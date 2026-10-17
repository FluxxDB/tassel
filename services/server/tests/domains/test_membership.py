import time

import pytest

from tassel.domains.dfa.contract import Atom, Clause, MembershipPredicate
from tassel.domains.dfa.machine import Machine
from tassel.domains.dfa.membership import agrees, check_length, evaluate, validate_predicate
from tassel.domains.dfa.regex import compile_regex


def atom(op, **fields):
    return Atom.model_validate(
        dict(op=op, text=None, symbol=None, n=None, m=None, r=None, negate=False) | fields
    )


def predicate(*atoms, expressible=True):
    return MembershipPredicate(expressible=expressible, any_of=[Clause(all_of=list(atoms))])


@pytest.mark.parametrize(
    "op,fields,word,want",
    [
        ("starts_with", {"text": "01"}, "010", True),
        ("starts_with", {"text": "01"}, "101", False),
        ("ends_with", {"text": "01"}, "001", True),
        ("ends_with", {"text": "01"}, "010", False),
        ("contains", {"text": "11"}, "0110", True),
        ("contains", {"text": "11"}, "101", False),
        ("length_eq", {"n": 2}, "01", True),
        ("length_eq", {"n": 2}, "", False),
        ("length_ge", {"n": 2}, "010", True),
        ("length_ge", {"n": 2}, "0", False),
        ("length_le", {"n": 2}, "", True),
        ("length_le", {"n": 2}, "010", False),
        ("length_mod", {"m": 3, "r": 1}, "0", True),
        ("length_mod", {"m": 3, "r": 1}, "", False),
        ("count_eq", {"symbol": "0", "n": 2}, "010", True),
        ("count_eq", {"symbol": "0", "n": 2}, "1", False),
        ("count_ge", {"symbol": "1", "n": 2}, "110", True),
        ("count_ge", {"symbol": "1", "n": 2}, "01", False),
        ("count_le", {"symbol": "0", "n": 1}, "1", True),
        ("count_le", {"symbol": "0", "n": 1}, "00", False),
        ("count_mod", {"symbol": "0", "m": 2, "r": 0}, "", True),
        ("count_mod", {"symbol": "0", "m": 2, "r": 0}, "0", False),
        ("value_mod", {"m": 3, "r": 0}, "", True),
        ("value_mod", {"m": 3, "r": 0}, "11", True),
        ("value_mod", {"m": 3, "r": 0}, "110", True),
        ("value_mod", {"m": 3, "r": 0}, "10", False),
    ],
)
@pytest.mark.parametrize("negate", [False, True])
def test_atoms(op, fields, word, want, negate):
    p = predicate(atom(op, **fields, negate=negate))
    assert validate_predicate(p, "01") == []
    assert evaluate(p, word) == (not want if negate else want)


def test_and_or_and_empty_clauses():
    p = MembershipPredicate(
        expressible=True,
        any_of=[
            Clause(all_of=[atom("ends_with", text="0"), atom("length_mod", m=2, r=0)]),
            Clause(all_of=[atom("starts_with", text="11")]),
        ],
    )
    assert evaluate(p, "10") and evaluate(p, "110")
    assert not evaluate(p, "0") and not evaluate(p, "01")
    assert not evaluate(MembershipPredicate(expressible=True, any_of=[]), "")
    assert evaluate(predicate(), "arbitrary")
    assert evaluate(predicate(atom("contains", text="")), "")


@pytest.mark.parametrize(
    "p,alphabet,fragment",
    [
        (predicate(atom("contains")), "01", "text"),
        (predicate(atom("length_eq")), "01", "n"),
        (predicate(atom("length_mod", m=0, r=0)), "01", "m"),
        (predicate(atom("length_mod", m=3, r=-1)), "01", "r"),
        (predicate(atom("length_mod", m=3, r=3)), "01", "r"),
        (predicate(atom("length_mod", r=0)), "01", "m"),
        (predicate(atom("length_mod", m=2)), "01", "r"),
        (predicate(atom("count_eq", n=1)), "01", "symbol"),
        (predicate(atom("count_eq", n=1, symbol="2")), "01", "symbol"),
        (predicate(atom("count_eq", n=1, symbol="00")), "01", "symbol"),
        (predicate(atom("contains", text="012")), "01", "text"),
        (predicate(expressible=False), "01", "expressible"),
        (predicate(atom("value_mod", m=3, r=0)), "ab", "binary"),
        (predicate(atom("value_mod", m=3, r=0)), "0", "binary"),
        (predicate(atom("length_eq", n=1)), ["00"], "alphabet"),
    ],
)
def test_validate(p, alphabet, fragment):
    problems = validate_predicate(p, alphabet)
    assert len(problems) == 1 and fragment in problems[0]


def test_validate_reports_each_missing_field_with_its_location():
    problems = validate_predicate(predicate(atom("count_mod")), "01")
    assert len(problems) == 3
    assert all("any_of[0].all_of[0]" in problem for problem in problems)
    assert validate_predicate(predicate(atom("length_ge", n=-1)), "01") == []


@pytest.mark.parametrize(
    "size,cap,want",
    [
        (2, 200000, 12),
        (3, 200000, 10),
        (4, 200000, 8),
        (0, 1, 12),
        (1, 200000, 12),
        (2, 1, 0),
        (2, 3, 1),
        (1, 5, 4),
    ],
)
def test_check_length(size, cap, want):
    assert check_length(size, cap) == want


@pytest.mark.parametrize("size,cap", [(-1, 200000), (2, 0)])
def test_invalid_check_budget(size, cap):
    with pytest.raises(ValueError):
        check_length(size, cap)


def test_agreement_finds_the_first_disagreement():
    m = compile_regex("(0|1)*01", "01")
    assert agrees(m, predicate(atom("ends_with", text="01")), 12) is None
    assert agrees(m, predicate(atom("ends_with", text="1")), 12) == "1"
    assert agrees(m, predicate(), 12) == ""


def test_agreement_is_incremental_and_fast(monkeypatch):
    m = compile_regex("(0|1)*01", "01")
    p = predicate(atom("ends_with", text="01"))
    steps = 0
    original = Machine.next

    def counted(self, state, symbol):
        nonlocal steps
        steps += 1
        return original(self, state, symbol)

    monkeypatch.setattr(Machine, "next", counted)
    started = time.monotonic()
    assert agrees(m, p, 12) is None
    assert time.monotonic() - started < 1
    assert steps == 8190  # One step per extension, not one run per word.


def test_agreement_visits_length_12_and_shortlex_first():
    m = compile_regex("Σ*", "01")
    assert agrees(m, predicate(atom("length_le", n=11)), 12) == "0" * 12
    assert agrees(m, predicate(atom("length_le", n=11)), 11) is None


@pytest.mark.parametrize("max_len", [-1, 13])
def test_agreement_refuses_an_unbounded_request(max_len):
    with pytest.raises(ValueError):
        agrees(compile_regex("Σ*", "01"), predicate(), max_len)


def test_agreement_refuses_invalid_predicates():
    with pytest.raises(ValueError):
        agrees(compile_regex("Σ*", "01"), predicate(atom("length_mod", m=0, r=0)), 12)
