"""Where the chat keeps things: attachment images in the object store, beside the session's
frames, and the saved conversation in Postgres.

``load_attachment`` is the one way in for code that needs a student's image (the voice bot,
and Set-of-Mark on student images). ``ChatStore`` is the voice bot's handle: it opens its own
database sessions, and its writes never raise into the pipeline.
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tassel.chat import repo
from tassel.chat.tables import SessionMessage
from tassel.frames.keys import session_prefix
from tassel.frames.objects import ObjectStore
from tassel.voice.messages import ChatMessageEvent

logger = logging.getLogger(__name__)

_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png"}


def attachments_prefix(learner_id: uuid.UUID, session_id: uuid.UUID) -> str:
    return f"{session_prefix(learner_id, session_id)}attachments/"


def attachment_key(
    learner_id: uuid.UUID, session_id: uuid.UUID, attachment_id: uuid.UUID, mime: str
) -> str:
    return f"{attachments_prefix(learner_id, session_id)}{attachment_id}.{_EXTENSIONS[mime]}"


@dataclass(frozen=True)
class LoadedAttachment:
    id: str
    data: bytes
    mime: str
    width: int
    height: int


def _uuid(value) -> uuid.UUID | None:
    try:
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
    except ValueError:
        return None


async def load_attachment(
    db: AsyncSession,
    store: ObjectStore,
    learner_id: uuid.UUID,
    session_id: uuid.UUID,
    attachment_id: uuid.UUID | str,
) -> tuple[bytes, str, int, int] | None:
    """The student's image as stored: (bytes, mime, width, height), or None when it isn't one of
    this learner's images in this session, or its object is gone."""
    loaded = await load_attachments(db, store, learner_id, session_id, [attachment_id])
    if not loaded:
        return None
    one = loaded[0]
    return one.data, one.mime, one.width, one.height


async def load_attachments(
    db: AsyncSession,
    store: ObjectStore,
    learner_id: uuid.UUID,
    session_id: uuid.UUID,
    ids: Sequence[uuid.UUID | str],
) -> list[LoadedAttachment]:
    """Those of ``ids`` that are this learner's images in this session, in the order asked;
    anything else is left out."""
    wanted = [u for u in (_uuid(i) for i in ids) if u is not None]
    rows = await repo.attachments_for(db, learner_id, session_id, wanted)
    out = []
    for row in rows:
        data = await store.get(row.object_key)
        if data is None:
            logger.warning("Attachment %s has no stored image", row.id)
            continue
        out.append(LoadedAttachment(str(row.id), data, row.mime, row.width, row.height))
    return out


class ChatStore:
    """The voice bot's chat storage for one process: images to read, lines to save."""

    def __init__(self, sessions: async_sessionmaker[AsyncSession], objects: ObjectStore):
        self.sessions, self.objects = sessions, objects

    async def load_attachments(
        self, learner_id: uuid.UUID, session_id: uuid.UUID, ids: Sequence[str]
    ) -> list[LoadedAttachment]:
        async with self.sessions() as db:
            return await load_attachments(db, self.objects, learner_id, session_id, ids)

    async def latest_attachment(
        self, learner_id: uuid.UUID, session_id: uuid.UUID
    ) -> LoadedAttachment | None:
        """The newest image she sent in the session, or None before her first."""
        async with self.sessions() as db:
            row = await repo.latest_attachment(db, learner_id, session_id)
            if row is None:
                return None
            loaded = await load_attachments(db, self.objects, learner_id, session_id, [row.id])
        return loaded[0] if loaded else None

    async def last_seq(self, session_id: uuid.UUID) -> int:
        async with self.sessions() as db:
            return await repo.last_seq(db, session_id)

    async def save(self, session_id: uuid.UUID, seq: int, message: ChatMessageEvent) -> None:
        """Saves a final line at ``seq``. Should another bot on this session have taken that seq
        (a reconnect racing the last writes), the line goes after the session's last."""
        for attempt in range(2):
            async with self.sessions() as db:
                if attempt:
                    seq = await repo.last_seq(db, session_id) + 1
                try:
                    await repo.insert_message(db, _row(session_id, seq, message))
                    await db.commit()
                    return
                except IntegrityError:
                    await db.rollback()
                    if attempt:
                        raise


def _row(session_id: uuid.UUID, seq: int, message: ChatMessageEvent) -> SessionMessage:
    return SessionMessage(
        id=uuid.UUID(message.id),
        session_id=session_id,
        seq=seq,
        role=message.role,
        source=message.source,
        text=message.text,
        interrupted=message.interrupted,
        attachment_ids=[a.id for a in message.attachments],
        action=message.action.model_dump(mode="json") if message.action else None,
        client_id=message.client_id,
    )
