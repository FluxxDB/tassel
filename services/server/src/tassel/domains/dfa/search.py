"""Shortest distinguishing words and traces, without enumerating a language's words."""

from collections import deque
from collections.abc import Mapping
from typing import Literal

from tassel.domains.dfa.contract import DEAD, Blame, Counterexample
from tassel.domains.dfa.machine import Machine, coreachable


def _compatible(student: Machine, reference: Machine) -> None:
    assert student.deterministic and reference.deterministic, "search requires DFAs"
    assert student.alphabet == reference.alphabet, "search requires the same alphabet"


def access_strings(m: Machine) -> dict[str, str]:
    """The shortlex-first word reaching each state, including DEAD if reachable."""
    assert m.deterministic, "access strings require a DFA"
    words = {m.start: ""}
    pending = deque([m.start])
    while pending:
        state = pending.popleft()
        for symbol in m.alphabet:
            target = m.next(state, symbol)
            if target not in words:
                words[target] = words[state] + symbol
                pending.append(target)
    return words


def run(m: Machine, word: str) -> list[str]:
    assert m.deterministic, "traces require a DFA"
    trace = [m.start]
    for symbol in word:
        trace.append(m.next(trace[-1], symbol))
    return trace


def accepts(m: Machine, word: str) -> bool:
    return run(m, word)[-1] in m.accepts


def shortest_counterexample(
    student: Machine,
    reference: Machine,
) -> tuple[str, Literal["false_accept", "false_reject"]] | None:
    _compatible(student, reference)
    start = (student.start, reference.start)
    parents = {start: None}
    pending = deque([start])
    while pending:
        pair = pending.popleft()
        s, r = pair
        if (s in student.accepts) != (r in reference.accepts):
            symbols = []
            current = pair
            while parents[current] is not None:
                current, symbol = parents[current]
                symbols.append(symbol)
            return "".join(reversed(symbols)), (
                "false_accept" if s in student.accepts else "false_reject"
            )
        for symbol in student.alphabet:
            target = (student.next(s, symbol), reference.next(r, symbol))
            if target not in parents:
                parents[target] = (pair, symbol)
                pending.append(target)
    return None


def blame(student: Machine, reference: Machine, word: str) -> Blame | None:
    _compatible(student, reference)
    student_trace, reference_trace = run(student, word), run(reference, word)
    if (student_trace[-1] in student.accepts) == (reference_trace[-1] in reference.accepts):
        return None
    live = coreachable(reference)
    roles = {}
    for state, access in access_strings(student).items():
        target = run(reference, access)[-1]
        roles[state] = target if target in live else None
    roles[DEAD] = None
    for i, symbol in enumerate(word, start=1):
        source, target = student_trace[i - 1 : i + 1]
        reference_target = reference_trace[i]
        normalized = reference_target if reference_target in live else None
        if roles[target] != normalized:
            missing = target == DEAD and not student.moves.get((source, symbol))
            return Blame(
                step=i,
                kind="missing_transition" if missing else "transition",
                state=source,
                symbol=symbol,
                target=None if missing else target,
                prefix=word[: i - 1],
            )
    return Blame(
        step=len(word),
        kind="accept_flag",
        state=student_trace[-1],
        symbol=None,
        target=None,
        prefix=word,
    )


def find_counterexample(
    student: Machine,
    reference: Machine,
    *,
    subsets: Mapping[str, frozenset[str]] | None = None,
) -> Counterexample | None:
    result = shortest_counterexample(student, reference)
    if result is None:
        return None
    word, direction = result
    trace = run(student, word)
    return Counterexample(
        input=word,
        direction=direction,
        student_trace=[
            sorted(subsets[state]) if subsets is not None and state != DEAD else [state]
            for state in trace
        ],
        reference_trace=run(reference, word),
        blame=blame(student, reference, word),
    )
