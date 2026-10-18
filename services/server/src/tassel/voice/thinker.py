"""One background reasoning request per session, with bounded, expiring tutor notes."""

import asyncio
import base64
import difflib
import re
import time
from copy import deepcopy

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
from tassel.voice.director import report_usage, rules
from tassel.voice.history import windowed
from tassel.voice.illustrator import Illustrator
from tassel.voice.pointer import MarkIntent, Pointer, mark_tags
from tassel.voice.prompts import thinker_system_prompt
from tassel.voice.settings import VoiceSettings


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
    confidence: float = Field(ge=0, le=1)
    followups: list[str]
    language: TargetLanguage | None = None
    draw: str | None = None


def make_thinker(settings: VoiceSettings):
    return Thinker(settings) if settings.two_tier_enabled else None


class Thinker:
    def __init__(self, settings: VoiceSettings, *, client=None):
        self.settings = settings
        self.on_usage = None
        self.client = client or AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value(), max_retries=0, timeout=20
        )

    async def think(self, messages: list[dict], effort=None) -> GuidanceBrief:
        effort = effort or self.settings.thinker_effort
        if self.settings.thinker_model.startswith("gpt-6-astra") and effort == "none":
            effort = "low"  # astra refuses "none"
        request = [
            {"role": "system", "content": thinker_system_prompt(GuidanceBrief.model_json_schema())},
            *deepcopy(messages),
        ]
        for attempt in range(2):
            try:
                response = await self.client.chat.completions.create(
                    model=self.settings.thinker_model,
                    reasoning_effort=effort,
                    messages=request,
                    response_format={"type": "json_object"},
                    max_completion_tokens=1200,
                )
            except (APIConnectionError, TimeoutError):
                if attempt:
                    raise
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
                if attempt:
                    raise
                request.append(
                    {
                        "role": "system",
                        "content": "The brief was invalid. Return every required schema field with "
                        "the correct types, 1–4 plan steps, confidence from 0 to 1.",
                    }
                )
        raise AssertionError("unreachable")

    async def close(self):
        await self.client.close()


INTENT = re.compile(
    r"\b(draw|mark|highlight|check|circle|find (?:a |the |my )?mistake|explain why)\b", re.I
)
PAPER = re.compile(r"\b(on my paper|my camera|on (?:the )?camera|circle mine)\b", re.I)
AUTOMATA = re.compile(r"\b(?:dfa|nfa|automat\w*|state machine|accept\w*|regex|language)\b", re.I)
NOTE_PREFIX = "[tutor notes]"
THINKER_WINDOW = 12
MARK_ID = re.compile(r"\bm\d+\b")


def _similar(a: str, b: str) -> bool:
    return difflib.SequenceMatcher(None, a.casefold(), b.casefold()).ratio() > 0.7


