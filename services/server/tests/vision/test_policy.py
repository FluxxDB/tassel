import json
from dataclasses import replace
from pathlib import Path

import pytest

from tassel.domains.dfa.contract import DfaReading, Issue
from tassel.domains.dfa.reference import CATALOG
from tassel.domains.dfa.verify import verify
from tassel.vision.policy import (
    Etiquette,
    Moment,
    ProblemState,
    Signals,
    apply,
    may_speak,
    plan,
    plan_request,
    signals,
)


@pytest.fixture
def examples():
    data = json.loads(
        (
            Path(__file__).resolve().parents[4] / "packages/shared/src/vision/fixtures.json"
        ).read_text()
    )
    readings = {name: DfaReading.model_validate(value) for name, value in data["readings"].items()}
    return {name: (verify(r, CATALOG["starts-with-010"]), r) for name, r in readings.items()}


@pytest.mark.parametrize(
    "name,complete,stuck,status,hints,attempts,rung,spoke,not_school,expected",
    [
        ("demo-wrong", True, True, None, 0, 0, None, False, True, None),
        ("demo-wrong", True, False, "absent", 0, 0, None, False, False, ("attempt", None, False)),
        ("demo-wrong", False, True, "absent", 0, 0, None, False, False, None),
        (
            "demo-wrong",
            True,
            False,
            "unreadable",
            0,
            0,
            None,
            False,
            False,
            ("attempt", None, False),
        ),
        ("demo-wrong", False, True, "unreadable", 0, 0, None, False, False, None),
        ("demo-correct", True, False, None, 0, 0, None, False, False, ("attempt", None, False)),
        ("demo-correct", False, True, None, 0, 0, None, False, False, None),
        ("demo-correct", True, False, None, 0, 0, None, True, False, None),
        ("demo-correct", True, False, "unsure", 0, 0, None, False, False, ("attempt", None, False)),
        ("demo-correct", True, False, "unsure", 0, 0, None, True, False, None),
        ("demo-wrong", True, False, "unknown", 0, 0, None, False, False, ("attempt", None, False)),
        ("demo-wrong", False, True, "unknown", 0, 0, None, False, False, None),
        (
            "demo-wrong",
            True,
            True,
            None,
            0,
            0,
            None,
            False,
            False,
            ("attempt", "counterexample", False),
        ),
        (
            "demo-wrong",
            True,
            False,
            None,
            0,
            1,
            "counterexample",
            False,
            False,
            ("attempt", "walkthrough", False),
        ),
        (
            "demo-wrong",
            True,
            False,
            None,
            0,
            2,
            "walkthrough",
            False,
            False,
            ("attempt", "walkthrough", False),
        ),
        (
            "demo-wrong",
            True,
            False,
            None,
            0,
            1,
            "hint",
            False,
            False,
            ("attempt", "guiding_question", False),
        ),
        (
            "demo-wrong",
            True,
            False,
            "unsure",
            0,
            0,
            None,
            False,
            False,
            ("attempt", "counterexample", False),
        ),
        ("demo-partial", False, True, None, 0, 0, None, False, False, ("stuck", "hint", True)),
        ("demo-partial", False, True, None, 2, 0, None, False, False, None),
        ("uncertain", False, True, None, 0, 0, None, False, False, None),
        ("demo-wrong", False, False, None, 0, 0, None, False, False, None),
    ],
)
def test_plan_table(
    examples, name, complete, stuck, status, hints, attempts, rung, spoke, not_school, expected
):
    verdict, reading = examples[name]
    if status == "absent":
        verdict = None
    elif status:
        verdict = verdict.model_copy(update={"status": status, "computed": False})
    problem = ProblemState(
        "page", rung=rung, hints=hints, failed_attempts=attempts, spoke_correct=spoke
    )
    before = replace(problem)
    p = plan(verdict, reading, Signals(complete, True, stuck, not_school), problem)
    assert problem == before
    assert (None if p is None else (p.trigger, p.rung, p.unprompted)) == expected
    if p:
        assert p.split_stage == (not p.unprompted)


