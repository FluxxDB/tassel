"""Convert streamed board tags to beat documents before their speech reaches TTS."""

from collections.abc import Callable
from uuid import uuid4

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

    async def _emit(self, sentences: list[Sentence]):
        for sentence in sentences:
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

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, InterruptionFrame):
            self._stream = MarkupStream(self._board)
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, LLMFullResponseStartFrame):
                self._turn = uuid4().hex[:8]
                self._sequence = 0
                self._stream = MarkupStream(self._board)
            elif isinstance(frame, LLMTextFrame):
                await self._emit(self._stream.feed(frame.text))
                return
            elif isinstance(frame, LLMFullResponseEndFrame):
                await self._emit(self._stream.flush())
        await self.push_frame(frame, direction)
