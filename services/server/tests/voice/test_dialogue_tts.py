import asyncio
import base64
import json
from unittest.mock import AsyncMock

import pytest
from pipecat.frames.frames import ErrorFrame, TTSAudioRawFrame

from tassel.voice import dialogue_tts
from tassel.voice.dialogue_tts import ElevenLabsDialogueTTSService
from tassel.voice.providers import make_tts
from tassel.voice.routes import route_for
from tassel.voice.settings import VoiceSettings


class Socket:
    def __init__(self, messages):
        self.messages = iter(messages)
        self.sent = []
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed = True

    async def send(self, value):
        self.sent.append(json.loads(value))

    async def recv(self):
        message = next(self.messages)
        if isinstance(message, BaseException):
            raise message
        return json.dumps(message)


def service():
    tts = make_tts(
        route_for("en"),
        VoiceSettings(
            providers="live",
            elevenlabs_api_key="test-secret",
            tts_model="eleven_v4_turbo",
            voice_en="selected-voice",
        ),
    )
    assert isinstance(tts, ElevenLabsDialogueTTSService)
    tts._sample_rate = 24000
    for name in ("start_ttfb_metrics", "stop_ttfb_metrics", "start_tts_usage_metrics"):
        setattr(tts, name, AsyncMock())
    return tts


@pytest.mark.asyncio
async def test_dialogue_protocol_streams_pcm_and_finalizes_short_text(monkeypatch):
    pcm = b"\x00\x01" * 50
    socket = Socket([{"audio": base64.b64encode(pcm).decode()}, {"is_final": True}])
    connections = []

    def connect(url, **kwargs):
        connections.append((url, kwargs))
        return socket

    monkeypatch.setattr(dialogue_tts, "connect", connect)
    tts = service()
    frames = [f async for f in tts.run_tts("Hi!", "context")]
    assert len(frames) == 1 and isinstance(frames[0], TTSAudioRawFrame)
    assert frames[0].audio == pcm
    assert frames[0].context_id == "context"
    assert frames[0].sample_rate == 24000
    assert socket.sent == [
        {"voices": ["selected-voice"]},
        {"inputs": [{"text": "Hi!", "voice_id": "selected-voice"}]},
        {"close_socket": True},
    ]
    assert "model_id=eleven_v4_turbo" in connections[0][0]
    assert "output_format=pcm_24000" in connections[0][0]
    assert "language_code=en" in connections[0][0]
    assert "test-secret" not in connections[0][0]
    assert socket.closed


@pytest.mark.asyncio
async def test_provider_error_is_reported_without_payload_secrets(monkeypatch):
    socket = Socket([{"error": "test-secret private learner text"}])
    monkeypatch.setattr(dialogue_tts, "connect", lambda *a, **kw: socket)
    frames = [f async for f in service().run_tts("Hi!", "context")]
    assert isinstance(frames[0], ErrorFrame)
    assert "test-secret" not in frames[0].error
    assert socket.closed


@pytest.mark.asyncio
async def test_interruption_closes_connection_and_propagates_cancellation(monkeypatch):
    socket = Socket([asyncio.CancelledError()])
    monkeypatch.setattr(dialogue_tts, "connect", lambda *a, **kw: socket)
    with pytest.raises(asyncio.CancelledError):
        _ = [f async for f in service().run_tts("Hi!", "context")]
    assert socket.closed
