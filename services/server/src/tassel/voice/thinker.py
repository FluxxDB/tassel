"""One background reasoning request per session, with bounded, expiring tutor notes."""

import asyncio
import base64
import difflib
import re
import time
from copy import deepcopy
from functools import partial

import cv2
import numpy as np
from openai import APIConnectionError, AsyncOpenAI
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.beats.processor import FlushSpeechFrame
from tassel.vision.turn_image import NO_VIEW
from tassel.voice.action_checker import TargetLanguage, check_tags, talker_allowed
from tassel.voice.director import ERASE, RESTORE, report_usage, rules
from tassel.voice.erase import (
    CLAIMS_REMOVAL,
    COULD_NOT_ERASE,
    ERASED,
    clears_kept,
    kept_items,
    pick,
    removes,
)
from tassel.voice.history import windowed
from tassel.voice.illustrator import Illustrator
from tassel.voice.ladder import Ladder
from tassel.voice.pointer import MarkIntent, Pointer, image_mark_tags, mark_tags
from tassel.voice.prompts import thinker_system_prompt
from tassel.voice.settings import VoiceSettings
from tassel.voice.stage import StageDrawing


class GuidanceBrief(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    page: str
    intent: str
    diagnosis: str
    plan: list[str] = Field(min_length=1, max_length=4)
    say: str = Field(min_length=1)
    board: list[str]
    paper: list[str]
    marks: list[MarkIntent] = Field(default_factory=list)
    # Her own image (one she sent in the chat): marks in words for the Pointer, or raw
    # [[image …]] tags as a fallback, as paper has marks and paper.
    image_marks: list[MarkIntent] = Field(default_factory=list)
    image: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    followups: list[str]
    language: TargetLanguage | None = None
    draw: str | None = None


# A brief's completion room: an answer at effort "none" is short; a brief that thinks (a
# construction, or the ladder's redraw with its highlights and one step per spoken sentence)
# needs room for its reasoning and every tag, or it is cut off mid-JSON.
BRIEF_TOKENS = 1200
DRAWN_BRIEF_TOKENS = 4000


def make_thinker(settings: VoiceSettings):
    return Thinker(settings) if settings.two_tier_enabled else None


class Thinker:
    def __init__(self, settings: VoiceSettings, *, client=None):
        self.settings = settings
        self.on_usage = None
        self.ideal_tutor = ""
        self.learner_notes = ""
        # The transcript's log, which the coordinator sets: retries are on the record.
        self.log = None
        self.client = client or AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value(), max_retries=0, timeout=20
        )

    async def think(self, messages: list[dict], effort=None) -> GuidanceBrief:
        effort = effort or self.settings.thinker_effort
        if self.settings.thinker_model.startswith("gpt-6-astra") and effort == "none":
            effort = "low"  # astra refuses "none"
        request = [
            {
                "role": "system",
                "content": thinker_system_prompt(
                    GuidanceBrief.model_json_schema(), ideal_tutor=self.ideal_tutor
                )
                + self.learner_notes,
            },
            *deepcopy(messages),
        ]
        resent = stripped = invalid = False
        while True:
            try:
                response = await self.client.chat.completions.create(
                    model=self.settings.thinker_model,
                    reasoning_effort=effort,
                    messages=request,
                    response_format={"type": "json_object"},
                    max_completion_tokens=BRIEF_TOKENS if effort == "none" else DRAWN_BRIEF_TOKENS,
                )
            except (APIConnectionError, TimeoutError) as error:
                reason = type(error).__name__
                if isinstance(error, APIConnectionError) and _has_images(request) and not resent:
                    # This network drops some image uploads at once (bad record mac): the live
                    # eval 20261018-133513 lost her image on two turns of three that way. Send it
                    # again with the image before going on without it.
                    resent = True
                    self._log("thinker_retry", reason=reason, images=True)
                    continue
                if stripped:
                    raise
                stripped = True
                self._log("thinker_retry", reason=reason, images=False)
                request = deepcopy(request)
                for message in request:
                    if isinstance(message.get("content"), list):
                        message["content"] = [
                            p
                            for p in message["content"]
                            if p.get("type") not in ("image", "image_url")
                        ]
                request.append({"role": "system", "content": NO_VIEW})
                continue
            report_usage(self.on_usage, "thinker:" + self.settings.thinker_model, response)
            content = response.choices[0].message.content or ""
            try:
                return GuidanceBrief.model_validate_json(content)
            except ValidationError:
                if invalid:
                    raise
                invalid = True
                request.append(
                    {
                        "role": "system",
                        "content": "The brief was invalid. Return every required schema field with "
                        "the correct types, 1–4 plan steps, confidence from 0 to 1.",
                    }
                )

    def _log(self, event, **data):
        if self.log is not None:
            self.log(event, **data)

    async def close(self):
        await self.client.close()


def _has_images(request) -> bool:
    return any(
        isinstance(m.get("content"), list)
        and any(p.get("type") in ("image", "image_url") for p in m["content"])
        for m in request
    )


INTENT = re.compile(
    r"\b(draw|mark|highlight|check|circle|find (?:a |the |my )?mistake|explain why)\b", re.I
)
PAPER = re.compile(r"\b(on my paper|my camera|on (?:the )?camera|circle mine)\b", re.I)
AUTOMATA = re.compile(r"\b(?:dfa|nfa|automat\w*|state machine|accept\w*|regex|language)\b", re.I)
NOTE_PREFIX = "[tutor notes]"
THINKER_WINDOW = 12
MARK_ID = re.compile(r"\bm\d+\b")
# A structured value: digits joined by dots, slashes, colons or hyphens (an IP, a CIDR, a date).
# What a page read and the learner memory can disagree about; plain numbers and states are not.
FACT = re.compile(r"(?<![\w.])\d+(?:[./:-]\d+)+(?!\w)")


def facts(text: str) -> set[str]:
    return set(FACT.findall(text or ""))


def fact_shape(fact: str) -> str:
    if re.fullmatch(r"\d+(?:\.\d+){3}/\d+", fact):
        return "cidr"
    if re.fullmatch(r"\d+(?:\.\d+){3}", fact):
        return "dotted"
    return "other"


def _replace_fact(text: str, fact: str, replacement: str | None) -> str:
    if replacement is not None:
        return text.replace(fact, replacement)
    # The value goes, with the quotes around it; the words around it stay.
    text = re.sub(r"[\"“”']?" + re.escape(fact) + r"[\"“”']?", "", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def _similar(a: str, b: str) -> bool:
    return difflib.SequenceMatcher(None, a.casefold(), b.casefold()).ratio() > 0.7


def _image_url(image: bytes) -> str:
    kind = "png" if image[:8] == b"\x89PNG\r\n\x1a\n" else "jpeg"
    return f"data:image/{kind};base64," + base64.b64encode(image).decode()


# What the talker may read of a brief: the reasoning, never the words or tags (see _done).
NOTE_FIELDS = {"page", "intent", "diagnosis", "plan", "confidence", "followups"}


def _done(brief) -> str:
    """What the last brief did, in words, for the notes: never its tags."""
    parts = []
    if brief.board or brief.draw:
        parts.append("changed the board")
    if brief.paper:
        parts.append("marked her paper")
    if getattr(brief, "image", None):
        parts.append("marked her image")
    return " and ".join(parts) or "answered without drawing"


# Older contexts may still hold this note; the talker no longer bridges thinker turns.
BRIDGE_PREFIX = "[thinker pending]"


def ink_signature(image: bytes | None):
    if image is None:
        return None
    decoded = cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_GRAYSCALE)
    if decoded is None:
        return None
    return cv2.resize(decoded, (128, 128), interpolation=cv2.INTER_AREA) < 150


