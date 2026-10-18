"""Shared gate context, explicit rule-based fake, selection and calibrated thresholds.

Transcript timestamps use monotonic milliseconds, like the vision orchestrator. Offline
replays must rebase their transcript timestamps to that clock before evaluating a gate.
The orchestrator owns the five-second scheduling limit; adapters never sleep or retry.
"""

import json
import time
from pathlib import Path

from tassel.models import Lang
from tassel.vision.ports import (
    PREDICATES,
    STALL_MS,
    DecisionGate,
    GateInput,
    GateReason,
    GateResult,
    Predicate,
    TranscriptLine,
)
from tassel.vision.settings import VisionSettings, resolve_vision_mode

GATE_MIN_INTERVAL_MS = 5000

_LANGUAGES: dict[Lang, str] = {"en": "English", "es": "Spanish", "ko": "Korean"}
_REASONS: dict[GateReason, str] = {
    "frame": "new ink appeared",
    "speech": "she just said something",
    "stall": "no new ink and no speech for a while",
    "board": "she edited the board",
}


def _recent_lines(gi: GateInput, window_ms: int) -> list[TranscriptLine]:
    now_ms = int(time.monotonic() * 1000)
    return sorted(
        (line for line in gi.transcript if 0 <= now_ms - line.at_ms <= window_ms),
        key=lambda line: line.at_ms,
    )


def _seconds(ms: int | None) -> str:
    return "unknown" if ms is None else f"{ms / 1000:g}"


def gate_text(gi: GateInput) -> str:
    """English context and the last twenty seconds of conversation, oldest first."""
    lines = [
        "A student is working on paper during a live tutoring session on automata "
        "(states drawn as circles, transitions as arrows).",
        f"Session language: {_LANGUAGES[gi.lang]}. The transcript is in that language.",
        f"Asked because: {_REASONS[gi.reason]}.",
        f"Seconds since new ink: {_seconds(gi.quiet_ms)}. "
        f"Seconds since she last spoke: {_seconds(gi.silence_ms)}. "
        f"New ink since the last check: {'yes' if gi.new_ink else 'no'}.",
        "Transcript, last 20 seconds, oldest first:",
    ]
    lines.extend(
        f"{'Student' if line.speaker == 'student' else 'Ada'}: {line.text}"
        for line in _recent_lines(gi, 20000)
    )
    return "\n".join(lines)


class FakeGate:
    name = "fake"
    DONE_PHRASES: dict[Lang, tuple[str, ...]] = {
        "en": (
            "i think i'm done",
            "i'm done",
            "i think that's it",
            "that's it",
            "i'm finished",
            "is it right",
            "is this right",
        ),
        "es": (
            "creo que ya está",
            "ya está",
            "terminé",
            "he terminado",
            "listo",
            "está bien así",
            "¿está bien?",
        ),
        "ko": ("다 했어요", "다 됐어요", "끝났어요", "이게 다예요", "맞아요?", "맞나요"),
    }

    def __init__(self, *, stall_ms: int = STALL_MS):
        self._stall_ms = stall_ms

    async def evaluate(self, gi: GateInput) -> GateResult:
        complete = any(
            phrase in line.text.casefold()
            for line in _recent_lines(gi, 15000)
            if line.speaker == "student"
            for phrase in self.DONE_PHRASES[gi.lang]
        )
        stuck = (
            gi.quiet_ms is not None
            and gi.quiet_ms >= self._stall_ms
            and gi.silence_ms is not None
            and gi.silence_ms >= self._stall_ms
        )
        return GateResult(
            probs={
                "diagram_attempt_complete": 0.9 if complete else 0.1,
                "new_work_worth_checking": 0.8 if gi.new_ink and gi.changed_cells >= 2 else 0.1,
                "student_seems_stuck": 0.85 if stuck else 0.1,
                "not_schoolwork": 0.05,
            },
            refused=(),
            ms=0,
            provider=self.name,
        )


def _probability(value: object) -> float:
    """Reject malformed, non-finite and out-of-range probabilities without echoing data."""
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not 0 <= value <= 1:
        raise ValueError("expected a probability between zero and one")
    return float(value)


def load_thresholds(path: Path, gate_name: str) -> dict[Predicate, float]:
    body = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(body, dict) or body.get("version") != 1:
        raise ValueError("unsupported gate thresholds version")
    values = body.get(gate_name)
    if not isinstance(values, dict) or set(values) != set(PREDICATES):
        raise ValueError("gate thresholds must contain all four predicates")
    return {p: _probability(values[p]) for p in PREDICATES}


def make_gate(s: VisionSettings) -> DecisionGate:
    if resolve_vision_mode("gate", s) == "fake":
        return FakeGate(stall_ms=s.vision_stall_ms)
    if s.gate_live == "clef":
        from tassel.vision.gate_clef import ClefGate

        assert s.vultr_inference_api_key is not None  # checked by resolve_vision_mode
        return ClefGate(
            api_key=s.vultr_inference_api_key,
            model=s.clef_model,
            timeout_s=s.gate_timeout_s,
        )
    from tassel.vision.gate_openai import OpenAIDecisionsGate

    assert s.openai_api_key is not None
    return OpenAIDecisionsGate(
        api_key=s.openai_api_key,
        model=s.gate_model,
        timeout_s=s.gate_timeout_s,
    )
