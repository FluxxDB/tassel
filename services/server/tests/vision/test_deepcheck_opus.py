"""Both real SDK adapters run exclusively through httpx2.MockTransport."""

import asyncio
import base64
import json
from pathlib import Path
from types import SimpleNamespace

import anthropic
import httpx2
import numpy as np
import openai
import pytest
from pydantic import SecretStr

from tassel.domains.dfa.contract import PREDICATE_SCHEMA
from tassel.vision.deepcheck import (
    OPENAI_DEEPCHECK_MODEL,
    OpenAIDeepCheck,
    OpusDeepCheck,
    ProblemContext,
    make_deepcheck,
    membership_request,
    openai_membership_request,
    openai_transcription_request,
    parse_transcription_response,
    prepare,
    transcription_request,
)
from tassel.vision.fakes.deepcheck import FixtureDeepCheck, NamedFixtureDeepCheck
from tassel.vision.page import encode_jpeg
from tassel.vision.ports import TranscriptLine
from tassel.vision.prompts import MEMBERSHIP_SYSTEM, TRANSCRIBE_SYSTEM, render_context
from tassel.vision.settings import VisionSettings
from tassel.vision.transcription import TRANSCRIPTION_SCHEMA, DfaTranscription

HERE = Path(__file__).parent / "fixtures"
SECRET = "test-only-secret-never-log"
CTX = ProblemContext(
    "My worksheet",
    ("Build the machine.",),
    (TranscriptLine("student", "Done.", 1000), TranscriptLine("tutor", "Let me read it.", 1100)),
    "es",
)


def fixture(name):
    return json.loads((HERE / name).read_text())


@pytest.fixture
def prepared():
    crop = encode_jpeg(np.full((60, 80, 3), 200, np.uint8))
    return prepare(encode_jpeg(np.full((300, 400, 3), 220, np.uint8)), None, crop)


def response_for(provider, payload=None):
    message = fixture("opus-transcription.json") if payload is None else payload
    if provider == "anthropic":
        return message
    text = next((b["text"] for b in message["content"] if b["type"] == "text"), "")
    return {
        "id": "resp_fixture",
        "object": "response",
        "created_at": 0,
        "status": "completed",
        "error": None,
        "incomplete_details": None,
        "model": OPENAI_DEEPCHECK_MODEL,
        "output": [
            {
                "id": "msg_fixture",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": text, "annotations": []}],
            }
        ],
        "parallel_tool_calls": False,
        "tool_choice": "auto",
        "tools": [],
        "usage": {"input_tokens": 100, "output_tokens": 100, "total_tokens": 200},
    }


def reader_for(provider, handler):
    transport = httpx2.MockTransport(handler)
    if provider == "anthropic":
        client = anthropic.AsyncAnthropic(
            api_key=SECRET,
            max_retries=0,
            http_client=anthropic.DefaultAsyncHttpxClient(transport=transport),
        )
        return OpusDeepCheck(api_key=SecretStr(SECRET), client=client), client
    client = openai.AsyncOpenAI(
        api_key=SECRET,
        max_retries=0,
        http_client=openai.DefaultAsyncHttpxClient(transport=transport),
    )
    return OpenAIDeepCheck(api_key=SecretStr(SECRET), client=client), client


def test_request_shape(prepared):
    body = transcription_request(prepared, CTX, model="claude-opus-5-5", effort="low")
    assert set(body) == {
        "model",
        "max_tokens",
        "betas",
        "fallbacks",
        "output_config",
        "system",
        "messages",
    }
    assert body["model"] == "claude-opus-5-5" and body["max_tokens"] == 16000
    assert body["betas"] == ["server-side-fallback-2026-07-01"] and body["fallbacks"] == "default"
    assert body["output_config"] == {
        "effort": "low",
        "format": {"type": "json_schema", "schema": TRANSCRIPTION_SCHEMA},
    }
    assert body["system"] == TRANSCRIBE_SYSTEM
    content = body["messages"][0]["content"]
    assert [b["type"] for b in content] == ["text", "image", "text", "image", "text"]
    assert content[0]["text"] == "Image 1: her page, flattened, with numbered tags."
    assert content[1]["transformations"] == {"oversized_image": "error"}
    assert content[1]["source"]["media_type"] == "image/jpeg"
    assert base64.b64decode(content[1]["source"]["data"]) == prepared.marked_jpeg
    assert base64.b64decode(content[3]["source"]["data"]) == prepared.crop_jpeg
    context = render_context(CTX, prepared)
    for line in (
        "Problem title: My worksheet",
        "What she said earlier:",
        "Build the machine.",
        "Last 20 seconds:",
        "Student: Done.",
        "Ada: Let me read it.",
        f"Image 1 is {prepared.page.width}×{prepared.page.height} pixels with 0 tags.",
    ):
        assert line in context
    assert content[-1]["text"] == context
    for phrase in (
        "You transcribe a student's hand-drawn finite automaton",
        "Transcribe exactly what is drawn, including mistakes. Never fix, complete or judge it.",
        "A double circle is an accepting state. "
        "An arrow that starts from no state points at the start state.",
        "A label such as 0,1 on one arrow means one transition per symbol.",
        "Write ε for an empty-string label (epsilon or lambda).",
        "The numbered blue tags were added by software, not by the student",
        "circle_mark",
        "label_mark",
        "null when no tag fits",
        "Boxes are pixel coordinates in Image 1",
        "Leave out arrows she didn't draw",
        "use | for union, * for zero or more, + for one or more, ? for optional, "
        "parentheses and ε; never + for union",
        "Confidence is your probability, from 0 to 1, that the item is read correctly",
    ):
        assert phrase in TRANSCRIBE_SYSTEM


