import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import httpx2
import pytest
from pydantic import SecretStr

from tassel.vision.gate_clef import VULTR_SYSTEMONE_URL, ClefGate, clef_request
from tassel.vision.ports import PREDICATE_QUESTIONS, PREDICATES, GateError, GateInput

GI = GateInput(b"jpeg", (), "ko", "stall", 7000, 9000, False, 0)
FIXTURE = json.loads((Path(__file__).parent / "fixtures/clef-systemone.json").read_text())


@pytest.mark.parametrize("image", [None, b"jpeg"])
def test_clef_request_shape(image):
    body = clef_request(replace(GI, image_jpeg=image), model="clef-flash", ref="unique-ref")
    assert body["model"] == "clef-flash"
    assert "Session language: Korean." in body["state"]["context"]
    assert body["questions"] == {
        p: {"type": "noul", "instructions": PREDICATE_QUESTIONS[p]} for p in PREDICATES
    }
    if image:
        assert json.dumps(body["state"]).count("unique-ref") == 1
        assert body["state"]["page"] == "unique-ref"
        assert body["assets"] == {
            "unique-ref": {"type": "image", "format": "jpeg", "data_base64": "anBlZw=="}
        }
    else:
        assert "page" not in body["state"]
        assert "assets" not in body


@pytest.mark.asyncio
@pytest.mark.parametrize("image", [None, b"jpeg"])
async def test_clef_contract(image, monkeypatch):
    refs = []

    def handler(request):
        assert request.method == "POST"
        assert str(request.url) == VULTR_SYSTEMONE_URL
        assert request.headers["Authorization"] == "Bearer test-key"
        assert request.headers["Content-Type"] == "application/json"
        body = json.loads(request.content)
        assert body["model"] == "clef-flash"
        if image:
            assert request.headers["TypeSafe-Danger-Zone-Images"] == "true"
            ref = body["state"]["page"]
            assert UUID(ref).version == 4
            assert json.dumps(body["state"]).count(ref) == 1
            assert list(body["assets"]) == [ref]
            refs.append(ref)
        else:
            assert "TypeSafe-Danger-Zone-Images" not in request.headers
            assert "assets" not in body
            assert "page" not in body["state"]
        return httpx2.Response(200, json=FIXTURE)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
        gate = ClefGate(api_key=SecretStr("test-key"), client=client)
        times = iter([10.0, 10.125, 11.0, 11.125])
        monkeypatch.setattr(
            "tassel.vision.gate_clef.time", SimpleNamespace(perf_counter=lambda: next(times))
        )
        for _ in range(2):
            result = await gate.evaluate(replace(GI, image_jpeg=image))
            assert result.probs == {
                "diagram_attempt_complete": 0.9,
                "new_work_worth_checking": 0.8,
                "student_seems_stuck": 0.1,
                "not_schoolwork": 0.05,
            }
            assert (result.provider, result.refused, result.ms) == ("clef", (), 125)
        await gate.aclose()
        assert not client.is_closed
    if image:
        assert refs[0] != refs[1]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [201, 400, 413, 422, 429, 529])
async def test_clef_status_errors(status):
    def handler(request):
        return httpx2.Response(
            status,
            json={
                "metadata": {"error_type": "invalid_request"},
                "message": "test-key private transcript",
            },
        )

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
        with pytest.raises(GateError, match=f"{status}.*invalid_request") as exc:
            await ClefGate(api_key=SecretStr("test-key"), client=client).evaluate(GI)
        assert "test-key" not in str(exc.value)
        assert "private transcript" not in str(exc.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "invalid-json", "missing", "bad-value", "bad-type"])
async def test_clef_bad_responses(failure):
    def handler(request):
        if failure == "timeout":
            raise httpx2.ReadTimeout("test-key private transcript", request=request)
        if failure == "invalid-json":
            return httpx2.Response(200, text="test-key private transcript")
        body = json.loads(json.dumps(FIXTURE))
        if failure == "missing":
            body["answers"].pop("not_schoolwork")
        elif failure == "bad-value":
            body["answers"]["not_schoolwork"]["noul"] = 1.5
        else:
            body["answers"]["not_schoolwork"]["type"] = "text"
        return httpx2.Response(200, json=body)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
        with pytest.raises(GateError) as exc:
            await ClefGate(api_key=SecretStr("test-key"), client=client).evaluate(GI)
        assert "test-key" not in str(exc.value)
        assert "private transcript" not in str(exc.value)
