import asyncio
import time
from uuid import uuid4

import pytest

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.beats.processor import BeatTagProcessor
from tassel.voice.bot import _TurnContext

pytestmark = pytest.mark.asyncio


async def test_records_only_actions_in_successfully_sent_beats():
    sent, recorded = [], []

    class Events:
        async def send(self, event):
            sent.append(event)

    processor = BeatTagProcessor(
        events=Events(),
        lang=lambda: "en",
        board=BoardContext(),
        on_actions=recorded.extend,
    )
    stream = MarkupStream(BoardContext())
    await processor._emit(stream.feed("[[dfa d start=q0 q0-0-q1]][[stage board]]") + stream.flush())
    assert recorded == [m.action for e in sent for m in e.beat.markers]
    assert any(a.kind == "board.automaton" for a in recorded)


async def test_failed_send_does_not_record_actions():
    recorded = []

    class Events:
        async def send(self, event):
            raise RuntimeError("disconnected")

    processor = BeatTagProcessor(
        events=Events(),
        lang=lambda: "en",
        board=BoardContext(),
        on_actions=recorded.extend,
    )
    stream = MarkupStream(BoardContext())
    with pytest.raises(RuntimeError, match="disconnected"):
        await processor._emit(stream.feed("[[dfa d start=q0 q0-0-q1]]") + stream.flush())
    assert recorded == []


async def test_snapshot_request_waits_for_fresh_image_and_logs():
    from tassel.board.snapshots import BoardSnapshots

    sid = uuid4()
    registry = BoardSnapshots()
    registry.put(sid, b"old")
    turn = _TurnContext(sid)
    turn.board_snapshots = registry
    logs = []

    class Transcript:
        def record(self, event, data):
            logs.append((event, data))

    turn.transcript = Transcript()
    requested = asyncio.Event()

    async def request():
        requested.set()

    turn.request_board_snapshot = request
    task = asyncio.create_task(turn._thinker_board_page())
    await requested.wait()
    assert not task.done()
    registry.put(sid, b"fresh")
    assert await task == b"fresh"
    assert logs[0][0] == "board_snapshot"
    assert logs[0][1]["bytes"] == 5
    assert logs[0][1]["wait_ms"] >= 0


async def test_snapshot_timeout_is_silent():
    from tassel.board.snapshots import BoardSnapshots

    turn = _TurnContext(uuid4())
    turn.board_snapshots = BoardSnapshots()

    async def request():
        pass

    turn.request_board_snapshot = request
    started = time.monotonic()
    assert await turn._thinker_board_page() is None
    assert time.monotonic() - started < 1.8


async def test_board_item_inventory_includes_adas_diagrams_and_notes():
    from types import SimpleNamespace

    from tassel.beats.models import BEAT_ACTION

    turn = _TurnContext(uuid4())
    diagram = BEAT_ACTION.validate_python(
        {
            "kind": "board.diagram",
            "item": "d",
            "spec": {
                "direction": "LR",
                "groups": [],
                "nodes": [{"id": "n", "label": "Node", "icon": "box"}],
                "edges": [],
            },
        }
    )
    turn.board.diagrams["d"] = diagram.spec
    note = {"kind": "board.note", "item": "n", "text": "Ada's note"}
    turn.board_history = SimpleNamespace(board_items={"n": note})
    assert turn._board_items() == {"d": diagram.spec.model_dump(mode="json"), "n": note}
