"""Chat rows: the student's images and the saved conversation. Callers commit. Every read that
takes a learner checks the session is theirs, so another learner's ids find nothing."""

import uuid
from collections.abc import Sequence

from sqlalchemy import exists, func, select

from tassel.chat.tables import SessionAttachment, SessionMessage
from tassel.storage.tables import TutoringSession


async def insert_attachment(db, row: SessionAttachment) -> SessionAttachment:
    db.add(row)
    await db.flush()  # RETURNING fills in created_at
    return row


async def attachment_for(
    db, learner_id: uuid.UUID, session_id: uuid.UUID, attachment_id: uuid.UUID
) -> SessionAttachment | None:
    """The attachment, if it belongs to that session of that learner."""
    return await db.scalar(
        select(SessionAttachment)
        .join(TutoringSession, SessionAttachment.session_id == TutoringSession.id)
        .where(
            SessionAttachment.id == attachment_id,
            SessionAttachment.session_id == session_id,
            TutoringSession.learner_id == learner_id,
        )
    )


async def attachments_for(
    db, learner_id: uuid.UUID, session_id: uuid.UUID, ids: Sequence[uuid.UUID]
) -> list[SessionAttachment]:
    """Those of ``ids`` that belong to that session of that learner, in the order asked."""
    if not ids:
        return []
    rows = await db.scalars(
        select(SessionAttachment)
        .join(TutoringSession, SessionAttachment.session_id == TutoringSession.id)
        .where(
            SessionAttachment.id.in_(list(ids)),
            SessionAttachment.session_id == session_id,
            TutoringSession.learner_id == learner_id,
        )
    )
    found = {row.id: row for row in rows}
    return [found[i] for i in dict.fromkeys(ids) if i in found]


async def has_attachments(db, session_id: uuid.UUID) -> bool:
    return bool(await db.scalar(select(exists().where(SessionAttachment.session_id == session_id))))


async def last_seq(db, session_id: uuid.UUID) -> int:
    """The session's highest message seq, 0 before its first."""
    return await db.scalar(
        select(func.coalesce(func.max(SessionMessage.seq), 0)).where(
            SessionMessage.session_id == session_id
        )
    )


async def insert_message(db, row: SessionMessage) -> SessionMessage:
    db.add(row)
    await db.flush()
    return row


async def messages_for(db, session_id: uuid.UUID) -> list[SessionMessage]:
    """Oldest first."""
    return list(
        await db.scalars(
            select(SessionMessage)
            .where(SessionMessage.session_id == session_id)
            .order_by(SessionMessage.seq)
        )
    )
