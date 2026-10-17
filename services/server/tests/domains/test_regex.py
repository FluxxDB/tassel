import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from automata.fa.dfa import DFA

from tassel.domains.dfa.machine import coreachable, to_automata_dfa
from tassel.domains.dfa.regex import RegexError, compile_regex
from tassel.domains.dfa.search import accepts, shortest_counterexample


@pytest.mark.parametrize("regex", ["010(0|1)*", "010Σ*", " 0 1 0 ( 0 | 1 ) * "])
def test_dialect(regex):
    m = compile_regex(regex, "01")
    for word in ("010", "0100", "0101"):
        assert accepts(m, word)
    for word in ("", "0", "01", "1010", "011"):
        assert not accepts(m, word)
    assert m.start == "q0"
    assert tuple(s for s in m.states if s != "dead") == ("q0", "q1", "q2", "q3")
    assert set(m.states) - coreachable(m) == {"dead"}
    assert all(m.moves.get((s, a)) for s in m.states for a in m.alphabet)
    oracle = to_automata_dfa(m)
    complete = DFA(
        states=oracle.states,
        input_symbols=oracle.input_symbols,
        transitions=oracle.transitions,
        initial_state=oracle.initial_state,
        final_states=oracle.final_states,
        allow_partial=False,
    )
    assert len(complete.minify().states) == len(m.states)


def test_plus_means_one_or_more_not_union():
    m = compile_regex("(0+1)*", "01")
    assert accepts(m, "") and accepts(m, "00101")
    assert not accepts(m, "0") and not accepts(m, "1")
    assert shortest_counterexample(m, compile_regex("(0|1)*", "01")) is not None


@pytest.mark.parametrize(
    "regex", ["0^1", "0&1", "0{3}", "[01]", "\\d", "012", ".", "0)", "(0", "*0", "0|", "|0"]
)
def test_unsupported_and_malformed_regexes_are_refused(regex):
    with pytest.raises(RegexError):
        compile_regex(regex, "01")


@pytest.mark.parametrize(
    "regex,words", [("ε", {""}), ("ε|0", {"", "0"}), ("(ε)*", {""}), ("0?", {"", "0"})]
)
def test_empty_string_and_optional(regex, words):
    m = compile_regex(regex, "01")
    for word in ("", "0", "1", "00", "01"):
        assert accepts(m, word) == (word in words)


def test_pathological_regex_is_refused():
    with ThreadPoolExecutor(max_workers=1) as worker:
        for regex, message in [("(0|1)*1" + "(0|1)" * 20, "too large"), ("0" * 201, "too long")]:
            started = time.monotonic()
            with pytest.raises(RegexError, match=message):
                worker.submit(compile_regex, regex, "01").result(timeout=2)
            assert time.monotonic() - started < 2


def test_nfa_size_cap_after_sigma_expansion():
    with pytest.raises(RegexError, match="too large"):
        compile_regex("Σ" * 81, "01")


def test_length_counts_after_whitespace_removal():
    assert accepts(compile_regex(" 0 " * 200, "01"), "0" * 200)


@pytest.mark.parametrize("alphabet", [["00"], [""], ["*"], ["ε"], ["Σ"], [" "], ["\\"]])
def test_alphabet_cannot_inject_regex_syntax(alphabet):
    with pytest.raises(RegexError):
        compile_regex("Σ", alphabet)


def test_empty_alphabet_has_epsilon_but_no_sigma():
    assert accepts(compile_regex("ε", []), "")
    with pytest.raises(RegexError):
        compile_regex("Σ", [])


def test_nonbinary_alphabet():
    m = compile_regex("aΣ?", ["b", "a"])
    assert m.alphabet == ("a", "b")
    assert accepts(m, "a") and accepts(m, "ab") and accepts(m, "aa")
    assert not accepts(m, "ba")
