"""The automaton contract: how Ada read the student's diagram, and what the verifier found.

It mirrors ``packages/shared/src/vision/contract.ts``, and both sides' tests check the examples in
``packages/shared/src/vision/fixtures.json``. Wire keys are snake_case, like the REST API's.

Every model forbids fields the contract doesn't declare and refuses coercion (``"0.9"`` is not a
float), so a reading or verdict either matches or is refused. Fields that may be empty are
nullable but never omitted.

Page coordinates run from 0 to 1 across the flattened page (x along its width, y along its
height), except where a field says pixels.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict

EPSILON = "ε"  # the symbol of an ε-move
DEAD = "∅"  # the implicit dead state, in traces: where a missing move goes

MachineKind = Literal["dfa", "nfa"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Pt(_Model):
    """A point in page coordinates (0–1), or in pixels where a field says so."""

    x: float
    y: float


class NormBox(_Model):
    """A box in page coordinates (0–1): its top-left corner, width and height."""

    x: float
    y: float
    w: float
    h: float


class ReadState(_Model):
    id: str
    label: str  # what she wrote inside the circle
    start: bool
    accept: bool
    center: Pt
    r: float  # the radius, as a fraction of the page width (P5-R10)
    box: NormBox
    mark: int | None  # the Set-of-Mark number it was snapped to
    snapped: bool
    confidence: float


class ReadTransition(_Model):
    id: str
    source: str  # state ids
    target: str
    symbols: list[str]  # EPSILON for an ε-move
    label_box: NormBox | None
    mark: int | None
    snapped: bool
    confidence: float


class PageGeometry(_Model):
    """The flattened page's size in pixels, and the page's quad in the full JPEG's pixels."""

    width: int
    height: int
    quad: list[Pt] | None  # TL, TR, BR, BL


class LanguageGuess(_Model):
    """The language the problem statement asks for, as a regex in Task 4's dialect."""

    regex: str | None
    confidence: float


class DfaReading(_Model):
    version: Literal[1] = 1
    frame_id: str | None  # the frame's UUID as text
    source: Literal["paper", "board", "fixture"]
    kind: MachineKind  # what she drew
    alphabet: list[str]
    states: list[ReadState]
    transitions: list[ReadTransition]
    page: PageGeometry | None
    problem: str | None  # the problem statement, as printed or written on the page
    problem_kind: MachineKind | None  # what the problem asks for
    language: LanguageGuess | None
    uncertain: list[str]  # ids of the states and transitions she should check


IssueKind = Literal[
    "implicit_dead_state",
    "nondeterminism",
    "epsilon_in_dfa",
    "missing_start",
    "multiple_starts",
    "no_accept",
    "unreachable",
    "unknown_symbol",
    "unlabeled_transition",
    "dangling_transition",
]


class Issue(_Model):
    kind: IssueKind
    states: list[str]
    symbols: list[str]


class Blame(_Model):
    """The first step of the counterexample where her machine leaves the right track (P4-R10)."""

    step: int
    kind: Literal["transition", "missing_transition", "accept_flag"]
    state: str
    symbol: str | None
    target: str | None
    prefix: str  # the input read before this step


class Counterexample(_Model):
    input: str
    direction: Literal["false_accept", "false_reject"]
    # One sorted state set per step, start included (singletons for a DFA); [DEAD] after a
    # missing move.
    student_trace: list[list[str]]
    reference_trace: list[str]
    blame: Blame | None


class Fix(_Model):
    kind: Literal["flip_accept", "redirect", "add_transition", "remove_transition"]
    state: str
    symbol: str | None
    target: str | None


class MachineSpec(_Model):
    """A complete DFA: every state has a move on every symbol."""

    states: list[str]
    alphabet: list[str]
    start: str
    accepts: list[str]
    transitions: dict[str, dict[str, str]]


class ReferenceInfo(_Model):
    id: str
    source: Literal["catalog", "llm-checked", "llm-unchecked"]
    trusted: bool
    regex: str | None
    title: str | None
    machine: MachineSpec | None


VerdictStatus = Literal["correct", "wrong", "unsure", "unknown", "unreadable"]


class DfaVerdict(_Model):
    status: VerdictStatus
    computed: bool  # an exact check against a trusted reference
    counterexample: Counterexample | None
    issues: list[Issue]
    fixes: list[Fix]
    reference: ReferenceInfo | None


AtomOp = Literal[
    "starts_with",
    "ends_with",
    "contains",
    "length_eq",
    "length_ge",
    "length_le",
    "length_mod",
    "count_eq",
    "count_ge",
    "count_le",
    "count_mod",
    "value_mod",
]


class Atom(_Model):
    """One test of a string, inverted when negate is true. Arguments the op doesn't use are null."""

    op: AtomOp
    text: str | None
    symbol: str | None
    n: int | None
    m: int | None
    r: int | None
    negate: bool


class Clause(_Model):
    """Holds when every one of its atoms holds."""

    all_of: list[Atom]


class MembershipPredicate(_Model):
    """A language as a JSON predicate, never code: a string is in it when any clause holds."""

    expressible: bool
    any_of: list[Clause]


# The JSON Schema of MembershipPredicate, for the deep check's structured output
# (output_config.format). Every object forbids extra properties and requires all of its own.
PREDICATE_SCHEMA: dict = MembershipPredicate.model_json_schema()