@pytest.mark.parametrize("kind", ["nondeterminism", "epsilon_in_dfa", "unknown_symbol"])
def test_structural_slip_precedes_stall_and_requires_certain_reading(examples, kind):
    v, r = examples["demo-wrong"]
    v = v.model_copy(update={"issues": [Issue(kind=kind, states=["q0"], symbols=["0"])]})
    sig = Signals(False, True, True, False)
    p = plan(v, r, sig, ProblemState("page"))
    assert (p.trigger, p.rung, p.unprompted, p.split_stage) == ("slip", "hint", True, False)
    assert plan(v, r, sig, ProblemState("page", hints=2)) is None
    assert plan(v, examples["uncertain"][1], sig, ProblemState("page")) is None
    assert plan(v, None, sig, ProblemState("page")) is None


def test_plan_request(examples):
    wrong, reading = examples["demo-wrong"]
    correct, _ = examples["demo-correct"]
    problem = ProblemState("page")
    for level in ("walkthrough", "solution"):
        p = plan_request(level, wrong, reading, problem)
        assert p.trigger == f"asked-{level}" and p.rung == level
        assert not p.unprompted and p.split_stage
        assert plan_request(level, None, reading, problem) is None
    assert plan_request("walkthrough", correct, reading, problem) is None
    for ref in (
        None,
        wrong.reference.model_copy(update={"trusted": False}),
        wrong.reference.model_copy(update={"machine": None}),
    ):
        v = wrong.model_copy(update={"reference": ref})
        assert plan_request("solution", v, reading, problem) is None


def test_apply_counts_hints_and_climbs(examples):
    wrong, reading = examples["demo-wrong"]
    correct, _ = examples["demo-correct"]
    problem = ProblemState("page")
    hint = plan(wrong, reading, Signals(False, True, True, False), problem)
    updated = apply(problem, hint)
    assert problem.hints == 0 and updated.hints == 1 and updated.rung is None
    problem = apply(updated, hint)
    assert problem.hints == 2 and problem.failed_attempts == 0
    for rung in ("counterexample", "walkthrough", "walkthrough"):
        p = plan(wrong, reading, Signals(True, True, False, False), problem)
        problem = apply(problem, p)
        assert problem.rung == rung
    assert problem.failed_attempts == 3
    problem = apply(problem, plan_request("solution", wrong, reading, problem))
    assert problem.rung == "solution" and problem.failed_attempts == 3
    for v in (correct, correct.model_copy(update={"status": "unsure", "computed": False})):
        p = plan(v, reading, Signals(True, False, False, False), ProblemState("page"))
        assert apply(ProblemState("page"), p).spoke_correct


def test_signals_missing_refused_and_thresholds():
    thresholds = dict(
        diagram_attempt_complete=0.8,
        new_work_worth_checking=0.6,
        student_seems_stuck=0.7,
        not_schoolwork=0.9,
    )
    assert signals(thresholds, [], thresholds) == Signals(True, True, True, True)
    assert signals(thresholds, list(thresholds), thresholds) == Signals(False, False, False, False)
    assert signals({}, [], thresholds) == Signals(False, False, False, False)
    assert signals({"diagram_attempt_complete": 0.799}, [], thresholds).complete is False


@pytest.mark.parametrize(
    "changes,unprompted,want",
    [
        (
            {"user_speaking": True, "bot_busy": True, "pen_busy": True},
            True,
            (False, "she is speaking"),
        ),
        ({"user_stopped_at": 99401, "bot_busy": True}, True, (False, "pause")),
        ({"user_stopped_at": 99400}, True, (True, "ok")),
        ({"bot_busy": True, "pen_busy": True}, True, (False, "Ada is busy")),
        ({"pen_busy": True}, True, (False, "pen")),
        ({"pen_still_since": 98501, "last_unprompted_at": 100000}, True, (False, "pen")),
        ({"pen_still_since": 98500}, True, (True, "ok")),
        ({"last_unprompted_at": 55001}, True, (False, "rate")),
        ({"last_unprompted_at": 55000}, True, (True, "ok")),
        ({"last_unprompted_at": 100000}, False, (True, "ok")),
        ({}, True, (True, "ok")),
        (
            {"user_stopped_at": None, "pen_still_since": None, "last_unprompted_at": None},
            True,
            (True, "ok"),
        ),
    ],
)
def test_may_speak_order(changes, unprompted, want):
    m = Moment(100000, False, 0, False, False, 0, 0)
    assert may_speak(replace(m, **changes), Etiquette(), unprompted=unprompted) == want
