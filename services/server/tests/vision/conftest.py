"""The ``clip`` factory: frames from P3's synthetic clips, made once per test session.

``clip("dfa-demo")`` returns the ``ClipFiles`` of P3's default clip (noise on), and
``clip("dfa-demo", noise=False)`` the clean one. Both come from ``ensure_clip``, which runs P3's
paper-synth CLI and caches the files under ``<repo>/.cache/paper-clips``. A test that asks for a
clip skips when the clip can't be made here: without Node on PATH, or (P4-R25) while P3's
paper-synth isn't merged into this branch.
"""

from collections.abc import Callable

import pytest

from tassel.vision.clips import REPO_DIR, ClipFiles, NodeMissing, ensure_clip

NEEDS_NODE = "needs Node 22.18+ and `pnpm install` (P3's paper-synth)"
PAPER_SYNTH_UNMERGED = "P3's paper-synth isn't merged into this branch"

PAPER_SYNTH = REPO_DIR / "packages" / "paper-synth"


@pytest.fixture(scope="session")
def clip() -> Callable[..., ClipFiles]:
    made: dict[tuple[str, bool], ClipFiles] = {}

    def make(variant: str, noise: bool = True) -> ClipFiles:
        key = (variant, noise)
        if key not in made:
            if not PAPER_SYNTH.is_dir():
                pytest.skip(PAPER_SYNTH_UNMERGED)
            try:
                made[key] = ensure_clip(variant, noise=noise)
            except NodeMissing:
                pytest.skip(NEEDS_NODE)
        return made[key]

    return make
