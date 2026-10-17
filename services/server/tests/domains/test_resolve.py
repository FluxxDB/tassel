from hashlib import sha256

import pytest

from tassel.domains.dfa.contract import Atom, Clause, MembershipPredicate
from tassel.domains.dfa.reference import CATALOG, resolve_reference


def ends_with(text, *, expressible=True):
    return MembershipPredicate(
        expressible=expressible,
        any_of=[
            Clause(
                all_of=[
                    Atom(
                        op="ends_with", text=text, symbol=None, n=None, m=None, r=None, negate=False
                    )
                ]
            )
        ],
    )


@pytest.mark.parametrize(
    "regex,p,want_source,want_trusted",
    [
        ("010(0|1)*", None, "catalog", True),
        ("(0|1)*00", ends_with("00"), "llm-checked", True),
        ("(0|1)*00", ends_with("0"), "llm-unchecked", False),
        ("(0|1)*00", ends_with("00", expressible=False), "llm-unchecked", False),
        ("(0|1)*00", ends_with("2"), "llm-unchecked", False),
        ("(0|1)*00", None, "llm-unchecked", False),
    ],
)
def test_resolve(regex, p, want_source, want_trusted):
    ref = resolve_reference(regex=regex, alphabet="01", predicate=p, title="A new problem")
    assert ref.source == want_source and ref.trusted == want_trusted
    if want_source == "catalog":
        assert ref is CATALOG["starts-with-010"]
    else:
        assert ref.id == "llm:" + sha256(regex.encode()).hexdigest()[:8]
        assert ref.title == "A new problem" and ref.regex == regex
        assert ref.info().trusted == want_trusted


@pytest.mark.parametrize("regex", [None, "0^1", "0" * 201, "(0|1)*1" + "(0|1)" * 20])
def test_no_or_invalid_regex_has_no_reference(regex):
    assert (
        resolve_reference(regex=regex, alphabet="01", predicate=ends_with("00"), title=None) is None
    )


def test_check_does_not_trust_a_disagreement_at_length_12():
    p = MembershipPredicate(
        expressible=True,
        any_of=[
            Clause(
                all_of=[
                    Atom(op="length_le", text=None, symbol=None, n=11, m=None, r=None, negate=False)
                ]
            )
        ],
    )
    ref = resolve_reference(regex="Σ*", alphabet="01", predicate=p, title=None)
    assert ref.source == "llm-unchecked" and not ref.trusted


def test_check_reduces_the_bound_for_larger_alphabets():
    ref = resolve_reference(regex="Σ*00", alphabet="012", predicate=ends_with("00"), title=None)
    assert ref.source == "llm-checked" and ref.trusted
