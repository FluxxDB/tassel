"""Pure automaton operations, with missing moves represented by the implicit DEAD state.

No provider, fixture or session state belongs here. Callers run CPU work off the event loop.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType

from tassel.domains.dfa.contract import DEAD, EPSILON, DfaReading, Issue, MachineSpec

MAX_DFA_STATES = 512
DETERMINIZE_BUDGET_S = 1.0


@dataclass(frozen=True)
class Machine:
    states: tuple[str, ...]
    alphabet: tuple[str, ...]
    start: str | None
    accepts: frozenset[str]
    moves: Mapping[tuple[str, str], frozenset[str]]
    _deterministic: bool = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        if DEAD in self.states:
            raise ValueError(f"{DEAD} is reserved for the implicit dead state")
        object.__setattr__(self, "states", tuple(self.states))
        object.__setattr__(self, "alphabet", tuple(sorted(set(self.alphabet))))
        object.__setattr__(self, "accepts", frozenset(self.accepts))
        moves = {key: frozenset(targets) for key, targets in self.moves.items()}
        object.__setattr__(self, "moves", MappingProxyType(moves))
        # next() is on the search hot path: compute this once on the immutable machine.
        object.__setattr__(
            self,
            "_deterministic",
            self.start is not None
            and all(
                len(targets) <= 1 and (symbol != EPSILON or not targets)
                for (_, symbol), targets in moves.items()
            ),
        )

    @property
    def deterministic(self) -> bool:
        return self._deterministic

    def next(self, state: str, symbol: str) -> str:
        """Take a DFA step; an absent move and every step from DEAD stay dead."""
        if not self.deterministic:
            raise ValueError("next needs a deterministic machine with a start state")
        if state == DEAD:
            return DEAD
        return next(iter(self.moves.get((state, symbol), ())), DEAD)


@dataclass(frozen=True)
class Parsed:
    machine: Machine
    issues: tuple[Issue, ...]


def machine_from_reading(reading: DfaReading, *, alphabet: Sequence[str] | None = None) -> Parsed:
    symbols = tuple(sorted(set(reading.alphabet if alphabet is None else alphabet)))
    states = tuple(state.id for state in reading.states)
    state_set = set(states)
    starts = [state.id for state in reading.states if state.start]
    accepts = frozenset(state.id for state in reading.states if state.accept)
    moves: dict[tuple[str, str], set[str]] = defaultdict(set)
    unknown, unlabeled, dangling = [], [], []
    for transition in reading.transitions:
        endpoints = list(dict.fromkeys((transition.source, transition.target)))
        bad_symbols = sorted(set(transition.symbols) - set(symbols) - {EPSILON})
        if bad_symbols:
            unknown.append(
                Issue(kind="unknown_symbol", states=[transition.source], symbols=bad_symbols)
            )
        if not transition.symbols:
            unlabeled.append(Issue(kind="unlabeled_transition", states=endpoints, symbols=[]))
        valid_endpoints = transition.source in state_set and transition.target in state_set
        if not valid_endpoints:
            dangling.append(
                Issue(
                    kind="dangling_transition",
                    states=endpoints,
                    symbols=sorted(set(transition.symbols)),
                )
            )
        if valid_endpoints:
            for symbol in transition.symbols:
                if symbol in symbols or symbol == EPSILON:
                    moves[transition.source, symbol].add(transition.target)

    m = Machine(states, symbols, starts[0] if starts else None, accepts, moves)
    issues = unknown + unlabeled + dangling
    if not starts:
        issues.append(Issue(kind="missing_start", states=[], symbols=[]))
    elif len(starts) > 1:
        issues.append(Issue(kind="multiple_starts", states=starts, symbols=[]))
    if not accepts:
        issues.append(Issue(kind="no_accept", states=[], symbols=[]))
    for state in states:
        for symbol in (*symbols, EPSILON):
            if len(m.moves.get((state, symbol), ())) > 1:
                issues.append(Issue(kind="nondeterminism", states=[state], symbols=[symbol]))
    if reading.kind == "dfa" or reading.problem_kind == "dfa":
        for state in states:
            if m.moves.get((state, EPSILON)):
                issues.append(Issue(kind="epsilon_in_dfa", states=[state], symbols=[EPSILON]))
    reached = reachable(m)
    unreached = [state for state in states if state not in reached]
    if unreached:
        issues.append(Issue(kind="unreachable", states=unreached, symbols=[]))
    for state in states:
        missing = [symbol for symbol in symbols if not m.moves.get((state, symbol))]
        if missing:
            issues.append(Issue(kind="implicit_dead_state", states=[state], symbols=missing))
    return Parsed(m, tuple(issues))


def machine_from_spec(spec: MachineSpec) -> Machine:
    return Machine(
        tuple(spec.states),
        tuple(spec.alphabet),
        spec.start,
        frozenset(spec.accepts),
        {
            (state, symbol): frozenset({target})
            for state, row in spec.transitions.items()
            for symbol, target in row.items()
        },
    )


def _require_dfa(m: Machine) -> None:
    if m.start is None:
        raise ValueError("a DFA needs a start state")
    if not m.deterministic:
        raise ValueError("a DFA cannot have epsilon moves or multiple targets")


def _unused_name(base: str, occupied: Iterable[str]) -> str:
    occupied = set(occupied)
    name, suffix = base, 1
    while name in occupied:
        name = f"{base}#{suffix}"
        suffix += 1
    return name


def to_spec(m: Machine) -> MachineSpec:
    """Export a complete DFA, adding a rejecting sink only if there are missing moves."""
    _require_dfa(m)
    dead = _unused_name("dead", m.states)
    transitions = {
        state: {symbol: m.next(state, symbol) for symbol in m.alphabet} for state in m.states
    }
    needs_dead = any(DEAD in row.values() for row in transitions.values())
    if needs_dead:
        transitions = {
            state: {symbol: dead if target == DEAD else target for symbol, target in row.items()}
            for state, row in transitions.items()
        }
        transitions[dead] = dict.fromkeys(m.alphabet, dead)
    return MachineSpec(
        states=[*m.states, *([dead] if needs_dead else [])],
        alphabet=list(m.alphabet),
        start=m.start,
        accepts=[state for state in m.states if state in m.accepts],
        transitions=transitions,
    )


def epsilon_closure(m: Machine, states: Iterable[str]) -> frozenset[str]:
    seen = set(states)
    pending = list(seen)
    while pending:
        for target in m.moves.get((pending.pop(), EPSILON), ()):
            if target not in seen:
                seen.add(target)
                pending.append(target)
    return frozenset(seen)


class TooLarge(ValueError):
    """Subset construction exceeded its state cap or wall-clock budget."""


def determinize(
    m: Machine,
    *,
    max_states: int = MAX_DFA_STATES,
    budget_s: float = DETERMINIZE_BUDGET_S,
) -> tuple[Machine, dict[str, frozenset[str]]]:
    if m.start is None:
        raise ValueError("determinization needs a start state")
    if m.deterministic:
        return m, {state: frozenset({state}) for state in m.states}

    started = time.monotonic()
    names: dict[frozenset[str], str] = {}
    subsets: dict[str, frozenset[str]] = {}
    pending: deque[frozenset[str]] = deque()

    def add(subset: frozenset[str]) -> str:
        if subset in names:
            return names[subset]
        count = len(names) + 1
        if count > max_states:
            raise TooLarge(f"determinization exceeds {max_states} states")
        if count % 64 == 0 and time.monotonic() - started >= budget_s:
            raise TooLarge(f"determinization exceeds its {budget_s:g}s budget")
        if len(subset) == 1:
            name = next(iter(subset))
        else:
            base = "{" + ",".join(sorted(subset)) + "}"
            # A student's literal '{a,b}' state must not alias the subset {a, b}.
            name = _unused_name(base, (*m.states, *subsets))
        names[subset] = name
        subsets[name] = subset
        pending.append(subset)
        return name

    start = add(epsilon_closure(m, [m.start]))
    moves: dict[tuple[str, str], frozenset[str]] = {}
    accepts = set()
    while pending:
        subset = pending.popleft()
        source = names[subset]
        if subset & m.accepts:
            accepts.add(source)
        for symbol in m.alphabet:
            targets = epsilon_closure(
                m, (target for state in subset for target in m.moves.get((state, symbol), ()))
            )
            if targets:  # The empty subset stays implicit, as DEAD.
                moves[source, symbol] = frozenset({add(targets)})
    return Machine(tuple(subsets), m.alphabet, start, frozenset(accepts), moves), subsets


def machine_from_automata_nfa(nfa: automata.fa.nfa.NFA) -> Machine:  # noqa: F821
    """Adapt automata-lib without importing it on the production parsing path."""
    states = sorted(nfa.states, key=lambda state: (str(state), type(state).__name__))
    labels = [str(state) for state in states]
    # automata-lib also accepts non-string states; str(1) and str('1') may collide.
    if DEAD in labels or len(set(labels)) != len(labels):
        labels = [f"q{i}" for i in range(len(states))]
    names = dict(zip(states, labels, strict=True))
    return Machine(
        tuple(labels),
        tuple(sorted(nfa.input_symbols)),
        names[nfa.initial_state],
        frozenset(names[state] for state in nfa.final_states),
        {
            (names[state], EPSILON if symbol == "" else symbol): frozenset(
                names[target] for target in targets
            )
            for state, row in nfa.transitions.items()
            for symbol, targets in row.items()
        },
    )


def _walk(seeds: Iterable[str], edges: Mapping[str, set[str]]) -> frozenset[str]:
    seen = set(seeds)
    pending = list(seen)
    while pending:
        for target in edges.get(pending.pop(), ()):
            if target not in seen:
                seen.add(target)
                pending.append(target)
    return frozenset(seen)


def reachable(m: Machine) -> frozenset[str]:
    edges: dict[str, set[str]] = defaultdict(set)
    for (state, _), targets in m.moves.items():
        edges[state].update(targets)
    return _walk([m.start] if m.start is not None else [], edges)


def coreachable(m: Machine) -> frozenset[str]:
    edges: dict[str, set[str]] = defaultdict(set)
    for (state, _), targets in m.moves.items():
        for target in targets:
            edges[target].add(state)
    return _walk(m.accepts, edges)


def to_automata_dfa(m: Machine) -> automata.fa.dfa.DFA:  # noqa: F821
    """Convert a DFA for use as a language-equivalence oracle in tests."""
    from automata.fa.dfa import DFA

    _require_dfa(m)
    return DFA(
        states=set(m.states),
        input_symbols=set(m.alphabet),
        transitions={
            state: {
                symbol: m.next(state, symbol)
                for symbol in m.alphabet
                if m.next(state, symbol) != DEAD
            }
            for state in m.states
        },
        initial_state=m.start,
        final_states=set(m.accepts),
        allow_partial=True,
    )
