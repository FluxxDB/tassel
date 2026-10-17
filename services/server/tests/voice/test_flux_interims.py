import asyncio
import json
from pathlib import Path

import pytest
from pipecat.frames.frames import (
    InterimTranscriptionFrame,
    ProposedUserStartedSpeakingFrame,
    ProposedUserStoppedSpeakingFrame,
    TranscriptionFrame,
)
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService

from tassel.voice.flux import attach_flux_interims


@pytest.mark.asyncio
async def test_flux_interims_follow_the_recorded_sequence(monkeypatch):
    stt = DeepgramFluxSTTService(api_key="test")
    attach_flux_interims(stt)
    recorded = []

    async def push(frame, *args, **kwargs):
        recorded.append(frame)

    async def broadcast(cls, **kwargs):
        recorded.append(cls(**kwargs))

    monkeypatch.setattr(stt, "push_frame", push)
    monkeypatch.setattr(stt, "broadcast_frame", broadcast)
    messages = json.loads((Path(__file__).parent / "fixtures/flux-turninfo.json").read_text())
    for message in messages:
        await stt._handle_message(message)
        await asyncio.sleep(0)
    assert [type(f) for f in recorded] == [
        ProposedUserStartedSpeakingFrame,
        InterimTranscriptionFrame,
        InterimTranscriptionFrame,
        TranscriptionFrame,
        ProposedUserStoppedSpeakingFrame,
    ]
    assert [f.text for f in recorded if hasattr(f, "text")] == [
        "Hi I",
        "Hi I'm working",
        "Hi I'm working on a DFA",
    ]
    assert recorded[3].finalized
    await stt._call_event_handler("on_update", "")
    await asyncio.sleep(0)
    assert len(recorded) == 5
    await stt.cleanup()
