import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import httpx2
import openai
import pytest
from pydantic import SecretStr

from tassel.vision.gate_openai import OpenAIDecisionsGate, openai_request, parse_openai_decision
from tassel.vision.ports import PREDICATE_QUESTIONS, PREDICATES, GateError, GateInput

GI = GateInput(b"jpeg", (), "en", "frame", None, None, True, 2)
FIXTURE = json.loads((Path(__file__).parent / "fixtures/openai-decision.json").read_text())


def test_openai_request_shape():
    body = openai_request(GI, model="gpt-6-luna")
    assert set(body) == {"model", "input", "questions"}
    assert body["model"] == "gpt-6-luna"
    assert len(body["input"]) == 1
    assert body["input"][0]["role"] == "user"
    content = body["input"][0]["content"]
    assert content[0]["type"] == "input_text"
    assert "Session language: English." in content[0]["text"]
    assert content[1] == {
        "type": "input_image",
        "image_url": "data:image/jpeg;base64,anBlZw==",
        "detail": "auto",
    }
    assert body["questions"] == [
        {"type": "predicate", "name": p, "instructions": PREDICATE_QUESTIONS[p]} for p in PREDICATES
    ]
    assert (
        len(openai_request(replace(GI, image_jpeg=None), model="custom")["input"][0]["content"])
        == 1
    )


@pytest.mark.asyncio
async def test_openai_contract(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        assert request.method == "POST"
        assert request.url.path == "/v1/decisions"
        body = json.loads(request.content)
        assert body["model"] == "gpt-6-luna"
        assert [q["name"] for q in body["questions"]] == list(PREDICATES)
        assert body["input"][0]["content"][1]["image_url"] == "data:image/jpeg;base64,anBlZw=="
        return httpx2.Response(200, json=FIXTURE)

    async with openai.AsyncOpenAI(
        api_key="test-key",
        http_client=openai.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler)),
    ) as client:
        gate = OpenAIDecisionsGate(api_key=SecretStr("test-key"), client=client)
        times = iter([10.0, 10.125])
        monkeypatch.setattr(
            "tassel.vision.gate_openai.time", SimpleNamespace(perf_counter=lambda: next(times))
        )
        result = await gate.evaluate(GI)
        assert result.probs == {
            "diagram_attempt_complete": 0.9,
            "new_work_worth_checking": 0.8,
            "student_seems_stuck": 0.1,
        }
        assert result.refused == ("not_schoolwork",)
        assert result.provider == "openai"
        assert result.ms == 125
        await gate.aclose()
        assert not client.is_closed()  # Injected clients belong to the caller.
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["500", "timeout", "invalid-json", "missing-answers"])
async def test_openai_failure_is_safe_and_not_retried(failure):
    calls = []

    def handler(request):
        calls.append(request)
        if failure == "timeout":
            raise httpx2.ReadTimeout("test-key private transcript", request=request)
        if failure == "500":
            return httpx2.Response(500, json={"error": {"message": "test-key private transcript"}})
        if failure == "invalid-json":
            return httpx2.Response(200, text="test-key private transcript")
        return httpx2.Response(200, json={"model": "gpt-6-luna"})

    async with openai.AsyncOpenAI(
        api_key="test-key",
        http_client=openai.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler)),
    ) as client:
        gate = OpenAIDecisionsGate(api_key=SecretStr("test-key"), client=client)
        with pytest.raises(GateError) as exc:
            await gate.evaluate(GI)
        assert "test-key" not in str(exc.value)
        assert "private transcript" not in str(exc.value)
        assert len(calls) == 1


@pytest.mark.parametrize("bad", [True, "0.9", None, -0.1, 1.1, float("nan"), float("inf")])
def test_openai_rejects_invalid_probability(bad):
    body = json.loads(json.dumps(FIXTURE))
    body["answers"][0]["probability"] = bad
    with pytest.raises(GateError):
        parse_openai_decision(body)


@pytest.mark.parametrize(
    "mutation", ["missing", "duplicate", "unknown", "wrong-type", "not-object"]
)
def test_openai_rejects_bad_answers(mutation):
    body = json.loads(json.dumps(FIXTURE))
    if mutation == "missing":
        body["answers"].pop()
    elif mutation == "duplicate":
        body["answers"][1]["name"] = "diagram_attempt_complete"
    elif mutation == "unknown":
        body["answers"][0]["name"] = "other"
    elif mutation == "wrong-type":
        body["answers"][0]["type"] = "choice"
    else:
        body["answers"][0] = None
    with pytest.raises(GateError):
        parse_openai_decision(body)


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [True, "0.9", "test-key-private-transcript"])
async def test_openai_wire_probabilities_are_not_coerced_or_logged(bad, recwarn):
    body = json.loads(json.dumps(FIXTURE))
    body["answers"][0]["probability"] = bad

    async with openai.AsyncOpenAI(
        api_key="test-key",
        http_client=openai.DefaultAsyncHttpxClient(
            transport=httpx2.MockTransport(lambda request: httpx2.Response(200, json=body))
        ),
    ) as client:
        with pytest.raises(GateError):
            await OpenAIDecisionsGate(api_key=SecretStr("test-key"), client=client).evaluate(GI)
    assert not recwarn.list
