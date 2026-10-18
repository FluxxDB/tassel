"""Structural diagnostics, language-preserving conversions and bounded subset construction."""

import time
from dataclasses import FrozenInstanceError
from types import MappingProxyType

import pytest
from automata.fa.dfa import DFA
from automata.fa.nfa import NFA

from tassel.domains.dfa.contract import DEAD, EPSILON, Issue, MachineSpec
from tassel.domains.dfa.machine import (
    Machine,
    TooLarge,
    coreachable,
    determinize,
    epsilon_closure,
    machine_from_automata_nfa,
    machine_from_reading,
    machine_from_spec,
    reachable,
    to_automata_dfa,
    to_spec,
)


def issues_of(parsed, kind):
    return [issue for issue in parsed.issues if issue.kind == kind]


def test_demo_wrong_parses_clean(readings):
    parsed = machine_from_reading(readings["demo-wrong"])
    m = parsed.machine
    assert m.deterministic
    assert m.states == ("q0", "q1", "q2", "q3")
    assert m.alphabet == ("0", "1")
    assert m.start == "q0"
    assert m.accepts == frozenset({"q3"})
    assert parsed.issues == (
        Issue(kind="implicit_dead_state", states=["q1"], symbols=["0"]),
        Issue(kind="implicit_dead_state", states=["q2"], symbols=["1"]),
    )


def test_partial_has_three_dead_ends(readings):
    # The brief names q1–q3, but the actual Task 1 fixture also omits q0's 1 move.
    parsed = machine_from_reading(readings["demo-partial"])
    assert parsed.issues == tuple(
        Issue(kind="implicit_dead_state", states=[state], symbols=symbols)
        for state, symbols in [("q0", ["1"]), ("q1", ["0"]), ("q2", ["1"]), ("q3", ["0", "1"])]
    )


def test_nondeterminism_is_reported_and_kept(readings):
    parsed = machine_from_reading(readings["nondeterministic"])
    assert issues_of(parsed, "nondeterminism") == [
        Issue(kind="nondeterminism", states=["q0"], symbols=["0"])
    ]
    assert parsed.machine.moves["q0", "0"] == frozenset({"q1", "q2"})
    assert not parsed.machine.deterministic


@pytest.mark.parametrize("kind,problem_kind", [("dfa", "nfa"), ("nfa", "dfa"), ("nfa", "nfa")])
def test_epsilon_in_a_dfa_problem(readings, kind, problem_kind):
    r = readings["demo-correct"]
    r.kind, r.problem_kind = kind, problem_kind
    r.transitions[0].symbols = [EPSILON]
    parsed = machine_from_reading(r)
    assert not issues_of(parsed, "unknown_symbol")
    assert parsed.machine.moves["q0", EPSILON] == frozenset({"q1"})
    assert not parsed.machine.deterministic
    assert issues_of(parsed, "epsilon_in_dfa") == (
        [Issue(kind="epsilon_in_dfa", states=["q0"], symbols=[EPSILON])]
        if "dfa" in (kind, problem_kind)
        else []
    )


def test_missing_and_multiple_starts(readings):
    r = readings["demo-wrong"]
    r.states[0].start = False
    parsed = machine_from_reading(r)
    assert parsed.machine.start is None
    assert not parsed.machine.deterministic
    assert issues_of(parsed, "missing_start") == [
        Issue(kind="missing_start", states=[], symbols=[])
    ]
    assert reachable(parsed.machine) == frozenset()
    r.states[1].start = r.states[3].start = True
    parsed = machine_from_reading(r)
    assert parsed.machine.start == "q1"
    assert issues_of(parsed, "multiple_starts") == [
        Issue(kind="multiple_starts", states=["q1", "q3"], symbols=[])
    ]


def test_no_accept(readings):
    parsed = machine_from_reading(readings["demo-no-accept"])
    assert not parsed.machine.accepts
    assert issues_of(parsed, "no_accept") == [Issue(kind="no_accept", states=[], symbols=[])]
    assert coreachable(parsed.machine) == frozenset()


