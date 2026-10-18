"""Provider-neutral transcription schema and pure snapping to observed page geometry.

The wire schema deliberately avoids provider-unsupported bounds. Local validation rejects
non-finite numbers; snapping clamps confidences and makes uncertain geometry explicit.
"""

from collections import Counter
from typing import Literal

from pydantic import BaseModel, ConfigDict

from tassel.domains.dfa.contract import (
    EPSILON,
    DfaReading,
    LanguageGuess,
    NormBox,
    PageGeometry,
    Pt,
    ReadState,
    ReadTransition,
)
from tassel.vision.marks import Candidates
from tassel.vision.page import FlatPage

CONFIDENCE_FLOOR = 0.6  # Anything below this needs the student's confirmation.
ACCEPT_DISAGREEMENT_FACTOR = 0.7  # Preserve the reader's flag but discount conflicting geometry.
MAX_SCHEMA_UNIONS = 16  # Structured output's union budget, including nullable fields.


class _TranscriptionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class TBox(_TranscriptionModel):
    x1: float
    y1: float
    x2: float
    y2: float


class TState(_TranscriptionModel):
    label: str
    circle_mark: int | None
    box: TBox
    accept: bool
    start: bool
    confidence: float


class TTransition(_TranscriptionModel):
    source: str
    target: str
    symbols: list[str]
    label_mark: int | None
    label_box: TBox | None
    confidence: float


class TLanguage(_TranscriptionModel):
    regex: str | None
    confidence: float


class DfaTranscription(_TranscriptionModel):
    machine_kind: Literal["dfa", "nfa", "none"]
    problem_kind: Literal["dfa", "nfa"] | None
    states: list[TState]
    transitions: list[TTransition]
    alphabet: list[str]
    problem_statement: str | None
    language: TLanguage
    intent: str | None
    intent_confidence: float
    unreadable: list[str]


def _object(properties: dict) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


# Hand-written, not derived from Pydantic: problem_kind's null is an enum member, leaving
# six nullable anyOf unions. Object boxes avoid fixed-length array constraints.
TRANSCRIPTION_SCHEMA: dict = {
    **_object(
        {
            "machine_kind": {"type": "string", "enum": ["dfa", "nfa", "none"]},
            "problem_kind": {"enum": ["dfa", "nfa", None]},
            "states": {"type": "array", "items": {"$ref": "#/$defs/TState"}},
            "transitions": {"type": "array", "items": {"$ref": "#/$defs/TTransition"}},
            "alphabet": {"type": "array", "items": {"type": "string"}},
            "problem_statement": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "language": {"$ref": "#/$defs/TLanguage"},
            "intent": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "intent_confidence": {"type": "number"},
            "unreadable": {"type": "array", "items": {"type": "string"}},
        }
    ),
    "$defs": {
        "TBox": _object(
            {
                "x1": {"type": "number"},
                "y1": {"type": "number"},
                "x2": {"type": "number"},
                "y2": {"type": "number"},
            }
        ),
        "TState": _object(
            {
                "label": {"type": "string"},
                "circle_mark": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                "box": {"$ref": "#/$defs/TBox"},
                "accept": {"type": "boolean"},
                "start": {"type": "boolean"},
                "confidence": {"type": "number"},
            }
        ),
        "TTransition": _object(
            {
                "source": {"type": "string"},
                "target": {"type": "string"},
                "symbols": {"type": "array", "items": {"type": "string"}},
                "label_mark": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                "label_box": {"anyOf": [{"$ref": "#/$defs/TBox"}, {"type": "null"}]},
                "confidence": {"type": "number"},
            }
        ),
        "TLanguage": _object(
            {
                "regex": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "confidence": {"type": "number"},
            }
        ),
    },
}


def schema_problems(schema: dict) -> list[str]:
    """Check the shared structured-output subset, without interpreting schema data as keywords."""
    problems: list[str] = []
    unions = 0

    def visit(node: dict, path: str) -> None:
        nonlocal unions
        for key in ("maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"):
            if key in node:
                problems.append(f"{path}: unsupported {key}")
        if node.get("minItems", 0) > 1:
            problems.append(f"{path}: minItems beyond 1 is unsupported")
        node_type = node.get("type")
        if (
            node_type == "object"
            or (isinstance(node_type, list) and "object" in node_type)
            or "properties" in node
            or "additionalProperties" in node
        ):
            properties = node.get("properties", {})
            if set(node.get("required", [])) != set(properties):
                problems.append(f"{path}: every property must be required")
            if node.get("additionalProperties") is not False:
                problems.append(f"{path}: additionalProperties must be false")
        if "anyOf" in node or "oneOf" in node or isinstance(node.get("type"), list):
            unions += 1
        for keyword in ("properties", "$defs", "definitions"):
            for name, child in node.get(keyword, {}).items():
                visit(child, f"{path}.{keyword}.{name}")
        if isinstance(node.get("items"), dict):
            visit(node["items"], f"{path}.items")
        for keyword in ("anyOf", "oneOf", "allOf"):
            for index, child in enumerate(node.get(keyword, [])):
                visit(child, f"{path}.{keyword}[{index}]")

    visit(schema, "$")
    if unions > MAX_SCHEMA_UNIONS:
        problems.append(f"$: {unions} unions exceed the {MAX_SCHEMA_UNIONS}-union limit")
    return problems


