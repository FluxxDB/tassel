"""Opt-in development transcripts. Never serialize frames, images or provider settings."""

import json
import re
import time
from pathlib import Path
from uuid import UUID

from loguru import logger
from pipecat.frames.frames import (
    LLMContextFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    MetricsFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSTextFrame,
)
from pipecat.metrics.metrics import LLMUsageMetricsData, STTUsageMetricsData, TTSUsageMetricsData
from pipecat.observers.base_observer import BaseObserver, FramePushed

from tassel.voice.cost import CostMeter

# A running `cost` event every few student turns, and a final one when the session ends.
COST_EVERY = 5


class DevTranscript(BaseObserver):
    def __init__(self, session: UUID, directory: Path | None, *, secrets=(), prices=None):
        super().__init__(observe_every_push=False)
        self.meter = CostMeter(prices)
        self.turns = 0
        self.path = None if directory is None else directory / f"{session}.jsonl"
        self.secrets = [s for s in secrets if s]
        self.started = time.monotonic()
        self.token = self.audio = False
        self._last_user = None
        self._last_final = None

    def _safe(self, value):
        if isinstance(value, dict):
            return {
                k: self._safe(v)
                for k, v in value.items()
                if not any(x in k.lower() for x in ("image", "key", "token", "credential"))
            }
        if isinstance(value, list):
            return [self._safe(v) for v in value if not isinstance(v, bytes)]
        if isinstance(value, str):
            for secret in self.secrets:
                value = value.replace(secret, "[redacted]")
            return re.sub(r'data:image/[^\s"\]]+', "[image omitted]", value)
        return value if isinstance(value, (int, float, bool, type(None))) else "[omitted]"

    def record(self, event: str, data: dict):
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as stream:
                stream.write(
                    json.dumps(
                        {"event": event, "at": time.time(), **self._safe(data)}, ensure_ascii=False
                    )
                    + "\n"
                )
        except OSError:
            logger.warning("Could not write development transcript")

    async def on_push_frame(self, data: FramePushed):
        if not data.first_push:
            return
        frame = data.frame
        if isinstance(frame, MetricsFrame):
            self._meter(frame)
            return
        if isinstance(frame, TranscriptionFrame):
            self.record("student_final", {"text": frame.text})
            self.turns += 1
            if self.turns % COST_EVERY == 0:
                self.record_cost()
            self._last_final = frame.text
            self.started = time.monotonic()
            self.token = self.audio = False
        elif isinstance(frame, LLMContextFrame):
            user = next(
                (m for m in reversed(frame.context.get_messages()) if m.get("role") == "user"), None
            )
            if user is not None and user is not self._last_user:
                self._last_user = user
                content = user.get("content")
                if isinstance(content, str) and not content.startswith("["):
                    if content != self._last_final:
                        self.record("student_final", {"text": content})
                        self.started = time.monotonic()
                    self._last_final = None
        elif isinstance(frame, LLMFullResponseStartFrame):
            self.token = self.audio = False
        elif isinstance(frame, LLMTextFrame) and not self.token:
            self.token = True
            self.record("first_token", {"ms": (time.monotonic() - self.started) * 1000})
        elif isinstance(frame, TTSTextFrame):
            self.record("ada_spoken", {"text": frame.text})
        elif isinstance(frame, TTSAudioRawFrame) and not self.audio:
            self.audio = True
            self.record("first_audio", {"ms": (time.monotonic() - self.started) * 1000})

    def _meter(self, frame: MetricsFrame) -> None:
        for item in frame.data:
            if isinstance(item, LLMUsageMetricsData):
                usage = item.value
                self.meter.llm(
                    item.model or "llm",
                    prompt=usage.prompt_tokens,
                    cached=usage.cache_read_input_tokens or 0,
                    completion=usage.completion_tokens,
                )
            elif isinstance(item, TTSUsageMetricsData):
                self.meter.tts(item.value)
            elif isinstance(item, STTUsageMetricsData):
                self.meter.stt(item.value.audio_seconds)

    def record_cost(self) -> None:
        """The session's usage so far (and USD when prices are set), as one `cost` event."""
        self.record("cost", self.meter.summary())