def test_unreachable(readings):
    r = readings["demo-correct"]
    r.transitions = r.transitions[1:]
    parsed = machine_from_reading(r)
    assert issues_of(parsed, "unreachable") == [
        Issue(kind="unreachable", states=["q1", "q2", "q3"], symbols=[])
    ]
    assert reachable(parsed.machine) == frozenset({"q0"})
    assert coreachable(parsed.machine) == frozenset({"q1", "q2", "q3"})


def test_unknown_symbol_is_dropped_and_reported(readings):
    parsed = machine_from_reading(readings["unknown-symbol"])
    assert issues_of(parsed, "unknown_symbol") == [
        Issue(kind="unknown_symbol", states=["q1"], symbols=["2"])
    ]
    assert ("q1", "2") not in parsed.machine.moves


def test_reference_alphabet_and_mixed_labels(readings):
    r = readings["demo-correct"]
    r.transitions[0].symbols = ["0", "x", EPSILON]
    parsed = machine_from_reading(r, alphabet=["1", "0", "2"])
    assert parsed.machine.alphabet == ("0", "1", "2")
    assert parsed.machine.moves["q0", "0"] == frozenset({"q1"})
    assert parsed.machine.moves["q0", EPSILON] == frozenset({"q1"})
    assert ("q0", "x") not in parsed.machine.moves
    assert issues_of(parsed, "unknown_symbol") == [
        Issue(kind="unknown_symbol", states=["q0"], symbols=["x"])
    ]
    assert all("2" in issue.symbols for issue in issues_of(parsed, "implicit_dead_state"))
    assert machine_from_reading(r, alphabet=[]).machine.alphabet == ()


def test_dangling_and_unlabeled(readings):
    r = readings["demo-wrong"]
    r.transitions[0].target = "missing"
    r.transitions[1].source = "absent"
    r.transitions[2].symbols = []
    parsed = machine_from_reading(r)
    assert issues_of(parsed, "unlabeled_transition") == [
        Issue(kind="unlabeled_transition", states=["q2", "q3"], symbols=[])
    ]
    assert issues_of(parsed, "dangling_transition") == [
        Issue(kind="dangling_transition", states=["q0", "missing"], symbols=["0"]),
        Issue(kind="dangling_transition", states=["absent", "q2"], symbols=["1"]),
    ]
    assert set(parsed.machine.moves) == {("q0", "1"), ("q3", "0"), ("q3", "1")}
    assert [i.kind for i in parsed.issues][:3] == [
        "unlabeled_transition",
        "dangling_transition",
        "dangling_transition",
    ]


def test_issue_categories_are_in_brief_order(readings):
    r = readings["nondeterministic"]
    r.states[0].start = r.states[2].accept = False
    for symbols, source, target in [
        (["x"], "q0", "q0"),
        ([], "q0", "q0"),
        (["1"], "absent", "q0"),
        ([EPSILON], "q1", "q1"),
    ]:
        r.transitions.append(
            r.transitions[0].model_copy(
                update={"symbols": symbols, "source": source, "target": target}
            )
        )
    kinds = list(dict.fromkeys(i.kind for i in machine_from_reading(r).issues))
    assert kinds == [
        "unknown_symbol",
        "unlabeled_transition",
        "dangling_transition",
        "missing_start",
        "no_accept",
        "nondeterminism",
        "epsilon_in_dfa",
        "unreachable",
        "implicit_dead_state",
    ]


def test_next_goes_dead_on_a_missing_move(readings):
    m = machine_from_reading(readings["demo-wrong"]).machine
    assert m.next("q0", "0") == "q1"
    assert m.next("q1", "0") == DEAD
    assert m.next(DEAD, "1") == DEAD
    with pytest.raises(ValueError):
        machine_from_reading(readings["nondeterministic"]).machine.next("q0", "0")