class TutorCoordinator:
    def __init__(
        self,
        thinker,
        board: BoardContext,
        *,
        transcript=None,
        ttl_s=300,
        lang=lambda: "en",
        illustrator=None,
        pointer=None,
        on_brief=None,
        reply_timeout_s=30.0,
    ):
        self.thinker, self.board, self.transcript = thinker, board, transcript
        if thinker is not None and hasattr(thinker, "log") and thinker.log is None:
            thinker.log = self.log
        # The longest she waits for a thinker reply before Ada says she couldn't finish.
        self.reply_timeout_s = reply_timeout_s
        self.on_brief = on_brief
        self.illustrator = illustrator
        self.pointer = pointer
        self.page_image = None
        self.page_caption = ""
        self.illustrator_task = None
        self.diagram_delivered = False
        self.ttl_s = ttl_s
        self.lang = lang
        self.task = None
        self.generation = 0
        self.context = None
        self.text = ""
        self.messages = []
        self.notes = []
        self.expires = 0
        self.ink = None
        self.delivered = False
        self.decision = None
        # The whiteboard ladder for her current problem, and this turn's rung (step, attempt).
        self.ladder = Ladder()
        self.rung: tuple[int | None, bool] = (None, False)
        self._page = None
        self._board_page = None
        self.attachments = []
        # Her latest image for this turn (``chat.student_image.StudentImage``), once fetched.
        self.student_image = None
        self._student_image = None

    def log(self, event, **data):
        if self.transcript:
            self.transcript.record(event, data)

    def pending(self):
        return self.task is not None and not self.delivered

    async def cancel(self):
        self.generation += 1
        drawing = self.illustrator_task
        if drawing and drawing.done() and not drawing.cancelled() and not self.diagram_delivered:
            item = drawing.result()
            if item:
                self.board.pending_diagrams.pop(item, None)
        tasks = [t for t in (self.task, self.illustrator_task) if t is not None]
        self.task = self.illustrator_task = None
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self.diagram_delivered = False

    def _notes_context(self):
        if self.context is None:
            return
        messages = self.context.get_messages()
        messages[:] = [
            m
            for m in messages
            if not (
                m.get("role") == "system"
                and isinstance(m.get("content"), str)
                and m["content"].startswith((NOTE_PREFIX, BRIDGE_PREFIX))
            )
        ]
        if self.notes:
            older = "\n".join(f"{n.intent}: {n.diagnosis}" for n in self.notes[:-1])
            # Mark IDs belong to one image; the next frame renumbers them (retest #8 circled
            # the wrong state with a stale m14). Never her last words or tags: the talker read
            # them back on unrelated turns ("I'll remove the three PCs", [[undo]], 2de450e6).
            last = self.notes[-1]
            latest = last.model_dump_json(include=NOTE_FIELDS)
            done = _done(last)
            messages.append(
                {
                    "role": "system",
                    "content": MARK_ID.sub(
                        "a mark",
                        f"{NOTE_PREFIX}\n{older}\n{latest}\nAlready done last turn: {done}. "
                        "Never say it again or redo it unless she asks.",
                    ),
                }
            )

    async def prepare(
        self,
        context,
        text: str,
        image: bytes | None = None,
        *,
        decision=None,
        page=None,
        board_page=None,
        attachments=None,
        student_image=None,
    ):
        """page: an async callable returning (image, caption[, ink]) or None, awaited by the
        thinker so the talker's bridge never waits for the camera. board_page returns PNG
        bytes or None and is fetched only for board-focused thinker turns. attachments: the
        images she sent with a typed message (``chat.store.LoadedAttachment``), for this turn.
        student_image: an async callable returning her latest image with its Set-of-Mark
        (``chat.student_image.StudentImage``) or None, for a turn about her image: the thinker
        sees it numbered, and its marks go on it."""
        await self.cancel()
        self.rung = self.ladder.take()
        self.context, self.text = context, text
        self.attachments = list(attachments or [])
        self._student_image, self.student_image = student_image, None
        self.decision = decision
        self.delivered = False
        self._page = page
        self._board_page = board_page
        self.page_image = image
        self.page_caption = ""
        current = ink_signature(image)
        changed = (
            current is not None
            and self.ink is not None
            and float(np.mean(current != self.ink)) > 0.015
        )
        if changed or time.monotonic() > self.expires:
            self.notes.clear()
        self._new_work(current)
        # Compare against the last brief's page, so small edits accumulate.
        if not self.notes:
            self.ink = current
        self._notes_context()
        # The thinker sees the last 6 exchanges; the notes carry what came before.
        self.messages = windowed(deepcopy(context.get_messages()), THINKER_WINDOW)
        if (
            decision.route == "thinker"
            if decision
            else INTENT.search(text) or PAPER.search(text) or changed
        ):
            self.trigger()
        self._notes_context()

    def _new_work(self, ink):
        """Her ink changed past the notes' threshold since the ladder began: a ladder turn
        diagnoses her new work from step 0."""
        if self.ladder.see(ink) and self.rung[0] is not None:
            self.ladder.begin("paper")
            self.ladder.see(ink)
            self.rung = self.ladder.take()
            self.log("ladder", step=0, reason="new work")

    def _add_rung(self):
        """This turn's rung for the thinker: the ladder's step, or the playbook's for the
        director's action."""
        decision = self.decision
        step, attempt = self.rung
        if step is not None:
            note = LADDER[step]
            if attempt:
                note = ATTEMPT + note.removeprefix("[app note] ")
            self.messages.append({"role": "system", "content": note})
            self.log("ladder", step=step, attempt=attempt)
            return
        if decision is None:
            return
        where = "board" if decision.refers_to == "board" else "paper"
        rung = RUNGS.get((decision.action, where))
        traced = any("[[dfa yours" in t for n in self.notes[-1:] for t in n.board)
        if decision.action == "trace" and where == "paper" and traced:
            rung = CONTRAST
        if rung:
            self.messages.append({"role": "system", "content": rung})

    def trigger(self):
        if self.thinker is None or (self.decision and self.decision.route != "thinker"):
            return
        if self.task is None:
            self.task = asyncio.create_task(self._run(self.generation))

    async def _run(self, generation):
        started = time.monotonic()
        try:
            if self._page is not None:
                await self._attach_page()
                if generation != self.generation:
                    return None
            if (
                self._board_page is not None
                and self.decision is not None
                and (self.decision.refers_to == "board" or self.decision.focus == "board")
            ):
                await self._attach_board_page()
                if generation != self.generation:
                    return None
            if self._student_image is not None:
                await self._attach_image()
                if generation != self.generation:
                    return None
            if self.attachments or self.student_image is not None:
                self._attach_student_images()
            self._add_rung()
            effort = None
            if self.rung[0] in (1, 2):
                # The ladder's redraw, highlights and trace: an exact copy of her work and one
                # step per sentence take a little thought (and DRAWN_BRIEF_TOKENS of room).
                settings = getattr(self.thinker, "settings", None)
                effort = getattr(settings, "thinker_draw_effort", "low")
            elif (
                self.decision
                and self.decision.action == "draw_board"
                and AUTOMATA.search(self.text)
            ):
                # Automata are checked by the exact verifier; give them more thought. Other
                # diagrams are the Illustrator's, so the brief stays fast.
                settings = getattr(self.thinker, "settings", None)
                effort = getattr(settings, "thinker_draw_effort", "low")
            elif self.decision and self.decision.action == "mark_image":
                # Reading her image's arrows and lines at "none" got them wrong (live eval
                # 20261018-133513: "no outgoing arrow from q2"); marks take a little thought.
                settings = getattr(self.thinker, "settings", None)
                effort = getattr(settings, "thinker_draw_effort", "low")
            brief = await self._brief(generation, self.messages, effort)
            if brief is None:
                return None
            said = [n.say for n in self.notes[-3:]]
            tracing = any(STEP.match(t) for t in brief.board + brief.paper)
            # The ladder's step 0 asks the same question by design ("Can you spot it?").
            asking = self.rung[0] == 0
            if not tracing and not asking and any(_similar(brief.say, old) for old in said):
                # Retest #8: the same sentence three times. Change words and tools instead.
                self.log("reject", source="repeat", text=brief.say)
                retry = await self._brief(
                    generation,
                    [
                        *self.messages,
                        {
                            "role": "system",
                            "content": "[app note] You already said: "
                            + " | ".join(said)
                            + " The student still doesn't follow. Say something new and move "
                            "up the playbook's ladder on the board: copy her machine there as "
                            "yours and trace the counterexample step by step, or draw the "
                            "correct one if you already did.",
                        },
                    ],
                    effort,
                )
                if retry is None:
                    return None
                brief = retry
            decision = self.decision or rules(self.text)
            if brief.draw and ERASE.search(self.text):
                # Erasing is [[clear ITEM]] or [[undo]], never a drawing: the eval's "erase the
                # network" came back as the same diagram redrawn, with "The network is erased."
                self.log("reject", source="draw", reason="erase request")
                brief = brief.model_copy(update={"draw": None})
            if (
                decision.action == "draw_board"
                and ERASE.search(self.text)
                and not RESTORE.search(self.text)
            ):
                brief = self._honest_erase(brief, decision)
            if self._illustrator_takes_over(brief, decision):
                # The brief said it would draw but carried nothing to draw (live test: "I'll add
                # two PCs in each zone", then nothing): the Illustrator draws her request itself.
                self.log("draw_fallback", text=self.text)
                # Her words and the brief's own plan: "add the PCs back" alone told the
                # Illustrator nothing about which PCs (2de450e6).
                intent = f"{brief.say} (She asked: {self.text})" if brief.say else self.text
                brief = brief.model_copy(update={"draw": intent})
            if brief.draw and (
                decision.action == "draw_board"
                or (decision.action in ("explain", "trace") and decision.refers_to == "board")
            ):
                self.illustrator_task = asyncio.create_task(self._draw(brief.draw, generation))
            self.notes = [*self.notes[-3:], brief]
            self.expires = time.monotonic() + self.ttl_s
            self.ladder.record(*self.rung, brief)
            self.log("thinker_brief", brief=brief.model_dump())
            self._notes_context()
            return brief
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.log("reject", source="thinker", reason=type(error).__name__)
            return None
        finally:
            self.log("thinker_duration", ms=(time.monotonic() - started) * 1000)

    def _honest_erase(self, brief, decision):
        """An erase turn takes off what she named and never what she keeps: a brief with no
        surviving clear or undo gets one picked from her words, or, when they fit no single
        item, the plain line that Ada couldn't tell, never a claim that it's gone (clear-one)."""
        kept = kept_items(self.text, self.board)
        board = []
        for tag in brief.board:
            if removes(tag) and clears_kept(tag, kept):
                self.log("reject", source="erase", text=tag, reason="clears what she keeps")
            else:
                board.append(tag)
        say = brief.say
        if not any(removes(t) for t in board):
            picked = pick(self.text, self.board)
            checked = (
                check_tags(board + picked, decision, self.board, student_text=self.text)
                if picked
                else None
            )
            if checked is None or checked.repair or any(t in checked.rejected for t in picked):
                self.log("reject", source="erase", reason="no single item fits", text=self.text)
                return brief.model_copy(
                    update={"board": board, "say": COULD_NOT_ERASE[self.lang()]}
                )
            self.log("erase_pick", tags=picked)
            board = [*board, *picked]
            if not CLAIMS_REMOVAL.search(say):
                say = ERASED[self.lang()]
        return brief.model_copy(update={"board": board, "say": say})

    async def _draw(self, intent, generation):
        started = time.monotonic()
        try:
            if self.illustrator is None:
                self.illustrator = Illustrator(self.thinker.settings, log=self.log)
                chat = getattr(self.illustrator, "client", None)
                if chat is not None and hasattr(chat, "on_usage"):
                    chat.on_usage = getattr(self.thinker, "on_usage", None)
            result = await self.illustrator.draw(intent, deepcopy(self.board), self.lang())
            if result is None or generation != self.generation:
                return None
            item, spec = result
            if self.board.diagrams.get(item) == spec:
                # The same diagram again changes nothing: not "Here it is." (2de450e6).
                self.log("reject", source="illustrator", reason="unchanged")
                return None
            self.board.pending_diagrams[item] = spec
            self.log(
                "illustrator_brief",
                item=item,
                nodes=len(spec.nodes),
                groups=len(spec.groups),
                edges=len(spec.edges),
            )
            return item
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.log("reject", source="illustrator", reason=type(error).__name__)
            return None
        finally:
            self.log("illustrator_duration", ms=(time.monotonic() - started) * 1000)

    async def diagram_result(self):
        task, generation = self.illustrator_task, self.generation
        if task is None or self.diagram_delivered:
            return None
        try:
            item = await asyncio.shield(task)
        except asyncio.CancelledError:
            if asyncio.current_task().cancelling():
                raise
            return None
        if generation != self.generation or self.diagram_delivered:
            return None
        self.diagram_delivered = True
        return f"[[diagram {item}]]" if item else None

    async def _attach_page(self):
        """The turn's page, fetched while the talker bridges: the thinker gets it, the talker
        never waits for it."""
        page, self._page = self._page, None
        self.page_image, self.page_caption = None, ""
        result = await page()
        user = next((m for m in reversed(self.messages) if m.get("role") == "user"), None)
        if user is None:
            return
        text = user["content"] if isinstance(user["content"], str) else self.text
        if result and result[0]:
            image, caption = result[0], result[1]
            self.page_image, self.page_caption = image, caption
            ink = result[2] if len(result) > 2 and result[2] else image
            current = ink_signature(ink)
            self._new_work(current)
            if (
                current is not None
                and self.ink is not None
                and float(np.mean(current != self.ink)) > 0.015
            ):
                # Her page changed since the notes: they describe old ink.
                self.notes.clear()
                self.messages[:] = [
                    m
                    for m in self.messages
                    if not (
                        isinstance(m.get("content"), str) and m["content"].startswith(NOTE_PREFIX)
                    )
                ]
            if not self.notes:
                self.ink = current
            user["content"] = [
                {"type": "text", "text": text},
                {"type": "text", "text": caption},
                {"type": "image_url", "image_url": {"url": _image_url(image)}},
            ]
        else:
            user["content"] = [{"type": "text", "text": text}, {"type": "text", "text": NO_VIEW}]

    def _attach_student_images(self):
        """The images she sent with this turn's message, after her words and her page; her
        latest image, on a turn about it, numbered with its legend in place of its pixels."""
        from tassel.chat.turns import marked_image_blocks, with_images

        user = next((m for m in reversed(self.messages) if m.get("role") == "user"), None)
        if user is None:
            return
        image = self.student_image
        raw = [a for a in self.attachments if image is None or a.id != image.id]
        content = with_images(user["content"], raw)
        if image is not None:
            content = [*content, *marked_image_blocks(image)]
        user["content"] = content

    async def _attach_image(self):
        """Her latest image, fetched with the thinker's turn: what its tags act on now."""
        fetch, self._student_image = self._student_image, None
        try:
            image = await fetch()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.log("reject", source="student_image", reason=type(error).__name__)
            image = None
        self.student_image = image
        if image is not None:
            self.board.image = image.stage()

    async def _attach_board_page(self):
        page, self._board_page = self._board_page, None
        try:
            image = await page()
        except TimeoutError:
            return
        if image is None:
            return
        user = next((m for m in reversed(self.messages) if m.get("role") == "user"), None)
        if user is None:
            return
        content = user["content"]
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        user["content"] = [
            *content,
            {
                "type": "text",
                "text": "[board] The shared whiteboard right now, including anything the student "
                "drew or moved. Ada's own items are listed in the board items; anything else "
                "is the student's.",
            },
            {"type": "image_url", "image_url": {"url": _image_url(image)}},
        ]

    async def _point(self, brief, decision, generation):
        if not brief.marks or not (
            decision.action == "mark_paper"
            or (decision.action == "trace" and decision.refers_to == "paper")
        ):
            return brief
        started = time.monotonic()
        try:
            elements = self.board.paper_elements
            if self.page_image is None or elements is None or elements.detected is None:
                raise ValueError("No current marked page")
            if self.pointer is None:
                self.pointer = Pointer(self.thinker.settings, log=self.log)
                self.pointer.client.on_usage = getattr(self.thinker, "on_usage", None)
            frame = self.board.paper_frame
            detected = elements.detected
            resolved = await self.pointer.resolve(
                brief.marks,
                self.page_image,
                self.page_caption,
                detected.items,
                size=(detected.width, detected.height),
            )
            if generation != self.generation or frame != self.board.paper_frame:
                return brief.model_copy(update={"paper": []})
            return brief.model_copy(update={"paper": mark_tags(resolved)})
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.log("reject", source="pointer", reason=type(error).__name__)
            return brief
        finally:
            self.log("pointer_duration", ms=(time.monotonic() - started) * 1000)

    def _page_over_memory(self, brief):
        """A value the learner memory holds, which this page's earlier reads contradict, never
        stands in page or a mark target: the reads' own value replaces it, or, when they name
        several, it goes. Her words, the legend and the reads make a value current; a page
        with no read to disagree is left to the image. Live session 3d8b1d78: the memory's
        10.0.0.0/24 became the page read and the Pointer's target over a paper that said
        192.168.1.0/24."""
        memory = facts(getattr(self.thinker, "learner_notes", "") or "")
        if not memory:
            return brief
        reads = {f for note in self.notes for f in facts(note.page)}
        current = reads | facts(self.page_caption) | facts(self.text)
        written = facts(brief.page) | {f for m in brief.marks for f in facts(m.target)}
        page, marks = brief.page, list(brief.marks)
        for fact in sorted((memory - current) & written):
            same = {f for f in reads if f != fact and fact_shape(f) == fact_shape(fact)}
            if not same:
                continue
            replacement = next(iter(same)) if len(same) == 1 else None
            self.log("memory_not_paper", fact=fact, page=replacement)
            page = _replace_fact(page, fact, replacement)
            marks = [
                m.model_copy(update={"target": _replace_fact(m.target, fact, replacement)[:80]})
                for m in marks
            ]
        marks = [m for m in marks if m.target]
        return brief.model_copy(update={"page": page, "marks": marks})

    async def _point_image(self, brief, decision, generation):
        """Her image's marks in words, resolved by the Pointer on that image: on a mark_image
        turn the brief's paper-style marks are the image's too."""
        on_image = decision.action == "mark_image" or decision.refers_to == "image"
        intents = brief.image_marks or (brief.marks if decision.action == "mark_image" else [])
        if on_image and not intents and not brief.image and decision.action == "mark_image":
            # She asked for a mark and the brief withheld it (live eval: a question instead of
            # the circle): her own words are the mark, on the closest element.
            intent = intent_from_words(self.text)
            self.log("image_mark_fallback", verb=intent.verb, target=intent.target)
            intents = [intent]
        if not on_image or not intents:
            return brief
        started = time.monotonic()
        try:
            image = self.student_image
            if image is None:
                raise ValueError("No student image")
            if self.pointer is None:
                self.pointer = Pointer(self.thinker.settings, log=self.log)
                self.pointer.client.on_usage = getattr(self.thinker, "on_usage", None)
            view = image.view
            resolved = await self.pointer.resolve(
                intents,
                view.marked_jpeg,
                view.legend_text,
                view.elements,
                size=(view.width, view.height),
            )
            on_stage = self.board.image
            if generation != self.generation or on_stage is None or on_stage.id != image.id:
                return brief.model_copy(update={"image": []})
            return brief.model_copy(update={"image": image_mark_tags(resolved)})
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.log("reject", source="pointer", reason=type(error).__name__)
            return brief
        finally:
            self.log("pointer_duration", ms=(time.monotonic() - started) * 1000)

    async def _think(self, messages, effort):
        brief = lift_say_tags(await self.thinker.think(messages, effort=effort))
        return self._page_over_memory(brief)

    async def _brief(self, generation, messages, effort):
        brief = await self._think(messages, effort)
        if generation != self.generation:
            return None
        decision = self.decision or rules(self.text)
        brief = await self._point(brief, decision, generation)
        if generation != self.generation:
            return None
        brief = await self._point_image(brief, decision, generation)
        if generation != self.generation:
            return None
        checked = await asyncio.to_thread(
            partial(check_tags, student_text=self.text),
            brief.board + brief.paper + brief.image,
            decision,
            self.board,
            brief.language,
        )
        if checked.repair:
            self.log("reject", source="action_checker", reason=checked.repair)
            original_language = brief.language
            try:
                repaired = await self._think(
                    [
                        *messages,
                        {
                            "role": "system",
                            "content": "Repair this drawing once: "
                            + checked.repair
                            + " Keep the same target language and director action. "
                            "Previous brief: " + brief.model_dump_json(),
                        },
                    ],
                    effort,
                )
                # A repair may not evade verification by removing/changing the target.
                brief = repaired.model_copy(update={"language": original_language})
                brief = await self._point(brief, decision, generation)
                brief = await self._point_image(brief, decision, generation)
                checked = await asyncio.to_thread(
                    partial(check_tags, student_text=self.text),
                    brief.board + brief.paper + brief.image,
                    decision,
                    self.board,
                    original_language,
                )
            except Exception:
                checked.tags = []
            if generation != self.generation:
                return None
        for tag in checked.rejected:
            self.log("reject", source="action_checker", text=tag)
        wanted = brief.board + brief.paper
        brief = brief.model_copy(
            update={
                "board": [t for t in brief.board if t in checked.tags],
                "paper": [t for t in brief.paper if t in checked.tags],
                "image": [t for t in brief.image if t in checked.tags],
            }
        )
        return self._honest_tags(wanted, self.validate_tags(brief))

    def _honest_tags(self, wanted, brief):
        """The say never narrates what the checks took out (owner's live session: every board
        tag of a paper trace rejected, and Ada still walked through "one takes you to the
        middle state" over an empty board). A trace with no surviving trace tag becomes the
        plain line that it couldn't be shown, and its orphan steps go with it; a drawing or
        mark that left nothing visible is said plainly after her words."""
        asked, kept = _verbs(wanted), _verbs(brief.board + brief.paper)
        lang = self.lang()
        if asked & TRACE_VERBS and not kept & TRACE_VERBS:
            self.log("reject", source="honest_tags", reason="trace lost", text=brief.say)
            paper = [t for t in brief.paper if not STEP.match(t)]
            return brief.model_copy(
                update={
                    "board": [t for t in brief.board if not STEP.match(t)],
                    "paper": paper if any(not FREEZE.match(t) for t in paper) else [],
                    "say": NOT_TRACED[lang],
                }
            )
        if brief.board or brief.paper or brief.draw:
            return brief
        decision = self.decision or rules(self.text)
        if asked & DRAWING_VERBS:
            if self._illustrator_takes_over(brief, decision) or ERASE.search(self.text):
                # The Illustrator draws her request itself (result says so if it can't), and an
                # erase turn's honesty is _honest_erase's.
                return brief
            self.log("reject", source="honest_tags", reason="drawing lost", text=brief.say)
            return brief.model_copy(update={"say": f"{brief.say.rstrip()} {NOT_DRAWN[lang]}"})
        if asked & MARK_VERBS:
            self.log("reject", source="honest_tags", reason="mark lost", text=brief.say)
            return brief.model_copy(update={"say": f"{brief.say.rstrip()} {NOT_MARKED[lang]}"})
        return brief

    def _illustrator_takes_over(self, brief, decision) -> bool:
        """A draw turn whose brief carries nothing to draw goes to the Illustrator, unless it
        is an automaton (the exact verifier's), an erase, or a ladder rung (her words there are
        "no", nothing to draw: the rung's brief draws, or says plainly that it couldn't)."""
        return bool(
            decision.action == "draw_board"
            and self.rung[0] is None
            and not brief.board
            and not brief.draw
            and not AUTOMATA.search(self.text)
            and not ERASE.search(self.text)
        )

    def validate_tags(self, brief):
        context = deepcopy(self.board)
        decision = self.decision or rules(self.text)
        # Her paper never gets a board diagram in its place, except the playbook's trace and the
        # ladder's steps 1 and 2: her machine is copied to the board as yours and traced there,
        # beside her page (the stage manager opens the split view), even when her words name
        # her paper.
        paper_only = (
            bool(PAPER.search(self.text))
            and not re.search(r"\bboard\b", self.text, re.I)
            and decision.action != "trace"
            and self.rung[0] not in (1, 2)
        )
        valid = {"board": [], "paper": [], "image": []}
        for location in valid:
            for tag in getattr(brief, location):
                candidate = deepcopy(context)
                stream = MarkupStream(candidate)
                sentences = stream.feed(tag + " Validate.") + stream.flush()
                actions = [a for sentence in sentences for _, a in sentence.anchors]
                problems = [p for sentence in sentences for p in sentence.problems]
                good = bool(re.fullmatch(r"\[\[[^\[\]]+\]\]", tag)) and bool(actions)
                good = good and not problems
                good = good and all(a.kind.startswith(location + ".") for a in actions)
                if location == "board" and paper_only:
                    good = False
                if location == "paper":
                    ids = set(re.findall(r"\bm\d+\b", tag))
                    elements = context.paper_elements
                    known = (
                        {el.id for el in elements.detected.items}
                        if (elements and elements.detected)
                        else set()
                    )
                    good = good and ids <= known and context.paper_frame is not None
                if location == "image":
                    # Only markers on her image as the thinker saw it.
                    image = context.image
                    ids = set(re.findall(r"\bm\d+\b", tag))
                    known = (
                        {el.id for el in image.detected.items}
                        if image is not None and image.detected is not None
                        else set()
                    )
                    good = good and image is not None and ids <= known
                if good:
                    valid[location].append(tag)
                    context = candidate
                else:
                    self.log("reject", source="thinker_tag", text=tag)
        # Freeze only with marks, and always pin the exact page used for the brief.
        marks = [t for t in valid["paper"] if not re.match(r"\[\[freeze\b", t)]
        valid["paper"] = ["[[freeze]]", *marks] if marks else []
        # Her image is shown before it's marked: an image she just sent goes up with the marks.
        image = [t for t in valid["image"] if not IMAGE_SHOW.match(t)]
        valid["image"] = ["[[image show]]", *image] if any(map(IMAGE_MARK.match, image)) else image

        def drop_spoken_tag(match):
            self.log("reject", source="thinker_say_tag", text=match.group())
            return ""

        say = re.sub(r"\[\[.*?(?:\]\]|$)", drop_spoken_tag, brief.say, flags=re.S)
        return brief.model_copy(update={**valid, "say": say})

    async def result(self):
        task, generation = self.task, self.generation
        if task is None or self.delivered:
            return None
        try:
            brief = await asyncio.shield(task)
        except asyncio.CancelledError:
            if asyncio.current_task().cancelling():
                raise
            return None
        if generation != self.generation:
            return None
        self.delivered = True
        if brief and self.illustrator_task and self.illustrator_task.done():
            tag = await self.diagram_result()
            if tag:
                brief = brief.model_copy(update={"board": [tag, *brief.board]})
            else:
                # Never leave "I'll draw it" standing when nothing was drawn.
                brief = brief.model_copy(update={"say": f"{brief.say} {NOT_DRAWN[self.lang()]}"})
        if brief:
            brief = fill_silence(brief, self.lang())
        if brief and self.on_brief:
            await self.on_brief(brief, self.decision or rules(self.text))
        self._notes_context()
        return brief

    async def close(self):
        await self.cancel()
        if self.thinker is not None:
            await self.thinker.close()
        if self.illustrator is not None:
            await self.illustrator.close()
        if self.pointer is not None:
            await self.pointer.close()


