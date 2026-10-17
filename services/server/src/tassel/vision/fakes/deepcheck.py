"""Opt-in rule-based readers: known truth sampled against pixels, or named ready readings."""

import json
from collections.abc import Sequence
from math import hypot, pi
from pathlib import Path
from time import perf_counter

import anyio
import numpy as np

from tassel.domains.dfa.contract import DfaReading, MembershipPredicate
from tassel.vision.clips import REPO_DIR
from tassel.vision.deepcheck import PreparedPage, ProblemContext, TranscriptionResult
from tassel.vision.page import ink_mask
from tassel.vision.transcription import DfaTranscription, TBox, TLanguage, TState, TTransition

RING_ANGLES = 72  # Uniform angular samples, independent of clip time.
RING_BAND = 0.15  # Search r ± this fraction of r for hand-drawn ink.
INK_COVERAGE = 0.5  # Half a ring or start segment must be supported.
ACCEPT_RADIUS = 0.8  # Inner accepting ring relative to the outer state radius.
START_X = 0.08  # Fixture scene's start-arrow tail in page widths.
LABEL_HALF_SIDE = 0.02  # Label sampling box extends this many page widths each way.
LABEL_INK_FRACTION = 0.03  # Minimum ink occupancy of a transition label's box.
CIRCLE_MATCH_DISTANCE = 0.5  # Match a circle center within this fraction of its truth radius.
LABEL_MATCH_DISTANCE = 0.03  # Match a label box within this many page widths of labelAt.
FIXTURE_CONFIDENCE = 0.95  # Explicit fixture certainty, never used by the live readers.


def _problems() -> dict:
    return json.loads(Path(__file__).with_name("problems.json").read_text(encoding="utf-8"))


def _ring(mask, cx, cy, radius) -> bool:
    angles = np.arange(RING_ANGLES) * 2 * pi / RING_ANGLES
    radii = np.arange(radius * (1 - RING_BAND), radius * (1 + RING_BAND) + 1)
    xs = np.rint(cx + radii[:, None] * np.cos(angles)).astype(int)
    ys = np.rint(cy + radii[:, None] * np.sin(angles)).astype(int)
    h, w = mask.shape
    valid = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
    hits = valid & (mask[ys.clip(0, h - 1), xs.clip(0, w - 1)] != 0)
    return bool(hits.any(axis=0).mean() >= INK_COVERAGE)


def _start(mask, cx, cy, radius) -> bool:
    h, w = mask.shape
    x0, x1 = START_X * w, cx - radius
    if x1 <= x0 or not 0 <= round(cy) < h:
        return False
    xs = np.rint(np.linspace(x0, x1, max(2, round(x1 - x0)))).astype(int)
    return bool((mask[round(cy), xs.clip(0, w - 1)] != 0).mean() >= INK_COVERAGE)


