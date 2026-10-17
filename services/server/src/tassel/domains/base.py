"""What every tutoring domain shares: the kind of claim Ada makes, and the verifier it plugs in.

Spec §5.3 leaves room for domains beyond automata. A claim is ``computed`` when an exact verifier
proved it (a DFA against a trusted reference), and ``judged`` when it rests on a model's judgment.
"""

from typing import Any, Literal, Protocol, runtime_checkable

ClaimKind = Literal["computed", "judged"]


@runtime_checkable
class Verifier(Protocol):
    """Checks a reading of the student's work against a reference, for one subject."""

    subject: str  # for example "automata.dfa"

    def verify(self, reading: Any, reference: Any) -> object: ...