def test_moves_are_immutable_and_detached():
    moves = {("a", "0"): {"a"}}
    m = Machine(("a",), ("0",), "a", frozenset({"a"}), moves)
    moves["a", "0"].clear()
    assert isinstance(m.moves, MappingProxyType)
    assert m.next("a", "0") == "a"
    with pytest.raises(TypeError):
        m.moves["a", "0"] = frozenset()
    with pytest.raises(FrozenInstanceError):
        m.start = None


def test_duplicate_arrows_are_not_nondeterminism(readings):
    r = readings["demo-wrong"]
    r.transitions.append(r.transitions[0].model_copy(deep=True))
    assert machine_from_reading(r).machine.deterministic


def test_epsilon_closure_and_graph_search():
    m = Machine(
        ("a", "b", "c", "d"),
        ("0",),
        "a",
        frozenset({"c"}),
        {
            ("a", EPSILON): frozenset({"b"}),
            ("b", EPSILON): frozenset({"a"}),
            ("b", "0"): frozenset({"c"}),
            ("d", "0"): frozenset({"d"}),
        },
    )
    assert epsilon_closure(m, iter(["a"])) == frozenset({"a", "b"})
    assert epsilon_closure(m, []) == frozenset()
    assert reachable(m) == frozenset({"a", "b", "c"})
    assert coreachable(m) == frozenset({"a", "b", "c"})
    dfa, subsets = determinize(m)
    assert dfa.states == ("{a,b}", "c")
    assert dfa.start == "{a,b}"
    assert dfa.accepts == frozenset({"c"})
    assert subsets == {"{a,b}": frozenset({"a", "b"}), "c": frozenset({"c"})}
    assert dfa.next("c", "0") == DEAD


def test_determinize_matches_automata_lib(readings):
    nfa = machine_from_reading(readings["nfa-ends-with-01"]).machine
    dfa, subsets = determinize(nfa)
    assert to_automata_dfa(dfa) == DFA.from_nfa(
        NFA.from_regex("(0|1)*01", input_symbols={"0", "1"})
    )
    assert dfa.states == ("q0", "{q0,q1}", "{q0,q2}")
    assert subsets["{q0,q2}"] == frozenset({"q0", "q2"})


def nth_from_last(n):
    moves = {("q0", "0"): frozenset({"q0"}), ("q0", "1"): frozenset({"q0", "q1"})}
    for i in range(1, n):
        for symbol in ("0", "1"):
            moves[f"q{i}", symbol] = frozenset({f"q{i + 1}"})
    return Machine(
        tuple(f"q{i}" for i in range(n + 1)), ("0", "1"), "q0", frozenset({f"q{n}"}), moves
    )


def test_determinize_stops_at_the_cap(readings):
    before = time.monotonic()
    with pytest.raises(TooLarge):
        determinize(nth_from_last(21))
    assert time.monotonic() - before < 2
    nfa = machine_from_reading(readings["nfa-ends-with-01"]).machine
    with pytest.raises(TooLarge):
        determinize(nfa, max_states=2)
    assert len(determinize(nfa, max_states=3)[0].states) == 3
    with pytest.raises(TooLarge):
        determinize(nth_from_last(21), budget_s=0, max_states=10**6)


def test_determinize_checks_time_at_the_64th_subset(monkeypatch):
    # q0 then each pair of symbols adds a subset; at 64, time expires.
    clock = iter([100.0, 102.0])
    monkeypatch.setattr("tassel.domains.dfa.machine.time.monotonic", lambda: next(clock))
    with pytest.raises(TooLarge, match="budget"):
        determinize(nth_from_last(21), max_states=10**6)


def test_deterministic_machine_is_returned_unchanged(readings):
    m = machine_from_reading(readings["demo-wrong"]).machine
    dfa, subsets = determinize(m)
    assert dfa is m
    assert subsets == {s: frozenset({s}) for s in ("q0", "q1", "q2", "q3")}