def _sample(prepared: PreparedPage, truth: dict, problem: dict) -> DfaTranscription:
    page = prepared.page
    mask = ink_mask(page)
    w, h = page.width, page.height
    states, transitions = [], []
    for state in truth["dfa"]["states"]:
        cx, cy, radius = state["center"]["x"] * w, state["center"]["y"] * h, state["radius"] * w
        if not _ring(mask, cx, cy, radius):
            continue
        near = min(
            prepared.candidates.circles,
            key=lambda c: (hypot(c.cx - cx, c.cy - cy), c.mark),
            default=None,
        )
        mark = (
            near.mark
            if near and hypot(near.cx - cx, near.cy - cy) <= CIRCLE_MATCH_DISTANCE * radius
            else None
        )
        states.append(
            TState(
                label=state["id"],
                circle_mark=mark,
                box=TBox(x1=cx - radius, y1=cy - radius, x2=cx + radius, y2=cy + radius),
                accept=_ring(mask, cx, cy, ACCEPT_RADIUS * radius),
                start=state["start"] and _start(mask, cx, cy, radius),
                confidence=FIXTURE_CONFIDENCE,
            )
        )
    for edge in truth["dfa"]["transitions"]:
        x, y = edge["labelAt"]["x"] * w, edge["labelAt"]["y"] * h
        half = LABEL_HALF_SIDE * w
        x1, x2 = max(0, int(x - half)), min(w, int(np.ceil(x + half)))
        y1, y2 = max(0, int(y - half)), min(h, int(np.ceil(y + half)))
        region = mask[y1:y2, x1:x2]
        if not region.size or np.count_nonzero(region) / region.size < LABEL_INK_FRACTION:
            continue

        # Label components may include adjoining arrow ink: distance is to the box, not its center.
        def distance(label):
            return hypot(
                max(label.x - x, 0, x - label.x - label.w),
                max(label.y - y, 0, y - label.y - label.h),
            )

        near = min(
            prepared.candidates.labels,
            key=lambda label: (
                distance(label),
                hypot(label.x + label.w / 2 - x, label.y + label.h / 2 - y),
                label.mark,
            ),
            default=None,
        )
        mark = near.mark if near and distance(near) <= LABEL_MATCH_DISTANCE * w else None
        transitions.append(
            TTransition(
                source=edge["from"],
                target=edge["to"],
                symbols=[s.strip() for s in edge["label"].split(",")],
                label_mark=mark,
                label_box=TBox(x1=x - half, y1=y - half, x2=x + half, y2=y + half),
                confidence=FIXTURE_CONFIDENCE,
            )
        )
    return DfaTranscription(
        machine_kind="dfa" if states else "none",
        problem_kind="dfa",
        states=states,
        transitions=transitions,
        alphabet=["0", "1"],
        problem_statement=problem["statement"],
        language=TLanguage(regex=problem["regex"], confidence=FIXTURE_CONFIDENCE),
        intent=None,
        intent_confidence=0.0,
        unreadable=[],
    )


def _predicate(
    problem: dict, statement: str, alphabet: Sequence[str]
) -> MembershipPredicate | None:
    if statement.strip() != problem["statement"] or set(alphabet) != {"0", "1"}:
        return None
    return MembershipPredicate.model_validate(problem["predicate"])


class FixtureDeepCheck:
    name = "fixture"

    def __init__(self, truth_path: Path, *, delay_ms: int = 0):
        if delay_ms < 0:
            raise ValueError("delay_ms must be nonnegative")
        self._truth = json.loads(truth_path.read_text(encoding="utf-8"))
        variant = self._truth["name"]
        problems = _problems()
        if variant not in problems:
            raise ValueError(f"unknown fixture variant: {variant}")
        self._problem = problems[variant]
        self._delay_ms = delay_ms

    async def transcribe(self, prepared: PreparedPage, ctx: ProblemContext) -> TranscriptionResult:
        started = perf_counter()
        if self._delay_ms:
            await anyio.sleep(self._delay_ms / 1000)
        transcription = await anyio.to_thread.run_sync(
            _sample, prepared, self._truth, self._problem
        )
        return TranscriptionResult("ok", transcription, round((perf_counter() - started) * 1000))

    async def membership(self, problem: str, alphabet: Sequence[str]) -> MembershipPredicate | None:
        return _predicate(self._problem, problem, alphabet)


class NamedFixtureDeepCheck:
    name = "named-fixture"

    def __init__(self, name: str):
        if name == "none":
            self._reading = DfaReading(
                frame_id=None,
                source="fixture",
                kind="dfa",
                alphabet=[],
                states=[],
                transitions=[],
                page=None,
                problem=None,
                problem_kind=None,
                language=None,
                uncertain=[],
            )
        else:
            fixtures = json.loads(
                (REPO_DIR / "packages/shared/src/vision/fixtures.json").read_text(encoding="utf-8")
            )["readings"]
            if name not in fixtures:
                raise ValueError(f"unknown fixture reading: {name}")
            self._reading = DfaReading.model_validate(fixtures[name])

    async def transcribe(self, prepared: PreparedPage, ctx: ProblemContext) -> TranscriptionResult:
        return TranscriptionResult("ok", None, 0, reading=self._reading.model_copy(deep=True))

    async def membership(self, problem: str, alphabet: Sequence[str]) -> MembershipPredicate | None:
        if self._reading.problem != problem:
            return None
        for known in _problems().values():
            if (predicate := _predicate(known, problem, alphabet)) is not None:
                return predicate
        return None
