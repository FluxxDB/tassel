"""Pydantic mirrors of the shared beats contract (packages/shared/src/beats): automata, Ada's board,
paper and stage actions, and the beat documents that time them to her words.

They hold to the rules of the app's parsers (parseAction, parseBeatDoc), which the shared
fixtures.json pins, so what the server sends is what the app accepts:

- An object has exactly its fields. An optional field that is None counts as absent, and a dump
  leaves it out; a required one that may be null (durationSec, a word's start and end) keeps it.
- Wire keys are camelCase (durationSec, mouthCues), and every dump uses them, a plain
  model_dump(mode="json") too, so P2's event envelope sends what the app parses (review C2).
- Values are as strict as JavaScript's typeof: no 1 for true, no "2" for 2, no NaN. Lengths count
  code points, as both sides' strings do.
- A bad marker rejects the whole document here, where the app's parser drops it and keeps the
  rest: the server never sends one.
"""

import json
import math
import re
from collections.abc import Callable
from itertools import pairwise
from typing import Annotated, Any, Literal, Self

from loguru import logger
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainValidator,
    SerializerFunctionWrapHandler,
    StrictBool,
    TypeAdapter,
    model_serializer,
    model_validator,
)
from pydantic.alias_generators import to_camel

EPSILON = "ε"
MOUTH_SHAPES = ("A", "B", "C", "D", "E", "F", "G", "H", "X")

TEXT_MAX = 280
"""Titles, notes, verdict notes and callouts, in code points."""
INPUT_MAX = 64
"""A trace's input: symbols of one character each (ruling P5-R4)."""
ID_MAX = 64
BEAT_TEXT_MAX = 400
WORDS_MAX = 80
MARKERS_MAX = 40
CUE_TOLERANCE = 1e-6
"""How far apart one mouth cue's end and the next one's start may be, in seconds."""

_MAX_SAFE_INTEGER = 2**53 - 1
_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
# Digit-led ids such as "0" fit (M19); none starts with "_", so none meets Graphviz's "__start".
_STATE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_]{0,15}")
# JavaScript's \s, which the app's symbol check uses; Python's own \s differs at the edges.
_JS_SPACE = frozenset("\t\n\v\f\r                  　﻿")


def is_state_id(value: object) -> bool:
    return isinstance(value, str) and _STATE_ID.fullmatch(value) is not None


def is_symbol(value: object) -> bool:
    """A symbol: 1–4 characters, with no comma or space."""
    return (
        isinstance(value, str)
        and 1 <= len(value) <= 4
        and not any(char == "," or char in _JS_SPACE for char in value)
    )


def parse_element_ref(ref: object) -> tuple[str, ...] | None:
    """('start',), ('state', id), ('edge', from, to), ('node', id) or ('group', id) for 'start',
    'state:q0', 'edge:q0>q1', and a diagram's 'node:r1' or 'group:zone1'."""
    if not isinstance(ref, str):
        return None
    if ref == "start":
        return ("start",)
    for kind in ("node", "group"):
        if ref.startswith(kind + ":"):
            ident = ref.removeprefix(kind + ":")
            return (kind, ident) if is_state_id(ident) else None
    if ref.startswith("state:"):
        state = ref.removeprefix("state:")
        return ("state", state) if is_state_id(state) else None
    if ref.startswith("edge:"):
        ends = ref.removeprefix("edge:").split(">")
        if len(ends) == 2 and all(is_state_id(end) for end in ends):
            return ("edge", ends[0], ends[1])
    return None


# Each check takes the raw value, like the app's field-by-field parser, and raises ValueError.


