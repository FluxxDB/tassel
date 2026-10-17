"""The ``frames`` table, on P1's declarative ``Base`` so that it shares its metadata (and the
tests' TRUNCATE). Migration ``0003`` creates it. The images themselves live in the object store.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from tassel.frames.models import FrameReason, PaperSourceKind
from tassel.storage.tables import Base, _one_of


class Frame(Base):
    __tablename__ = "frames"
    __table_args__ = (_one_of("reason", FrameReason), _one_of("source", PaperSourceKind))

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    # 1, 2, 3… within the session, taken while the session row is locked.
    seq: Mapped[int]
    reason: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    captured_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    width: Mapped[int]
    height: Mapped[int]
    bytes: Mapped[int]  # the full JPEG's size
    full_key: Mapped[str] = mapped_column(Text)
    crop_key: Mapped[str | None] = mapped_column(Text)
    # page_found, page_quad, crop_rect, mask and detector, as FrameMeta validated them.
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB)


# One index both keeps seq unique within a session and serves "newest first".
Index("ix_frames_session_id_seq", Frame.session_id, Frame.seq.desc(), unique=True)
