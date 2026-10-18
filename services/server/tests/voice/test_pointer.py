import asyncio
import json
from types import SimpleNamespace

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_retest8_fixes import decision
from test_two_tier import brief

from tassel.beats.markup import BoardContext
from tassel.beats.models import DetectedElement, DetectedElements, PaperElements, PaperFrame
from tassel.voice import thinker
from tassel.voice.prompts import thinker_system_prompt
from tassel.voice.settings import VoiceSettings


def elements():
    return [
        DetectedElement(id="m1", kind="circle", box=dict(x=100, y=100, w=60, h=60)),
        DetectedElement(id="m2", kind="label", box=dict(x=5, y=5, w=20, h=10)),
        DetectedElement(id="m3", kind="label", box=dict(x=115, y=115, w=20, h=10)),
    ]


class Client:
    def __init__(self, mark_id="m1", delay=0):
        self.mark_id, self.delay = mark_id, delay
        self.requests = []
        self.chat = SimpleNamespace(completions=self)

    async def create(self, **request):
        self.requests.append(request)
        await asyncio.sleep(self.delay)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=json.dumps({"marks": [{"i": 0, "id": self.mark_id}]})
                    )
                )
            ],
            usage=None,
        )

    async def close(self):
        pass


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mark_id,keep", [("m1", True), ("m99", False), ("m2", False), ("m3", True), (None, False)]
)
async def test_resolution(mark_id, keep):
    from tassel.voice.pointer import Pointer

    logs = []
    client = Client(mark_id)
    pointer = Pointer(VoiceSettings(), client=client, log=lambda e, **d: logs.append((e, d)))
    intent = thinker.MarkIntent(verb="circle", target="the double-circled final state")
    result = await pointer.resolve([intent], b"jpeg", "m1 circle at right", elements())
    assert result == ([("circle", mark_id, None, None)] if keep else [])
    assert any(e == "reject" and d["source"] == "pointer" for e, d in logs) == (not keep)
    assert client.requests[0]["reasoning_effort"] == "none"
    assert client.requests[0]["response_format"]["json_schema"]["strict"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["resolved", "timeout", "legacy", "null", "failure"])
@pytest.mark.parametrize("action", ["mark_paper", "trace"])
async def test_coordinator_delivers_checked_marks_and_falls_back(mode, action):
    from tassel.voice.pointer import Pointer

    base = brief().model_dump()
    base["paper"] = ["[[freeze]]", "[[check m2]]"]
    base["marks"] = [] if mode == "legacy" else [{"verb": "circle", "target": "the final state"}]

    class Thinker:
        async def think(self, messages, effort=None):
            return thinker.GuidanceBrief.model_validate(base)

        async def close(self):
            pass

    board = BoardContext(
        paper_frame=PaperFrame(kind="paper", id="frame", captured_at="now"),
        paper_elements=PaperElements(
            states={}, edges={}, detected=DetectedElements(width=200, height=200, items=elements())
        ),
    )

    class FailingClient(Client):
        async def create(self, **request):
            raise RuntimeError("provider unavailable")

    pointer = Pointer(
        VoiceSettings(pointer_timeout_s=0.01),
        client=Client(None if mode == "null" else "m1", delay=0.1 if mode == "timeout" else 0),
    )
    if mode == "failure":
        pointer.client.client = FailingClient()
    events = []
    transcript = SimpleNamespace(record=lambda e, d: events.append((e, d)))
    c = thinker.TutorCoordinator(Thinker(), board, pointer=pointer, transcript=transcript)
    pointer.log = c.log

    async def page():
        return b"jpeg", "m1 circle at right"

    await c.prepare(
        LLMContext([{"role": "user", "content": "circle it"}]),
        "circle it",
        decision=decision(action=action),
        page=page,
    )
    result = await c.result()
    expected = (
        []
        if mode == "null"
        else ["[[freeze]]", "[[circle m1]]" if mode == "resolved" else "[[check m2]]"]
    )
    assert result.paper == expected
    assert any(e == "pointer_duration" for e, d in events) == (mode != "legacy")
    if mode in ("resolved", "null"):
        assert any(e == "pointer_brief" for e, d in events)
    await c.close()


