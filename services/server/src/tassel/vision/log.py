"""JSONL diagnostics with an allowlist: no image bytes, credentials or exception bodies."""

import json
import logging
from pathlib import Path
from uuid import UUID

_FIELDS = frozenset(
    {
        "stage",
        "frame_id",
        "reason",
        "quiet_ms",
        "silence_ms",
        "new_ink",
        "changed_cells",
        "transcript",
        "probs",
        "refused",
        "ms",
        "provider",
        "status",
        "witness",
        "blame",
        "action",
        "rung",
        "why",
    }
)
_LOG = logging.getLogger(__name__)


class VisionLog:
    def __init__(self, path: Path | None):
        self.path = path

    def write(self, session_id: UUID, record: dict) -> None:
        if self.path is None:
            return
        safe = {k: v for k, v in record.items() if k in _FIELDS}
        safe["session_id"] = str(session_id)
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(safe, ensure_ascii=False) + "\n")
        except (OSError, TypeError, ValueError):
            _LOG.warning("Vision diagnostic record could not be written")
