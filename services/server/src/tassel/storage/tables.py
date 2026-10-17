"""Database tables. The migrations in ``alembic/versions`` create them."""

import uuid
from datetime import datetime
from typing import Any, get_args

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    MetaData,
    String,
    Text,
    column,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from tassel.models import Lang, SessionType, Source, TitleSource


def one_of(name: str, literal: Any) -> CheckConstraint:
    """A CHECK that column ``name`` holds one of the ``Literal`` type's values (or NULL)."""
    return CheckConstraint(column(name).in_(get_args(literal)), name=name)


class Base(DeclarativeBase):
    # Deterministic constraint names, so migrations can refer to them.
    metadata = MetaData(
        naming_convention={
            "pk": "pk_%(table_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
        }
    )
    type_annotation_map = {datetime: DateTime(timezone=True)}


class Learner(Base):
    __tablename__ = "learners"
    __table_args__ = (one_of("ui_language", Lang),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    ui_language: Mapped[str] = mapped_column(String(2), server_default="en")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    learner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learners.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TutoringSession(Base):
    """A tutoring session (table ``sessions``), not a database session."""

    __tablename__ = "sessions"
    __table_args__ = (
        one_of("title_source", TitleSource),
        one_of("type", SessionType),
        one_of("language", Lang),
        one_of("source", Source),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    learner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learners.id"))
    title: Mapped[str | None] = mapped_column(Text)
    title_source: Mapped[str | None] = mapped_column(Text)
    subject: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # now() is the transaction's start time, so a new row's two timestamps are equal.
    last_activity_at: Mapped[datetime] = mapped_column(server_default=func.now())


# The library's sorts: recent, created and topic, each within one learner.
Index(
    "ix_sessions_learner_id_last_activity_at",
    TutoringSession.learner_id,
    TutoringSession.last_activity_at.desc(),
)
Index(
    "ix_sessions_learner_id_created_at",
    TutoringSession.learner_id,
    TutoringSession.created_at.desc(),
)
Index("ix_sessions_learner_id_subject", TutoringSession.learner_id, TutoringSession.subject)