def _image_url(image: bytes) -> str:
    kind = "png" if image[:8] == b"\x89PNG\r\n\x1a\n" else "jpeg"
    return f"data:image/{kind};base64," + base64.b64encode(image).decode()


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
    ):
        self.thinker, self.board, self.transcript = thinker, board, transcript
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
        self._page = None
        self._board_page = None

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
            older = "\n".join(f"{n.intent}: {n.diagnosis} (said: {n.say})" for n in self.notes[:-1])
            # Mark IDs belong to one image; the next frame renumbers them (retest #8 circled
            # the wrong state with a stale m14).
            latest = self.notes[-1].model_dump_json(exclude={"paper"})
            messages.append(
                {
                    "role": "system",
                    "content": MARK_ID.sub("a mark", NOTE_PREFIX + "\n" + older + "\n" + latest),
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
    ):
        """page: an async callable returning (image, caption[, ink]) or None, awaited by the
        thinker so the talker's bridge never waits for the camera. board_page returns PNG
        bytes or None and is fetched only for board-focused thinker turns."""
        await self.cancel()
        self.context, self.text = context, text
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
        # Compare against the last brief's page, so small edits accumulate.
        if not self.notes:
            self.ink = current
        self._notes_context()
        # The thinker sees the last 6 exchanges; the notes carry what came before.
        self.messages = windowed(deepcopy(context.get_messages()), THINKER_WINDOW)
        if decision is not None:
            where = "board" if decision.refers_to == "board" else "paper"
            rung = RUNGS.get((decision.action, where))
            traced = any("[[dfa yours" in t for n in self.notes[-1:] for t in n.board)
            if decision.action == "trace" and where == "paper" and traced:
                rung = CONTRAST
            if rung:
                self.messages.append({"role": "system", "content": rung})
        if (
            decision.route == "thinker"
            if decision
            else INTENT.search(text) or PAPER.search(text) or changed
        ):
            self.trigger()
        self._notes_context()

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
            effort = None
            if (
                self.decision
                and self.decision.action == "draw_board"
                and AUTOMATA.search(self.text)
            ):
                # Automata are checked by the exact verifier; give them more thought. Other
                # diagrams are the Illustrator's, so the brief stays fast.
                settings = getattr(self.thinker, "settings", None)
                effort = getattr(settings, "thinker_draw_effort", "low")
            brief = await self._brief(generation, self.messages, effort)
            if brief is None:
                return None
            said = [n.say for n in self.notes[-3:]]
            tracing = any(STEP.match(t) for t in brief.board + brief.paper)
            if not tracing and any(_similar(brief.say, old) for old in said):
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
                            "up the playbook's ladder: mark her paper, or copy her machine to "
                            "the board as yours and trace the counterexample step by step.",
                        },
                    ],
                    effort,
                )
                if retry is None:
                    return None
                brief = retry
            decision = self.decision or rules(self.text)
            if brief.draw and (
                decision.action == "draw_board"
                or (decision.action in ("explain", "trace") and decision.refers_to == "board")
            ):
                self.illustrator_task = asyncio.create_task(self._draw(brief.draw, generation))
            self.notes = [*self.notes[-3:], brief]
            self.expires = time.monotonic() + self.ttl_s
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
            resolved = await self.pointer.resolve(
                brief.marks, self.page_image, self.page_caption, elements.detected.items
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

    async def _brief(self, generation, messages, effort):
        brief = lift_say_tags(await self.thinker.think(messages, effort=effort))
        if generation != self.generation:
            return None
        decision = self.decision or rules(self.text)
        brief = await self._point(brief, decision, generation)
        if generation != self.generation:
            return None
        checked = await asyncio.to_thread(
            check_tags, brief.board + brief.paper, decision, self.board, brief.language
        )
        if checked.repair:
            self.log("reject", source="action_checker", reason=checked.repair)
            original_language = brief.language
            try:
                repaired = await self.thinker.think(
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
                    effort=effort,
                )
                # A repair may not evade verification by removing/changing the target.
                brief = lift_say_tags(repaired).model_copy(update={"language": original_language})
                brief = await self._point(brief, decision, generation)
                checked = await asyncio.to_thread(
                    check_tags,
                    brief.board + brief.paper,
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
        brief = brief.model_copy(
            update={
                "board": [t for t in brief.board if t in checked.tags],
                "paper": [t for t in brief.paper if t in checked.tags],
            }
        )
        return self.validate_tags(brief)

    def validate_tags(self, brief):
        context = deepcopy(self.board)
        paper_only = bool(PAPER.search(self.text)) and not re.search(r"\bboard\b", self.text, re.I)
        valid = {"board": [], "paper": []}
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
                if good:
                    valid[location].append(tag)
                    context = candidate
                else:
                    self.log("reject", source="thinker_tag", text=tag)
        # Freeze only with marks, and always pin the exact page used for the brief.
        marks = [t for t in valid["paper"] if not re.match(r"\[\[freeze\b", t)]
        valid["paper"] = ["[[freeze]]", *marks] if marks else []

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
PAPER_VERB = re.compile(
    r"\[\[\s*(?:freeze|circle|wash|number|strike|check|callout|ptrace|pstep|live)\b"
)
SAY_TAG = re.compile(r"\[\[[^\[\]]*\]\]")
# Per-action guidance for the thinker: the playbook's rung, made explicit for this turn.
RUNGS = {
    ("trace", "paper"): "[app note] Playbook rung c (show): copy her machine exactly as drawn to "
    "the board as yours, then [[trace t yours INPUT student]] on the counterexample, with one "
    "[[step t]] per sentence after the first.",
    ("trace", "board"): "[app note] Trace on the board: [[trace t MACHINE INPUT]] on the machine "
    "already there, with one [[step t]] per sentence after the first.",
    ("mark_paper", "paper"): "[app note] Playbook rung b (point): freeze, then circle or callout "
    "the exact state or edge on her paper, with a few words.",
}

# Rung d: she watched her machine traced and is still lost. Show the fix beside it.
CONTRAST = (
    "[app note] Playbook rung d (contrast): you already traced her machine; do not trace it "
    "again. Draw the minimal fix on the board as fix, then [[trace t fix INPUT]] the target "
    "string on it, one [[step t]] per sentence, and say in one line what changed."
)


def lift_say_tags(brief):
    """Tags written inside say still count: move them to the paper or board list (compose
    places steps per sentence) instead of dropping them."""
    tags = SAY_TAG.findall(brief.say)
    if not tags:
        return brief
    paper = [t for t in tags if PAPER_VERB.match(t)]
    board = [t for t in tags if not PAPER_VERB.match(t)]
    say = " ".join(SAY_TAG.sub(" ", brief.say).split())
    return brief.model_copy(
        update={"board": brief.board + board, "paper": brief.paper + paper, "say": say}
    )


def compose(brief) -> str:
    """Tags lead, except trace steps: one lands before each sentence after the first, so a
    trace advances as Ada speaks it."""
    tags = brief.board + brief.paper
    steps = [t for t in tags if STEP.match(t)]
    text = "".join(t for t in tags if not STEP.match(t))
    for i, sentence in enumerate(re.split(r"(?<=[.!?])\s+", brief.say.strip())):
        if i and steps:
            text += steps.pop(0)
        text += sentence + " "
    return text.rstrip() + "".join(steps)


# Longest bracketed aside held back from speech before it's treated as ordinary text.
META_MAX = 80


class ThinkerOutput(FrameProcessor):
    """Consume control tags before beats/TTS; continue the spoken turn with its brief."""

    def __init__(self, coordinator):
        super().__init__()
        self.coordinator = coordinator
        self.buffer = ""

    async def _text(self, text, final=False):
        self.buffer += text
        while self.buffer:
            opening = self.buffer.find("[")
            if opening < 0:
                await self.push_frame(LLMTextFrame(self.buffer))
                self.buffer = ""
                break
            if opening:
                await self.push_frame(LLMTextFrame(self.buffer[:opening]))
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
                    await self.push_frame(LLMTextFrame(self.buffer[:1]))
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
                await self.push_frame(LLMTextFrame(tag))

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, (InterruptionFrame, CancelFrame, EndFrame)):
                self.buffer = ""
                await self.coordinator.cancel()
            elif isinstance(frame, LLMFullResponseStartFrame):
                self.buffer = ""
            elif isinstance(frame, LLMTextFrame):
                await self._text(frame.text)
                return
            elif isinstance(frame, LLMFullResponseEndFrame):
                await self._text("", final=True)
                await self.push_frame(FlushSpeechFrame())
                generation = self.coordinator.generation
                pending = self.coordinator.task is not None and not self.coordinator.delivered
                brief = await self.coordinator.result()
                if brief:
                    await self.push_frame(LLMTextFrame(compose(brief)))
                    if self.coordinator.illustrator_task and not self.coordinator.diagram_delivered:
                        await self.push_frame(FlushSpeechFrame())
                        tag = await self.coordinator.diagram_result()
                        if tag:
                            words = {"en": "Here it is.", "es": "Aquí está.", "ko": "여기 있어요."}[
                                self.coordinator.lang()
                            ]
                            await self.push_frame(LLMTextFrame(tag + words))
                elif pending and generation == self.coordinator.generation:
                    failure = {
                        "en": "I couldn't finish checking that. Could you ask me again?",
                        "es": "No pude terminar de revisarlo. ¿Puedes preguntarme otra vez?",
                        "ko": "확인을 끝내지 못했어요. 다시 물어봐 주시겠어요?",
                    }[self.coordinator.lang()]
                    await self.push_frame(LLMTextFrame(failure))
        await self.push_frame(frame, direction)

    async def cleanup(self):
        await self.coordinator.close()
        await super().cleanup()
