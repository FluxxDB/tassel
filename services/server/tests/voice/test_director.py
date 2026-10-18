import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from tassel.voice.director import Decision, Director, rules


@pytest.mark.parametrize(
    "text,focus,route,action,ref,vision",
    [
        ("draw it on my paper", "paper", "thinker", "mark_paper", "paper", True),
        ("draw on my camera feed", "paper", "thinker", "mark_paper", "paper", True),
        ("draw it on the board", "board", "thinker", "draw_board", "board", False),
        ("look at the whiteboard", "board", "talker", "none", "board", False),
        ("hello", "split", "talker", "none", "conversation", False),
        ("why does this work?", "split", "thinker", "explain", "conversation", False),
        ("what is a DFA?", "split", "talker", "explain", "conversation", False),
    ],
)
def test_rules(text, focus, route, action, ref, vision):
    assert rules(text, focus="split").model_dump() == dict(
        focus=focus, route=route, action=action, refers_to=ref, needs_vision=vision
    )


def test_schema_strict_and_board_never_needs_paper():
    schema = Decision.model_json_schema()
    assert schema["additionalProperties"] is False
    assert len(schema["required"]) == 5
    with pytest.raises(ValidationError):
        Decision(
            focus="board", needs_vision="yes", route="talker", action="none", refers_to="board"
        )
    assert not rules("whiteboard", page_changed=True).needs_vision


@pytest.mark.asyncio
async def test_timeout_uses_rules_and_records_decision():
    async def slow(**kwargs):
        await asyncio.sleep(1)

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=slow)))
    logs = []
    director = Director(client=client, budget_s=0.001, log=lambda *a, **k: logs.append((a, k)))
    decision = await director.decide("hello", [], focus="paper")
    assert decision.route == "talker" and not decision.needs_vision
    assert logs[-1][1]["source"] == "rules"


@pytest.mark.asyncio
async def test_structured_model_request_and_failure():
    result = rules("draw it on the board")
    create = AsyncMock(
        return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=result.model_dump_json()))]
        )
    )
    d = Director(
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    )
    assert await d.decide("draw it on the board", []) == result
    request = create.call_args.kwargs
    assert request["response_format"]["json_schema"]["strict"] is True
    assert request["extra_body"]["provider"]["only"] == ["cerebras"]
    create.return_value.choices[0].message.content = "{}"
    assert (await d.decide("thanks", [])).route == "talker"


@pytest.mark.asyncio
async def test_bot_gate_board_context_stage_and_no_speech_start_capture():
    from uuid import uuid4

    from pipecat.frames.frames import LLMContextFrame
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.frame_processor import FrameDirection

    from tassel.beats.markup import parse_command
    from tassel.voice.bot import _TurnContext

    capture = AsyncMock()
    gate = _TurnContext(uuid4(), capture)
    gate.director = Director()
    gate.request_frame = AsyncMock()
    gate.on_focus = AsyncMock()
    gate.push_frame = AsyncMock()
    parse_command("dfa ex start=q0 accept=q0 q0-0-q0", gate.board)
    await gate.speech_started()
    gate.request_frame.assert_not_called()
    gate.add_turn_image(b"stale", "stale paper")
    context = LLMContext([{"role": "user", "content": "look at the whiteboard"}])
    await gate.process_frame(LLMContextFrame(context), FrameDirection.DOWNSTREAM)
    capture.assert_not_called()
    assert "image_url" not in str(context.get_messages())
    assert "q0" in str(context.get_messages())
    gate.on_focus.assert_awaited_once_with("board")


@pytest.mark.asyncio
async def test_director_route_overrides_keyword_and_notes_survive_no_image():
    from pipecat.processors.aggregators.llm_context import LLMContext
    from test_two_tier import FakeThinker, page

    from tassel.beats.markup import BoardContext
    from tassel.voice.thinker import TutorCoordinator

    c = TutorCoordinator(FakeThinker(), BoardContext())
    ctx = LLMContext([])
    await c.prepare(ctx, "check", page())
    await c.result()
    await c.prepare(ctx, "check", decision=rules("hello"))
    assert c.task is None
    assert c.notes
    c.trigger()  # A talker consult must not override the director either.
    assert c.task is None
    await c.close()


def test_stage_state_message_is_strict():
    from tassel.voice.messages import CLIENT_EVENTS

    state = CLIENT_EVENTS.validate_python(
        dict(kind="stage-state", view="split", frozen=True, page_revision=2)
    )
    assert state.view == "split" and state.page_revision == 2


def test_deictic_paper_question_uses_current_focus():
    decision = rules("check this", focus="paper")
    assert decision.needs_vision and decision.refers_to == "paper"
    assert not rules("check this", focus="board").needs_vision