def _string(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("must be a string")
    return value


def _sized(low: int, high: int) -> Callable[[object], str]:
    def check(value: object) -> str:
        text = _string(value)
        if not low <= len(text) <= high:
            raise ValueError(f"must be {low} to {high} characters")
        return text

    return check


def _nonempty(value: object) -> str:
    text = _string(value)
    if not text:
        raise ValueError("must not be empty")
    return text


def _matching(pattern: re.Pattern[str], what: str) -> Callable[[object], str]:
    def check(value: object) -> str:
        text = _string(value)
        if pattern.fullmatch(text) is None:
            raise ValueError(f"bad {what}")
        return text

    return check


def _element(value: object) -> str:
    text = _string(value)
    if parse_element_ref(text) is None:
        raise ValueError("bad element")
    return text


def _symbol(value: object) -> str:
    text = _string(value)
    if not is_symbol(text):
        raise ValueError("bad symbol")
    return text


def _edge_key(value: object) -> str:
    text = _string(value)
    if parse_element_ref(f"edge:{text}") is None:
        raise ValueError("bad edge key")
    return text


def _number(low: float = -math.inf, *, above: bool = False) -> Callable[[object], float]:
    """A finite number from `low` (or above it); never a boolean or a string."""

    def check(value: object) -> float:
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ValueError("must be a number")
        try:
            number = float(value)
        except OverflowError as error:
            raise ValueError("must be finite") from error
        if not math.isfinite(number) or number < low or (above and number == low):
            raise ValueError(f"must be a finite number {'above' if above else 'from'} {low}")
        return number

    return check


def _whole(low: int, high: int = _MAX_SAFE_INTEGER) -> Callable[[object], int]:
    """A whole number from `low` to `high`; 2.0 counts, as it does in JavaScript."""

    def check(value: object) -> int:
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ValueError("must be a number")
        if isinstance(value, float) and not value.is_integer():
            raise ValueError("must be a whole number")
        number = int(value)
        if not low <= number <= high:
            raise ValueError(f"must be {low} to {high}")
        return number

    return check


def _version(value: object) -> int:
    # Literal[1] would take True, which the app refuses.
    if isinstance(value, bool) or value != 1 or not isinstance(value, int | float):
        raise ValueError("must be 1")
    return 1


Str = Annotated[str, PlainValidator(_string)]
Id = Annotated[str, PlainValidator(_matching(_ID, "id"))]
"""An item or mark id: /^[A-Za-z0-9_-]{1,64}$/."""
StateId = Annotated[str, PlainValidator(_matching(_STATE_ID, "state id"))]
ElementRef = Annotated[str, PlainValidator(_element)]
Symbol = Annotated[str, PlainValidator(_symbol)]
Text = Annotated[str, PlainValidator(_sized(1, TEXT_MAX))]
TraceInput = Annotated[str, PlainValidator(_sized(0, INPUT_MAX))]
DocId = Annotated[str, PlainValidator(_sized(1, ID_MAX))]
"""A beat's id, turn, segment, or a marker's or frame's id: any 1–64 characters."""
Finite = Annotated[float, PlainValidator(_number())]
NonNegative = Annotated[float, PlainValidator(_number(0))]
Positive = Annotated[float, PlainValidator(_number(0, above=True))]
Step = Annotated[int, PlainValidator(_whole(0))]


class Wire(BaseModel):
    """An object on the wire: camelCase keys, exactly its fields, and None optionals left out."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="forbid",
        frozen=True,
    )

    @model_serializer(mode="wrap")
    def _leave_out_absent(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        for name, field in type(self).model_fields.items():
            if not field.is_required() and getattr(self, name) is None:
                data.pop(field.alias or name, None)
                data.pop(name, None)
        return data


# Automata


class StateSpec(Wire):
    id: Str
    accept: StrictBool | None = None


class Transition(Wire):
    from_: Str = Field(alias="from")
    to: Str
    symbols: list[Str]


class AutomatonSpec(Wire):
    """An automaton as Ada draws it; check_automaton names what's wrong with one."""

    kind: Literal["dfa", "nfa"]
    states: list[StateSpec]
    start: Str
    transitions: list[Transition]

    @model_validator(mode="after")
    def _checked(self) -> Self:
        problems = check_automaton(self)
        if problems:
            raise ValueError("; ".join(problems))
        return self


def check_automaton(spec: AutomatonSpec) -> list[str]:
    """Every problem with `spec`, each once, in the app's order and words: `bad state id "q 1"`,
    `duplicate state q1`, `unknown start q9`, `unknown state q9 in q0>q9`, `no symbols in q0>q1`,
    `bad symbol "0,1"`, `ε in a DFA`, `two moves from q0 on 1`. [] when it's valid."""
    problems: dict[str, None] = {}
    known: set[str] = set()
    for state in spec.states:
        if not is_state_id(state.id):
            problems.setdefault(f"bad state id {_quoted(state.id)}")
        elif state.id in known:
            problems.setdefault(f"duplicate state {state.id}")
        known.add(state.id)
    if spec.start not in known:
        problems.setdefault(f"unknown start {spec.start}")

    moves: dict[tuple[str, str], set[str]] = {}
    for move in spec.transitions:
        for end in (move.from_, move.to):
            if end not in known:
                problems.setdefault(f"unknown state {end} in {move.from_}>{move.to}")
        if not move.symbols:
            problems.setdefault(f"no symbols in {move.from_}>{move.to}")
        for symbol in move.symbols:
            if not is_symbol(symbol):
                problems.setdefault(f"bad symbol {_quoted(symbol)}")
            elif spec.kind == "dfa" and symbol == EPSILON:
                problems.setdefault("ε in a DFA")
            elif spec.kind == "dfa":
                targets = moves.setdefault((move.from_, symbol), set())
                targets.add(move.to)
                if len(targets) > 1:
                    problems.setdefault(f"two moves from {move.from_} on {symbol}")
    return list(problems)


def _quoted(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


# Ada's board


class BoardAutomatonSpec(AutomatonSpec):
    """Drawable model output: preserve the first DFA move on each symbol."""

    @model_validator(mode="after")
    def _checked(self) -> Self:
        if self.kind == "dfa":
            seen: dict[tuple[str, str], str] = {}
            moves = []
            for move in self.transitions:
                symbols = []
                for symbol in move.symbols:
                    key = (move.from_, symbol)
                    if key in seen and seen[key] != move.to:
                        logger.info(
                            "Board tag trimmed: dropped {}-{}-{}; kept {}",
                            move.from_,
                            symbol,
                            move.to,
                            seen[key],
                        )
                    else:
                        seen[key] = move.to
                        symbols.append(symbol)
                # Preserve originally empty edges so strict validation still rejects them.
                if symbols or not move.symbols:
                    moves.append(move.model_copy(update={"symbols": symbols}))
            object.__setattr__(self, "transitions", moves)
        return super()._checked()


# Diagrams: networks, flowcharts, trees. Structure only; the app lays them out.

DIAGRAM_ICONS = (
    "router",
    "switch",
    "pc",
    "laptop",
    "server",
    "cloud",
    "firewall",
    "phone",
    "database",
    "box",
    "circle",
)
DIAGRAM_MAX_NODES, DIAGRAM_MAX_GROUPS, DIAGRAM_MAX_EDGES, DIAGRAM_LABEL_MAX = 24, 6, 40, 40
Label = Annotated[str, PlainValidator(_sized(1, DIAGRAM_LABEL_MAX))]


class DiagramGroup(Wire):
    id: StateId
    label: Label
    sublabel: Label | None = None


class DiagramNode(Wire):
    id: StateId
    label: Label
    sublabel: Label | None = None
    icon: Literal[
        "router",
        "switch",
        "pc",
        "laptop",
        "server",
        "cloud",
        "firewall",
        "phone",
        "database",
        "box",
        "circle",
    ]
    group: StateId | None = None


class DiagramEdge(Wire):
    from_: StateId = Field(alias="from")
    to: StateId
    label: Label | None = None
    directed: StrictBool
    style: Literal["solid", "dashed"]


class DiagramSpec(Wire):
    title: Text | None = None
    direction: Literal["LR", "TB"]
    groups: Annotated[list[DiagramGroup], Field(max_length=DIAGRAM_MAX_GROUPS)]
    nodes: Annotated[list[DiagramNode], Field(min_length=1, max_length=DIAGRAM_MAX_NODES)]
    edges: Annotated[list[DiagramEdge], Field(max_length=DIAGRAM_MAX_EDGES)]

    @model_validator(mode="after")
    def _resolves(self) -> Self:
        ids = [g.id for g in self.groups] + [n.id for n in self.nodes]
        if len(set(ids)) != len(ids):
            raise ValueError("diagram ids repeat")
        groups = {g.id for g in self.groups}
        nodes = {n.id for n in self.nodes}
        if any(n.group is not None and n.group not in groups for n in self.nodes):
            raise ValueError("a node names an unknown group")
        if any(e.from_ not in nodes or e.to not in nodes for e in self.edges):
            raise ValueError("an edge names an unknown node")
        return self


class BoardDiagram(Wire):
    """A whole diagram; the same item again replaces it, so edits redraw in place."""

    kind: Literal["board.diagram"]
    item: Id
    spec: DiagramSpec
    reveal: Literal["all", "none"] | None = None


class BoardAutomaton(Wire):
    kind: Literal["board.automaton"]
    item: Id
    spec: BoardAutomatonSpec
    title: Text | None = None
    reveal: Literal["all", "none"] | None = None


class BoardAddState(Wire):
    kind: Literal["board.addState"]
    item: Id
    id: StateId
    accept: StrictBool | None = None


class BoardAddTransition(Wire):
    kind: Literal["board.addTransition"]
    item: Id
    from_: StateId = Field(alias="from")
    to: StateId
    symbols: Annotated[list[Symbol], Field(min_length=1)]


class BoardReveal(Wire):
    """Without `els`, everything in the item."""

    kind: Literal["board.reveal"]
    item: Id
    els: list[ElementRef] | None = None


class BoardHighlight(Wire):
    kind: Literal["board.highlight"]
    item: Id
    el: ElementRef
    on: StrictBool


class BoardPulse(Wire):
    kind: Literal["board.pulse"]
    item: Id
    el: ElementRef


class Near(Wire):
    item: Id
    el: ElementRef


class BoardNote(Wire):
    kind: Literal["board.note"]
    item: Id
    text: Text
    near: Near | None = None


class BoardTrace(Wire):
    kind: Literal["board.trace"]
    item: Id
    spec: AutomatonSpec
    input: TraceInput
    subject: Literal["student", "tutor"] | None = None
    on: Id | None = None
    title: Text | None = None


class BoardTraceStep(Wire):
    kind: Literal["board.traceStep"]
    item: Id
    step: Step | None = None


class BoardVerdict(Wire):
    kind: Literal["board.verdict"]
    item: Id
    got: Literal["accept", "reject"]
    expected: Literal["accept", "reject"] | None = None
    note: Text | None = None


class BoardFocus(Wire):
    kind: Literal["board.focus"]
    item: Id | None = None


class BoardClear(Wire):
    kind: Literal["board.clear"]
    item: Id | None = None


# The student's paper (page coordinates, P5-R10)


class Pt(Wire):
    x: Finite
    y: Finite


class NormRect(Wire):
    x: Finite
    y: Finite
    w: NonNegative
    h: NonNegative


DetectedId = Annotated[
    str, PlainValidator(_matching(re.compile(r"m[1-9][0-9]{0,2}"), "detected id"))
]


class ElTarget(Wire):
    el: ElementRef | DetectedId


class AtTarget(Wire):
    at: Pt


class BoxTarget(Wire):
    box: NormRect


PaperTarget = ElTarget | AtTarget | BoxTarget
"""Exactly one of `el`, `at` and `box`: each target forbids the others' keys."""


class CircleMark(Wire):
    type: Literal["circle"]
    id: Id
    target: PaperTarget
    wash: StrictBool | None = None


class ArrowMark(Wire):
    type: Literal["arrow"]
    id: Id
    from_: PaperTarget = Field(alias="from")
    to: PaperTarget


class StepMark(Wire):
    type: Literal["step"]
    id: Id
    n: Annotated[int, PlainValidator(_whole(0, 99))]
    target: PaperTarget


class CalloutMark(Wire):
    type: Literal["callout"]
    id: Id
    target: PaperTarget
    text: Text


class StrikeMark(Wire):
    type: Literal["strike"]
    id: Id
    target: PaperTarget


class UnderlineMark(Wire):
    """A line just under a target: her handwritten IP, a label, a state."""

    type: Literal["underline"]
    id: Id
    target: PaperTarget


class CheckMark(Wire):
    type: Literal["check"]
    id: Id
    target: PaperTarget


PaperMark = Annotated[
    CircleMark | ArrowMark | StepMark | CalloutMark | StrikeMark | UnderlineMark | CheckMark,
    Field(discriminator="type"),
]


class FrameById(Wire):
    kind: Literal["frame"]
    id: DocId


class PaperFrame(Wire):
    kind: Literal["paper"]
    id: DocId
    captured_at: DocId


class LatestFrame(Wire):
    kind: Literal["latest"]


class LiveFrame(Wire):
    kind: Literal["live"]


class FixtureFrame(Wire):
    kind: Literal["fixture"]
    name: Literal["dfa-wrong"]


FrameRef = Annotated[
    FrameById | PaperFrame | LatestFrame | LiveFrame | FixtureFrame, Field(discriminator="kind")
]


class StateInk(Wire):
    center: Pt
    r: Positive
    """In page-width units."""


class EdgeInk(Wire):
    """A self-loop's path runs around its state."""

    path: Annotated[list[Pt], Field(min_length=2)]
    label: Pt | None = None


class StartInk(Wire):
    path: Annotated[list[Pt], Field(min_length=2)]


class PixelBox(Wire):
    x: NonNegative
    y: NonNegative
    w: Positive
    h: Positive


class DetectedElement(Wire):
    id: DetectedId
    kind: Literal["circle", "label"]
    box: PixelBox


class DetectedElements(Wire):
    """Candidate boxes in flattened-page pixels; independent of semantic DFA ids."""

    width: Positive
    height: Positive
    items: Annotated[list[DetectedElement], Field(max_length=40)]

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("duplicate detected id")
        if any(
            e.box.x + e.box.w > self.width or e.box.y + e.box.h > self.height for e in self.items
        ):
            raise ValueError("detected box outside page")
        return self


class PaperElements(Wire):
    """Where an automaton's ink is on the paper; edge keys are 'q0>q1'."""

    states: dict[Annotated[str, PlainValidator(_matching(_STATE_ID, "state id"))], StateInk]
    edges: dict[Annotated[str, PlainValidator(_edge_key)], EdgeInk]
    start: StartInk | None = None
    detected: DetectedElements | None = None


class PaperFreeze(Wire):
    kind: Literal["paper.freeze"]
    frame: FrameRef
    elements: PaperElements | None = None
    spec: AutomatonSpec | None = None


class PaperMarkAction(Wire):
    kind: Literal["paper.mark"]
    mark: PaperMark


class PaperUnmark(Wire):
    kind: Literal["paper.unmark"]
    id: Id


class PaperTrace(Wire):
    kind: Literal["paper.trace"]
    input: TraceInput


class PaperTraceStep(Wire):
    kind: Literal["paper.traceStep"]
    step: Step | None = None


class PaperClear(Wire):
    kind: Literal["paper.clear"]


class PaperLive(Wire):
    kind: Literal["paper.live"]


class StageAction(Wire):
    kind: Literal["stage"]
    view: Literal["paper", "board", "split"]


BeatAction = Annotated[
    BoardAutomaton
    | BoardDiagram
    | BoardAddState
    | BoardAddTransition
    | BoardReveal
    | BoardHighlight
    | BoardPulse
    | BoardNote
    | BoardTrace
    | BoardTraceStep
    | BoardVerdict
    | BoardFocus
    | BoardClear
    | PaperFreeze
    | PaperMarkAction
    | PaperUnmark
    | PaperTrace
    | PaperTraceStep
    | PaperClear
    | PaperLive
    | StageAction,
    Field(discriminator="kind"),
]

BEAT_ACTION: TypeAdapter[BeatAction] = TypeAdapter(BeatAction)
"""Validates and dumps any one of Ada's actions."""


# Beat documents


class MouthCue(Wire):
    """In seconds from the beat's first audio."""

    start: NonNegative
    end: Finite
    value: Literal["A", "B", "C", "D", "E", "F", "G", "H", "X"]

    @model_validator(mode="after")
    def _in_order(self) -> Self:
        if self.end < self.start:
            raise ValueError("a mouth cue ends before it starts")
        return self


class BeatWord(Wire):
    """`start` and `end` are both null until the timing is known (P5-R4), or both set."""

    text: Annotated[str, PlainValidator(_nonempty)]
    start: NonNegative | None
    end: Finite | None

    @model_validator(mode="after")
    def _timed_or_not(self) -> Self:
        if (self.start is None) != (self.end is None):
            raise ValueError("a word's start and end are both null or both set")
        if self.start is not None and self.end is not None and self.end < self.start:
            raise ValueError("a word ends before it starts")
        return self


class BeatMarker(Wire):
    """Fires as words[word] is heard; word == len(words) fires with the last word."""

    id: DocId
    word: Step
    action: BeatAction


class BeatDoc(Wire):
    version: Annotated[int, PlainValidator(_version)]
    id: DocId
    turn: DocId
    segment: DocId
    lang: Literal["en", "es", "ko"]
    text: Annotated[str, PlainValidator(_sized(0, BEAT_TEXT_MAX))]
    """The line as captions show it."""
    duration_sec: NonNegative | None
    shape_set: Literal["rhubarb9"]
    mouth_cues: list[MouthCue]
    words: Annotated[list[BeatWord], Field(max_length=WORDS_MAX)]
    markers: Annotated[list[BeatMarker], Field(max_length=MARKERS_MAX)]

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        cues = self.mouth_cues
        if cues:
            if cues[0].start != 0 or cues[-1].value != "X":
                raise ValueError("mouthCues must start at 0 and end on X")
            for before, cue in pairwise(cues):
                if abs(cue.start - before.end) > CUE_TOLERANCE:
                    raise ValueError(f"mouthCues have a gap at {before.end:.2f}")
            if self.duration_sec is None:
                raise ValueError("mouthCues need durationSec")
        last_start = -math.inf
        for i, word in enumerate(self.words):
            if word.start is not None:
                if word.start < last_start:
                    raise ValueError(f"words out of order at {i}")
                last_start = word.start
        seen: set[str] = set()
        for marker in self.markers:
            if marker.id in seen:
                raise ValueError(f"duplicate marker {marker.id}")
            seen.add(marker.id)
            if marker.word > len(self.words):
                raise ValueError(
                    f"marker {marker.id} anchors to word {marker.word} of {len(self.words)}"
                )
        return self


def dump_beat(doc: BeatDoc) -> dict[str, Any]:
    """The beat as the app parses it: camelCase keys, required nulls kept, absent options left
    out."""
    return doc.model_dump(mode="json", by_alias=True)