STEP = re.compile(r"\[\[\s*p?step\b")
IMAGE_TAG = re.compile(r"\[\[\s*image\b", re.I)
IMAGE_SHOW = re.compile(r"\[\[\s*image\s+show\s*\]\]", re.I)
IMAGE_MARK = re.compile(
    r"\[\[\s*image\s+(?:circle|wash|number|strike|underline|check|callout)\b", re.I
)
FREEZE = re.compile(r"\[\[\s*freeze\b")
# A tag's verb, to tell what kind of thing the brief meant to show.
TAG_VERB = re.compile(r"\[\[\s*([A-Za-z]+)")
TRACE_VERBS = {"trace", "ptrace"}
DRAWING_VERBS = {"dfa", "nfa", "diagram", "add", "edge"}
MARK_VERBS = {"circle", "wash", "number", "strike", "underline", "check", "callout"}


def _verbs(tags) -> set[str]:
    found = (TAG_VERB.match(t) for t in tags)
    return {m.group(1).lower() for m in found if m}


PAPER_VERB = re.compile(
    r"\[\[\s*(?:freeze|circle|wash|number|strike|underline|check|callout|ptrace|pstep|live)\b"
)
SAY_TAG = re.compile(r"\[\[[^\[\]]*\]\]")
# The whiteboard ladder's steps (voice/ladder.py), one note per turn: the same ladder for every
# board topic, automata and diagrams alike. Board only: her paper gets marks only when she asks.
LADDER = {
    0: "[app note] Whiteboard ladder, step 0 (diagnose and ask): find her mistake yourself and "
    "keep it in diagnosis and followups. In say, tell her only that there's an error in her work "
    'and ask her to spot it, like "There\'s an error in your DFA. Can you spot it?" Name no '
    "state, edge, value or input, and draw nothing: board, paper and draw stay empty. If her "
    "work is right, say so in one short sentence instead.",
    1: "[app note] Whiteboard ladder, step 1 (show hers): she couldn't spot it. Start say with "
    '"Okay, let me help you out." Redraw HER work on the board exactly as she drew it, '
    "mistake included: an automaton as [[dfa yours ...]] (or nfa) with her states, arrows and "
    "accepting states; any other diagram (a network, a tree) through draw, with her own labels "
    "and values. Then [[highlight yours EL]] the states or edges that matter, and walk ONE "
    "input that breaks it through her copy: [[trace t yours INPUT student]], then one "
    "[[step t]] per symbol, each with one short spoken sentence naming the state that symbol "
    "reaches. For a diagram, put a short [[note]] on the wrong part and walk through it in "
    "short sentences instead of a trace. End with one question asking her to fix it. Nothing "
    "on her paper, and not the correct version yet.",
    2: "[app note] Whiteboard ladder, step 2 (show the correct one): she is still stuck after "
    "seeing her own work. Draw the correct machine on the board as fix (or the correct diagram "
    "through draw), [[highlight fix EL]] what changed, and walk an input it now handles "
    "correctly through it: [[trace t fix INPUT]], then one [[step t]] per symbol, each with one "
    "short spoken sentence. Say in one line what changed, then ask her to fix her own work to "
    "match. Nothing on her paper.",
}
# She answered the ladder's question with a try of her own ("is it q3?").
ATTEMPT = (
    "[app note] She answered your question with an attempt. If it is right, confirm it in a few "
    "words and ask her to fix it; draw nothing. If it is wrong or partial, do this instead: "
)
# Per-action guidance for the thinker on a turn off the ladder: what she asked for, explicitly.
RUNGS = {
    ("trace", "paper"): "[app note] Ladder step 1 (show hers): copy her machine exactly as drawn "
    "to the board as yours, then [[trace t yours INPUT student]] on the counterexample, with one "
    "[[step t]] per sentence after the first.",
    ("trace", "board"): "[app note] Trace on the board: [[trace t MACHINE INPUT]] on the machine "
    "already there, with one [[step t]] per sentence after the first.",
    ("mark_paper", "paper"): "[app note] She asked for marks on her paper: freeze, then circle or "
    "callout the exact state or edge on her paper, with a few words.",
    ("mark_image", "paper"): "[app note] Mark her image (the one captioned [image]), not her "
    "paper or the board: image_marks with each target in words; the Pointer finds its numbered "
    "candidate and the app shows the image. She asked for this mark: never withhold it. Mark "
    "what she named, or the closest element to it, then teach in say (a hint or a question "
    "about what the mark shows). No [image] attached: leave image_marks empty and say you "
    "can't see it.",
}