def test_openai_request_uses_same_images_and_schema(prepared):
    body = openai_transcription_request(prepared, CTX, model=OPENAI_DEEPCHECK_MODEL, effort="low")
    assert body["text"]["format"] == {
        "type": "json_schema",
        "name": "dfa_transcription",
        "strict": True,
        "schema": TRANSCRIPTION_SCHEMA,
    }
    assert body["instructions"] == TRANSCRIBE_SYSTEM
    assert body["max_output_tokens"] == 16000 and body["store"] is False
    assert body["reasoning"] == {"effort": "low"}
    assert "temperature" not in body and "thinking" not in body
    content = body["input"][0]["content"]
    assert [c["type"] for c in content] == [
        "input_text",
        "input_image",
        "input_text",
        "input_image",
        "input_text",
    ]
    for image, raw in zip(
        [content[1], content[3]], [prepared.marked_jpeg, prepared.crop_jpeg], strict=True
    ):
        assert image["detail"] == "high"
        assert base64.b64decode(image["image_url"].split(",", 1)[1]) == raw
    assert content[-1]["text"] == render_context(CTX, prepared)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["anthropic", "openai"])
async def test_contract_against_the_documented_response(provider, prepared, caplog):
    def handler(request):
        assert request.method == "POST"
        assert request.url.path == ("/v1/messages" if provider == "anthropic" else "/v1/responses")
        body = json.loads(request.content)
        if provider == "anthropic":
            assert "server-side-fallback-2026-07-01" in request.headers["anthropic-beta"]
            expected = transcription_request(prepared, CTX, model="claude-opus-5-5", effort="low")
            del expected["betas"]
        else:
            expected = openai_transcription_request(
                prepared, CTX, model=OPENAI_DEEPCHECK_MODEL, effort="low"
            )
        assert body == expected
        return httpx2.Response(
            200,
            json=response_for(provider),
            headers={"request-id": "req_ok", "x-request-id": "req_ok"},
        )

    reader, client = reader_for(provider, handler)
    async with client:
        with caplog.at_level("INFO", logger="tassel.vision.deepcheck"):
            result = await reader.transcribe(prepared, CTX)
    assert result.status == "ok" and result.reading is None and result.ms >= 0
    assert result.transcription == DfaTranscription.model_validate(
        fixture("transcription-demo.json")
    )
    assert "req_ok" in caplog.text and SECRET not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["anthropic", "openai"])
@pytest.mark.parametrize(
    "case,status",
    [
        ("refusal", "refused"),
        ("truncated", "failed"),
        ("invalid", "failed"),
        ("empty", "failed"),
        ("timeout", "timeout"),
        ("connection", "failed"),
        ("500", "failed"),
        ("429", "failed"),
    ],
)
async def test_refusal_timeout_and_errors(provider, case, status, prepared, caplog):
    def handler(request):
        if case == "timeout":
            raise httpx2.ReadTimeout(SECRET, request=request)
        if case == "connection":
            raise httpx2.ConnectError(SECRET, request=request)
        if case in ("500", "429"):
            return httpx2.Response(
                int(case),
                json={"error": {"type": "server_error", "message": SECRET}},
                headers={"request-id": "req_error", "x-request-id": "req_error"},
            )
        body = response_for(provider)
        if provider == "anthropic":
            if case == "refusal":
                body = fixture("opus-refusal.json")
            elif case == "truncated":
                body["stop_reason"] = "max_tokens"
            elif case == "invalid":
                body["content"][-1]["text"] = SECRET
            else:
                body["content"] = []
        else:
            if case == "refusal":
                body["output"][0]["content"] = [{"type": "refusal", "refusal": SECRET}]
            elif case == "truncated":
                body.update(status="incomplete", incomplete_details={"reason": "max_output_tokens"})
            elif case == "invalid":
                body["output"][0]["content"][0]["text"] = SECRET
            else:
                body["output"] = []
        return httpx2.Response(
            200, json=body, headers={"request-id": "req_result", "x-request-id": "req_result"}
        )

    reader, client = reader_for(provider, handler)
    async with client:
        with caplog.at_level("INFO", logger="tassel.vision.deepcheck"):
            result = await reader.transcribe(prepared, CTX)
    assert result.status == status and result.transcription is None and result.reading is None
    assert SECRET not in repr(result) and SECRET not in caplog.text
    assert "transcribe" in caplog.text