def _confidence(value: float) -> float:
    return min(1.0, max(0.0, value))


def _box(box: TBox, page: FlatPage) -> NormBox:
    # An unsnapped reader box remains uncertain. Reversed corners should not draw a negative box.
    x1, x2 = sorted((box.x1, box.x2))
    y1, y2 = sorted((box.y1, box.y2))
    return NormBox(
        x=x1 / page.width, y=y1 / page.height, w=(x2 - x1) / page.width, h=(y2 - y1) / page.height
    )


def _fresh_id(base: str, used: set[str]) -> str:
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def snap(
    t: DfaTranscription, page: FlatPage, cands: Candidates, *, frame_id: str | None
) -> DfaReading:
    """Convert one reader response to normalized geometry; never silently resolve ambiguity."""
    geometry = PageGeometry(
        width=page.width, height=page.height, quad=[p.model_copy() for p in page.quad]
    )
    result = DfaReading(
        frame_id=frame_id,
        source="paper",
        kind="dfa",
        alphabet=[],
        states=[],
        transitions=[],
        page=geometry,
        problem=t.problem_statement,
        problem_kind=t.problem_kind,
        language=LanguageGuess(
            regex=t.language.regex, confidence=_confidence(t.language.confidence)
        ),
        uncertain=[],
    )
    if t.machine_kind == "none":
        return result
    result.alphabet = list(t.alphabet)
    circles = {c.mark: c for c in cands.circles}
    labels = {label.mark: label for label in cands.labels}
    counts = Counter(s.label for s in t.states)
    # Reserve endpoint labels too: an unknown endpoint must not accidentally name a generated id.
    reserved = (
        {s.label for s in t.states}
        | {e.source for e in t.transitions}
        | {e.target for e in t.transitions}
    )
    used = set(reserved)
    resolved: dict[str, str] = {}
    for index, state in enumerate(t.states):
        circle = circles.get(state.circle_mark)
        if state.label and counts[state.label] == 1:
            state_id = state.label
            resolved[state.label] = state_id
        else:
            state_id = _fresh_id(f"s{circle.mark if circle is not None else index}", used)
        confidence = _confidence(state.confidence)
        conflict = circle is not None and state.accept != circle.inner
        if circle is not None:
            center = Pt(x=circle.cx / page.width, y=circle.cy / page.height)
            radius = circle.r / page.width
            box = NormBox(
                x=(circle.cx - circle.r) / page.width,
                y=(circle.cy - circle.r) / page.height,
                w=2 * circle.r / page.width,
                h=2 * circle.r / page.height,
            )
        else:
            box = _box(state.box, page)
            center = Pt(x=box.x + box.w / 2, y=box.y + box.h / 2)
            radius = min(box.w * page.width, box.h * page.height) / (2 * page.width)
        if conflict:
            confidence *= ACCEPT_DISAGREEMENT_FACTOR
        result.states.append(
            ReadState(
                id=state_id,
                label=state.label,
                start=state.start,
                accept=state.accept,
                center=center,
                r=radius,
                box=box,
                mark=circle.mark if circle is not None else None,
                snapped=circle is not None,
                confidence=confidence,
            )
        )
        if circle is None or conflict or confidence < CONFIDENCE_FLOOR:
            result.uncertain.append(state_id)

    targets: dict[tuple[str, str], set[str]] = {}
    for transition in t.transitions:
        source = resolved.get(transition.source, transition.source)
        target = resolved.get(transition.target, transition.target)
        symbols = list(
            dict.fromkeys(
                EPSILON
                if symbol in ("ε", "λ") or (symbol == "e" and "e" not in t.alphabet)
                else symbol
                for symbol in transition.symbols
            )
        )
        edge_id = _fresh_id(f"{source}-{','.join(symbols)}-{target}", used)
        label = labels.get(transition.label_mark)
        if label is not None:
            label_box = NormBox(
                x=label.x / page.width,
                y=label.y / page.height,
                w=label.w / page.width,
                h=label.h / page.height,
            )
        elif transition.label_box is not None:
            label_box = _box(transition.label_box, page)
        else:
            label_box = None
        confidence = _confidence(transition.confidence)
        result.transitions.append(
            ReadTransition(
                id=edge_id,
                source=source,
                target=target,
                symbols=symbols,
                label_box=label_box,
                mark=label.mark if label is not None else None,
                snapped=label is not None,
                confidence=confidence,
            )
        )
        ambiguous = counts[transition.source] > 1 or counts[transition.target] > 1
        if label is None or confidence < CONFIDENCE_FLOOR or ambiguous:
            result.uncertain.append(edge_id)
        for symbol in symbols:
            destinations = targets.setdefault((source, symbol), set())
            destinations.add(target)
            if symbol == EPSILON or len(destinations) > 1:
                result.kind = "nfa"
    return result
