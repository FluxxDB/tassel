"""Fresh readings from the shared wire-contract fixtures for each test."""

import json
from pathlib import Path

import pytest

from tassel.domains.dfa.contract import DfaReading

REPO = Path(__file__).resolve().parents[4]


@pytest.fixture
def readings() -> dict[str, DfaReading]:
    fixtures = json.loads(
        (REPO / "packages/shared/src/vision/fixtures.json").read_text(encoding="utf-8")
    )
    return {name: DfaReading.model_validate(value) for name, value in fixtures["readings"].items()}
