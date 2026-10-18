"""Convert streamed board tags to beat documents before their speech reaches TTS."""

import re
from collections.abc import Callable
from uuid import uuid4

from loguru import logger
from pipecat.frames.frames import (
    AggregatedTextFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from tassel.models import Lang
from tassel.voice.events import ServerEvents
from tassel.voice.messages import BeatEvent

from .assemble import build_beat
from .markup import BoardContext, MarkupStream, Sentence

FREEZE_TAG = re.compile(r"\[\[\s*freeze(?:\s+[^\]]*)?\]\]", re.IGNORECASE)
PAPER_MARK_TAG = re.compile(
    r"\[\[\s*(?:circle|wash|number|check|strike|arrow|callout)\s+[^\]]+\]\]", re.IGNORECASE
)


class BeatTagProcessor(FrameProcessor):
    def __init__(
        self, *, events: ServerEvents, lang: Callable[[], Lang], board: BoardContext, **kwargs
    ):
        super().__init__(**kwargs)
        self._events = events
        self._lang = lang
        self._board = board
        self._stream = MarkupStream(board)
        self._turn = uuid4().hex[:8]
        self._sequence = 0
        self._guard_buffer = ""
        self._reply_text = ""

    async def _emit(self, sentences: list[Sentence]):
        for sentence in sentences:
            # A tag that's refused, or read with parts dropped, is logged, never captioned.
            for problem in sentence.problems:
                logger.info("Board tag rejected: {}", problem)
            frame = AggregatedTextFrame(
                text=sentence.clean, aggregated_by="sentence", raw_text=sentence.tagged
            )
            self._sequence += 1
            beat = build_beat(
                sentence,
                beat_id=f"{self._turn}-{self._sequence}",
                turn=self._turn,
                segment=str(frame.id),
                lang=self._lang(),
            )
            await self._events.send(BeatEvent(beat=beat))
            if sentence.clean:
                await self.push_frame(frame)

    async def _feed_guarded(self, text: str, *, final: bool = False):
        self._reply_text += text
        self._guard_buffer += text
        has_mark = PAPER_MARK_TAG.search(self._reply_text) is not None
        if final and not has_mark:

            def drop(match):
                logger.warning("Dropped [[freeze]]: reply contains no paper-mark tag")
                return ""

            self._guard_buffer = FREEZE_TAG.sub(drop, self._guard_buffer)
        elif not has_mark and FREEZE_TAG.search(self._guard_buffer):
            return
        # Don't release half a tag: it could become a freeze in the next chunk.
        cut = len(self._guard_buffer)
        if not final:
            opening = self._guard_buffer.rfind("[[")
            if opening >= 0 and "]]" not in self._guard_buffer[opening:]:
                cut = opening
            elif self._guard_buffer.endswith("["):
                cut -= 1
        ready, self._guard_buffer = self._guard_buffer[:cut], self._guard_buffer[cut:]
        await self._emit(self._stream.feed(ready))

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterruptionFrame):
            self._guard_buffer = self._reply_text = ""
            self._stream = MarkupStream(self._board)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, LLMFullResponseStartFrame):
                self._turn = uuid4().hex[:8]
                self._sequence = 0
                self._guard_buffer = self._reply_text = ""
                self._stream = MarkupStream(self._board)
            elif isinstance(frame, LLMTextFrame):
                await self._feed_guarded(frame.text)
                return
            elif isinstance(frame, LLMFullResponseEndFrame):
                await self._feed_guarded("", final=True)
                await self._emit(self._stream.flush())
        await self.push_frame(frame, direction)
