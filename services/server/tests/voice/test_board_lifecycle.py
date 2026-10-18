"""Board persistence survives normal and interrupted bot shutdown."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from tassel.beats.markup import BoardContext, parse_command
from tassel.board.history import BoardHistory
from tassel.models import SessionCreate
from tassel.storage import sessions_repo
from tassel.storage.db import make_engine, session_factory
from tassel.storage.tables import Learner
from tassel.voice.bot import BotContext, run_bot
from tassel.voice.memory import ConversationMemory
from tassel.voice.messages import OfferRequestData
from tassel.voice.settings import VoiceSettings


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [None, "runner", "cleanup"])
async def test_run_bot_loads_before_build_and_flushes_on_shutdown(db, db_url, monkeypatch, failure):
    learner = Learner()
    db.add(learner)
    await db.commit()
    session = await sessions_repo.create(
        db, learner.id, SessionCreate(type="homework", language="en", source="talk")
    )
    engine = make_engine(db_url)
    factory = session_factory(engine)
    old = parse_command('note old "previous board"', BoardContext())
    new = parse_command('note new "this connection"', BoardContext())
    await sessions_repo.save_board_actions(
        db, learner.id, session.id, [old.model_dump(mode="json", exclude_none=True)]
    )
    ctx = BotContext(
        learner_id=learner.id,
        session_id=session.id,
        lang="en",
        titled=False,
        request=OfferRequestData(),
        settings=VoiceSettings(providers="fake", fake_tts="tone"),
        memory=ConversationMemory(),
        sessions=factory,
    )
    connection = Mock(disconnect=AsyncMock())
    transport = Mock()
    transport.event_handler.side_effect = lambda name: lambda handler: handler
    monkeypatch.setattr("tassel.voice.bot.SmallWebRTCTransport", Mock(return_value=transport))

    def build(input_processor, output_processor, context):
        assert context.board_actions == [old]
        assert context.board_history is not None
        return SimpleNamespace(
            worker=Mock(),
            context=Mock(get_messages=Mock(return_value=[])),
            transcript=(
                Mock(record_cost=Mock(side_effect=RuntimeError("cleanup")))
                if failure == "cleanup"
                else None
            ),
        )

    async def run():
        ctx.board_history.record([new])
        if failure == "runner":
            raise RuntimeError("runner")

    runner = Mock(add_workers=AsyncMock(), run=run)
    monkeypatch.setattr("tassel.voice.bot.build_bot", build)
    monkeypatch.setattr("tassel.voice.bot.WorkerRunner", Mock(return_value=runner))
    try:
        if failure:
            with pytest.raises(RuntimeError, match=failure):
                await run_bot(connection, ctx)
        else:
            await run_bot(connection, ctx)
        assert await BoardHistory(factory, learner.id, session.id).load() == [old, new]
        connection.disconnect.assert_awaited_once()
    finally:
        await engine.dispose()