# She watched her machine traced and is still lost: the correct one, beside it.
CONTRAST = (
    "[app note] Ladder step 2 (show the correct one): you already traced her machine; do not "
    "trace it again. Draw the minimal fix on the board as fix, then [[trace t fix INPUT]] the "
    "target string on it, one [[step t]] per sentence, and say in one line what changed."
)


# Her mark verbs, in words: the first one she uses is the mark (highlight and mark circle).
_MARK_WORDS = (
    (re.compile(r"\b(?:cross(?:\s+(?:it|that|this|them))?\s+out|strike|cross)\b", re.I), "strike"),
    (re.compile(r"\bunderline\b", re.I), "underline"),
    (re.compile(r"\b(?:tick|check\s*mark|check)\b", re.I), "check"),
    (re.compile(r"\bwash\b", re.I), "wash"),
    (re.compile(r"\b(?:circle|highlight|mark|point (?:at|to)|show)\b", re.I), "circle"),
)
# What she said around her target: the request's lead-in and where it is ("in my screenshot").
_LEAD_IN = re.compile(
    r"^\W*(?:(?:now|ok(?:ay)?|so|and|then|please|can you|could you|would you|will you)\b[\s,]*)*",
    re.I,
)
_WHERE = re.compile(
    r"\s*\b(?:on|in|from|of)\s+(?:my|the|this|that)\s+(?:screen\s?shot|image|picture|photo|pic|"
    r"attachment)s?\b",
    re.I,
)


