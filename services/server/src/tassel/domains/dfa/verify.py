"""The DFA domain's exact verdict, with reference trust kept separate from evidence."""

from tassel.domains.base import Verifier
from tassel.domains.dfa.contract import DfaReading, DfaVerdict
from tassel.domains.dfa.fixes import one_edit_fixes
from tassel.domains.dfa.machine import TooLarge, determinize, machine_from_reading
from tassel.domains.dfa.reference import Reference
from tassel.domains.dfa.search import find_counterexample


def verify(reading: DfaReading, reference: Reference | None) -> DfaVerdict:
    info = reference.info() if reference is not None else None
    result = DfaVerdict(
        status="unreadable",
        computed=False,
        counterexample=None,
        issues=[],
        fixes=[],
        reference=info,
    )
    if not reading.states:
        return result
    parsed = machine_from_reading(
        reading, alphabet=reference.machine.alphabet if reference else None
    )
    result.issues = list(parsed.issues)
    if reference is None:
        result.status = "unknown"
        return result
    student = parsed.machine
    if student.start is None:
        return result
    subsets = None
    if not student.deterministic:
        try:
            student, subsets = determinize(student)
        except TooLarge:
            return result
    result.counterexample = find_counterexample(student, reference.machine, subsets=subsets)
    result.computed = reference.trusted
    result.status = (
        ("wrong" if result.counterexample else "correct") if reference.trusted else "unsure"
    )
    if (
        reference.trusted
        and result.counterexample is not None
        and parsed.machine.deterministic
        and len(parsed.machine.states) <= 12
    ):
        result.fixes = one_edit_fixes(parsed.machine, reference.machine)
    return result


class _DfaVerifier:
    subject = "automata.dfa"
    verify = staticmethod(verify)


DFA_VERIFIER: Verifier = _DfaVerifier()
