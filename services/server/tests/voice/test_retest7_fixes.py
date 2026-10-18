"""Regressions from the owner's retest #7 (2026-10-18 00:00): no drawing on the camera or the
board, long thinking, 429s from Cerebras, and background music interrupting Ada."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest
from openai import RateLimitError
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    InterimTranscriptionFrame,
    ProposedUserStartedSpeakingFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.tests.utils import run_test
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from tassel.voice.director import Decision, Director, guard, rules
from tassel.voice.prompts import TALKER_RULES, thinker_system_prompt
from tassel.voice.turns import BackchannelGuard, TurnTuning


def decision(**kw):
    base = dict(
        focus="paper", needs_vision=False, route="talker", action="none", refers_to="conversation"
    )
    return Decision(**{**base, **kw})


# --- Drawing on the camera: the model said board/none and the guard let it through ---------


def test_draw_on_my_camera_is_a_paper_mark_whatever_the_model_said():
    out = guard(
        "Can you draw directly on my my camera then?",
        decision(focus="board", route="thinker", action="none", refers_to="board"),
    )
    assert (out.action, out.refers_to, out.focus, out.route) == (
        "mark_paper",
        "paper",
        "paper",
        "thinker",
    )
    assert out.needs_vision


@pytest.mark.parametrize(
    "text",
    [
        "Can you draw on top of my camera?",
        "Circle it on my paper.",
        "Show me on my paper where it goes.",
        "Can you point to it on the camera?",
    ],
)
def test_paper_drawing_requests(text):
    for start in (rules(text), decision(action="draw_board", refers_to="board", focus="board")):
        out = guard(text, start)
        assert out.action == "mark_paper" and out.refers_to == "paper" and out.needs_vision


# --- "Do you see the DFA I tried to draw?" is about her paper, not a board drawing ----------


@pytest.mark.parametrize(
    "text",
    [
        "Okay. Do you see the DFA that I try to draw?",
        "Can you look at what I drew?",
        "Is my DFA right?",
    ],
)
def test_her_own_drawing_means_the_paper(text):
    for start in (rules(text), decision(action="draw_board", refers_to="board", focus="board")):
        out = guard(text, start)
        assert out.refers_to == "paper" and out.needs_vision and out.action != "draw_board"
        assert out.route == "thinker"


# --- Board requests and complaints go to the thinker as board drawings ----------------------


@pytest.mark.parametrize(
    "text",
    [
        "I don't see anything on the whiteboard.",
        "I don't see anything on your whiteboard.",
        "What's wrong with my DFA? Can you walk through a counter example? on your whiteboard.",
        "Can you show me on the whiteboard?",
    ],
)
def test_board_requests_draw_on_the_board(text):
    for start in (rules(text), decision(focus="board", refers_to="board")):
        out = guard(text, start)
        assert (out.route, out.action, out.focus) == ("thinker", "draw_board", "board")


def test_vision_turns_go_to_the_thinker():
    # The talker took 6.6 s with the page attached; the thinker reads it after a bridge.
    out = guard(
        "Hello. Can you see my paper?",
        decision(needs_vision=True, route="talker", refers_to="paper"),
    )
    assert out.route == "thinker" and out.needs_vision


@pytest.mark.parametrize(
    "text", ["Can you walk through a counter example?", "What's wrong with my DFA?"]
)
def test_diagnosis_phrasing_is_complex(text):
    assert guard(text, decision()).route == "thinker"


# --- The director survives a 429 by trying the same model elsewhere -------------------------


class _Completions:
    def __init__(self, outcomes):
        self.outcomes, self.calls = list(outcomes), []

    async def create(self, **kw):
        self.calls.append(kw)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _rate_limit():
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    return RateLimitError("rate limited", response=httpx.Response(429, request=request), body=None)


def test_director_retries_a_rate_limit_on_backup_providers():
    reply = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=decision(route="thinker", action="explain").model_dump_json()
                )
            )
        ]
    )
    completions = _Completions([_rate_limit(), reply])
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    out = asyncio.run(Director(client=client).decide("why does q2 loop?", []))
    assert out.route == "thinker"
    first, second = (c["extra_body"]["provider"] for c in completions.calls)
    assert first["only"] == ["cerebras"]
    assert "cerebras" not in second.get("order", []) and second["allow_fallbacks"]


# --- Interruptions: music must not cut Ada off or cancel a pending answer -------------------


async def _starts(frames, *, busy=lambda: False, sensitivity="normal"):
    start = BackchannelGuard(tuning=TurnTuning(sensitivity=sensitivity), lang="en", busy=busy)
    user, _ = LLMContextAggregatorPair(
        LLMContext(),
        user_params=LLMUserAggregatorParams(user_turn_strategies=UserTurnStrategies(start=[start])),
    )
    down, _ = await run_test(user, frames_to_send=frames)
    return any(isinstance(f, UserStartedSpeakingFrame) for f in down)


def _speech(text):
    return [
        ProposedUserStartedSpeakingFrame(),
        InterimTranscriptionFrame(text, "", ""),
        TranscriptionFrame(text, "", ""),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text,starts",
    [
        ("baby love", False),  # a two-word lyric
        ("oh oh oh", False),
        ("what does that mean", True),
        ("wait", True),
        ("hold on", True),
        ("sorry what", True),
    ],
)
async def test_speaking_ada_needs_real_words_to_be_interrupted(text, starts):
    assert await _starts([BotStartedSpeakingFrame(), *_speech(text)]) == starts


@pytest.mark.asyncio
async def test_a_pending_answer_is_not_cancelled_by_noise():
    # Ada said her bridge and stopped; the thinker is still working.
    frames = [
        BotStartedSpeakingFrame(),
        BotStoppedSpeakingFrame(),
        ProposedUserStartedSpeakingFrame(),
    ]
    assert not await _starts(frames, busy=lambda: True)
    assert await _starts([*frames, *_speech("can you show me again")], busy=lambda: True)


@pytest.mark.asyncio
async def test_idle_ada_still_hears_a_start_signal():
    assert await _starts([ProposedUserStartedSpeakingFrame()])


# --- Prompts: the talker never promises a drawing; the thinker never asks for a re-send -----


def test_talker_never_promises_a_drawing_itself():
    assert "Never promise a drawing" in TALKER_RULES


def test_thinker_never_asks_the_student_to_resend_the_image():
    prompt = thinker_system_prompt({})
    assert "Never ask the student to send" in prompt


# --- Long thinking: effort "none" answers in ~2.7 s; constructions keep "low" ---------------


def _recording_thinker(model="gpt-6-luna"):
    from test_two_tier import brief

    from tassel.voice.settings import VoiceSettings
    from tassel.voice.thinker import Thinker

    requests = []

    class Completions:
        async def create(self, **kw):
            requests.append(kw)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(message=SimpleNamespace(content=brief().model_dump_json()))
                ]
            )

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    settings = VoiceSettings(openai_api_key="fake", thinker_model=model)
    return Thinker(settings, client=client), requests


def test_thinker_answers_at_effort_none_and_constructs_at_low():
    thinker, requests = _recording_thinker()
    asyncio.run(thinker.think([{"role": "user", "content": "see my paper?"}]))
    asyncio.run(thinker.think([{"role": "user", "content": "draw it"}], effort="low"))
    assert [r["reasoning_effort"] for r in requests] == ["none", "low"]
    astra, requests = _recording_thinker("gpt-6-astra")
    asyncio.run(astra.think([{"role": "user", "content": "hi"}]))
    assert requests[0]["reasoning_effort"] == "low"  # astra refuses "none"


@pytest.mark.asyncio
async def test_board_constructions_think_at_low_effort():
    from test_two_tier import brief

    from tassel.beats.markup import BoardContext
    from tassel.voice.thinker import TutorCoordinator

    efforts = []

    class Recording:
        async def think(self, messages, effort=None):
            efforts.append(effort)
            return brief()

        async def close(self):
            pass

    c = TutorCoordinator(Recording(), BoardContext())
    for action in ("draw_board", "mark_paper"):
        await c.prepare(LLMContext([]), "x", decision=decision(route="thinker", action=action))
        await c.result()
    # The second brief repeats the first, so it is rewritten once: still at the default.
    assert efforts[0] == "low" and set(efforts[1:]) == {None}
    await c.close()


# --- The bridge is fast (no page attached) and split turns reach the director whole --------


@pytest.mark.asyncio
async def test_thinker_turn_bridge_carries_no_image_but_the_thinker_does():
    from unittest.mock import AsyncMock
    from uuid import uuid4

    from pipecat.frames.frames import LLMContextFrame
    from pipecat.processors.frame_processor import FrameDirection

    from tassel.voice.bot import _TurnContext

    seen = []

    class Recording:
        async def think(self, messages, effort=None):
            seen.append(str(messages))
            from test_two_tier import brief

            return brief()

        async def close(self):
            pass

    from tassel.beats.markup import BoardContext
    from tassel.voice.thinker import TutorCoordinator

    gate = _TurnContext(uuid4(), AsyncMock())
    gate.director = Director()
    gate.coordinator = TutorCoordinator(Recording(), BoardContext())
    gate.push_frame = AsyncMock()
    gate.add_turn_image(b"page", "the page")
    context = LLMContext(
        [
            {"role": "assistant", "content": "Hi"},
            {"role": "user", "content": "What's wrong with my DFA?"},
            {"role": "user", "content": "on your whiteboard."},
        ]
    )
    await gate.process_frame(LLMContextFrame(context), FrameDirection.DOWNSTREAM)
    await gate.coordinator.result()
    # Both fragments reached the director: a board drawing on the thinker.
    assert (gate.decision.route, gate.decision.action) == ("thinker", "draw_board")
    assert "image_url" not in str(context.get_messages())
    await gate.coordinator.close()


@pytest.mark.asyncio
async def test_paper_look_sends_the_page_to_the_thinker_only():
    from unittest.mock import AsyncMock
    from uuid import uuid4

    from pipecat.frames.frames import LLMContextFrame
    from pipecat.processors.frame_processor import FrameDirection
    from test_two_tier import brief

    from tassel.beats.markup import BoardContext
    from tassel.voice.bot import _TurnContext
    from tassel.voice.thinker import TutorCoordinator

    seen = []

    class Recording:
        async def think(self, messages, effort=None):
            seen.append(str(messages))
            return brief()

        async def close(self):
            pass

    gate = _TurnContext(uuid4(), AsyncMock())
    gate.director = Director()
    gate.coordinator = TutorCoordinator(Recording(), BoardContext())
    gate.push_frame = AsyncMock()
    gate.add_turn_image(b"page", "the page")
    gate._turn_page = AsyncMock(return_value=None)
    context = LLMContext([{"role": "user", "content": "Can you see my paper?"}])
    await gate.process_frame(LLMContextFrame(context), FrameDirection.DOWNSTREAM)
    await gate.coordinator.result()
    assert gate.decision.route == "thinker"
    assert "image_url" in seen[0]
    assert "image_url" not in str(context.get_messages())
    await gate.coordinator.close()


def test_a_modified_machine_is_a_board_construction():
    # Live, the model once sent this to her paper as marks.
    text = "Can you show me a modified version of this with an NFA?"
    out = guard(
        text,
        decision(
            focus="paper",
            needs_vision=True,
            route="thinker",
            action="mark_paper",
            refers_to="paper",
        ),
    )
    assert (out.action, out.focus, out.route) == ("draw_board", "board", "thinker")
