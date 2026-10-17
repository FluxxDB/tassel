"""Frames: the paper images a session uploads. Their JPEGs live in the object store.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "frames",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("full_key", sa.Text(), nullable=False),
        sa.Column("crop_key", sa.Text(), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_frames")),
        # Deleting a session deletes its frame rows (its images are deleted before that).
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name=op.f("fk_frames_session_id_sessions"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("reason IN ('ink', 'page')", name=op.f("ck_frames_reason")),
        sa.CheckConstraint(
            "source IN ('deskview-helper', 'window-capture', 'fake-clip', 'screen')",
            name=op.f("ck_frames_source"),
        ),
    )
    # Unique, so seq can't repeat within a session; descending, for "newest first".
    op.create_index(
        "ix_frames_session_id_seq", "frames", ["session_id", sa.text("seq DESC")], unique=True
    )


def downgrade() -> None:
    op.drop_table("frames")
