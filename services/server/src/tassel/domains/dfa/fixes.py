"""Try single edits and retain only those that prove language equivalence."""

from dataclasses import replace

from tassel.domains.dfa.contract import DEAD, Fix
from tassel.domains.dfa.machine import Machine
from tassel.domains.dfa.search import shortest_counterexample


def one_edit_fixes(student: Machine, reference: Machine, *, limit: int = 3) -> list[Fix]:
    assert student.deterministic and reference.deterministic, "fixes require DFAs"
    assert student.alphabet == reference.alphabet, "fixes require the same alphabet"
    if limit <= 0:
        return []
    fixes = []
    for state in student.states:
        candidate = replace(student, accepts=student.accepts ^ {state})
        if shortest_counterexample(candidate, reference) is None:
            fixes.append(Fix(kind="flip_accept", state=state, symbol=None, target=None))
            if len(fixes) >= limit:
                return fixes
    for state in student.states:
        for symbol in student.alphabet:
            old = student.next(state, symbol)
            for target in (*student.states, DEAD):
                if target == old:
                    continue
                moves = dict(student.moves)
                if target == DEAD:
                    moves.pop((state, symbol), None)
                    kind = "remove_transition"
                else:
                    moves[state, symbol] = frozenset({target})
                    kind = "add_transition" if old == DEAD else "redirect"
                if shortest_counterexample(replace(student, moves=moves), reference) is None:
                    fixes.append(
                        Fix(
                            kind=kind,
                            state=state,
                            symbol=symbol,
                            target=None if target == DEAD else target,
                        )
                    )
                    if len(fixes) >= limit:
                        return fixes
    return fixes
