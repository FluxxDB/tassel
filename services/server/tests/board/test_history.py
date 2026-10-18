import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from tassel.beats.markup import BoardContext, parse_command
from tassel.beats.models import BEAT_ACTION
from tassel.models import SessionCreate
from tassel.storage import sessions_repo
from tassel.storage.db import make_engine, session_factory
from tassel.storage.tables import Learner, TutoringSession


@pytest_asyncio.fixture
async def owned(db):
    learner = Learner()
    db.add(learner)
    await db.commit()
    session = await sessions_repo.create(
        db, learner.id, SessionCreate(type="homework", language="en", source="talk")
    )
    return learner.id, session.id


def actions(*commands):
    board = BoardContext()
    result = [parse_command(command, board) for command in commands]
    assert all(result)
    return result


@pytest.mark.asyncio
async def test_history_roundtrip_filters_caps_and_flushes(db, db_url, owned):
    from tassel.board.history import BoardHistory

    engine = make_engine(db_url)
    factory = session_factory(engine)
    try:
        history = BoardHistory(factory, *owned)
        assert await history.load() == []
        history.record(actions('note first "old"', "stage board", "live"))
        history.record(actions(*(f'note n{i} "text"' for i in range(205))))
        await history.close()
        restored = await BoardHistory(factory, *owned).load()
        assert len(restored) == 200
        assert restored[0].item == "n5"
        assert restored[-1].item == "n204"
        stranger = BoardHistory(factory, uuid.uuid4(), owned[1])
        assert await stranger.load() == []
        stranger.record(actions('note stolen "bad"'))
        await stranger.close()
        assert await BoardHistory(factory, *owned).load() == restored
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_clear_and_debounce(db_url, owned):
    from tassel.board.history import BoardHistory

    engine = make_engine(db_url)
    factory = session_factory(engine)
    try:
        history = BoardHistory(factory, *owned)
        history.record(actions('note a "a"', 'note b "b"', "clear a"))
        await asyncio.sleep(0.1)
        assert await BoardHistory(factory, *owned).load() == []
        await asyncio.sleep(1.05)
        saved = await BoardHistory(factory, *owned).load()
        assert [a.kind for a in saved] == ["board.note", "board.note", "board.clear"]
        history.record(actions("clear", 'note c "c"'))
        await history.close()
        saved = await BoardHistory(factory, *owned).load()
        assert [a.kind for a in saved] == ["board.clear", "board.note"]
        assert saved[-1].item == "c"
    finally:
        await engine.dispose()


def test_replay_restores_specs_incremental_edges_diagrams_and_clears():
    from tassel.board.history import replay

    batch = actions(
        "dfa m start=q0",
        "add m q1 accept",
        "edge m q0 q1 0",
        "edge m q0 q1 1",
        "dfa other start=q0",
        "clear other",
    )
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
    batch.append(diagram)
    board = BoardContext()
    replay(board, batch)
    assert list(board.specs) == ["m"]
    assert board.specs["m"].states[-1].accept is True
    assert board.specs["m"].transitions[0].symbols == ["0", "1"]
    assert board.diagrams["d"] == diagram.spec
    # Replay owns its copies: later edits cannot change the persisted actions.
    assert batch[0].spec.states[0].id == "q0"
    assert len(batch[0].spec.states) == 1
    replay(board, actions("clear d"))
    assert board.diagrams == {} and "m" in board.specs
    replay(board, actions("clear"))
    assert board.specs == {} and board.diagrams == {}


@pytest.mark.asyncio
async def test_board_actions_column_defaults_empty(db, owned):
    session = await db.scalar(select(TutoringSession).where(TutoringSession.id == owned[1]))
    assert session.board_actions == []


@pytest.mark.asyncio
async def test_failed_background_save_keeps_data_without_logging_contents(
    db_url, owned, monkeypatch, caplog
):
    from tassel.board.history import BoardHistory

    engine = make_engine(db_url)
    factory = session_factory(engine)
    history = BoardHistory(factory, *owned)
    save = sessions_repo.save_board_actions

    async def unavailable(*args):
        raise RuntimeError("private board contents from SQL parameters")

    try:
        monkeypatch.setattr(sessions_repo, "save_board_actions", unavailable)
        history.record(actions('note n "private board contents"'))
        await asyncio.sleep(1.1)
        assert "persist board history" in caplog.text
        assert "private board contents" not in caplog.text
    finally:
        monkeypatch.setattr(sessions_repo, "save_board_actions", save)
        await history.close()
        restored = await BoardHistory(factory, *owned).load()
        await engine.dispose()
    assert restored[0].text == "private board contents"


@pytest.mark.asyncio
async def test_board_items_tracks_declarations_replacements_and_clears(db_url, owned):
    from tassel.board.history import BoardHistory

    engine = make_engine(db_url)
    history = BoardHistory(session_factory(engine), *owned)
    diagram = BEAT_ACTION.validate_python(
        {
            "kind": "board.diagram",
            "item": "diagram",
            "spec": {
                "direction": "LR",
                "groups": [],
                "nodes": [{"id": "n", "label": "Node", "icon": "box"}],
                "edges": [],
            },
        }
    )
    try:
        history.record(
            actions(
                "dfa m start=q0",
                'note n "old"',
                'note label "attached" near=m:q0',
                "trace run m 0",
                "verdict run reject",
                "verdict missing accept",
            )
        )
        history.record([diagram])
        history.record(actions('note n "replacement"'))
        items = history.board_items
        assert set(items) == {"m", "n", "label", "run", "diagram"}
        assert items["n"]["text"] == "replacement"
        assert items["diagram"] == diagram.model_dump(mode="json", exclude_none=True)
        assert items["run"]["kind"] == "board.trace"
        items["n"]["text"] = "external mutation"
        assert history.board_items["n"]["text"] == "replacement"
        history.record(actions("clear m"))
        assert set(history.board_items) == {"n", "run", "diagram"}
        history.record(actions("clear diagram"))
        assert set(history.board_items) == {"n", "run"}
        history.record(actions("clear", 'note new "after clear"'))
        assert set(history.board_items) == {"new"}
    finally:
        await history.close()
        await engine.dispose()
