import json
from pathlib import Path

import pytest

from tassel.domains.dfa.contract import Blame, Counterexample, DfaReading
from tassel.domains.dfa.reference import CATALOG
from tassel.domains.dfa.verify import verify
from tassel.vision.notes import HOLDING_LINES, parse_note, render_note, template_key, template_slots
from tassel.vision.policy import NotePlan


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
    "name,trigger,rung,unprompted,want",
    [
        (
            "demo-wrong",
            "attempt",
            "counterexample",
            False,
            "[vision] DFA attempt complete. Verdict: wrong. Accepts 1010 but should reject. "
            "Blame: q0 on 1 goes to q0. Escalation: counterexample. "
            "Ask her to run 1010 through her DFA and say where it ends; don't name the fix.",
        ),
        (
            "demo-partial",
            "stuck",
            "hint",
            True,
            "[vision] She seems stuck. Verdict: wrong. Rejects 0100 but should accept. "
            "Blame: q3 has no move on 0 after reading 010. Escalation: hint. "
            "Give one short hint as a question; don't name the fix.",
        ),
        (
            "demo-correct",
            "attempt",
            None,
            False,
            "[vision] DFA attempt complete. Verdict: correct. Escalation: none. "
            "Confirm briefly and ask her why it works.",
        ),
    ],
)
def test_render_demo_notes(examples, name, trigger, rung, unprompted, want):
    v, r = examples[name]
    assert render_note(NotePlan(trigger, rung, unprompted, v, r)) == want


def test_render_walkthrough_and_solution(examples):
    v, r = examples["demo-wrong"]
    walkthrough = render_note(NotePlan("asked-walkthrough", "walkthrough", False, v, r))
    assert "Trace: q0 -1-> q0 -0-> q1 -1-> q2 -0-> q3." in walkthrough
    solution = render_note(NotePlan("asked-solution", "solution", False, v, r))
    assert (
        "Solution: q0 -0-> q1, q1 -1-> q2, q2 -0-> q3, q3 -0,1-> q3; accepting: q3; "
        "every other move goes to a dead state." in solution
    )


@pytest.mark.parametrize("name,word", [("uncertain", "wrong"), ("demo-correct", "correct")])
def test_judged_and_uncertain_suffixes(examples, name, word):
    v, r = examples[name]
    v = v.model_copy(update={"status": "unsure", "computed": False})
    text = render_note(
        NotePlan("attempt", "counterexample" if word == "wrong" else None, False, v, r)
    )
    assert f"Verdict: probably {word} (judged)." in text
    assert "Say you think so; don't claim to be sure." in text
    if name == "uncertain":
        assert text.endswith("Ask her to check the board's reading of q2 first.")


@pytest.mark.parametrize(
    "name,trigger,rung,unprompted",
    [
        ("demo-wrong", "attempt", "counterexample", False),
        ("demo-wrong", "attempt", "guiding_question", False),
        ("demo-partial", "stuck", "hint", True),
        ("demo-no-accept", "attempt", "counterexample", False),
        ("demo-wrong", "slip", "hint", True),
        ("demo-correct", "attempt", None, False),
        ("demo-wrong", "asked-walkthrough", "walkthrough", False),
        ("demo-wrong", "asked-solution", "solution", False),
        ("uncertain", "attempt", "counterexample", False),
    ],
)
def test_parse_round_trips(examples, name, trigger, rung, unprompted):
    v, r = examples[name]
    p = NotePlan(trigger, rung, unprompted, v, r)
    n = parse_note(render_note(p))
    assert (n.trigger, n.rung, n.verdict, n.judged, n.uncertain) == (
        trigger,
        rung,
        v.status,
        False,
        r.uncertain,
    )
    ce = v.counterexample
    assert n.witness == (ce.input if ce else None)
    assert n.direction == (ce.direction if ce else None)
    if ce and ce.blame:
        b = ce.blame
        assert (n.blame_kind, n.state, n.symbol, n.target) == (b.kind, b.state, b.symbol, b.target)
        # The exact transition sentence carries no prefix; do not invent one.
        assert n.prefix == (None if b.kind == "transition" else b.prefix)
    if rung == "walkthrough":
        assert n.trace == ["q0", "q0", "q1", "q2", "q3"]
    else:
        assert n.trace == []
    assert bool(n.solution) == (rung == "solution")


