import pytest
from pipecat.frames.frames import (
    InterimTranscriptionFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.tests.utils import SleepFrame, run_test

from tassel.voice.fakes.stt import FakeSTTService


@pytest.mark.parametrize("direction", list(FrameDirection))
@pytest.mark.asyncio
async def test_fake_stt_maps_utterances_to_lines(direction):
    vad = []
    for _ in range(3):
        vad += [VADUserStartedSpeakingFrame(), VADUserStoppedSpeakingFrame()]
    down, up = await run_test(
        FakeSTTService(
            lines=["uh-huh", "Wait, can I ask something?"], lang="en", interim_after_ms=0
        ),
        frames_to_send=vad,
        frames_to_send_direction=direction,
    )
    transcript = [f for f in down if isinstance(f, (InterimTranscriptionFrame, TranscriptionFrame))]
    assert [(type(f), f.text) for f in transcript] == [
        (InterimTranscriptionFrame, "uh-huh"),
        (TranscriptionFrame, "uh-huh"),
        (InterimTranscriptionFrame, "Wait, can"),
        (TranscriptionFrame, "Wait, can I ask something?"),
    ]
    assert all(f.finalized for f in transcript if isinstance(f, TranscriptionFrame))
    assert all(f.language.value == "en" and f.timestamp for f in transcript)
    passed = down if direction == FrameDirection.DOWNSTREAM else up
    assert [
        f
        for f in passed
        if isinstance(f, (VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame))
    ] == vad


@pytest.mark.asyncio
async def test_stop_cancels_pending_interim():
    down, _ = await run_test(
        FakeSTTService(lines=["Short utterance"], lang="en", interim_after_ms=100),
        frames_to_send=[
            VADUserStartedSpeakingFrame(),
            VADUserStoppedSpeakingFrame(),
            SleepFrame(0.15),
        ],
    )
    assert [f.text for f in down if isinstance(f, TranscriptionFrame)] == ["Short utterance"]
    assert not any(isinstance(f, InterimTranscriptionFrame) for f in down)


@pytest.mark.asyncio
async def test_interim_arrives_while_speaking():
    down, _ = await run_test(
        FakeSTTService(lines=["one two three"], lang="en", interim_after_ms=10),
        frames_to_send=[
            VADUserStartedSpeakingFrame(),
            SleepFrame(0.04),
            VADUserStoppedSpeakingFrame(),
        ],
    )
    assert [f.text for f in down if isinstance(f, InterimTranscriptionFrame)] == ["one two"]
    assert [f.text for f in down if isinstance(f, TranscriptionFrame)] == ["one two three"]


@pytest.mark.asyncio
async def test_raw_audio_never_transcribes():
    stt = FakeSTTService(lines=["unused"], lang="ko")
    assert [frame async for frame in stt.run_stt(bytes(320))] == []
