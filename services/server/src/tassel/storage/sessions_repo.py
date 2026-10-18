"""Tutoring sessions, always scoped to one learner. Each write commits."""

import uuid
from typing import Any

from sqlalchemy import ColumnElement, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.models import SessionCreate, SessionPatch, SessionSort
from tassel.storage.tables import TutoringSession

_ORDER_BY = {
    "recent": (TutoringSession.last_activity_at.desc(),),
    "created": (TutoringSession.created_at.desc(),),
    # Subjects A to Z ignoring case, sessions without one last, then newest activity first.
    "topic": (
        TutoringSession.subject.is_(None),
        func.lower(TutoringSession.subject),
        TutoringSession.last_activity_at.desc(),
    ),
}


def _owned(learner_id: uuid.UUID, session_id: uuid.UUID) -> tuple[ColumnElement[bool], ...]:
    return (TutoringSession.id == session_id, TutoringSession.learner_id == learner_id)


async def create(db: AsyncSession, learner_id: uuid.UUID, new: SessionCreate) -> TutoringSession:
    session = TutoringSession(learner_id=learner_id, **new.model_dump())
    db.add(session)
    await db.commit()
    return session


async def list_for(
    db: AsyncSession, learner_id: uuid.UUID, sort: SessionSort = "recent", q: str | None = None
) -> list[TutoringSession]:
    query = select(TutoringSession).where(TutoringSession.learner_id == learner_id)
    if q:
        # autoescape: "%" and "_" in the search text match literally.
        query = query.where(
            or_(
                TutoringSession.title.icontains(q, autoescape=True),
                TutoringSession.subject.icontains(q, autoescape=True),
            )
        )
    return list(await db.scalars(query.order_by(*_ORDER_BY[sort])))


async def get_for(
    db: AsyncSession, learner_id: uuid.UUID, session_id: uuid.UUID
) -> TutoringSession | None:
    return await db.scalar(select(TutoringSession).where(*_owned(learner_id, session_id)))


async def patch_for(
    db: AsyncSession, learner_id: uuid.UUID, session_id: uuid.UUID, patch: SessionPatch
) -> TutoringSession | None:
    changes = patch.model_dump(exclude_unset=True)
    if "title" in changes:
        # The source records who set the current title; a cleared title has none.
        changes["title_source"] = None if changes["title"] is None else "student"
    session = await db.scalar(
        update(TutoringSession)
        .where(*_owned(learner_id, session_id))
        .values(**changes, last_activity_at=func.now())
        .returning(TutoringSession)
    )
    await db.commit()
    return session


async def delete_for(db: AsyncSession, learner_id: uuid.UUID, session_id: uuid.UUID) -> bool:
    deleted_id = await db.scalar(
        delete(TutoringSession).where(*_owned(learner_id, session_id)).returning(TutoringSession.id)
    )
    await db.commit()
    return deleted_id is not None


async def load_board_actions(
    db: AsyncSession, learner_id: uuid.UUID, session_id: uuid.UUID
) -> list[dict[str, Any]]:
    return (
        await db.scalar(
            select(TutoringSession.board_actions).where(*_owned(learner_id, session_id))
        )
        or []
    )


async def save_board_actions(
    db: AsyncSession,
    learner_id: uuid.UUID,
    session_id: uuid.UUID,
    actions: list[dict[str, Any]],
) -> None:
    await db.execute(
        update(TutoringSession).where(*_owned(learner_id, session_id)).values(board_actions=actions)
    )
    await db.commit()
