"""Frame rows. Callers commit; the upload and the session delete each run as one transaction."""

import uuid
from datetime import timedelta
from typing import NamedTuple

from sqlalchemy import exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.frames.tables import Frame
from tassel.storage.tables import TutoringSession


class Newest(NamedTuple):
    seq: int
    age: timedelta  # by the database's clock, which also stamped created_at


async def lock_session(
    db: AsyncSession, learner_id: uuid.UUID, session_id: uuid.UUID
) -> TutoringSession | None:
    """The learner's session, locked (``FOR UPDATE``) until the transaction ends."""
    return await db.scalar(
        select(TutoringSession)
        .where(TutoringSession.id == session_id, TutoringSession.learner_id == learner_id)
        .with_for_update()
    )


async def newest(db: AsyncSession, session_id: uuid.UUID) -> Newest | None:
    """The session's highest seq and how long ago that frame was stored."""
    row = (
        await db.execute(
            select(Frame.seq, func.now() - Frame.created_at)
            .where(Frame.session_id == session_id)
            .order_by(Frame.seq.desc())
            .limit(1)
        )
    ).first()
    return None if row is None else Newest(*row)


async def insert(db: AsyncSession, frame: Frame) -> Frame:
    db.add(frame)
    await db.flush()  # RETURNING fills in created_at
    return frame


async def touch_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(
        update(TutoringSession)
        .where(TutoringSession.id == session_id)
        .values(last_activity_at=func.now())
    )


async def list_for(db: AsyncSession, session_id: uuid.UUID, limit: int) -> list[Frame]:
    """Newest seq first."""
    query = select(Frame).where(Frame.session_id == session_id)
    return list(await db.scalars(query.order_by(Frame.seq.desc()).limit(limit)))


async def get_for(
    db: AsyncSession, learner_id: uuid.UUID, session_id: uuid.UUID, frame_id: uuid.UUID
) -> Frame | None:
    """The frame, if it belongs to that session of that learner."""
    return await db.scalar(
        select(Frame)
        .join(TutoringSession, Frame.session_id == TutoringSession.id)
        .where(
            Frame.id == frame_id,
            Frame.session_id == session_id,
            TutoringSession.learner_id == learner_id,
        )
    )


async def has_frames(db: AsyncSession, session_id: uuid.UUID) -> bool:
    return bool(await db.scalar(select(exists().where(Frame.session_id == session_id))))


async def db_now(db: AsyncSession):
    """The database's clock, which stamps created_at."""
    return await db.scalar(select(func.now()))
