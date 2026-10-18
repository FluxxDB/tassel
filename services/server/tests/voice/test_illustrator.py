import asyncio
import json
from types import SimpleNamespace

import pytest

from tassel.beats.markup import BoardContext, parse_command
from tassel.beats.models import DiagramSpec
from tassel.voice.action_checker import check_tags
from tassel.voice.director import rules
from tassel.voice.illustrator import Illustrator
from tassel.voice.prompts import thinker_system_prompt
from tassel.voice.settings import VoiceSettings
from tassel.voice.thinker import GuidanceBrief

SPEC = dict(
    direction="LR",
    groups=[dict(id="zone", label="LAN", sublabel="10.0.0.0/26")],
    nodes=[dict(id="r", label="Router", sublabel="10.0.0.1", icon="router", group="zone")],
    edges=[],
)


class Client:
    def __init__(self, *answers):
        self.answers = iter(answers)
        self.requests = []
        self.chat = self.completions = self

    async def create(self, **request):
        self.requests.append(request)
        answer = next(self.answers)
        if isinstance(answer, Exception):
            raise answer
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(answer)))]
        )

    async def close(self):
        pass


def response(spec=SPEC):
    return dict(item="net", spec=spec)


@pytest.mark.asyncio
async def test_valid_and_edit_in_place():
    board = BoardContext()
    client = Client(response(), response({**SPEC, "title": "Updated"}))
    illustrator = Illustrator(VoiceSettings(), client=client)
    for title in (None, "Updated"):
        item, spec = await illustrator.draw("draw network", board, "es")
        board.pending_diagrams[item] = spec
        action = parse_command("diagram net", board)
        assert action.kind == "board.diagram" and action.reveal == "all"
        assert board.diagrams[item].title == title
    assert list(board.diagrams) == ["net"]
    assert "net" in client.requests[1]["messages"][1]["content"]
    assert client.requests[0]["reasoning_effort"] == "none"
    assert client.requests[0]["response_format"] == {"type": "json_object"}


@pytest.mark.asyncio
@pytest.mark.parametrize("success", [True, False])
async def test_one_repair(success):
    events = []
    client = Client(response({**SPEC, "nodes": []}), response() if success else response({}))
    illustrator = Illustrator(
        VoiceSettings(), client=client, log=lambda e, **d: events.append((e, d))
    )
    result = await illustrator.draw("network", BoardContext(), "en")
    assert bool(result) == success
    assert len(client.requests) == 2
    assert "repair" in client.requests[1]["messages"][-1]["content"].lower()
    if not success:
        assert any(e == "reject" and d["source"] == "illustrator" for e, d in events)


@pytest.mark.asyncio
async def test_timeout_returns_no_drawing():
    illustrator = Illustrator(VoiceSettings(), client=Client(TimeoutError()))
    assert await illustrator.draw("network", BoardContext(), "ko") is None


@pytest.mark.parametrize("ref", ["node:r", "group:zone", "edge:r>s"])
@pytest.mark.parametrize("verb", ["reveal", "highlight", "pulse"])
def test_element_refs(verb, ref):
    action = parse_command(f"{verb} net {ref}", BoardContext())
    assert action is not None
    assert (action.els[0] if verb == "reveal" else action.el) == ref


def test_note_newline_and_near():
    action = parse_command(r'note n "a\nb" near=net:node:r', BoardContext())
    assert action.text == "a\nb"
    assert action.near.el == "node:r"


def test_checker_rejects_invalid_network():
    spec = DiagramSpec.model_validate(
        {**SPEC, "nodes": [{**SPEC["nodes"][0], "sublabel": "10.0.0.63"}]}
    )
    board = BoardContext(pending_diagrams={"net": spec})
    checked = check_tags(["[[diagram net]]"], rules("draw a network"), board)
    assert checked.repair and not checked.tags
    assert not board.diagrams


def test_thinker_drawing_prompt():
    prompt = thinker_system_prompt(GuidanceBrief.model_json_schema())
    assert "Board tools" in prompt
    assert "draw a network with zones" in prompt.lower()
    assert "draw" in GuidanceBrief.model_fields


class DrawingThinker:
    def __init__(self, draw="network"):
        self.intent = draw

    async def think(self, messages, effort=None):
        return GuidanceBrief(
            page="",
            intent="draw",
            diagnosis="",
            plan=["draw"],
            say="These are the zones.",
            board=[],
            paper=[],
            confidence=1.0,
            followups=[],
            draw=self.intent,
        )

    async def close(self):
        pass


