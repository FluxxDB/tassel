"""The ladder's next step, thought ahead (owner, 2026-10-18: "the agent takes too long"). After
step 0 or 1 on her paper, the thinker's call for the next rung runs while Ada speaks; the turn
that climbs to that rung with her page unchanged takes it instead of calling the thinker again."""

import asyncio
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_ladder import YOURS, brief, paper

from tassel.beats.markup import BoardContext
from tassel.voice.thinker import LADDER, TutorCoordinator

HINT = "There's an error in your DFA. Can you spot it?"
REDRAW = "Okay, let me help you out. Here's your machine. Let's run 010. Zero. One. Zero. Fix it?"
CHECK = "Can you take a look at my DFA?"
STUCK = "No, I can't see it."


def page_image(ink=False) -> bytes:
    image = np.full((480, 640), 255, np.uint8)
    cv2.circle(image, (160, 240), 40, 0, 4)
    if ink:
        cv2.rectangle(image, (300, 100), (600, 400), 0, -1)
    return cv2.imencode(".jpg", image)[1].tobytes()


def page_of(image):
    async def page():
        return image, "Her page, numbered."

    return page


class Scripted:
    """The thinker: each call's messages, its effort, and a scripted reply in call order. A call
    can wait on `gate` to stand for a slow model."""

    def __init__(self, *replies, prefetch=True):
        self.calls, self.efforts = [], []
        self.replies = list(replies)
        self.gate: asyncio.Event | None = None
        self.settings = SimpleNamespace(thinker_draw_effort="low", ladder_prefetch=prefetch)

    async def think(self, messages, effort=None):
        self.calls.append(messages)
        self.efforts.append(effort)
        reply = self.replies[min(len(self.calls), len(self.replies)) - 1]
        if self.gate is not None and len(self.calls) > 1:
            await self.gate.wait()
        return reply

    async def close(self):
        pass


def redraw():
    return brief(
        say=REDRAW,
        board=[YOURS, "[[trace t yours 010 student]]", *["[[step t]]"] * 3],
    )


async def hint_turn(c, image):
    history = [{"role": "assistant", "content": "Hi! What are we working on?"}]
    history.append({"role": "user", "content": CHECK})
    c.ladder.begin("paper", step=0)
    await c.prepare(LLMContext(list(history)), CHECK, decision=paper(action="explain"), page=image)
    out = await c.result()
    history.append({"role": "assistant", "content": out.say})
    return history


async def stuck_turn(c, history, image, said=STUCK, *, attempt=False):
    history = [*history, {"role": "user", "content": said}]
    c.ladder.climb(attempt=attempt)
    decision = paper(action="draw_board")
    await c.prepare(LLMContext(history), said, decision=decision, page=image)
    return await c.result()


def texts(messages) -> list[str]:
    out = []
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            out.append(content)
        else:
            out += [p.get("text", "") for p in content if p.get("type") == "text"]
    return out


def has_image(message) -> bool:
    content = message.get("content")
    return isinstance(content, list) and any(p.get("type") == "image_url" for p in content)


@pytest.mark.asyncio
async def test_the_next_rung_is_thought_ahead_and_taken_without_a_second_call():
    thinker = Scripted(brief(say=HINT), redraw())
    c = TutorCoordinator(thinker, BoardContext())
    page = page_of(page_image())
    history = await hint_turn(c, page)
    await c.ahead_settled()
    assert len(thinker.calls) == 2  # Step 0, and step 1 ahead of her answer.
    out = await stuck_turn(c, history, page)
    assert out.say == REDRAW and YOURS in out.board
    assert c.ladder.step == 1
    await c.ahead_settled()
    # The step-1 turn never called the thinker itself; the third call is step 2, ahead.
    assert len(thinker.calls) == 3 and LADDER[2] in texts(thinker.calls[2])
    await c.close()


@pytest.mark.asyncio
async def test_the_ahead_request_is_the_next_rungs_turn():
    thinker = Scripted(brief(say=HINT), redraw())
    c = TutorCoordinator(thinker, BoardContext())
    await hint_turn(c, page_of(page_image()))
    await c.ahead_settled()
    ahead = thinker.calls[1]
    said = texts(ahead)
    assert LADDER[1] in said and LADDER[0] not in said
    assert HINT in said and STUCK in said
    users = [m for m in ahead if m.get("role") == "user"]
    # Her page goes with her stuck line, as on a real turn; never twice.
    assert has_image(users[-1]) and not any(has_image(m) for m in users[:-1])
    assert thinker.efforts[1] == "low"
    await c.close()


@pytest.mark.asyncio
async def test_a_turn_waits_for_the_thought_ahead_still_running():
    thinker = Scripted(brief(say=HINT), redraw())
    thinker.gate = asyncio.Event()
    c = TutorCoordinator(thinker, BoardContext())
    page = page_of(page_image())
    history = await hint_turn(c, page)
    await asyncio.sleep(0.01)
    assert len(thinker.calls) == 2  # Step 1 is already being thought, before she answers.
    turn = asyncio.create_task(stuck_turn(c, history, page))
    await asyncio.sleep(0.05)
    assert not turn.done()
    thinker.gate.set()
    out = await turn
    assert out.say == REDRAW
    assert all(LADDER[1] not in texts(call) for call in thinker.calls[2:])
    await c.close()


@pytest.mark.asyncio
async def test_new_ink_on_her_page_thinks_again():
    thinker = Scripted(brief(say=HINT), redraw(), brief(say="Let's look at your new work."))
    c = TutorCoordinator(thinker, BoardContext())
    history = await hint_turn(c, page_of(page_image()))
    await c.ahead_settled()
    out = await stuck_turn(c, history, page_of(page_image(ink=True)))
    # New work starts the ladder over: a fresh step-0 call, not the step-1 thought ahead.
    assert LADDER[0] in texts(thinker.calls[2])
    assert out.say == "Let's look at your new work."
    await c.close()


@pytest.mark.asyncio
async def test_an_attempt_thinks_again():
    thinker = Scripted(brief(say=HINT), redraw(), brief(say="Close: q3 should accept."))
    c = TutorCoordinator(thinker, BoardContext())
    page = page_of(page_image())
    history = await hint_turn(c, page)
    await c.ahead_settled()
    out = await stuck_turn(c, history, page, "Should q3 accept?", attempt=True)
    assert len(thinker.calls) == 3 and out.say == "Close: q3 should accept."
    await c.close()


@pytest.mark.asyncio
async def test_no_thought_ahead_past_the_top_rung_or_when_it_is_off():
    thinker = Scripted(brief(say="The fix."))
    c = TutorCoordinator(thinker, BoardContext())
    c.ladder.begin("paper", step=2)
    await c.prepare(
        LLMContext([{"role": "user", "content": "Just show me the answer."}]),
        "Just show me the answer.",
        decision=paper(action="draw_board"),
        page=page_of(page_image()),
    )
    await c.result()
    await c.ahead_settled()
    assert len(thinker.calls) == 1
    await c.close()

    off = Scripted(brief(say=HINT), prefetch=False)
    c = TutorCoordinator(off, BoardContext())
    await hint_turn(c, page_of(page_image()))
    await c.ahead_settled()
    assert len(off.calls) == 1
    await c.close()


def test_the_thought_ahead_is_on_by_default():
    from tassel.voice.settings import VoiceSettings

    assert VoiceSettings.model_fields["ladder_prefetch"].default is True
