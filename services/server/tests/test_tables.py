import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError

from tassel.storage.tables import Base, Device, Learner, TutoringSession


@pytest.mark.asyncio
async def test_roundtrip_learner_device_session(db):
    learner = Learner()
    db.add(learner)
    await db.flush()
    db.add(Device(learner_id=learner.id, token_hash="a" * 64))
    s = TutoringSession(learner_id=learner.id, type="homework", language="en", source="paper")
    db.add(s)
    await db.commit()
    await db.refresh(s)
    assert s.title is None and s.title_source is None and s.subject is None
    assert s.last_activity_at == s.created_at
    assert (await db.execute(select(Device.learner_id))).scalar_one() == learner.id
    await db.refresh(learner)
    assert learner.ui_language == "en"


@pytest.mark.asyncio
async def test_rejects_unknown_language(db):
    learner = Learner()
    db.add(learner)
    await db.flush()
    db.add(TutoringSession(learner_id=learner.id, type="homework", language="fr", source="paper"))
    with pytest.raises(IntegrityError, match="ck_sessions_language"):
        await db.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("column", "value"), [("type", "quiz"), ("source", "camera"), ("title_source", "teacher")]
)
async def test_rejects_other_values_outside_the_session_model(db, column, value):
    learner = Learner()
    db.add(learner)
    await db.flush()
    fields = {"type": "homework", "language": "en", "source": "paper", column: value}
    db.add(TutoringSession(learner_id=learner.id, **fields))
    with pytest.raises(IntegrityError, match=f"ck_sessions_{column}"):
        await db.commit()


@pytest.mark.asyncio
async def test_rejects_unknown_ui_language(db):
    db.add(Learner(ui_language="fr"))
    with pytest.raises(IntegrityError, match="ck_learners_ui_language"):
        await db.commit()


@pytest.mark.asyncio
async def test_vector_extension_installed(db):
    extension = await db.execute(text("select extname from pg_extension where extname='vector'"))
    assert extension.scalar() == "vector"


def test_migrations_match_the_models(db_url):
    engine = create_engine(db_url)
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(conn, opts={"compare_server_default": True})
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()
