"""The decision gate's port: the yes-or-no questions a cheap model answers about each moment.

The orchestrator asks the gate whenever a frame, her speech, a stall or the board changes
something, at most once per 5 s. The gate answers four predicates, always asked in English
whatever the session language, with a probability for each. The OpenAI and Clef adapters and the
fake gate implement ``DecisionGate``; the policy reads the probabilities against thresholds.
"""

from dataclasses import dataclass, field
from typing import Literal, Protocol, get_args

from tassel.models import Lang

Predicate = Literal[
    "diagram_attempt_complete",
    "new_work_worth_checking",
    "student_seems_stuck",
    "not_schoolwork",
]
PREDICATES: tuple[Predicate, ...] = get_args(Predicate)

# The questions behind the predicates, word for word: the OpenAI and Clef adapters send them as
# their instructions.
PREDICATE_QUESTIONS: dict[Predicate, str] = {
    "diagram_attempt_complete": (
        "Has the student finished an attempt at her automaton and is she ready for feedback?"
        " Yes if she says she is done or asks whether it is right; no while she is still adding"
        " to it."
    ),
    "new_work_worth_checking": (
        "Does the page show new work since the last check that is worth checking now, such as a"
        " new state, arrow or label, rather than a stray mark or nothing new?"
    ),
    "student_seems_stuck": (
        "Does the student seem stuck? Yes if her automaton looks unfinished and she has stopped"
        " writing and talking for a while."
    ),
    "not_schoolwork": (
        "Is the page or the conversation something other than schoolwork, such as a doodle, a"
        " personal note or an unrelated chat?"
    ),
}

GateReason = Literal["frame", "speech", "stall", "board"]

# No ink and no speech for this long counts as a stall, before the gate is asked about one.
# TASSEL_VISION_STALL_MS overrides it (VisionSettings.vision_stall_ms).
STALL_MS = 6000


@dataclass(frozen=True)
class TranscriptLine:
    speaker: Literal["student", "tutor"]
    text: str
    at_ms: int


@dataclass(frozen=True)
class GateInput:
    # The page as the gate sees it. Kept out of repr, so a frame never lands in a log line.
    image_jpeg: bytes | None = field(repr=False)
    transcript: tuple[TranscriptLine, ...]
    lang: Lang
    reason: GateReason
    quiet_ms: int | None  # since the pen last moved
    silence_ms: int | None  # since she last spoke
    new_ink: bool
    changed_cells: int


@dataclass(frozen=True)
class GateResult:
    probs: dict[Predicate, float]
    refused: tuple[Predicate, ...]  # predicates the provider declined to answer
    ms: int
    provider: str


class GateError(RuntimeError):
    """A gate call that failed in transport: a timeout, a refused connection, a bad response."""


class DecisionGate(Protocol):
    name: str

    async def evaluate(self, gi: GateInput) -> GateResult:
        """The four predicates for this moment. Raises ``GateError`` on transport failures."""
        ...
