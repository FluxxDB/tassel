"""The chat sidebar: a session's saved conversation and the images the student sent.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("interrupted", sa.Boolean(), nullable=False),
        sa.Column(
            "attachment_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("action", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("client_id", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_session_messages")),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name=op.f("fk_session_messages_session_id_sessions"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "role IN ('student', 'tutor', 'action')", name=op.f("ck_session_messages_role")
        ),
        sa.CheckConstraint("source IN ('voice', 'typed')", name=op.f("ck_session_messages_source")),
    )
    op.create_index(
        "ix_session_messages_session_id_seq",
        "session_messages",
        ["session_id", "seq"],
        unique=True,
    )
    op.create_table(
        "session_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("mime", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_session_attachments")),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name=op.f("fk_session_attachments_session_id_sessions"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "mime IN ('image/jpeg', 'image/png')", name=op.f("ck_session_attachments_mime")
        ),
    )
    op.create_index("ix_session_attachments_session_id", "session_attachments", ["session_id"])


def downgrade() -> None:
    op.drop_table("session_attachments")
    op.drop_table("session_messages")
