from tassel.domains.dfa.describe import describe_machine, describe_trace
from tassel.domains.dfa.machine import Machine
from tassel.domains.dfa.reference import CATALOG


def test_describe_machine():
    assert describe_machine(CATALOG["starts-with-010"].machine) == (
        "q0 -0-> q1, q1 -1-> q2, q2 -0-> q3, q3 -0,1-> q3; accepting: q3; "
        "every other move goes to a dead state"
    )


def test_describe_trace():
    assert describe_trace("1010", [["q0"], ["q0"], ["q1"], ["q2"], ["q3"]]) == (
        "q0 -1-> q0 -0-> q1 -1-> q2 -0-> q3"
    )
    assert describe_trace("01", [["q0"], ["q1", "q0"], ["q2"]]) == "q0 -0-> {q0,q1} -1-> q2"
    assert describe_trace("", [["q0"]]) == "q0"


def test_accepting_state_named_dead_is_not_omitted():
    m = Machine(
        ("dead",),
        ("0", "1"),
        "dead",
        frozenset({"dead"}),
        {("dead", "0"): frozenset({"dead"}), ("dead", "1"): frozenset({"dead"})},
    )
    assert describe_machine(m) == "dead -0,1-> dead; accepting: dead"


def test_no_accept_flags_do_not_hide_the_drawn_transitions():
    m = Machine(
        ("s", "a", "b"),
        ("0",),
        "s",
        frozenset(),
        {("s", "0"): frozenset({"a"}), ("a", "0"): frozenset({"b"})},
    )
    assert describe_machine(m) == (
        "s -0-> a, a -0-> b; accepting: none; every other move goes to a dead state"
    )


def test_absorbing_reject_sink_is_hidden_regardless_of_its_name():
    m = Machine(
        ("s", "trap"),
        ("0", "1"),
        "s",
        frozenset({"s"}),
        {
            ("s", "0"): frozenset({"s"}),
            ("s", "1"): frozenset({"trap"}),
            ("trap", "0"): frozenset({"trap"}),
            ("trap", "1"): frozenset({"trap"}),
        },
    )
    assert describe_machine(m) == ("s -0-> s; accepting: s; every other move goes to a dead state")