def intent_from_words(text: str) -> MarkIntent:
    """Her request as a mark in words for the Pointer: her verb, and what she named."""
    found = [
        (m.start(), m.end(), verb)
        for pattern, verb in _MARK_WORDS
        for m in [pattern.search(text)]
        if m
    ]
    verb = "circle"
    target = text
    if found:
        start, end, verb = min(found)
        target = text[end:]
    target = _WHERE.sub("", target)
    target = re.sub(r"\b(?:please|for me)\b", "", target, flags=re.I)
    target = " ".join(_LEAD_IN.sub("", target).split()).strip(" .,!?")
    return MarkIntent(verb=verb, target=(target or text.strip() or "it")[:80])


def lift_say_tags(brief):
    """Tags written inside say still count: move them to the paper or board list (compose
    places steps per sentence) instead of dropping them."""
    tags = SAY_TAG.findall(brief.say)
    if not tags:
        return brief
    image = [t for t in tags if IMAGE_TAG.match(t)]
    paper = [t for t in tags if PAPER_VERB.match(t)]
    board = [t for t in tags if not PAPER_VERB.match(t) and not IMAGE_TAG.match(t)]
    say = " ".join(SAY_TAG.sub(" ", brief.say).split())
    return brief.model_copy(
        update={
            "board": brief.board + board,
            "paper": brief.paper + paper,
            "image": brief.image + image,
            "say": say,
        }
    )


