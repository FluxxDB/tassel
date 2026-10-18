"""Eval scenarios as data: what the student types each turn, the page on her desk, the view the
app shows, and the OUTCOMES expected (never Ada's wording).

One scenario per ``scenarios/<name>.json``. A turn's ``page`` names a synthetic fixture
(``fixtures.py``) and stays on the desk until another page or ``"none"`` replaces it.
"""

from pathlib import Path
from typing import Literal, Self, get_args

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from tassel.beats.models import BeatAction, PaperMark
from tassel.models import Lang
from tassel.voice.director import certain, view_request

SCENARIOS_DIR = Path(__file__).with_name("scenarios")

View = Literal["paper", "board", "split"]
Action = Literal["none", "explain", "draw_board", "mark_paper", "trace"]


def _literal_values(union) -> set[str]:
    values = set()
    for member in get_args(get_args(union)[0]):
        for field in ("kind", "type"):
            info = member.model_fields.get(field)
            if info is not None:
                values.update(get_args(info.annotation))
    return values


ACTION_KINDS = _literal_values(BeatAction)
MARK_TYPES = _literal_values(PaperMark)
# Kinds a turn may expect to reach beats: every action, and a paper mark by its type.
TAG_KINDS = ACTION_KINDS | {f"paper.mark:{t}" for t in MARK_TYPES}


