"""Learner memory holds preferences only: the existing documents keep the lines that say how
she likes to be taught and lose every topic, problem, value and answer (owner, 2026-10-18:
content never carries over between sessions). The removed text is counted, never printed.

Revision ID: 0008
Revises: 0007
"""

import logging

import sqlalchemy as sa
from alembic import op

from tassel.learner_memory import preference_lines

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT learner_id, content FROM learner_memory WHERE content <> ''")
    ).all()
    rewritten = removed = 0
    for learner_id, content in rows:
        kept = "\n".join(preference_lines(content))
        if kept == content:
            continue
        before = sum(1 for line in content.splitlines() if line.strip())
        removed += before - len(kept.splitlines())
        rewritten += 1
        connection.execute(
            sa.text(
                "UPDATE learner_memory SET content = :content, revision = revision + 1, "
                "updated_at = now() WHERE learner_id = :id"
            ),
            {"content": kept, "id": learner_id},
        )
    log.info(
        "Learner memory: %d of %d documents rewritten to preferences only, %d lines removed",
        rewritten,
        len(rows),
        removed,
    )


def downgrade() -> None:
    # The removed lines are gone by design; nothing to restore.
    pass
