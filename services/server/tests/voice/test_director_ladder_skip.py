"""The director sits out a turn the ladder decides (owner, 2026-10-18: "the agent takes too
long"). On an open ladder, "no", "I still don't get it", "just show me the answer" or an attempt
climbs it whatever the model says, and a check of her own work opens it: the model's 0.3-0.8 s
call was thrown away by `escalate`. Anything else still asks the model."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from tassel.voice.director import Director, escalate, ladder_decides, rules
from tassel.voice.ladder import Ladder

CHECK = "Can you take a look at my DFA?"


def director():
    reply = rules("and then the rest of it")
    create = AsyncMock(
        return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=reply.model_dump_json()))]
        )
    )
    logs = []
    d = Director(
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
        log=lambda event, **data: logs.append((event, data)),
    )
    return d, create, logs


def open_ladder(step=0):
    ladder = Ladder()
    ladder.begin("paper", step=step)
    ladder.take()
    ladder.step = step
    return ladder


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "No, I can't see it.",
        "I still don't get it.",
        "Just show me the answer.",
        "Should q3 accept?",
    ],
)
async def test_a_climb_on_an_open_ladder_never_asks_the_model(text):
    d, create, logs = director()
    ladder = open_ladder()
    decision = await d.decide(text, [], focus="paper", ladder=ladder, answered=True)
    create.assert_not_called()
    assert logs[-1][1]["source"] == "ladder"
    climbed = escalate(text, decision, ladder=ladder, answered=True)
    assert (climbed.route, climbed.action) == ("thinker", "draw_board")


@pytest.mark.asyncio
async def test_a_check_of_her_own_work_never_asks_the_model():
    d, create, _ = director()
    ladder = Ladder()
    decision = await d.decide(CHECK, [], focus="paper", ladder=ladder, answered=True)
    create.assert_not_called()
    opened = escalate(CHECK, decision, ladder=ladder, answered=True)
    assert (opened.route, opened.action, opened.refers_to) == ("thinker", "explain", "paper")
    assert ladder.take() == (0, False)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("text", "kw"),
    [
        # A new request on an open ladder is the model's to route.
        ("Draw me a network with two routers.", dict(ladder=open_ladder(), answered=True)),
        # Without a ladder, or before Ada has said anything, as before.
        ("No, I can't see it.", dict(ladder=None, answered=True)),
        ("No, I can't see it.", dict(ladder=open_ladder(), answered=False)),
        # An image she sent is the model's to place.
        ("No, I can't see it.", dict(ladder=open_ladder(), answered=True, image=True)),
    ],
)
async def test_other_turns_still_ask_the_model(text, kw):
    d, create, _ = director()
    await d.decide(text, [], focus="paper", **kw)
    create.assert_called_once()


def test_ladder_decides_mirrors_escalate():
    assert ladder_decides(CHECK, Ladder(), answered=False)
    assert not ladder_decides("What's a DFA?", Ladder(), answered=True)
    assert not ladder_decides("No.", None, answered=True)
