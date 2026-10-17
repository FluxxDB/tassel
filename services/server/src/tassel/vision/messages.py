"""The vision events between the server and the desktop app, beside P2's voice events.

They mirror ``packages/shared/src/vision/contract.ts``, and both sides' tests check the examples
in ``packages/shared/src/vision/fixtures.json``. The models are P2's style (a local ``_Message``
base that forbids undeclared fields and refuses coercion), so this module doesn't import P2's
voice contract; Task 14 adds these events to P2's unions.

- ``ReadbackEvent``: the reading Ada shows on the board ("How I read your DFA") and its verdict.
- ``VisionDebugEvent``: one gate call, check or policy decision, for the HUD.
- ``PenEvent``: the app's report of whether her pen is moving on the page.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from tassel.domains.dfa.contract import DfaReading, DfaVerdict, VerdictStatus
from tassel.vision.ports import GateReason, Predicate

# The escalation ladder, in order. It never jumps to the solution unprompted.
Rung = Literal["hint", "guiding_question", "counterexample", "walkthrough", "solution"]


class _Message(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ReadbackEvent(_Message):
    """Server to app. Both null clear the board's reading (a new page or a new problem)."""

    kind: Literal["readback"] = "readback"
    reading: DfaReading | None
    verdict: DfaVerdict | None


class GateDebug(_Message):
    stage: Literal["gate"] = "gate"
    reason: GateReason
    probs: dict[Predicate, float]
    ms: int
    provider: str


class CheckDebug(_Message):
    stage: Literal["check"] = "check"
    status: VerdictStatus | Literal["failed", "refused", "timeout"]
    witness: str | None  # the counterexample's input
    blame: str | None  # the blamed step as text, such as "q0 -1-> q0"
    ms: int


class PolicyDebug(_Message):
    stage: Literal["policy"] = "policy"
    action: Literal["hold", "speak", "drop", "holding-line"]
    rung: Rung | None
    why: str


class VisionDebugEvent(_Message):
    """Server to app, for the HUD: one stage of the vision loop."""

    kind: Literal["vision-debug"] = "vision-debug"
    debug: Annotated[GateDebug | CheckDebug | PolicyDebug, Field(discriminator="stage")]


class PenEvent(_Message):
    """App to server: whether her pen is moving on the page."""

    kind: Literal["pen"] = "pen"
    busy: bool
