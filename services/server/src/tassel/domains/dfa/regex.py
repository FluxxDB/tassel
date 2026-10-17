"""The small tutoring regex dialect, bounded before subset construction."""

from collections import deque
from collections.abc import Sequence

from automata.base.exceptions import AutomatonException, RegexException
from automata.fa.dfa import DFA
from automata.fa.nfa import NFA

from tassel.domains.dfa.machine import (
    Machine,
    TooLarge,
    coreachable,
    determinize,
    machine_from_automata_nfa,
    to_spec,
)

MAX_REGEX_LEN = 200
MAX_NFA_STATES = 400
_OPERATORS = frozenset("|*+?()εΣ")
_FORBIDDEN = frozenset("[]\\&^{}.")


class RegexError(ValueError):
    """An invalid or oversized expression in the tutoring dialect."""


def compile_regex(regex: str, alphabet: Sequence[str]) -> Machine:
    rx = "".join(regex.split())
    if len(rx) > MAX_REGEX_LEN:
        raise RegexError("too long")
    symbols = tuple(sorted(set(alphabet)))
    if any(len(s) != 1 or s.isspace() or s in _OPERATORS | _FORBIDDEN for s in symbols):
        raise RegexError("alphabet must contain single literal characters")
    if set(rx) & _FORBIDDEN:
        raise RegexError("unsupported operator")
    if set(rx) - set(symbols) - _OPERATORS:
        raise RegexError("symbol outside alphabet")
    if "Σ" in rx and not symbols:
        raise RegexError("Σ needs a nonempty alphabet")
    # Each literal needs two NFA states. Bound expansion before allocating a large Σ union.
    literals = sum(len(symbols) if ch == "Σ" else ch in symbols for ch in rx)
    if 2 * literals > MAX_NFA_STATES:
        raise RegexError("too large")
    rx = rx.replace("ε", "()").replace("Σ", "(" + "|".join(symbols) + ")")
    try:
        nfa = NFA.from_regex(rx, input_symbols=set(symbols))
        if len(nfa.states) > MAX_NFA_STATES:
            raise RegexError("too large")
        machine, _ = determinize(machine_from_automata_nfa(nfa))
        spec = to_spec(machine)
        # allow_partial=False keeps the rejecting sink through minimization.
        minimal = DFA(
            states=set(spec.states),
            input_symbols=set(symbols),
            transitions=spec.transitions,
            initial_state=spec.start,
            final_states=set(spec.accepts),
            allow_partial=False,
        ).minify()
    except TooLarge as exc:
        raise RegexError("too large") from exc
    except (RegexException, AutomatonException) as exc:
        raise RegexError("invalid regex") from exc

    m = Machine(
        tuple(str(s) for s in minimal.states),
        symbols,
        str(minimal.initial_state),
        frozenset(str(s) for s in minimal.final_states),
        {
            (str(s), a): frozenset({str(t)})
            for s, row in minimal.transitions.items()
            for a, t in row.items()
        },
    )
    live = coreachable(m)
    names = {m.start: "q0" if m.start in live else "dead"}
    next_index = int(m.start in live)
    pending = deque([m.start])
    while pending:
        source = pending.popleft()
        for symbol in symbols:
            target = m.next(source, symbol)
            if target not in names:
                names[target] = f"q{next_index}" if target in live else "dead"
                next_index += int(target in live)
                pending.append(target)
    return Machine(
        tuple(names.values()),
        symbols,
        names[m.start],
        frozenset(names[s] for s in m.accepts),
        {(names[s], a): frozenset({names[m.next(s, a)]}) for s in names for a in symbols},
    )
