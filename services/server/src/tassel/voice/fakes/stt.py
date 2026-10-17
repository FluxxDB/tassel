"""A deterministic VAD-driven STT fake; it never sends audio to a provider."""

import asyncio
from collections.abc import AsyncGenerator, Sequence

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.services.stt_service import STTService
from pipecat.transcriptions.language import Language
from pipecat.utils.time import time_now_iso8601

from tassel.models import Lang


class FakeSTTService(STTService):
    def __init__(self, *, lines: Sequence[str], lang: Lang, interim_after_ms: int = 150, **kwargs):
        super().__init__(ttfs_p99_latency=0.2, **kwargs)
        self._lines = tuple(lines)
        self._lang = Language(lang)
        self._index = 0
        self._interim_after_ms = interim_after_ms
        self._interim_task: asyncio.Task | None = None
        self._speaking = False

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        # Keep the STTService async-generator interface while emitting no frames.
        for frame in ():
            yield frame

    async def _emit_interim(self, line: str):
        await self.push_frame(
            InterimTranscriptionFrame(
                " ".join(line.split()[:2]), "", time_now_iso8601(), language=self._lang
            )
        )

    async def _delayed_interim(self, line: str):
        await asyncio.sleep(self._interim_after_ms / 1000)
        await self._emit_interim(line)

    async def _cancel_interim(self):
        if self._interim_task is not None:
            await self.cancel_task(self._interim_task)
            self._interim_task = None

    async def _handle_vad_user_started_speaking(self, frame: VADUserStartedSpeakingFrame):
        await super()._handle_vad_user_started_speaking(frame)
        if self._speaking or self._index >= len(self._lines):
            return
        self._speaking = True
        line = self._lines[self._index]
        if self._interim_after_ms == 0:
            await self._emit_interim(line)
        else:
            self._interim_task = self.create_task(self._delayed_interim(line))

    async def _handle_vad_user_stopped_speaking(self, frame: VADUserStoppedSpeakingFrame):
        await super()._handle_vad_user_stopped_speaking(frame)
        await self._cancel_interim()
        if not self._speaking:
            return
        self._speaking = False
        line = self._lines[self._index]
        self._index += 1
        await self.push_frame(
            TranscriptionFrame(line, "", time_now_iso8601(), language=self._lang, finalized=True)
        )

    async def stop(self, frame: EndFrame):
        await self._cancel_interim()
        await super().stop(frame)

    async def cancel(self, frame: CancelFrame):
        await self._cancel_interim()
        await super().cancel(frame)
