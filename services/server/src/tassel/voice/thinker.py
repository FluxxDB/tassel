"""One background reasoning request per session, with bounded, expiring tutor notes."""

import asyncio
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
from tassel.voice.action_checker import TargetLanguage, check_tags
from tassel.voice.director import rules
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
    confidence: float = Field(ge=0, le=1)
    followups: list[str]
    language: TargetLanguage | None = None


def make_thinker(settings: VoiceSettings):
    return Thinker(settings) if settings.two_tier_enabled else None


class Thinker:
    def __init__(self, settings: VoiceSettings, *, client=None):
        self.settings = settings
        self.client = client or AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value(), max_retries=0, timeout=20
        )

    async def think(self, messages: list[dict]) -> GuidanceBrief:
        request = [
            {"role": "system", "content": thinker_system_prompt(GuidanceBrief.model_json_schema())},
            *deepcopy(messages),
        ]
        for attempt in range(2):
            try:
                response = await self.client.chat.completions.create(
                    model=self.settings.thinker_model,
                    reasoning_effort=self.settings.thinker_effort,
                    messages=request,
                    response_format={"type": "json_object"},
                    max_completion_tokens=3000,
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
NOTE_PREFIX = "[tutor notes]"
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
        self, thinker, board: BoardContext, *, transcript=None, ttl_s=300, lang=lambda: "en"
    ):
        self.thinker, self.board, self.transcript = thinker, board, transcript
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

    def log(self, event, **data):
        if self.transcript:
            self.transcript.record(event, data)

    async def cancel(self):
        self.generation += 1
        task, self.task = self.task, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

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
            messages.append(
                {
                    "role": "system",
                    "content": NOTE_PREFIX + "\n" + older + "\n" + self.notes[-1].model_dump_json(),
                }
            )
        if self.task and not self.delivered:
            messages.append(
                {
                    "role": "system",
                    "content": BRIDGE_PREFIX
                    + " Give one short natural bridge about this question now. "
                    "Do not solve or draw yet; "
                    "the tutor brief will supply your next sentence.",
                }
            )

    async def prepare(self, context, text: str, image: bytes | None = None, *, decision=None):
        await self.cancel()
        self.context, self.text = context, text
        self.decision = decision
        self.delivered = False
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
        self.messages = deepcopy(context.get_messages())
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
            brief = await self.thinker.think(self.messages)
            if generation != self.generation:
                return None
            decision = self.decision or rules(self.text)
            checked = await asyncio.to_thread(
                check_tags, brief.board + brief.paper, decision, self.board, brief.language
            )
            if checked.repair:
                self.log("reject", source="action_checker", reason=checked.repair)
                original_language = brief.language
                try:
                    repaired = await self.thinker.think(
                        [
                            *self.messages,
                            {
                                "role": "system",
                                "content": "Repair this drawing once: "
                                + checked.repair
                                + " Keep the same target language and director action. "
                                "Previous brief: " + brief.model_dump_json(),
                            },
                        ]
                    )
                    # A repair may not evade verification by removing/changing the target.
                    brief = repaired.model_copy(update={"language": original_language})
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
            brief = self.validate_tags(brief)
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
        self._notes_context()
        return brief

    async def close(self):
        await self.cancel()
        if self.thinker is not None:
            await self.thinker.close()


class ThinkerOutput(FrameProcessor):
    """Consume control tags before beats/TTS; continue the spoken turn with its brief."""

    def __init__(self, coordinator):
        super().__init__()
        self.coordinator = coordinator
        self.buffer = ""

    async def _text(self, text, final=False):
        self.buffer += text
        while self.buffer:
            opening = self.buffer.find("[[")
            if opening < 0:
                cut = len(self.buffer) - (not final and self.buffer.endswith("["))
                if cut:
                    await self.push_frame(LLMTextFrame(self.buffer[:cut]))
                    self.buffer = self.buffer[cut:]
                break
            if opening:
                await self.push_frame(LLMTextFrame(self.buffer[:opening]))
                self.buffer = self.buffer[opening:]
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
                    checked = check_tags([tag], decision, self.coordinator.board)
                    structural = any(
                        kind in ("board.automaton", "board.addState", "board.addTransition")
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
                    await self.push_frame(
                        LLMTextFrame("".join(brief.board + brief.paper) + brief.say)
                    )
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
