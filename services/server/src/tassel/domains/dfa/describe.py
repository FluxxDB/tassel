"""Compact English context for the tutor; no locale-dependent machine logic."""

from tassel.domains.dfa.contract import DEAD
from tassel.domains.dfa.machine import Machine


def describe_machine(m: Machine) -> str:
    # A drawn path without an accept flag still belongs in the description. Only
    # explicit absorbing reject sinks (and implicit DEAD) can be left out.
    sinks = {DEAD}
    for state in m.states:
        if (
            state not in m.accepts
            and m.alphabet
            and all(m.moves.get((state, symbol)) == frozenset({state}) for symbol in m.alphabet)
            and all(
                targets <= {state} for (source, _), targets in m.moves.items() if source == state
            )
        ):
            sinks.add(state)
    groups: dict[tuple[str, str], list[str]] = {}
    goes_dead = False
    for state in m.states:
        for symbol in sorted({a for source, a in m.moves if source == state} | set(m.alphabet)):
            targets = m.moves.get((state, symbol), frozenset({DEAD}))
            if not targets:
                targets = frozenset({DEAD})
            for target in sorted(targets):
                if target in sinks:
                    goes_dead = True
                else:
                    groups.setdefault((state, target), []).append(symbol)
    text = ", ".join(
        f"{s} -{','.join(sorted(symbols))}-> {t}" for (s, t), symbols in groups.items()
    )
    text += "; accepting: " + (", ".join(s for s in m.states if s in m.accepts) or "none")
    if goes_dead:
        text += "; every other move goes to a dead state"
    return text


def describe_trace(word: str, trace: list[list[str]]) -> str:
    if len(trace) != len(word) + 1:
        raise ValueError("a trace needs a start and one state set per symbol")

    def show(states: list[str]) -> str:
        return states[0] if len(states) == 1 else "{" + ",".join(sorted(states)) + "}"

    return show(trace[0]) + "".join(
        f" -{a}-> {show(states)}" for a, states in zip(word, trace[1:], strict=True)
    )
