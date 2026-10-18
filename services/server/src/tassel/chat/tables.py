"""The chat sidebar's tables, on P1's declarative ``Base`` so they share its metadata (and the
tests' TRUNCATE). Migration ``0007`` creates them; the images themselves live in the object store.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import ForeignKey, Index, Integer, Text, func
from sqlalchemy import text as sql
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from tassel.storage.tables import Base, one_of

Role = Literal["student", "tutor", "action"]
MessageSource = Literal["voice", "typed"]
AttachmentMime = Literal["image/jpeg", "image/png"]


class SessionMessage(Base):
    """A final line of the session's conversation, as its ``message`` event carried it."""

    __tablename__ = "session_messages"
    __table_args__ = (one_of("role", Role), one_of("source", MessageSource))

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    # Increasing within the session, in the order the lines first appeared.
    seq: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    interrupted: Mapped[bool]
    attachment_ids: Mapped[list[str]] = mapped_column(JSONB, server_default=sql("'[]'::jsonb"))
    action: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    client_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


# Unique, so a line is saved once at its place; and the history reads in this order.
Index(
    "ix_session_messages_session_id_seq", SessionMessage.session_id, SessionMessage.seq, unique=True
)


class SessionAttachment(Base):
    """An image the student sent in the chat (or a snap of her paper)."""

    __tablename__ = "session_attachments"
    __table_args__ = (one_of("mime", AttachmentMime),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    object_key: Mapped[str] = mapped_column(Text)
    mime: Mapped[str] = mapped_column(Text)
    width: Mapped[int]
    height: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


Index("ix_session_attachments_session_id", SessionAttachment.session_id)
