"""Local fake speech with playback-synchronized word timestamps."""

import asyncio
import math
import shutil
import sys
import tempfile
import wave
from array import array
from collections.abc import AsyncGenerator, Callable
from pathlib import Path
from typing import Literal

from loguru import logger
from pipecat.frames.frames import Frame, TTSAudioRawFrame
from pipecat.services.tts_service import TTSService

from tassel.models import Lang

TtsEngine = Literal["say", "tone"]
SAY_VOICES: dict[Lang, str] = {"en": "Samantha", "es": "Paulina", "ko": "Yuna"}


def pick_engine(
    setting: Literal["auto", "say", "tone"],
    *,
    platform: str = sys.platform,
    which: Callable[[str], str | None] = shutil.which,
) -> TtsEngine:
    if setting != "tone" and platform == "darwin" and which("say"):
        return "say"
    return "tone"


def tone_clip(
    text: str, sample_rate: int, *, ms_per_char: int = 55, gap_ms: int = 60
) -> tuple[bytes, list[tuple[str, float]]]:
    """220 Hz, 10 ms fades, and a silent gap after each word; LE int16 mono."""
    samples = array("h")
    timings = []
    fade = max(1, round(sample_rate * 0.01))
    gap = round(sample_rate * gap_ms / 1000)
    for word in text.split():
        timings.append((word, len(samples) / sample_rate))
        count = round(sample_rate * len(word) * ms_per_char / 1000)
        samples.extend(
            round(
                8000
                * math.sin(2 * math.pi * 220 * i / sample_rate)
                * min(1, i / fade, (count - 1 - i) / fade)
            )
            for i in range(count)
        )
        samples.extend([0] * gap)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples.tobytes(), timings


def spread_words(text: str, duration_s: float) -> list[tuple[str, float]]:
    words = text.split()
    total = sum(map(len, words))
    offset = 0
    timings = []
    for word in words:
        timings.append((word, round(duration_s * offset / total, 9)))
        offset += len(word)
    return timings


async def say_clip(
    text: str, lang: Lang, sample_rate: int, *, exec=asyncio.create_subprocess_exec
) -> tuple[bytes, float]:
    """Synthesize to a temporary WAV, never to a speaker."""
    with tempfile.TemporaryDirectory(prefix="tassel-say-") as directory:
        path = Path(directory) / "speech.wav"
        process = await exec(
            "say",
            "-v",
            SAY_VOICES[lang],
            "-o",
            str(path),
            "--file-format=WAVE",
            f"--data-format=LEI16@{sample_rate}",
            "--",
            text,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await asyncio.wait_for(process.communicate(), timeout=30)
        except (TimeoutError, asyncio.CancelledError):
            if process.returncode is None:
                process.kill()
                await process.communicate()
            raise
        if process.returncode:
            raise RuntimeError("say synthesis failed")
        with wave.open(str(path), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, sample_rate):
                raise ValueError("say returned an unexpected PCM format")
            pcm = wav.readframes(wav.getnframes())
        if not pcm:
            raise ValueError("say returned empty audio")
        return pcm, len(pcm) / (2 * sample_rate)


class FakeTTSService(TTSService):
    def __init__(self, *, lang: Lang, engine: TtsEngine, ttfb_ms: int = 150, **kwargs):
        super().__init__(
            push_text_frames=False, push_start_frame=True, push_stop_frames=True, **kwargs
        )
        self._lang = lang
        self._engine = engine
        self._ttfb_ms = ttfb_ms
        self._offsets: dict[str, float] = {}
        self._warned_say = False

    def can_generate_metrics(self) -> bool:
        return True

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        await self.start_ttfb_metrics()
        await asyncio.sleep(self._ttfb_ms / 1000)
        if self._engine == "say":
            try:
                pcm, duration = await say_clip(text, self._lang, self.sample_rate)
                timings = spread_words(text, duration)
            except Exception:
                if not self._warned_say:
                    logger.warning("Local say synthesis failed; fake TTS is using tones")
                    self._warned_say = True
                pcm, timings = tone_clip(text, self.sample_rate)
        else:
            pcm, timings = tone_clip(text, self.sample_rate)
        offset = self._offsets.get(context_id, 0.0)
        self._offsets[context_id] = offset + len(pcm) / (2 * self.sample_rate)
        chunk_size = round(self.sample_rate * 0.02) * 2
        await self.stop_ttfb_metrics()
        for pos in range(0, len(pcm), chunk_size):
            yield TTSAudioRawFrame(pcm[pos : pos + chunk_size], self.sample_rate, 1, context_id)
            if pos == 0:
                await self.add_word_timestamps(
                    [(word, secs + offset) for word, secs in timings], context_id
                )

    async def on_audio_context_completed(self, context_id: str):
        self._offsets.pop(context_id, None)
        await super().on_audio_context_completed(context_id)

    async def on_audio_context_interrupted(self, context_id: str):
        self._offsets.pop(context_id, None)
        await super().on_audio_context_interrupted(context_id)
