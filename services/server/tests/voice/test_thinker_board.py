import asyncio
import base64
from copy import deepcopy

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_two_tier import FakeThinker, page

from tassel.beats.markup import BoardContext
from tassel.voice.director import Decision
from tassel.voice.thinker import TutorCoordinator


class RecordingThinker(FakeThinker):
    async def think(self, messages, effort=None):
        self.messages = deepcopy(messages)
        return await super().think(messages, effort)


def decision(focus="board", refers_to="board"):
    return Decision(
        focus=focus, refers_to=refers_to, needs_vision=False, route="thinker", action="explain"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("focus", "refers_to", "want_board"),
    [("board", "conversation", True), ("split", "board", True), ("paper", "paper", False)],
)
async def test_board_snapshot_routing_preserves_paper_and_talker(focus, refers_to, want_board):
    thinker = RecordingThinker()
    coordinator = TutorCoordinator(thinker, BoardContext())
    paper_image, board_image = page(), page(True)
    calls = []

    async def paper():
        return paper_image, "[paper] Current page"

    async def board():
        calls.append("board")
        return board_image

    context = LLMContext([{"role": "user", "content": "Explain this"}])
    await coordinator.prepare(
        context, "Explain this", decision=decision(focus, refers_to), page=paper, board_page=board
    )
    assert await coordinator.result() is not None
    user = next(m for m in thinker.messages if m["role"] == "user")
    images = [p["image_url"]["url"] for p in user["content"] if p["type"] == "image_url"]
    assert images == [
        "data:image/png;base64," + base64.b64encode(image).decode()
        for image in ([paper_image, board_image] if want_board else [paper_image])
    ]
    assert calls == (["board"] if want_board else [])
    assert next(m for m in context.get_messages() if m["role"] == "user")["content"] == (
        "Explain this"
    )
    if want_board:
        assert {
            "type": "text",
            "text": (
                "[board] The shared whiteboard right now, including anything the student drew "
                "or moved. Ada's own items are listed in the board items; anything else "
                "is the student's."
            ),
        } in user["content"]
    await coordinator.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("timeout", [False, True])
async def test_missing_board_snapshot_still_produces_guidance(timeout):
    thinker = RecordingThinker()
    coordinator = TutorCoordinator(thinker, BoardContext())

    async def board():
        if timeout:
            raise TimeoutError
        return None

    await coordinator.prepare(
        LLMContext([{"role": "user", "content": "Explain this"}]),
        "Explain this",
        decision=decision(),
        board_page=board,
    )
    assert await coordinator.result() is not None
    assert next(m for m in thinker.messages if m["role"] == "user")["content"] == "Explain this"
    await coordinator.close()


@pytest.mark.asyncio
async def test_board_fetch_runs_in_background_and_updates_only_latest_copied_user():
    thinker = RecordingThinker()
    coordinator = TutorCoordinator(thinker, BoardContext())
    started, release = asyncio.Event(), asyncio.Event()
    content = [{"type": "text", "text": "Explain this"}]
    context = LLMContext(
        [
            {"role": "user", "content": "Earlier question"},
            {"role": "assistant", "content": "Earlier answer"},
            {"role": "user", "content": content},
        ]
    )

    async def board():
        started.set()
        await release.wait()
        return page(True)

    try:
        await asyncio.wait_for(
            coordinator.prepare(context, "Explain this", decision=decision(), board_page=board),
            timeout=1,
        )
        await asyncio.wait_for(started.wait(), timeout=1)
        assert thinker.calls == 0
        assert content == [{"type": "text", "text": "Explain this"}]
        release.set()
        assert await coordinator.result() is not None
        users = [m for m in thinker.messages if m["role"] == "user"]
        assert users[0]["content"] == "Earlier question"
        assert users[1]["content"][0] == content[0]
        assert len(users[1]["content"]) == 3
        assert content == [{"type": "text", "text": "Explain this"}]
    finally:
        await coordinator.close()
