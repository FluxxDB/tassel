"""Initial schema: learners, devices and tutoring sessions, plus the pgvector extension.

Revision ID: 0001
Revises:
Create Date: 2026-10-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamp(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "learners",
        sa.Column("id", sa.Uuid(), nullable=False),
        _timestamp("created_at"),
        sa.Column("ui_language", sa.String(2), server_default="en", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_learners")),
    )

    op.create_table(
        "devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("learner_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.CHAR(64), nullable=False),
        _timestamp("created_at"),
        _timestamp("last_seen_at"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_devices")),
        sa.ForeignKeyConstraint(
            ["learner_id"],
            ["learners.id"],
            name=op.f("fk_devices_learner_id_learners"),
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token_hash", name=op.f("uq_devices_token_hash")),
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("learner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("title_source", sa.Text(), nullable=True),
        sa.Column("subject", sa.Text(), nullable=True),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        _timestamp("created_at"),
        _timestamp("last_activity_at"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
        sa.ForeignKeyConstraint(
            ["learner_id"], ["learners.id"], name=op.f("fk_sessions_learner_id_learners")
        ),
        sa.CheckConstraint(
            "title_source IN ('ai', 'student')", name=op.f("ck_sessions_title_source")
        ),
        sa.CheckConstraint(
            "type IN ('homework', 'studying', 'research', 'other')", name=op.f("ck_sessions_type")
        ),
        sa.CheckConstraint("language IN ('en', 'es', 'ko')", name=op.f("ck_sessions_language")),
        sa.CheckConstraint(
            "source IN ('paper', 'screen', 'talk')", name=op.f("ck_sessions_source")
        ),
    )
    op.create_index(
        "ix_sessions_learner_id_last_activity_at",
        "sessions",
        ["learner_id", sa.text("last_activity_at DESC")],
    )
    op.create_index(
        "ix_sessions_learner_id_created_at",
        "sessions",
        ["learner_id", sa.text("created_at DESC")],
    )
    op.create_index("ix_sessions_learner_id_subject", "sessions", ["learner_id", "subject"])


def downgrade() -> None:
    # Dropping a table drops its indexes and constraints.
    op.drop_table("sessions")
    op.drop_table("devices")
    op.drop_table("learners")
    op.execute("DROP EXTENSION IF EXISTS vector")
