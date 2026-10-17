"""Hand-labeled moments, with recorded timestamps preserved until evaluation."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from tassel.models import Lang
from tassel.vision.clips import ensure_clip, frame_at
from tassel.vision.page import GATE_LONG_SIDE, encode_jpeg, flatten_page, resized
from tassel.vision.ports import PREDICATES, GateInput, GateReason, Predicate, TranscriptLine

SYNTHETIC_SET = Path(__file__).with_name("evalsets") / "synthetic.json"


@dataclass(frozen=True)
class LabeledMoment:
    id: str
    variant: str
    at_ms: int
    lang: Lang
    reason: GateReason
    transcript: tuple[TranscriptLine, ...]
    quiet_ms: int | None
    silence_ms: int | None
    new_ink: bool
    changed_cells: int
    labels: dict[Predicate, bool | None]


class _Exact(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", hide_input_in_errors=True)


class _Line(_Exact):
    speaker: Literal["student", "tutor"]
    text: str
    at_ms: int


class _Moment(_Exact):
    id: str = Field(min_length=1)
    variant: str = Field(min_length=1)
    at_ms: int = Field(ge=0)
    lang: Lang
    reason: GateReason
    transcript: list[_Line]
    quiet_ms: int | None = Field(ge=0)
    silence_ms: int | None = Field(ge=0)
    new_ink: bool
    changed_cells: int = Field(ge=0)
    labels: dict[Predicate, bool | None]

    @field_validator("labels")
    @classmethod
    def all_predicates(cls, value):
        if set(value) != set(PREDICATES):
            raise ValueError("every predicate needs a label (null means not labeled)")
        return value


class _Set(_Exact):
    version: Literal[1]
    moments: list[_Moment]


def load_moments(path: Path) -> list[LabeledMoment]:
    body = _Set.model_validate(json.loads(path.read_text(encoding="utf-8")))
    moments = [
        LabeledMoment(
            **m.model_dump(exclude={"transcript"}),
            transcript=tuple(TranscriptLine(**line.model_dump()) for line in m.transcript),
        )
        for m in body.moments
    ]
    if len({m.id for m in moments}) != len(moments):
        raise ValueError("evaluation moment ids must be unique")
    return moments


def gate_input_for(m: LabeledMoment, clips_dir: Path) -> GateInput:
    """Prepare pixels synchronously; callers on an event loop must use a worker thread.

    An exported moment's variant is a dataset-relative ``frames/<seq>.jpg``. Other variants
    name paper-synth clips. Never use camera, microphone or screen-capture APIs here.
    """
    if m.variant.lower().endswith((".jpg", ".jpeg")):
        source = (clips_dir / m.variant).resolve()
        if Path(m.variant).is_absolute() or not source.is_relative_to(clips_dir.resolve()):
            raise ValueError("frame path must stay inside its evaluation set")
        jpeg = source.read_bytes()
    else:
        if "/" in m.variant or "\\" in m.variant or m.variant in {".", ".."}:
            raise ValueError("expected a paper-synth variant or dataset-relative JPEG")
        clip = ensure_clip(m.variant, clips_dir=clips_dir)
        jpeg = frame_at(clip.mjpeg, m.at_ms)
    page = flatten_page(jpeg, None)
    return GateInput(
        image_jpeg=encode_jpeg(resized(page.rgb, GATE_LONG_SIDE)),
        transcript=m.transcript,
        lang=m.lang,
        reason=m.reason,
        quiet_ms=m.quiet_ms,
        silence_ms=m.silence_ms,
        new_ink=m.new_ink,
        changed_cells=m.changed_cells,
    )
