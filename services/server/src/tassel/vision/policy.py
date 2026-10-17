"""Pure decisions about what Ada may say; the caller owns clocks and stage changes."""

from collections.abc import Collection, Mapping
from dataclasses import dataclass, replace
from typing import Literal

from tassel.domains.dfa.contract import DfaReading, DfaVerdict
from tassel.vision.messages import Rung
from tassel.vision.ports import Predicate

RUNGS: tuple[Rung, ...] = ("hint", "guiding_question", "counterexample", "walkthrough", "solution")
NOTE_TTL_MS = 30_000
UNPROMPTED_CHECK_INTERVAL_MS = 15_000


@dataclass(frozen=True)
class Etiquette:
    pause_ms: int = 600
    pen_still_ms: int = 1500
    unprompted_gap_ms: int = 45_000
    hints_per_problem: int = 2
    holding_after_ms: int = 2000


@dataclass(frozen=True)
class Signals:
    complete: bool
    worth_checking: bool
    stuck: bool
    not_schoolwork: bool


def signals(
    probs: Mapping[Predicate, float],
    refused: Collection[Predicate],
    thresholds: Mapping[Predicate, float],
) -> Signals:
    def yes(key: Predicate) -> bool:
        return (
            key not in refused
            and key in probs
            and key in thresholds
            and probs[key] >= thresholds[key]
        )

    return Signals(
        yes("diagram_attempt_complete"),
        yes("new_work_worth_checking"),
        yes("student_seems_stuck"),
        yes("not_schoolwork"),
    )


@dataclass
class ProblemState:
    key: str
    rung: Rung | None = None
    hints: int = 0
    failed_attempts: int = 0
    spoke_correct: bool = False


Trigger = Literal["attempt", "stuck", "slip", "asked-walkthrough", "asked-solution"]


@dataclass(frozen=True)
class NotePlan:
    trigger: Trigger
    rung: Rung | None
    unprompted: bool
    verdict: DfaVerdict | None
    reading: DfaReading | None

    @property
    def split_stage(self) -> bool:
        """P4-R23: a stall/slip hint never opens the board; only invited notes may."""
        return not self.unprompted and self.trigger in (
            "attempt",
            "asked-walkthrough",
            "asked-solution",
        )


def _correct(verdict: DfaVerdict | None) -> bool:
    return verdict is not None and (
        verdict.status == "correct"
        or (verdict.status == "unsure" and verdict.counterexample is None)
    )


def _wrong(verdict: DfaVerdict | None) -> bool:
    return verdict is not None and (
        verdict.status == "wrong"
        or (verdict.status == "unsure" and verdict.counterexample is not None)
    )


def plan(
    verdict: DfaVerdict | None, reading: DfaReading | None, sig: Signals, problem: ProblemState
) -> NotePlan | None:
    if sig.not_schoolwork:
        return None
    if verdict is None or verdict.status == "unreadable":
        return NotePlan("attempt", None, False, verdict, reading) if sig.complete else None
    if _correct(verdict):
        return (
            NotePlan("attempt", None, False, verdict, reading)
            if sig.complete and not problem.spoke_correct
            else None
        )
    if verdict.status == "unknown":
        return NotePlan("attempt", None, False, verdict, reading) if sig.complete else None
    if _wrong(verdict) and sig.complete:
        rung: Rung = "counterexample"
        if problem.failed_attempts:
            previous = problem.rung or "counterexample"
            rung = RUNGS[min(RUNGS.index(previous) + 1, RUNGS.index("walkthrough"))]
        return NotePlan("attempt", rung, False, verdict, reading)
    if (
        _wrong(verdict)
        and problem.hints < Etiquette().hints_per_problem
        and reading is not None
        and not reading.uncertain
    ):
        if any(
            i.kind in ("nondeterminism", "epsilon_in_dfa", "unknown_symbol") for i in verdict.issues
        ):
            return NotePlan("slip", "hint", True, verdict, reading)
        if sig.stuck:
            return NotePlan("stuck", "hint", True, verdict, reading)
    return None


def plan_request(
    level: Literal["walkthrough", "solution"],
    verdict: DfaVerdict | None,
    reading: DfaReading | None,
    problem: ProblemState,
) -> NotePlan | None:
    if verdict is None:
        return None
    if level == "walkthrough" and verdict.counterexample is not None:
        return NotePlan("asked-walkthrough", "walkthrough", False, verdict, reading)
    if (
        level == "solution"
        and verdict.reference is not None
        and verdict.reference.trusted
        and verdict.reference.machine is not None
    ):
        return NotePlan("asked-solution", "solution", False, verdict, reading)
    return None


def apply(problem: ProblemState, p: NotePlan) -> ProblemState:
    """Return the state after speech, without consuming budgets while a note is pending."""
    updated = replace(problem)
    if p.trigger == "attempt":
        if _wrong(p.verdict):
            updated.rung = p.rung
            updated.failed_attempts += 1
        elif _correct(p.verdict):
            updated.spoke_correct = True
    elif p.trigger in ("stuck", "slip"):
        updated.hints += 1
    elif p.trigger in ("asked-walkthrough", "asked-solution"):
        updated.rung = p.rung
    return updated


@dataclass(frozen=True)
class Moment:
    now_ms: int
    user_speaking: bool
    user_stopped_at: int | None
    bot_busy: bool
    pen_busy: bool
    pen_still_since: int | None
    last_unprompted_at: int | None


def may_speak(m: Moment, e: Etiquette, *, unprompted: bool) -> tuple[bool, str]:
    # None means no prior activity was recorded, rather than a fabricated time zero.
    if m.user_speaking:
        return False, "she is speaking"
    if m.user_stopped_at is not None and m.now_ms - m.user_stopped_at < e.pause_ms:
        return False, "pause"
    if m.bot_busy:
        return False, "Ada is busy"
    if m.pen_busy or (
        m.pen_still_since is not None and m.now_ms - m.pen_still_since < e.pen_still_ms
    ):
        return False, "pen"
    if (
        unprompted
        and m.last_unprompted_at is not None
        and m.now_ms - m.last_unprompted_at < e.unprompted_gap_ms
    ):
        return False, "rate"
    return True, "ok"
