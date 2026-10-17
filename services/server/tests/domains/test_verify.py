import json
from dataclasses import replace
from pathlib import Path

from tassel.domains.base import Verifier
from tassel.domains.dfa.contract import Blame
from tassel.domains.dfa.reference import CATALOG
from tassel.domains.dfa.verify import DFA_VERIFIER, verify


def test_every_shared_expected_entry(readings):
    expected = json.loads(
        (
            Path(__file__).resolve().parents[4] / "packages/shared/src/vision/fixtures.json"
        ).read_text()
    )["expected"]
    for name, want in expected.items():
        verdict = verify(readings[name], CATALOG[want["reference"]])
        assert verdict.status == want["status"], name
        assert verdict.computed
        assert verdict.reference.id == want["reference"]
        if want["counterexample"] is None:
            assert verdict.counterexample is None
        else:
            ce = verdict.counterexample
            assert ce.input == want["counterexample"]["input"]
            assert ce.direction == want["counterexample"]["direction"]
            assert ce.blame == Blame.model_validate(want["counterexample"]["blame"])
        assert verdict.reference.machine == CATALOG[want["reference"]].info().machine


def test_unreadable_and_unknown(readings):
    r = readings["demo-wrong"]
    verdict = verify(r, None)
    assert verdict.status == "unknown" and not verdict.computed
    assert verdict.reference is None and verdict.counterexample is None and not verdict.fixes
    assert [i.states for i in verdict.issues] == [["q1"], ["q2"]]
    r.states = []
    verdict = verify(r, CATALOG["starts-with-010"])
    assert verdict.status == "unreadable" and not verdict.computed
    assert verdict.counterexample is None and not verdict.fixes


def test_untrusted_reference_is_unsure_and_judged(readings):
    reference = replace(CATALOG["starts-with-010"], source="llm-unchecked", trusted=False)
    verdict = verify(readings["demo-wrong"], reference)
    assert verdict.status == "unsure" and not verdict.computed
    assert verdict.counterexample.input == "1010"
    assert not verdict.fixes
    assert verdict.reference.source == "llm-unchecked" and not verdict.reference.trusted


def test_untrusted_match_has_no_counterexample(readings):
    reference = replace(CATALOG["starts-with-010"], source="llm-unchecked", trusted=False)
    verdict = verify(readings["demo-correct"], reference)
    assert verdict.status == "unsure" and not verdict.computed
    assert verdict.counterexample is None and not verdict.fixes


def test_missing_start_is_unreadable_instead_of_crashing(readings):
    r = readings["demo-correct"]
    r.states[0].start = False
    verdict = verify(r, CATALOG["starts-with-010"])
    assert verdict.status == "unreadable" and not verdict.computed
    assert any(i.kind == "missing_start" for i in verdict.issues)


def test_nfa_is_determinized_with_token_traces_and_no_fixes(readings):
    r = readings["nfa-ends-with-01"]
    assert verify(r, CATALOG["ends-with-01"]).status == "correct"
    r.transitions = [t for t in r.transitions if t.source != "q1"]
    verdict = verify(r, CATALOG["ends-with-01"])
    assert verdict.status == "wrong" and verdict.computed
    assert verdict.counterexample.student_trace == [["q0"], ["q0", "q1"], ["q0"]]
    assert not verdict.fixes


def test_oversized_nfa_is_unreadable(readings):
    r = readings["nondeterministic"]
    template_state, template_edge = r.states[0], r.transitions[0]
    r.states = [
        template_state.model_copy(update={"id": f"q{i}", "start": i == 0, "accept": i == 21})
        for i in range(22)
    ]
    edges = [("q0", "q0", ["0", "1"]), ("q0", "q1", ["1"])]
    edges.extend((f"q{i}", f"q{i + 1}", ["0", "1"]) for i in range(1, 21))
    r.transitions = [
        template_edge.model_copy(update={"id": f"t{i}", "source": s, "target": t, "symbols": a})
        for i, (s, t, a) in enumerate(edges)
    ]
    verdict = verify(r, CATALOG["ends-with-01"])
    assert verdict.status == "unreadable" and not verdict.computed
    assert not verdict.fixes and verdict.counterexample is None


def test_large_deterministic_reading_has_no_fixes(readings):
    r = readings["demo-wrong"]
    r.states.extend(r.states[1].model_copy(update={"id": f"extra{i}"}) for i in range(9))
    verdict = verify(r, CATALOG["starts-with-010"])
    assert verdict.status == "wrong" and verdict.counterexample.input == "1010"
    assert not verdict.fixes


def test_verifier_protocol(readings):
    assert isinstance(DFA_VERIFIER, Verifier)
    assert DFA_VERIFIER.subject == "automata.dfa"
    assert (
        DFA_VERIFIER.verify(readings["demo-correct"], CATALOG["starts-with-010"]).status
        == "correct"
    )
