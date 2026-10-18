"""The whiteboard ladder: one stored rung per problem, so "no" after Ada's question moves her up
instead of starting over (owner, 2026-10-18). The old confusion counter reset on every "no".

- Step 0, diagnose and ask: Ada finds the error silently and asks her to spot it. No board.
- Step 1, show hers: "Okay, let me help you out." Ada redraws HER work on the board, highlights
  what matters and steps one breaking input through it, then asks her to fix it.
- Step 2, show the correct one: the correct machine (or diagram), with a correct input traced.

The problem is her page (``"paper"``) or the board (``"board"``). The ladder starts over when she
asks for a check again, when her ink changes past the notes' threshold, or when she asks for
something new; the director (``director.escalate``) routes each turn from it, and the coordinator
(``thinker.TutorCoordinator``) records the rung each brief did."""

import re
from dataclasses import dataclass

import numpy as np

TOP = 2
# How much of her page's ink signature changes before it is new work: the notes' threshold.
INK_CHANGE = 0.015

# "Can you take a look at my DFA?", "is it right?", "check my work": a diagnosis of her own work.
CHECK = re.compile(
    r"\b(?:(?:take|have) a (?:quick )?look at|look (?:at|over)|check|review|go over)\s+"
    r"(?:my|this|it|what I)\b|"
    r"\bis (?:it|this|that|my \w+) (?:right|correct|okay|ok)\b|"
    r"\bdoes (?:it|this|that|my \w+) (?:work|look right)\b|"
    r"\b(?:any|are there) (?:mistakes|errors)\b|"
    r"\bwhat'?s wrong with (?:it|this|my)\b",
    re.I,
)
# She can't do what Ada asked: "I can't see it", "not sure", "I don't know", "I don't get it".
STUCK = re.compile(
    r"\b(?:i )?(?:can'?t|cannot|couldn'?t) (?:see|spot|find|tell|figure)\b|"
    r"\bi (?:still )?(?:don'?t|do not) (?:really |quite )?(?:see|know|get|understand|follow)\b|"
    r"\b(?:not sure|no idea|no clue|i'?m (?:lost|stuck|confused)|confus\w*|"
    r"what do you mean|makes? no sense|help me|can you help|give me a hint|i give up|"
    r"how (?:do|would|should) i fix)\b",
    re.I,
)
# A bare "no" to Ada's question; "No, is it q3?" is an attempt instead.
NO = re.compile(r"^\W*(?:no|nope|nah|not really)\b", re.I)


def checking(text: str) -> bool:
    return bool(CHECK.search(text))


def failed(text: str) -> bool:
    """She couldn't answer Ada's ladder question."""
    return bool(STUCK.search(text)) or (bool(NO.search(text)) and "?" not in text)


@dataclass
class Ladder:
    # "paper" or "board": what the ladder is about; None when no ladder is open.
    problem: str | None = None
    # The rung Ada last did for this problem.
    step: int | None = None
    # This turn's rung and whether it answers an attempt, set by the director and taken once.
    turn: int | None = None
    attempt: bool = False
    # Her page's ink signature when the ladder began (``thinker.ink_signature``).
    ink: np.ndarray | None = None

    @property
    def open(self) -> bool:
        return self.problem is not None

    def begin(self, problem: str, step: int = 0) -> None:
        self.problem, self.step, self.ink = problem, None, None
        self.turn, self.attempt = step, False

    def climb(self, *, attempt=False, to: int | None = None) -> None:
        done = self.step if self.step is not None else 0
        self.turn = min(TOP, to if to is not None else done + 1)
        self.attempt = attempt

    def take(self) -> tuple[int | None, bool]:
        """This turn's rung for the coordinator, once."""
        rung = (self.turn, self.attempt)
        self.turn, self.attempt = None, False
        return rung

    def record(self, rung: int | None, attempt: bool, brief) -> None:
        """What the brief did on this rung: an attempt answered without drawing was right."""
        if rung is None or not self.open:
            return
        if attempt and not (brief.board or getattr(brief, "draw", None)):
            self.reset()
            return
        self.step = rung

    def see(self, ink) -> bool:
        """Her page's ink on a turn: True, and the ladder is closed, when it changed past the
        notes' threshold since the ladder began (she changed her work)."""
        if ink is None or self.problem != "paper":
            return False
        if self.ink is None or self.ink.shape != ink.shape:
            self.ink = ink
            return False
        if float(np.mean(ink != self.ink)) > INK_CHANGE:
            self.reset()
            return True
        return False

    def reset(self) -> None:
        self.problem = self.step = self.turn = self.ink = None
        self.attempt = False