# Pacing: where a tag lands in what Ada says. A trace and its input, a highlight and its state.
TRACE_TAG = re.compile(r"\[\[\s*(?:trace\s+\S+\s+\S+|ptrace)\s+([^\s\]]+)")
POINT_TAG = re.compile(r"\[\[\s*(?:highlight|unhighlight|pulse)\s+\S+\s+([^\s\]]+)\s*\]\]")
VERDICT_TAG = re.compile(r"\[\[\s*verdict\b")
# The sentence that starts a walk: "Let's run zero one zero", "Watch this", "따라가 봐요".
WALK = re.compile(
    r"\b(?:run|runs|running|trace|tracing|walk|follow|feed|try|watch|step through|"
    r"start(?:s|ing)? (?:at|from|in)|recorr\w*|sig\w+|prueb\w*)\b|따라|넣어|추적|실행",
    re.I,
)
# Digits as Ada says them (en, es, ko), and the letters of state names.
DIGIT_WORDS = {
    "0": ("zero", "cero", "영", "공"),
    "1": ("one", "uno", "일"),
    "2": ("two", "dos", "이"),
    "3": ("three", "tres", "삼"),
    "4": ("four", "cuatro", "사"),
    "5": ("five", "cinco", "오"),
    "6": ("six", "seis", "육"),
    "7": ("seven", "siete", "칠"),
    "8": ("eight", "ocho", "팔"),
    "9": ("nine", "nueve", "구"),
}
DIGIT_OF = {word: digit for digit, words in DIGIT_WORDS.items() for word in words}
LETTER_SOUNDS = {"q": ("q", "큐", "cu")}