def test_parse_failures_and_nonchecks(examples):
    for text in (
        "Hi Ada",
        "[vision] DFA attempt complete.",
        "[vision] DFA attempt complete. Verdict: wrong. Escalation: nonsense.",
    ):
        assert parse_note(text) is None
    v, r = examples["demo-wrong"]
    for status, want in [("unreadable", "unreadable"), ("unknown", "unknown target language")]:
        n = parse_note(
            render_note(
                NotePlan(
                    "attempt",
                    None,
                    False,
                    v.model_copy(update={"status": status, "counterexample": None}),
                    r,
                )
            )
        )
        assert n.verdict == want and template_key(n) == status
    assert (
        parse_note(render_note(NotePlan("attempt", None, False, None, None))).verdict
        == "unreadable"
    )


def test_template_keys_and_slots(examples):
    v, r = examples["demo-partial"]
    n = parse_note(render_note(NotePlan("stuck", "hint", True, v, r)))
    assert template_key(n) == "hint.missing_transition"
    slots = template_slots(n)
    assert slots["witness"] == "0100" and slots["prefix"] == "010"
    assert slots["state"] == "q3" and slots["symbol"] == "0"
    v, r = examples["demo-wrong"]
    for trigger, rung, key in [
        ("attempt", "counterexample", "counterexample"),
        ("attempt", "guiding_question", "guiding_question"),
        ("stuck", "hint", "hint.transition"),
        ("slip", "hint", "hint.slip"),
        ("asked-walkthrough", "walkthrough", "walkthrough.false_accept"),
        ("asked-solution", "solution", "solution"),
    ]:
        n = parse_note(render_note(NotePlan(trigger, rung, trigger in ("stuck", "slip"), v, r)))
        assert template_key(n) == key
        if rung == "walkthrough":
            assert template_slots(n)["trace"] == "q0, q0, q1, q2, q3"
            assert template_slots(n)["end"] == "q3"
        if rung == "solution":
            assert template_slots(n)["solution"] == n.solution
    v, r = examples["demo-correct"]
    for status in ("correct", "unsure"):
        n = parse_note(
            render_note(
                NotePlan("attempt", None, False, v.model_copy(update={"status": status}), r)
            )
        )
        assert template_key(n) == "correct"
        assert n.judged == (status == "unsure")


def test_empty_word_and_empty_prefix(examples):
    v, r = examples["demo-partial"]
    ce = Counterexample(
        input="0",
        direction="false_reject",
        student_trace=[["q0"], ["∅"]],
        reference_trace=["q0", "q1"],
        blame=Blame(
            step=1, kind="missing_transition", state="q0", symbol="0", target=None, prefix=""
        ),
    )
    v = v.model_copy(update={"counterexample": ce})
    n = parse_note(render_note(NotePlan("stuck", "hint", True, v, r)))
    assert n.prefix == "" and template_key(n) == "hint.missing_transition_start"
    ce = ce.model_copy(
        update={
            "input": "",
            "blame": Blame(
                step=0, kind="accept_flag", state="q0", symbol=None, target=None, prefix=""
            ),
            "student_trace": [["q0"]],
            "reference_trace": ["q0"],
        }
    )
    n = parse_note(
        render_note(
            NotePlan(
                "attempt", "counterexample", False, v.model_copy(update={"counterexample": ce}), r
            )
        )
    )
    assert n.witness == "" and n.prefix == ""
    assert template_slots(n)["witness"] == "ε"


def test_holding_lines():
    assert HOLDING_LINES == {
        "en": "Let me look at that.",
        "es": "Déjame mirarlo.",
        "ko": "잠깐만요, 확인해 볼게요.",
    }