class SlowIllustrator:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def draw(self, intent, board, lang):
        self.started.set()
        await self.release.wait()
        return "net", DiagramSpec.model_validate(SPEC)

    async def close(self):
        pass


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "draw,text,expected",
    [
        (None, "draw a network", False),
        ("network", "circle my paper", False),
        ("network", "draw a network", True),
    ],
)
async def test_coordinator_gates_and_does_not_wait(draw, text, expected):
    from pipecat.processors.aggregators.llm_context import LLMContext

    from tassel.voice.thinker import TutorCoordinator

    illustrator = SlowIllustrator()
    c = TutorCoordinator(DrawingThinker(draw), BoardContext(), illustrator=illustrator)
    await c.prepare(LLMContext([]), text, decision=rules(text))
    brief = await asyncio.wait_for(c.result(), 1)
    await asyncio.sleep(0)
    assert brief.say == "These are the zones."
    assert illustrator.started.is_set() == expected
    await c.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "lang,words", [("en", "Here it is."), ("es", "Aquí está."), ("ko", "여기 있어요.")]
)
async def test_late_diagram_is_spoken_after_brief(lang, words):
    from pipecat.frames.frames import LLMFullResponseEndFrame, LLMTextFrame
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.frame_processor import FrameDirection

    from tassel.voice.thinker import ThinkerOutput, TutorCoordinator

    illustrator = SlowIllustrator()
    c = TutorCoordinator(
        DrawingThinker(), BoardContext(), illustrator=illustrator, lang=lambda: lang
    )
    await c.prepare(LLMContext([]), "draw a network")
    output = ThinkerOutput(c)
    frames = []

    async def push(frame, *args):
        frames.append(frame)
        if isinstance(frame, LLMTextFrame) and "These are" in frame.text:
            assert not illustrator.release.is_set()
            illustrator.release.set()

    output.push_frame = push
    await output.process_frame(LLMFullResponseEndFrame(), FrameDirection.DOWNSTREAM)
    texts = [f.text for f in frames if isinstance(f, LLMTextFrame)]
    assert texts == ["These are the zones.", "[[diagram net]]" + words]
    assert "net" in c.board.pending_diagrams
    await c.close()


@pytest.mark.asyncio
async def test_ready_diagram_leads_compose_and_logs():
    from pipecat.processors.aggregators.llm_context import LLMContext

    from tassel.voice.thinker import TutorCoordinator, compose

    events = []
    illustrator = SlowIllustrator()
    illustrator.release.set()
    c = TutorCoordinator(
        DrawingThinker(),
        BoardContext(),
        illustrator=illustrator,
        transcript=SimpleNamespace(record=lambda e, d: events.append((e, d))),
    )
    await c.prepare(LLMContext([]), "draw a network")
    await c.task
    await c.illustrator_task
    brief = await c.result()
    assert compose(brief).startswith("[[diagram net]]These")
    assert await c.diagram_result() is None  # delivered exactly once
    assert {e for e, d in events} >= {"illustrator_brief", "illustrator_duration"}
    await c.close()


@pytest.mark.asyncio
async def test_timeout_still_speaks_say():
    from pipecat.frames.frames import LLMFullResponseEndFrame, LLMTextFrame
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.frame_processor import FrameDirection

    from tassel.voice.thinker import ThinkerOutput, TutorCoordinator

    c = TutorCoordinator(
        DrawingThinker(),
        BoardContext(),
        illustrator=Illustrator(VoiceSettings(), client=Client(TimeoutError())),
    )
    await c.prepare(LLMContext([]), "draw a network")
    output = ThinkerOutput(c)
    frames = []

    async def push(frame, *args):
        frames.append(frame)

    output.push_frame = push
    await output.process_frame(LLMFullResponseEndFrame(), FrameDirection.DOWNSTREAM)
    assert [f.text for f in frames if isinstance(f, LLMTextFrame)] == ["These are the zones."]
    assert not c.board.pending_diagrams
    await c.close()


