"""Allow ordinary webcams as paper-frame sources.

Revision ID: webcam_source_01
Revises: 0003
"""

from alembic import op

revision = "webcam_source_01"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_frames_source"), "frames", type_="check")
    op.create_check_constraint(
        op.f("ck_frames_source"),
        "frames",
        "source IN ('deskview-helper', 'window-capture', 'fake-clip', 'screen', 'webcam')",
    )


def downgrade() -> None:
    # Existing webcam rows must be handled explicitly before downgrading; never delete images
    # or mislabel their source just to satisfy the older constraint.
    op.drop_constraint(op.f("ck_frames_source"), "frames", type_="check")
    op.create_check_constraint(
        op.f("ck_frames_source"),
        "frames",
        "source IN ('deskview-helper', 'window-capture', 'fake-clip', 'screen')",
    )