def test_refusal_category_is_retained():
    message = SimpleNamespace(
        stop_reason="refusal", stop_details=SimpleNamespace(category="general_harms")
    )
    assert parse_transcription_response(message).detail == "general_harms"


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["anthropic", "openai"])
async def test_membership_request_and_parse(provider, caplog):
    problem = "All binary strings starting with 010"

    def handler(request):
        body = json.loads(request.content)
        if provider == "anthropic":
            expected = membership_request(problem, ["0", "1"], model="claude-opus-5-5")
            del expected["betas"]
            assert expected["max_tokens"] == 4000
            assert expected["output_config"]["effort"] == "low"
            assert expected["output_config"]["format"]["schema"] == PREDICATE_SCHEMA
        else:
            expected = openai_membership_request(problem, ["0", "1"], model=OPENAI_DEEPCHECK_MODEL)
            assert expected["max_output_tokens"] == 4000
            assert expected["text"]["format"]["schema"] == PREDICATE_SCHEMA
        assert body == expected
        assert problem in json.dumps(body) and "010(0|1)*" not in json.dumps(body)
        return httpx2.Response(
            200,
            json=response_for(provider, fixture("opus-membership.json")),
            headers={"request-id": "req_member", "x-request-id": "req_member"},
        )

    reader, client = reader_for(provider, handler)
    async with client:
        result = await reader.membership(problem, ["0", "1"])
    assert result.expressible and result.any_of[0].all_of[0].text == "010"
    assert "If the atoms can't express the language, set expressible to false" in MEMBERSHIP_SYSTEM
    for op in PREDICATE_SCHEMA["$defs"]["Atom"]["properties"]["op"]["enum"]:
        assert op in MEMBERSHIP_SYSTEM


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["anthropic", "openai"])
@pytest.mark.parametrize("case", ["refusal", "invalid", "truncated", "timeout"])
async def test_membership_fails_closed(provider, case):
    def handler(request):
        if case == "timeout":
            raise httpx2.ReadTimeout(SECRET, request=request)
        body = response_for(provider, fixture("opus-membership.json"))
        if provider == "anthropic":
            if case == "refusal":
                body = fixture("opus-refusal.json")
            elif case == "truncated":
                body["stop_reason"] = "max_tokens"
            else:
                body["content"][-1]["text"] = "{}"
        elif case == "refusal":
            body["output"][0]["content"] = [{"type": "refusal", "refusal": SECRET}]
        elif case == "truncated":
            body["status"] = "incomplete"
        else:
            body["output"][0]["content"][0]["text"] = "{}"
        return httpx2.Response(200, json=body)

    reader, client = reader_for(provider, handler)
    async with client:
        assert await reader.membership("Something", ["0", "1"]) is None


@pytest.mark.asyncio
async def test_make_deepcheck_picks_by_settings(clip):
    assert isinstance(make_deepcheck(VisionSettings()), NamedFixtureDeepCheck)
    fake = make_deepcheck(
        VisionSettings(deepcheck_provider="fake", fake_truth=clip("dfa-demo").truth)
    )
    assert isinstance(fake, FixtureDeepCheck)
    for fields, expected in [
        ({"openai_api_key": SECRET}, OpenAIDeepCheck),
        ({"openai_api_key": SECRET, "anthropic_api_key": SECRET}, OpusDeepCheck),
        (
            {"deepcheck_provider": "openai", "anthropic_api_key": SECRET, "openai_api_key": SECRET},
            OpenAIDeepCheck,
        ),
    ]:
        reader = make_deepcheck(VisionSettings(**fields))
        assert isinstance(reader, expected)
        await reader.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["anthropic", "openai"])
async def test_reader_preserves_cancellation_and_injected_client(provider, prepared):
    async def handler(request):
        raise asyncio.CancelledError

    reader, client = reader_for(provider, handler)
    async with client:
        with pytest.raises(asyncio.CancelledError):
            await reader.transcribe(prepared, CTX)
        await reader.aclose()
        assert not client.is_closed()  # lifecycle remains with the injecting caller
