"""Regression: the owner's live run fell back to rules on every turn (OpenRouter 404)."""

import pytest

from tassel.voice.director import Director


class _Capture:
    def __init__(self):
        self.kwargs = None
        self.chat = self
        self.completions = self

    async def create(self, **kwargs):
        self.kwargs = kwargs
        raise RuntimeError("stop after capture")


@pytest.mark.asyncio
async def test_director_request_never_requires_parameters():
    # Cerebras doesn't list structured output among its supported parameters, so
    # provider.require_parameters made OpenRouter answer 404 for every director call.
    client = _Capture()
    await Director(client=client).decide("Is this part okay?", [])
    provider = client.kwargs["extra_body"]["provider"]
    assert provider["only"] == ["cerebras"]
    assert "require_parameters" not in provider
    assert client.kwargs["response_format"]["type"] == "json_schema"


def test_director_budget_allows_a_real_cerebras_call():
    # Measured live: 210–244 ms for the strict schema; 300 ms left no margin.
    assert Director().budget_s >= 0.5
