import os
import shutil
import sys
import wave

import pytest
from pipecat.frames.frames import (
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    TTSTextFrame,
)
from pipecat.pipeline.worker import PipelineParams
from pipecat.tests.utils import run_test

from tassel.voice.fakes.tts import FakeTTSService, pick_engine, say_clip, spread_words, tone_clip


def test_tone_clip_timing():
    pcm, words = tone_clip("try 1010", 24000)
    assert len(pcm) == 2 * 12120
    assert words == [("try", 0.0), ("1010", 0.225)]
    assert pcm[:2] == b"\x00\x00"
    assert pcm[-2880:] == bytes(2880)
    assert any(pcm)


def test_spread_words():
    assert spread_words("ab cdef", 1.2) == [("ab", 0.0), ("cdef", 0.4)]
    assert spread_words(" ", 1.2) == []
    assert tone_clip("", 24000) == (b"", [])


@pytest.mark.parametrize(
    "setting,platform,available,expected",
    [
        ("auto", "linux", True, "tone"),
        ("auto", "darwin", True, "say"),
        ("auto", "darwin", False, "tone"),
        ("say", "win32", True, "tone"),
        ("tone", "darwin", True, "tone"),
    ],
)
def test_pick_engine(setting, platform, available, expected):
    assert (
        pick_engine(
            setting, platform=platform, which=lambda _: "/usr/bin/say" if available else None
        )
        == expected
    )


@pytest.mark.asyncio
async def test_speaks_with_word_timings():
    tts = FakeTTSService(lang="en", engine="tone", ttfb_ms=0)
    assert tts.can_generate_metrics()
    down, _ = await run_test(
        tts,
        frames_to_send=[TTSSpeakFrame("Try running 1010.")],
        pipeline_params=PipelineParams(audio_out_sample_rate=24000),
    )
    speech = [
        f
        for f in down
        if isinstance(f, (TTSStartedFrame, TTSAudioRawFrame, TTSTextFrame, TTSStoppedFrame))
    ]
    assert isinstance(speech[0], TTSStartedFrame)
    assert isinstance(speech[-1], TTSStoppedFrame)
    audio = [f for f in speech if isinstance(f, TTSAudioRawFrame)]
    assert audio and all((f.sample_rate, f.num_channels) == (24000, 1) for f in audio)
    assert all(len(f.audio) <= 960 for f in audio)
    words = [f for f in speech if isinstance(f, TTSTextFrame)]
    assert [f.text for f in words] == ["Try", "running", "1010."]
    assert all(f.pts is not None for f in words)
    assert [f.pts - words[0].pts for f in words] == [0, 225000000, 670000000]
    assert speech.index(audio[0]) < speech.index(words[0])


@pytest.mark.asyncio
async def test_word_offsets_continue_across_sentences():
    down, _ = await run_test(
        FakeTTSService(lang="en", engine="tone", ttfb_ms=0),
        frames_to_send=[
            LLMFullResponseStartFrame(),
            LLMTextFrame("Hello. "),
            LLMTextFrame("Goodbye."),
            LLMFullResponseEndFrame(),
        ],
        pipeline_params=PipelineParams(audio_out_sample_rate=24000),
    )
    words = [f for f in down if isinstance(f, TTSTextFrame)]
    assert [f.text for f in words] == ["Hello.", "Goodbye."]
    assert words[0].context_id == words[1].context_id
    assert words[1].pts - words[0].pts == 390000000


@pytest.mark.asyncio
async def test_say_uses_the_language_voice():
    calls = []

    async def fake_exec(*argv, **kwargs):
        calls.append(argv)
        with wave.open(argv[argv.index("-o") + 1], "wb") as wav:
            wav.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
            wav.writeframes(bytes(24000))

        class Process:
            returncode = 0

            async def communicate(self):
                return b"", b""

        return Process()

    pcm, duration = await say_clip("안녕하세요", "ko", 24000, exec=fake_exec)
    assert len(pcm) == 24000 and duration == 0.5
    assert calls[0][0:3] == ("say", "-v", "Yuna")
    assert "--file-format=WAVE" in calls[0]
    assert "--data-format=LEI16@24000" in calls[0]
    assert calls[0][-2:] == ("--", "안녕하세요")


@pytest.mark.asyncio
async def test_say_failure_falls_back_to_tone(monkeypatch):
    async def broken(*args, **kwargs):
        raise OSError("unavailable")

    monkeypatch.setattr("tassel.voice.fakes.tts.say_clip", broken)
    down, _ = await run_test(
        FakeTTSService(lang="en", engine="say", ttfb_ms=0),
        frames_to_send=[TTSSpeakFrame("Try 1010.")],
    )
    assert any(isinstance(f, TTSAudioRawFrame) for f in down)
    assert [f.text for f in down if isinstance(f, TTSTextFrame)] == ["Try", "1010."]


@pytest.mark.skipif(
    os.environ.get("TASSEL_TEST_SKIP_SAY") == "1",
    reason="say speech service unavailable in this sandbox; file synthesis check owed",
)
@pytest.mark.skipif(sys.platform != "darwin" or not shutil.which("say"), reason="macOS say only")
@pytest.mark.asyncio
async def test_say_really_speaks():
    # File output only: this never opens a speaker.
    pcm, duration = await say_clip("Try running one zero one zero.", "en", 24000)
    assert duration > 0.3
    assert any(pcm)
