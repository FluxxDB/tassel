"""Join the migrations made side by side on 0003: board actions, learner memory and webcam
sources.

Revision ID: 0005
Revises: 0004, learner_memory_01, webcam_source_01
"""

from collections.abc import Sequence

revision: str = "0005"
down_revision: str | Sequence[str] | None = ("0004", "learner_memory_01", "webcam_source_01")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