def _says_state(sentence: str, state: str) -> bool:
    """Whether the sentence names a state: "q3", "q 3", "q three", "큐 삼"."""
    found = re.fullmatch(r"([A-Za-z]+)(\d+)", state)
    if found is None:
        return bool(re.search(rf"(?<!\w){re.escape(state)}(?![0-9A-Za-z])", sentence, re.I))
    letters, number = found.groups()
    numbers = (number, *DIGIT_WORDS.get(number, ()))
    return any(
        re.search(rf"(?<!\w){re.escape(sound)}\s*{re.escape(n)}(?![0-9A-Za-z])", sentence, re.I)
        for sound in LETTER_SOUNDS.get(letters.lower(), (letters,))
        for n in numbers
    )


def _says_input(sentence: str, word: str) -> bool:
    """Whether the sentence names the input: "010", "0 1 0", "zero one zero"."""
    if len(word) < 2:
        return False
    digits = "".join(
        token if token.isdigit() else DIGIT_OF.get(token, "|")
        for token in re.findall(r"\w+", sentence.lower())
    )
    return word in digits


def _walk_start(sentences: list[str], trace: str, steps: int) -> int:
    """The sentence the trace starts on: the first that names its input or starts a walk, else
    the one that leaves a sentence for each step before a closing question."""
    found = TRACE_TAG.match(trace)
    word = found.group(1) if found else ""
    for i, sentence in enumerate(sentences):
        if _says_input(sentence, word) or WALK.search(sentence):
            return i
    last = len(sentences) - 1
    if len(sentences) > steps + 1 and sentences[-1].rstrip().endswith("?"):
        last -= 1
    return max(0, last - steps)


def compose(brief) -> str:
    """Tags land where Ada narrates them. Drawings lead; a [[trace]] lands before the sentence
    that starts the walk (it names the input, or says run, trace, walk…), then one [[step]]
    before each sentence after it, so the trace advances as she speaks; a highlight lands before
    the first sentence that names its state, or with the walk; a verdict comes with the last
    step. Steps beyond the last sentence follow it."""
    tags = brief.board + brief.paper + list(getattr(brief, "image", []))
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", brief.say.strip()) if s] or [""]
    trace = next((t for t in tags if TRACE_TAG.match(t)), None)
    steps = [t for t in tags if STEP.match(t)]
    points = [t for t in tags if POINT_TAG.match(t)]
    verdicts = [t for t in tags if trace and VERDICT_TAG.match(t)]
    moved = {id(t) for t in [*steps, *points, *verdicts]} | ({id(trace)} if trace else set())
    lead = [t for t in tags if id(t) not in moved]
    walk = _walk_start(sentences, trace, len(steps)) if trace else 0
    marks = [[] for _ in sentences]
    moves = [[] for _ in sentences]
    after = []
    if trace:
        moves[walk].append(trace)
    last = moves[walk]
    for k, step in enumerate(steps):
        i = walk + 1 + k
        last = moves[i] if i < len(sentences) else after
        last.append(step)
    last.extend(verdicts)
    for point in points:
        states = POINT_TAG.match(point).group(1).split(">")
        named = [i for i, s in enumerate(sentences) if all(_says_state(s, st) for st in states)]
        named = named or [
            i for i, s in enumerate(sentences) if any(_says_state(s, st) for st in states)
        ]
        marks[named[0] if named else walk].append(point)
    text = "".join(lead)
    for i, sentence in enumerate(sentences):
        text += "".join(marks[i]) + "".join(moves[i]) + sentence + " "
    return text.rstrip() + "".join(after)


# Said when a promised drawing didn't reach the board.
NOT_DRAWN = {
    "en": "I couldn't get that drawing onto the board. Could you say it another way?",
    "es": "No pude poner ese dibujo en la pizarra. ¿Puedes decirlo de otra forma?",
    "ko": "그 그림을 칠판에 그리지 못했어요. 다른 말로 다시 말해 주시겠어요?",
}

# Said in place of a trace narration when no trace reached the board or her paper.
NOT_TRACED = {
    "en": "I couldn't get that trace up for you to see. Could you ask me to trace it again?",
    "es": "No pude mostrarte ese recorrido. ¿Me pides de nuevo que lo recorra?",
    "ko": "그 추적 과정을 보여 드리지 못했어요. 다시 추적해 달라고 말해 주시겠어요?",
}

# Said after her words when a promised mark didn't reach her paper.
NOT_MARKED = {
    "en": "I couldn't put that mark on your paper.",
    "es": "No pude poner esa marca en tu hoja.",
    "ko": "그 표시를 종이에 하지 못했어요.",
}

