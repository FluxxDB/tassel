import pytest
from automata.fa.nfa import NFA

from tassel.domains.dfa.contract import DEAD, Blame
from tassel.domains.dfa.machine import (
    Machine,
    determinize,
    machine_from_automata_nfa,
    machine_from_reading,
)
from tassel.domains.dfa.search import (
    accepts,
    access_strings,
    blame,
    find_counterexample,
    run,
    shortest_counterexample,
)


def test_demo_wrong_gives_1010(readings, starts_with_010):
    m = machine_from_reading(readings["demo-wrong"]).machine
    assert shortest_counterexample(m, starts_with_010) == ("1010", "false_accept")
    ce = find_counterexample(m, starts_with_010)
    assert ce.input == "1010" and ce.direction == "false_accept"
    assert ce.student_trace == [["q0"], ["q0"], ["q1"], ["q2"], ["q3"]]
    assert ce.reference_trace == ["q0", "dead", "dead", "dead", "dead"]
    assert ce.blame == Blame(
        step=1, kind="transition", state="q0", symbol="1", target="q0", prefix=""
    )


def test_partial_gives_0100_and_the_q3_hint(readings, starts_with_010):
    m = machine_from_reading(readings["demo-partial"]).machine
    ce = find_counterexample(m, starts_with_010)
    assert (ce.input, ce.direction) == ("0100", "false_reject")
    assert ce.blame == Blame(
        step=4, kind="missing_transition", state="q3", symbol="0", target=None, prefix="010"
    )
    assert ce.student_trace[-1] == [DEAD]


def test_no_accept_blames_the_flag(readings, starts_with_010):
    m = machine_from_reading(readings["demo-no-accept"]).machine
    ce = find_counterexample(m, starts_with_010)
    assert (ce.input, ce.direction) == ("010", "false_reject")
    assert ce.blame == Blame(
        step=3, kind="accept_flag", state="q3", symbol=None, target=None, prefix="010"
    )


def test_correct_has_none(readings, starts_with_010):
    m = machine_from_reading(readings["demo-correct"]).machine
    assert shortest_counterexample(m, starts_with_010) is None
    assert find_counterexample(m, starts_with_010) is None
    assert blame(m, starts_with_010, "010") is None


def test_shortlex_tie_break():
    a = Machine(
        ("a", "b"),
        ("1", "0"),
        "a",
        frozenset({"b"}),
        {("a", "0"): frozenset({"b"}), ("a", "1"): frozenset({"b"})},
    )
    b = Machine(("s",), ("0", "1"), "s", frozenset(), {})
    assert shortest_counterexample(a, b) == ("0", "false_accept")
    assert shortest_counterexample(b, a) == ("0", "false_reject")


def test_access_strings_are_shortlex():
    m = Machine(
        ("a", "b", "c", "unreachable"),
        ("1", "0"),
        "a",
        frozenset(),
        {
            ("a", "0"): frozenset({"b"}),
            ("a", "1"): frozenset({"b"}),
            ("b", "0"): frozenset({"c"}),
            ("b", "1"): frozenset({"a"}),
        },
    )
    assert access_strings(m) == {"a": "", "b": "0", "c": "00", DEAD: "000"}
    assert run(m, "0001") == ["a", "b", "c", DEAD, DEAD]
    assert not accepts(m, "0001")


def test_empty_word_counterexample_and_blame():
    a = Machine(("s",), ("0",), "s", frozenset({"s"}), {})
    b = Machine(("t",), ("0",), "t", frozenset(), {})
    ce = find_counterexample(a, b)
    assert (ce.input, ce.direction) == ("", "false_accept")
    assert ce.student_trace == [["s"]] and ce.reference_trace == ["t"]
    assert ce.blame == Blame(
        step=0, kind="accept_flag", state="s", symbol=None, target=None, prefix=""
    )
    assert accepts(a, "")


def test_nfa_traces_are_token_sets(readings):
    r = readings["nfa-ends-with-01"]
    reference = determinize(
        machine_from_automata_nfa(NFA.from_regex("(0|1)*01", input_symbols={"0", "1"}))
    )[0]
    student, subsets = determinize(machine_from_reading(r).machine)
    assert find_counterexample(student, reference, subsets=subsets) is None
    r.transitions = [t for t in r.transitions if t.source != "q1"]
    student, subsets = determinize(machine_from_reading(r).machine)
    ce = find_counterexample(student, reference, subsets=subsets)
    assert ce.input == "01"
    assert ce.student_trace == [["q0"], ["q0", "q1"], ["q0"]]


def test_subset_trace_retains_implicit_dead():
    a = Machine(("a",), ("0",), "a", frozenset(), {})
    b = Machine(("b", "f"), ("0",), "b", frozenset({"f"}), {("b", "0"): frozenset({"f"})})
    ce = find_counterexample(a, b, subsets={"a": frozenset({"z", "x"})})
    assert ce.student_trace == [["x", "z"], [DEAD]]


def test_noncoreachable_reference_states_share_the_dead_role():
    # Both transitions reject permanently: differing dead-state IDs are not blame.
    student = Machine(
        ("s", "a", "b"),
        ("0", "1"),
        "s",
        frozenset({"a"}),
        {
            ("s", "0"): frozenset({"a"}),
            ("s", "1"): frozenset({"a"}),
            ("a", "0"): frozenset({"b"}),
        },
    )
    reference = Machine(
        ("r", "dead0", "dead1"),
        ("0", "1"),
        "r",
        frozenset(),
        {
            ("r", "0"): frozenset({"dead0"}),
            ("r", "1"): frozenset({"dead1"}),
        },
    )
    assert blame(student, reference, "1") == Blame(
        step=1, kind="accept_flag", state="a", symbol=None, target=None, prefix="1"
    )


@pytest.mark.parametrize(
    "operation", [shortest_counterexample, find_counterexample, lambda a, b: blame(a, b, "")]
)
def test_search_requires_the_same_alphabet(operation):
    a = Machine(("s",), ("0",), "s", frozenset(), {})
    b = Machine(("t",), ("1",), "t", frozenset(), {})
    with pytest.raises(AssertionError):
        operation(a, b)


def test_search_requires_deterministic_inputs(readings, starts_with_010):
    nfa = machine_from_reading(readings["nondeterministic"]).machine
    for operation in (run, accepts):
        with pytest.raises(AssertionError):
            operation(nfa, "")
    with pytest.raises(AssertionError):
        access_strings(nfa)
    with pytest.raises(AssertionError):
        shortest_counterexample(nfa, starts_with_010)


@pytest.fixture
def starts_with_010():
    # A literal oracle independent of the catalog introduced by Task 4.
    from tassel.domains.dfa.contract import MachineSpec
    from tassel.domains.dfa.machine import machine_from_spec

    return machine_from_spec(
        MachineSpec(
            states=["q0", "q1", "q2", "q3", "dead"],
            alphabet=["0", "1"],
            start="q0",
            accepts=["q3"],
            transitions={
                "q0": {"0": "q1", "1": "dead"},
                "q1": {"0": "dead", "1": "q2"},
                "q2": {"0": "q3", "1": "dead"},
                "q3": {"0": "q3", "1": "q3"},
                "dead": {"0": "dead", "1": "dead"},
            },
        )
    )