class ScenarioError(ValueError):
    """A scenario that can't run, with the reason."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Bounds(_Strict):
    min: int | None = None
    max: int | None = None


Count = int | Bounds


class StageState(_Strict):
    """What the app shows before the turn, sent as a stage-state client message."""

    view: View
    pinned: View | None = None
    frozen: bool = False


class StageExpect(_Strict):
    view: View
    pinned: bool = False


class BoardExpect(_Strict):
    automata: Count | None = None
    diagrams: Count | None = None
    has: list[str] = Field(default_factory=list)
    lacks: list[str] = Field(default_factory=list)
    nodes: Count | None = None
    groups: Count | None = None
    icons: dict[str, Count] = Field(default_factory=dict)
    # 1-based: the board after this turn equals the board after that earlier turn (undo, redo).
    same_as_turn: int | None = Field(None, ge=1)
    unchanged: bool | None = None


class MarkExpect(_Strict):
    type: str
    truth: str


class Expect(_Strict):
    # "view": her own view request, answered with a set line and no model call.
    route: Literal["talker", "thinker", "view"] | None = None
    action: Action | None = None
    # Exactly these stage events, in order; [] means none.
    stage: list[StageExpect] | None = None
    # Each of these kinds reaches beats; [] means no action at all.
    tags: list[str] | None = None
    no_tags: list[str] = Field(default_factory=list)
    board: BoardExpect | None = None
    marks: list[MarkExpect] = Field(default_factory=list)
    forbid: list[str] = Field(default_factory=list)
    allow_repeat: bool = False
    spoke: bool = True
    # The chat: her line and a final reply of Ada's reach it as message events.
    chat: bool | None = None
    # Whether the reply made speech audio: False for a text-only reply.
    audio: bool | None = None
    max_ms: dict[Literal["director", "thinker", "first_audio"], float] = Field(default_factory=dict)


class Turn(_Strict):
    student: str = Field(min_length=1)
    page: str | None = None
    # Sent as a chat message (student-message) with these page fixtures as her images, or with
    # her voice off; otherwise typed through RTVI send-text as before.
    images: list[str] = Field(default_factory=list, max_length=4)
    voice: bool = True
    stage: StageState | None = None
    expect: Expect = Field(default_factory=Expect)


class Scenario(_Strict):
    name: str = Field(pattern=r"^[a-z0-9-]{1,40}$")
    title: str
    description: str | None = None
    # In the default run; replays and the smoke test run only by name.
    default: bool = True
    lang: Lang = "en"
    # The fake LLM's script for a --fake run (voice/fakes/scenarios).
    fake_script: str = "dfa-opening"
    # The board at the start: automata as tags, other actions as beat actions.
    seed_tags: list[str] = Field(default_factory=list)
    seed_actions: list[dict] = Field(default_factory=list)
    stage: StageState | None = None
    turns: list[Turn] = Field(min_length=1)

    @model_validator(mode="after")
    def _runs(self) -> Self:
        from tassel.evals.fixtures import FIXTURES, render

        for index, turn in enumerate(self.turns, 1):
            where = f"turn {index}"
            if turn.page not in (None, "none") and turn.page not in FIXTURES:
                raise ValueError(f"{where}: unknown page fixture {turn.page!r}")
            for image in turn.images:
                if image not in FIXTURES:
                    raise ValueError(f"{where}: unknown image fixture {image!r}")
            expect = turn.expect
            for kind in [*(expect.tags or []), *expect.no_tags]:
                if kind not in TAG_KINDS:
                    raise ValueError(f"{where}: unknown tag kind {kind!r}")
            same = expect.board.same_as_turn if expect.board else None
            if same is not None and same >= index:
                raise ValueError(f"{where}: same_as_turn must name an earlier turn")
            page = self.page_at(index - 1)
            for mark in expect.marks:
                if mark.type not in MARK_TYPES:
                    raise ValueError(f"{where}: unknown mark type {mark.type!r}")
                if page is None:
                    raise ValueError(f"{where}: marks need a page fixture on the desk")
                if mark.truth not in render(page).truths:
                    raise ValueError(f"{where}: {page} has no truth box {mark.truth!r}")
        return self

    def page_at(self, index: int) -> str | None:
        """The fixture on her desk at this 0-based turn."""
        page = None
        for turn in self.turns[: index + 1]:
            if turn.page is not None:
                page = None if turn.page == "none" else turn.page
        return page

    @property
    def has_pages(self) -> bool:
        return any(t.page not in (None, "none") for t in self.turns)


def load_scenario(path: Path) -> Scenario:
    try:
        scenario = Scenario.model_validate_json(path.read_text(encoding="utf-8"))
    except ValidationError as error:
        raise ScenarioError(f"{path.name}: {error}") from None
    if scenario.name != path.stem:
        raise ScenarioError(f"{path.name} names {scenario.name!r}; the file must match its name")
    return scenario


def load_scenarios(names=(), *, directory: Path = SCENARIOS_DIR) -> list[Scenario]:
    """The named scenarios in the order given; none named is the default set, "all" every one."""
    every = {path.stem: load_scenario(path) for path in sorted(directory.glob("*.json"))}
    if not names:
        return [s for s in every.values() if s.default]
    if list(names) == ["all"]:
        return list(every.values())
    picked = []
    for name in names:
        if name not in every:
            known = ", ".join(every)
            raise ScenarioError(f"unknown scenario {name!r} (known: {known})")
        picked.append(every[name])
    return picked


# Rough prompt tokens per call on the configured models, measured from the prompts' sizes
# (talker ~1.3k, thinker ~3.7k, Illustrator ~1.2k system tokens) plus history and board items.
DIRECTOR_TOKENS = 700
TALKER_TOKENS = 2200
THINKER_TOKENS = 5500
ILLUSTRATOR_TOKENS = 2500
POINTER_TOKENS = 1600
PAGE_TOKENS = 1000
GROWTH_PER_TURN = 150
AUTOMATA = ("dfa", "nfa", "automat", "state machine")


def estimate_turn(turn: Turn, index: int, *, page: str | None = None) -> int:
    """A rough prompt-token cost for one turn, for the dry run and the budget's look-ahead."""
    if view_request(turn.student) is not None:
        return 0
    sure = certain(turn.student)
    route = turn.expect.route or (sure.route if sure else None)
    action = turn.expect.action or (sure.action if sure else None)
    if route is None:
        route = "thinker" if turn.expect.tags or turn.expect.marks else "talker"
    growth = GROWTH_PER_TURN * index
    if route == "talker":
        return DIRECTOR_TOKENS + TALKER_TOKENS + growth
    total = DIRECTOR_TOKENS + THINKER_TOKENS + growth
    text = turn.student.lower()
    if action == "draw_board" and not any(word in text for word in AUTOMATA):
        total += ILLUSTRATOR_TOKENS
    if page is not None and action in ("mark_paper", "trace", None):
        total += PAGE_TOKENS
    if turn.expect.marks or action == "mark_paper":
        total += POINTER_TOKENS + PAGE_TOKENS
    return total