# Said when the thinker's reply failed or didn't come in time.
NOT_FINISHED = {
    "en": "I couldn't finish checking that. Could you ask me again?",
    "es": "No pude terminar de revisarlo. ¿Puedes preguntarme otra vez?",
    "ko": "확인을 끝내지 못했어요. 다시 물어봐 주시겠어요?",
}
# Said for a reply that drew or marked something but had no words of its own.
LOOK = {
    "paper": {"en": "Take a look at your paper.", "es": "Mira tu hoja.", "ko": "종이를 보세요."},
    "board": {"en": "Take a look at the board.", "es": "Mira la pizarra.", "ko": "칠판을 보세요."},
    "image": {
        "en": "Take a look at your image.",
        "es": "Mira tu imagen.",
        "ko": "이미지를 보세요.",
    },
}


def spoken_words(text: str) -> str:
    """What of `text` is speech: everything but its [[tags]]."""
    return " ".join(SAY_TAG.sub(" ", text).split())


def fill_silence(brief, lang):
    """A reply always has words (paper-marks turn 3): tags alone mean no audio, and the TTS holds
    the response's end until its audio ends, so the turn would never end."""
    if spoken_words(brief.say):
        return brief
    if brief.paper:
        say = LOOK["paper"][lang]
    elif getattr(brief, "image", None):
        say = LOOK["image"][lang]
    elif brief.board:
        say = LOOK["board"][lang]
    else:
        say = NOT_FINISHED[lang]
    return brief.model_copy(update={"say": say})


# Longest bracketed aside held back from speech before it's treated as ordinary text.
META_MAX = 80


class ThinkerOutput(FrameProcessor):
    """Consume control tags before beats/TTS; continue the spoken turn with its brief."""

    def __init__(self, coordinator):
        super().__init__()
        self.coordinator = coordinator
        self.buffer = ""
        self._reset()

    def _reset(self):
        # This response so far: did it say any words, and where did it draw?
        self.heard = False
        self.marked = None

    async def _say(self, text):
        if spoken_words(text):
            self.heard = True
        tags = SAY_TAG.findall(text)
        if tags:
            paper = any(PAPER_VERB.match(t) for t in tags) or self.marked == "paper"
            image = any(IMAGE_TAG.match(t) for t in tags) or self.marked == "image"
            self.marked = "paper" if paper else "image" if image else "board"
        await self.push_frame(LLMTextFrame(text))

    async def _text(self, text, final=False):
        self.buffer += text
        while self.buffer:
            opening = self.buffer.find("[")
            if opening < 0:
                await self._say(self.buffer)
                self.buffer = ""
                break
            if opening:
                await self._say(self.buffer[:opening])
                self.buffer = self.buffer[opening:]
            if not self.buffer.startswith("[["):
                if len(self.buffer) == 1 and not final:
                    break  # "[" or "[[": wait for the next chunk.
                # Bracketed meta text ("[assistant turn omitted]", copied from the app's notes)
                # is never spoken; a stray "[" with no close soon after is ordinary text.
                close = self.buffer.find("]")
                if close < 0 and not final and len(self.buffer) < META_MAX:
                    break
                if 0 < close < META_MAX:
                    aside = self.buffer[: close + 1]
                    self.coordinator.log("reject", source="meta_text", text=aside)
                    self.buffer = self.buffer[close + 1 :].lstrip()
                else:
                    await self._say(self.buffer[:1])
                    self.buffer = self.buffer[1:]
                continue
            end = self.buffer.find("]]")
            if end < 0:
                if final:
                    self.buffer = ""
                break
            tag, self.buffer = self.buffer[: end + 2], self.buffer[end + 2 :]
            if re.fullmatch(r"\[\[\s*consult\s*\]\]", tag, re.I):
                self.coordinator.trigger()
            else:
                decision = self.coordinator.decision
                if decision:
                    # Structural drawings come only from the checked brief, never raw talker tags.
                    checked = check_tags(
                        [tag], decision, self.coordinator.board, allow=talker_allowed
                    )
                    structural = any(
                        kind
                        in (
                            "board.diagram",
                            "board.automaton",
                            "board.addState",
                            "board.addTransition",
                        )
                        for kind in checked.kinds
                    )
                    if not checked.tags or structural:
                        self.coordinator.log("reject", source="talker_tag", text=tag)
                        continue
                    if self.coordinator.on_brief:
                        drawing = StageDrawing(
                            board=[tag]
                            if any(k.startswith("board.") for k in checked.kinds)
                            else [],
                            paper=[tag]
                            if any(k.startswith("paper.") for k in checked.kinds)
                            else [],
                        )
                        await self.coordinator.on_brief(drawing, decision)
                        await self._say(compose(drawing) + (" " if drawing.say.strip() else ""))
                        continue
                await self._say(tag)

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, (InterruptionFrame, CancelFrame, EndFrame)):
                self.buffer = ""
                await self.coordinator.cancel()
            elif isinstance(frame, LLMFullResponseStartFrame):
                self.buffer = ""
                self._reset()
            elif isinstance(frame, LLMTextFrame):
                await self._text(frame.text)
                return
            elif isinstance(frame, LLMFullResponseEndFrame):
                await self._text("", final=True)
                await self.push_frame(FlushSpeechFrame())
                generation = self.coordinator.generation
                pending = self.coordinator.task is not None and not self.coordinator.delivered
                timed_out = False
                try:
                    async with asyncio.timeout(self.coordinator.reply_timeout_s):
                        brief = await self.coordinator.result()
                except TimeoutError:
                    # A thinker that never answers never silences her: the honest line, now.
                    self.coordinator.log("reject", source="thinker", reason="reply timeout")
                    await self.coordinator.cancel()
                    brief, timed_out = None, True
                if brief:
                    await self._say(compose(brief))
                    if self.coordinator.illustrator_task and not self.coordinator.diagram_delivered:
                        await self.push_frame(FlushSpeechFrame())
                        tag = await self.coordinator.diagram_result()
                        if tag:
                            words = {"en": "Here it is.", "es": "Aquí está.", "ko": "여기 있어요."}[
                                self.coordinator.lang()
                            ]
                            late = brief.model_copy(
                                update={"board": [tag], "paper": [], "draw": None, "say": words}
                            )
                            if self.coordinator.on_brief:
                                await self.coordinator.on_brief(
                                    late, self.coordinator.decision or rules(self.coordinator.text)
                                )
                            await self._say(compose(late))
                        else:
                            # Never leave "I'll draw it" standing when nothing was drawn.
                            await self._say(NOT_DRAWN[self.coordinator.lang()])
                elif timed_out or (pending and generation == self.coordinator.generation):
                    await self._say(NOT_FINISHED[self.coordinator.lang()])
                if self.marked and not self.heard:
                    # Tags alone are no audio, and the TTS holds this end until audio ends: the
                    # turn would never end (paper-marks turn 3, 90 s of silence).
                    await self._say(LOOK[self.marked][self.coordinator.lang()])
        await self.push_frame(frame, direction)

    async def cleanup(self):
        await self.coordinator.close()
        await super().cleanup()
