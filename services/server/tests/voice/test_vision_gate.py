import numpy as np
import pytest
from pipecat.processors.aggregators.llm_context import LLMContext

from tassel.vision.turn_image import NO_VIEW, _model_jpeg
from tassel.voice.providers import _without_images


def test_noisy_model_image_under_60kb():
    image = np.random.default_rng(42).integers(0, 256, (1400, 1800, 3), dtype=np.uint8)
    assert len(_model_jpeg(image)) < 60_000


def test_image_failure_uses_notes_without_blame_or_unprompted_apology():
    ctx = LLMContext(
        [
            {"role": "system", "content": "[tutor notes] q1 accepts"},
            {"role": "user", "content": "what next?"},
        ]
    )
    result = _without_images(ctx).get_messages()
    assert "q1 accepts" in str(result)
    instruction = result[-1]["content"]
    assert "latest page notes" in instruction
    assert "only if the student asked about the page" in instruction
    assert "hold still" not in instruction
    assert "latest page notes" in NO_VIEW


@pytest.mark.asyncio
async def test_thinker_image_delivery_failure_retries_from_latest_notes():
    from types import SimpleNamespace

    import httpx
    from openai import APIConnectionError
    from test_two_tier import brief

    from tassel.voice.settings import VoiceSettings
    from tassel.voice.thinker import Thinker

    calls = []

    class Completions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                raise APIConnectionError(request=httpx.Request("POST", "https://example.test"))
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(message=SimpleNamespace(content=brief().model_dump_json()))
                ]
            )

    thinker = Thinker(
        VoiceSettings(openai_api_key="fake"),
        client=SimpleNamespace(chat=SimpleNamespace(completions=Completions())),
    )
    result = await thinker.think(
        [
            {"role": "system", "content": "[tutor notes] q1 accepts"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "check my paper"},
                    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}},
                ],
            },
        ]
    )
    assert result.say
    assert len(calls) == 2
    assert "image_url" not in str(calls[1])
    assert "q1 accepts" in str(calls[1])
    assert "latest page notes" in str(calls[1])
