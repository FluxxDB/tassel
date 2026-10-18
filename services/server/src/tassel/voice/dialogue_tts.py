"""Eleven v4 Turbo's Text-to-Dialogue protocol, adapted to Pipecat audio contexts."""

import asyncio
import base64
import json
from collections.abc import AsyncGenerator
from urllib.parse import urlencode

from pipecat.frames.frames import ErrorFrame, Frame, TTSAudioRawFrame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException


class ElevenLabsDialogueTTSService(TTSService):
    """Stream PCM per aggregated sentence; cancellation closes its socket immediately.

    Each request is explicitly finalized so even short sentences drain without waiting
    for the provider's buffering threshold. Pipecat owns audio contexts and text frames.
    A socket per sentence also prevents interrupted audio leaking into the next turn.
    """

    def __init__(self, *, api_key: str, voice: str, language: str, **kwargs):
        super().__init__(
            settings=TTSSettings(model="eleven_v4_turbo", voice=voice),
            push_start_frame=True,
            push_stop_frames=True,
            **kwargs,
        )
        self._api_key = api_key
        self._language = language

    def can_generate_metrics(self) -> bool:
        return True

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        query = urlencode(
            {
                "model_id": "eleven_v4_turbo",
                "output_format": f"pcm_{self.sample_rate}",
                "language_code": self._language,
            }
        )
        await self.start_ttfb_metrics()
        first_audio = True
        try:
            async with connect(
                f"wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?{query}",
                additional_headers={"xi-api-key": self._api_key},
                open_timeout=10,
                close_timeout=2,
                max_size=4 * 1024 * 1024,
            ) as socket:
                await socket.send(json.dumps({"voices": [self._settings.voice]}))
                await socket.send(
                    json.dumps(
                        {
                            "inputs": [
                                {
                                    "text": text,
                                    "voice_id": self._settings.voice,
                                }
                            ]
                        }
                    )
                )
                await socket.send(json.dumps({"close_socket": True}))
                await self.start_tts_usage_metrics(text)
                while True:
                    message = json.loads(await asyncio.wait_for(socket.recv(), timeout=30))
                    if message.get("error") or (
                        message.get("message")
                        and not (message.get("audio") or message.get("is_final"))
                    ):
                        # Do not echo provider payloads, credentials, or learner text.
                        yield ErrorFrame("ElevenLabs v4 Turbo refused speech generation")
                        return
                    if message.get("audio"):
                        pcm = base64.b64decode(message["audio"], validate=True)
                        if first_audio:
                            await self.stop_ttfb_metrics()
                            first_audio = False
                        yield TTSAudioRawFrame(pcm, self.sample_rate, 1, context_id)
                    if message.get("is_final"):
                        return
        except (TimeoutError, OSError, ValueError, WebSocketException) as error:
            yield ErrorFrame(f"ElevenLabs v4 Turbo stream failed ({type(error).__name__})")
        finally:
            await self.stop_ttfb_metrics()