@pytest.mark.asyncio
async def test_openrouter_429_uses_backup():
    from copy import deepcopy

    import httpx
    from openai import RateLimitError

    from tassel.voice.director import QWEN_BACKUP_PROVIDER, QWEN_PRIMARY_PROVIDER

    class BusyClient(Client):
        async def create(self, **request):
            return await super().create(**deepcopy(request))

    error = RateLimitError(
        "busy",
        response=httpx.Response(429, request=httpx.Request("POST", "https://example.test")),
        body=None,
    )
    client = BusyClient(error, response())
    illustrator = Illustrator(VoiceSettings(illustrator_provider="openrouter"), client=client)
    assert await illustrator.draw("network", BoardContext(), "ko")
    first, second = client.requests
    assert first["model"] == "qwen/qwen3.8-27b"
    assert first["response_format"]["type"] == "json_schema"
    assert first["extra_body"]["provider"] == QWEN_PRIMARY_PROVIDER
    assert second["extra_body"]["provider"] == QWEN_BACKUP_PROVIDER


@pytest.mark.asyncio
async def test_deadline_bounds_hung_client():
    class HungClient(Client):
        async def create(self, **request):
            await asyncio.Event().wait()

    illustrator = Illustrator(VoiceSettings(illustrator_timeout_s=0.01), client=HungClient())
    assert await asyncio.wait_for(illustrator.draw("network", BoardContext(), "en"), 1) is None


@pytest.mark.asyncio
async def test_cancel_discards_late_drawing():
    from pipecat.processors.aggregators.llm_context import LLMContext

    from tassel.voice.thinker import TutorCoordinator

    illustrator = SlowIllustrator()
    c = TutorCoordinator(DrawingThinker(), BoardContext(), illustrator=illustrator)
    await c.prepare(LLMContext([]), "draw a network")
    await c.result()
    await illustrator.started.wait()
    await c.cancel()
    illustrator.release.set()
    assert await c.diagram_result() is None
    assert not c.board.pending_diagrams
    await c.close()


def test_clear_removes_diagram_state():
    spec = DiagramSpec.model_validate(SPEC)
    board = BoardContext(diagrams={"net": spec}, pending_diagrams={"net": spec})
    parse_command("clear net", board)
    assert not board.diagrams and not board.pending_diagrams


@pytest.mark.asyncio
async def test_cancel_removes_ready_but_undelivered_spec():
    from pipecat.processors.aggregators.llm_context import LLMContext

    from tassel.voice.thinker import TutorCoordinator

    illustrator = SlowIllustrator()
    illustrator.release.set()
    c = TutorCoordinator(DrawingThinker(), BoardContext(), illustrator=illustrator)
    await c.prepare(LLMContext([]), "draw a network")
    await c.task
    await c.illustrator_task
    assert "net" in c.board.pending_diagrams
    await c.cancel()
    assert not c.board.pending_diagrams
    await c.close()


@pytest.mark.asyncio
async def test_provider_schema_is_strict_and_types_custom_wire_strings():
    client = Client(response())
    illustrator = Illustrator(VoiceSettings(illustrator_provider="openrouter"), client=client)
    await illustrator.draw("network", BoardContext(), "en")
    schema = client.requests[0]["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["item"]["type"] == "string"
    for definition in schema["$defs"].values():
        assert set(definition["required"]) == set(definition["properties"])
        for prop in definition["properties"].values():
            assert "default" not in prop
            for alternative in prop.get("anyOf", [prop]):
                assert "type" in alternative or "$ref" in alternative


@pytest.mark.asyncio
async def test_diagram_reaches_beat_before_matching_speech():
    from pipecat.frames.frames import AggregatedTextFrame, LLMFullResponseEndFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.tests.utils import run_test

    from tassel.beats.processor import BeatTagProcessor
    from tassel.voice.thinker import ThinkerOutput, TutorCoordinator

    events = []

    class Events:
        async def send(self, event):
            events.append(event)

    illustrator = SlowIllustrator()
    illustrator.release.set()
    board = BoardContext()
    c = TutorCoordinator(DrawingThinker(), board, illustrator=illustrator)
    await c.prepare(LLMContext([]), "draw a network")
    await c.task
    await c.illustrator_task
    frames, _ = await run_test(
        Pipeline(
            [ThinkerOutput(c), BeatTagProcessor(events=Events(), lang=lambda: "en", board=board)]
        ),
        frames_to_send=[LLMFullResponseEndFrame()],
    )
    beat = next(e.beat for e in events if hasattr(e, "beat"))
    assert beat.markers[0].word == 0
    assert beat.markers[0].action.kind == "board.diagram"
    assert beat.markers[0].action.spec == board.diagrams["net"]
    speech = next(f for f in frames if isinstance(f, AggregatedTextFrame))
    assert speech.text == beat.text == "These are the zones."
    assert beat.segment == str(speech.id)
    await c.close()
