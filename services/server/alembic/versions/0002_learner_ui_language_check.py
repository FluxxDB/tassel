"""A learner's UI language is one of the session languages: en, es or ko.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The API has only ever written the default, 'en'. Reset anything else, so the
    # check can be added to a database that already has learners.
    op.execute("UPDATE learners SET ui_language = 'en' WHERE ui_language NOT IN ('en', 'es', 'ko')")
    op.create_check_constraint(
        op.f("ck_learners_ui_language"), "learners", "ui_language IN ('en', 'es', 'ko')"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_learners_ui_language"), "learners", type_="check")
