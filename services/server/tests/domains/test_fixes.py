import pytest

from tassel.domains.dfa.contract import Fix
from tassel.domains.dfa.fixes import one_edit_fixes
from tassel.domains.dfa.machine import Machine, machine_from_reading
from tassel.domains.dfa.reference import CATALOG


def test_demo_wrong_first_fix_removes_q0_loop(readings):
    m = machine_from_reading(readings["demo-wrong"]).machine
    fixes = one_edit_fixes(m, CATALOG["starts-with-010"].machine)
    assert fixes[0] == Fix(kind="remove_transition", state="q0", symbol="1", target=None)
    assert m.next("q0", "1") == "q0"  # Trials never mutate the student's machine.


def test_partial_has_no_single_edit_fix(readings):
    m = machine_from_reading(readings["demo-partial"]).machine
    assert one_edit_fixes(m, CATALOG["starts-with-010"].machine) == []


def test_no_accept_flips_q3(readings):
    m = machine_from_reading(readings["demo-no-accept"]).machine
    assert one_edit_fixes(m, CATALOG["starts-with-010"].machine)[0] == Fix(
        kind="flip_accept", state="q3", symbol=None, target=None
    )


@pytest.mark.parametrize("existing,kind", [(False, "add_transition"), (True, "redirect")])
def test_add_and_redirect(existing, kind):
    moves = {("s", "0"): frozenset({"s"})} if existing else {}
    student = Machine(("s", "f"), ("0",), "s", frozenset({"f"}), moves)
    reference = Machine(("a", "b"), ("0",), "a", frozenset({"b"}), {("a", "0"): frozenset({"b"})})
    assert one_edit_fixes(student, reference) == [Fix(kind=kind, state="s", symbol="0", target="f")]


def test_limit_and_state_order():
    student = Machine(("s", "a", "b"), ("0",), "s", frozenset({"a", "b"}), {})
    reference = Machine(("s", "f"), ("0",), "s", frozenset({"f"}), {("s", "0"): frozenset({"f"})})
    assert one_edit_fixes(student, reference, limit=0) == []
    assert one_edit_fixes(student, reference, limit=1) == [
        Fix(kind="add_transition", state="s", symbol="0", target="a")
    ]
    assert [fix.target for fix in one_edit_fixes(student, reference)] == ["a", "b"]