def test_machine_from_automata_nfa():
    nfa = NFA.from_regex("0*1|()", input_symbols={"0", "1"})
    m = machine_from_automata_nfa(nfa)
    assert any(symbol == EPSILON for _, symbol in m.moves)
    assert all(symbol != "" for _, symbol in m.moves)
    assert m.alphabet == ("0", "1")
    assert all(isinstance(s, str) for s in m.states)
    assert to_automata_dfa(determinize(m)[0]) == DFA.from_nfa(nfa)


def test_to_spec_completes_with_dead(readings):
    m = machine_from_reading(readings["demo-wrong"]).machine
    spec = to_spec(m)
    assert spec == MachineSpec(
        states=["q0", "q1", "q2", "q3", "dead"],
        alphabet=["0", "1"],
        start="q0",
        accepts=["q3"],
        transitions={
            "q0": {"0": "q1", "1": "q0"},
            "q1": {"0": "dead", "1": "q2"},
            "q2": {"0": "q3", "1": "dead"},
            "q3": {"0": "q3", "1": "q3"},
            "dead": {"0": "dead", "1": "dead"},
        },
    )
    restored = machine_from_spec(spec)
    assert to_automata_dfa(restored) == to_automata_dfa(m)
    assert to_spec(restored) == spec


def test_complete_machine_needs_no_dead_state():
    spec = MachineSpec(
        states=["s"],
        alphabet=["1", "0"],
        start="s",
        accepts=["s"],
        transitions={"s": {"0": "s", "1": "s"}},
    )
    m = machine_from_spec(spec)
    assert m.alphabet == ("0", "1")
    assert to_spec(m).states == ["s"]
    assert to_automata_dfa(m).accepts_input("010")


def test_dead_name_collision_preserves_language():
    m = Machine(
        ("start", "dead"),
        ("0", "1"),
        "start",
        frozenset({"dead"}),
        {
            ("start", "0"): frozenset({"dead"}),
        },
    )
    spec = to_spec(m)
    assert len(spec.states) == 3
    assert spec.transitions["start"]["1"] != "dead"
    oracle = to_automata_dfa(machine_from_spec(spec))
    assert oracle.accepts_input("0")
    assert not oracle.accepts_input("1")
    assert not oracle.accepts_input("00")


@pytest.mark.parametrize("operation", [to_spec, to_automata_dfa, determinize])
def test_missing_start_cannot_be_exported_as_a_valid_machine(operation):
    with pytest.raises(ValueError, match="start"):
        operation(Machine((), ("0",), None, frozenset(), {}))


@pytest.mark.parametrize("operation", [to_spec, to_automata_dfa])
def test_nondeterministic_machine_cannot_be_exported_as_a_dfa(readings, operation):
    with pytest.raises(ValueError):
        operation(machine_from_reading(readings["nondeterministic"]).machine)


def test_subset_names_cannot_merge_distinct_states():
    m = Machine(
        ("s", "a", "b", "{a,b}"),
        ("0", "1"),
        "s",
        frozenset({"{a,b}"}),
        {
            ("s", "0"): frozenset({"a", "b"}),
            ("s", "1"): frozenset({"{a,b}"}),
            ("a", "0"): frozenset({"a"}),
            ("b", "0"): frozenset({"b"}),
        },
    )
    dfa, subsets = determinize(m)
    assert len(subsets) == 3
    assert frozenset({"a", "b"}) in subsets.values()
    assert frozenset({"{a,b}"}) in subsets.values()
    oracle = to_automata_dfa(dfa)
    assert oracle.accepts_input("1")
    assert not oracle.accepts_input("0")


def test_reserved_dead_cannot_be_an_explicit_state():
    with pytest.raises(ValueError, match="reserved"):
        Machine((DEAD,), ("0",), DEAD, frozenset({DEAD}), {})