def test_prompt_and_intent_contract():
    assert "marks: preferred for paper marks" in thinker_system_prompt({})
    assert "target" in thinker_system_prompt({})
    assert brief().marks == []
    with pytest.raises(ValueError):
        thinker.MarkIntent(verb="circle", target="x" * 81)


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["the edge between states", "the arrow", "the label"])
async def test_non_state_targets_accept_far_label(target):
    from tassel.voice.pointer import Pointer

    pointer = Pointer(VoiceSettings(), client=Client("m2"))
    assert await pointer.resolve(
        [thinker.MarkIntent(verb="wash", target=target)], b"jpeg", "", elements()
    ) == [("wash", "m2", None, None)]


@pytest.mark.asyncio
async def test_openrouter_backup_and_usage():
    import httpx
    from openai import RateLimitError

    from tassel.voice.director import QWEN_BACKUP_PROVIDER, QWEN_PRIMARY_PROVIDER
    from tassel.voice.pointer import Pointer

    class RouterClient(Client):
        async def create(self, **request):
            if not self.requests:
                from copy import deepcopy

                self.requests.append(deepcopy(request))
                raise RateLimitError(
                    "busy",
                    response=httpx.Response(
                        429, request=httpx.Request("POST", "https://example.com")
                    ),
                    body={},
                )
            response = await super().create(**request)
            response.usage = SimpleNamespace(
                prompt_tokens=10, completion_tokens=4, prompt_tokens_details=None
            )
            return response

    usage = []
    client = RouterClient()
    pointer = Pointer(VoiceSettings(pointer_provider="openrouter"), client=client)
    pointer.client.on_usage = lambda model, **counts: usage.append((model, counts))
    assert await pointer.resolve(
        [thinker.MarkIntent(verb="circle", target="state")], b"jpeg", "", elements()
    )
    assert client.requests[0]["extra_body"]["provider"] == QWEN_PRIMARY_PROVIDER
    assert client.requests[1]["extra_body"]["provider"] == QWEN_BACKUP_PROVIDER
    assert usage == [("pointer:qwen/qwen3.8-27b", {"prompt": 10, "cached": 0, "completion": 4})]


def test_tag_serialization():
    from tassel.voice.pointer import mark_tags

    assert mark_tags(
        [
            ("circle", "m1", None, None),
            ("wash", "m1", None, None),
            ("check", "m1", None, None),
            ("strike", "m1", None, None),
            ("callout", "m1", "Look here", None),
            ("number", "m1", None, 2),
        ]
    ) == [
        "[[freeze]]",
        "[[circle m1]]",
        "[[wash m1]]",
        "[[check m1]]",
        "[[strike m1]]",
        '[[callout m1 "Look here"]]',
        "[[number 2 m1]]",
    ]


@pytest.mark.asyncio
async def test_cancellation_propagates():
    from tassel.voice.pointer import Pointer

    pointer = Pointer(VoiceSettings(), client=Client(delay=10))
    task = asyncio.create_task(
        pointer.resolve(
            [thinker.MarkIntent(verb="circle", target="state")], b"jpeg", "", elements()
        )
    )
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_missing_page_clears_pointer_image():
    c = thinker.TutorCoordinator(None, BoardContext())
    c.page_image, c.page_caption = b"old", "old legend"
    c.messages = [{"role": "user", "content": "circle it"}]

    async def missing():
        return None

    c._page = missing
    await c._attach_page()
    assert c.page_image is None
    assert c.page_caption == ""


def test_thinker_paper_example_prefers_word_targets():
    from tassel.voice.prompts import THINKER_EXAMPLES

    example = next(e for e in THINKER_EXAMPLES if e["student"] == "Circle the mistake on my paper.")
    assert example["brief"]["marks"][0]["target"] == "the double-circled final state"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target",
    [
        "the final state next to the arrow",
        "the circle containing the label q2",
    ],
)
async def test_state_target_with_relational_label_or_arrow_rejects_far_label(target):
    from tassel.voice.pointer import Pointer

    pointer = Pointer(VoiceSettings(), client=Client("m2"))
    assert (
        await pointer.resolve(
            [thinker.MarkIntent(verb="circle", target=target)], b"jpeg", "", elements()
        )
        == []
    )
