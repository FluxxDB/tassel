"""Outcome checks for one eval turn, from what the pipeline recorded: stage events, the actions
that reached beats, the board before and after, where paper marks landed, what Ada said and how
long each step took. They check outcomes, never wording."""

import re
from collections import Counter
from dataclasses import asdict, dataclass, field

from tassel.evals.fixtures import overlap_ok, render
from tassel.evals.scenario import Bounds, Count, Turn
from tassel.voice.bot import VIEW_ACKS

# Never in what Ada says: a stalling bridge, a promise she can't keep, bracketed meta text.
FORBIDDEN = ("hang on", "let me", "i'll look again")
# Except the ladder's step 1, which draws in the same turn: "Okay, let me help you out."
ALLOWED = ("let me help you",)
BRACKETED = re.compile(r"\[[^\[\]]{0,120}\]")
# A sentence repeated from an earlier turn counts only when it says something (4+ words).
REPEAT_MIN_WORDS = 4
FIXED_LINES = {line for lines in VIEW_ACKS.values() for line in lines.values()}


@dataclass
class Observation:
    """What one turn did, as recorded from the pipeline."""

    student: str
    spoken: str = ""
    stage: list[dict] = field(default_factory=list)
    actions: list[dict] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    rejects: list[dict] = field(default_factory=list)
    decision: dict | None = None
    view_request: str | None = None
    board_before: dict = field(default_factory=lambda: {"automata": {}, "diagrams": {}})
    board_after: dict = field(default_factory=lambda: {"automata": {}, "diagrams": {}})
    page: str | None = None
    elements: dict[str, dict] = field(default_factory=dict)
    timings: dict[str, float | None] = field(default_factory=dict)
    prompt_tokens: int = 0
    tokens: dict[str, dict] = field(default_factory=dict)
    finished: bool = True
    # The chat's message events this turn, and whether the reply made speech audio.
    chat: list[dict] = field(default_factory=list)
    audio: bool = False

    def to_json(self) -> dict:
        data = asdict(self)
        data["tags_reached"] = action_kinds(self.actions)
        return data


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


def _normal(text: str) -> str:
    return text.replace("’", "'").replace("‘", "'").lower()


def forbidden_phrases(spoken: str, extra=()) -> list[str]:
    said = _normal(spoken)
    for allowed in ALLOWED:
        said = said.replace(allowed, " ")
    found = [p for p in (*FORBIDDEN, *(_normal(e) for e in extra)) if p in said]
    return found + BRACKETED.findall(spoken)


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", _normal(text).strip())
    return [" ".join(re.sub(r"[^\w'\s]", " ", p).split()) for p in parts if p.strip()]


def stale_repeats(spoken: str, earlier: list[str]) -> list[str]:
    """Sentences Ada already said on an earlier turn (2de450e6: "removing the three PCs" again on
    an unrelated turn). Short lines and the fixed view acknowledgements repeat by design."""
    fixed = {s for line in FIXED_LINES for s in sentences(line)}
    before = {s for text in earlier for s in sentences(text)}
    return [
        s
        for s in sentences(spoken)
        if s in before and s not in fixed and len(s.split()) >= REPEAT_MIN_WORDS
    ]


def action_kinds(actions: list[dict]) -> list[str]:
    kinds = []
    for action in actions:
        kinds.append(action.get("kind", "?"))
        if action.get("kind") == "paper.mark":
            kinds.append(f"paper.mark:{action.get('mark', {}).get('type')}")
    return kinds


def _within(value: int, count: Count) -> bool:
    if isinstance(count, Bounds):
        return (count.min is None or value >= count.min) and (
            count.max is None or value <= count.max
        )
    return value == count


def _describe(count: Count) -> str:
    if isinstance(count, Bounds):
        low = "" if count.min is None else count.min
        high = "" if count.max is None else count.max
        return f"{low}..{high}"
    return str(count)


def _nodes(board: dict) -> list[dict]:
    return [n for d in board.get("diagrams", {}).values() for n in d.get("nodes", [])]


def _board_problems(expect, obs: Observation, earlier: list[Observation]) -> list[str]:
    after = obs.board_after
    automata, diagrams = after.get("automata", {}), after.get("diagrams", {})
    problems = []
    counts = {
        "automata": len(automata),
        "diagrams": len(diagrams),
        "nodes": len(_nodes(after)),
        "groups": sum(len(d.get("groups", [])) for d in diagrams.values()),
    }
    for name, value in counts.items():
        wanted = getattr(expect, name)
        if wanted is not None and not _within(value, wanted):
            problems.append(f"{name} {value}, wanted {_describe(wanted)}")
    icons = Counter(n.get("icon") for n in _nodes(after))
    for icon, wanted in expect.icons.items():
        if not _within(icons[icon], wanted):
            problems.append(f"{icon} icons {icons[icon]}, wanted {_describe(wanted)}")
    # An item, or one of its parts as ITEM.PART: a zone, a node or a state.
    items = set(automata) | set(diagrams)
    items |= {
        f"{item}.{part['id']}"
        for item, spec in diagrams.items()
        for part in [*spec.get("groups", []), *spec.get("nodes", [])]
    }
    items |= {
        f"{item}.{s['id']}" for item, spec in automata.items() for s in spec.get("states", [])
    }
    problems += [f"missing item {item}" for item in expect.has if item not in items]
    problems += [f"item {item} still there" for item in expect.lacks if item in items]
    labels = {
        part.get("label")
        for spec in diagrams.values()
        for part in [*spec.get("groups", []), *spec.get("nodes", [])]
    } | {spec.get("title") for spec in diagrams.values()}
    problems += [f"no label {label!r}" for label in expect.labels if label not in labels]
    if expect.same_as_turn is not None:
        if expect.same_as_turn > len(earlier):
            problems.append(f"turn {expect.same_as_turn} didn't run")
        elif earlier[expect.same_as_turn - 1].board_after != after:
            problems.append(f"board differs from after turn {expect.same_as_turn}")
    if expect.unchanged is not None and (obs.board_before == after) != expect.unchanged:
        problems.append("board changed" if expect.unchanged else "board unchanged")
    return problems


def _mark_box(target: dict, obs: Observation, width: int, height: int) -> dict | None:
    if "el" in target:
        return obs.elements.get(target["el"])
    if "box" in target:
        b = target["box"]
        return {
            "x": b["x"] * width,
            "y": b["y"] * height,
            "w": b["w"] * width,
            "h": b["h"] * height,
        }
    if "at" in target:
        p = target["at"]
        return {"x": p["x"] * width - 1, "y": p["y"] * height - 1, "w": 2, "h": 2}
    return None


def _mark_problems(turn: Turn, obs: Observation) -> list[str]:
    if obs.page is None:
        return ["no page on the desk"]
    page = render(obs.page)
    marks = [a["mark"] for a in obs.actions if a.get("kind") == "paper.mark"]
    problems = []
    for wanted in turn.expect.marks:
        truth = page.truths[wanted.truth]
        landed = []
        for mark in (m for m in marks if m.get("type") == wanted.type):
            box = _mark_box(mark.get("target", {}), obs, page.width, page.height)
            landed.append(box is not None and overlap_ok(box, truth))
        if not any(landed):
            seen = ", ".join(f"{m.get('type')}→{m.get('target')}" for m in marks) or "no marks"
            problems.append(f"no {wanted.type} on {wanted.truth} ({seen})")
    return problems


def _chat_problems(turn: Turn, obs: Observation) -> list[str]:
    finals = [m for m in obs.chat if m.get("final")]
    problems = []
    typed = bool(turn.images) or not turn.voice
    student = [m for m in finals if m.get("role") == "student"]
    if not student:
        problems.append("her line never reached the chat")
    elif typed and len(student[-1].get("attachments", [])) != len(turn.images):
        problems.append(
            f"{len(student[-1].get('attachments', []))} images in the chat, sent {len(turn.images)}"
        )
    replies = [m for m in finals if m.get("role") == "tutor" and m.get("text", "").strip()]
    if not replies:
        problems.append("no final reply in the chat")
    elif typed and replies[-1].get("source") != "typed":
        problems.append(f"the reply's source is {replies[-1].get('source')}, wanted typed")
    return problems


def check_turn(turn: Turn, obs: Observation, *, earlier: list[Observation]) -> list[CheckResult]:
    expect = turn.expect
    results = [CheckResult("finished", obs.finished, "" if obs.finished else "timed out")]

    def add(name, problems):
        results.append(CheckResult(name, not problems, "; ".join(problems)))

    if expect.spoke:
        add("spoke", [] if obs.spoken.strip() else ["Ada said nothing"])
    add("forbidden phrases", forbidden_phrases(obs.spoken, expect.forbid))
    if not expect.allow_repeat:
        add("no stale repeats", stale_repeats(obs.spoken, [e.spoken for e in earlier]))
    if expect.chat:
        add("chat", _chat_problems(turn, obs))
    if expect.audio is not None:
        wrong = "no speech audio" if expect.audio else "speech audio for a text-only reply"
        add("audio", [] if obs.audio == expect.audio else [wrong])
    if expect.route == "view":
        problems = []
        if obs.view_request is None:
            problems.append(f"not a view request (director: {obs.decision})")
        if obs.prompt_tokens:
            problems.append(f"{obs.prompt_tokens} prompt tokens spent")
        add("route", problems)
    elif expect.route is not None:
        got = (obs.decision or {}).get("route")
        add("route", [] if got == expect.route else [f"route {got}, wanted {expect.route}"])
    if expect.action is not None:
        got = (obs.decision or {}).get("action")
        add("action", [] if got == expect.action else [f"action {got}, wanted {expect.action}"])
    if expect.stage is not None:
        got = [{"view": s.get("view"), "pinned": bool(s.get("pinned"))} for s in obs.stage]
        wanted = [s.model_dump() for s in expect.stage]
        add("stage", [] if got == wanted else [f"stage {got}, wanted {wanted}"])
    kinds = action_kinds(obs.actions)
    if expect.tags is not None:
        if expect.tags:
            missing = [k for k in expect.tags if k not in kinds]
            add("tags", [f"missing {k} (reached: {kinds or 'nothing'})" for k in missing])
        else:
            add("tags", [f"unexpected {', '.join(kinds)}"] if kinds else [])
    if expect.no_tags:
        add("no tags", [f"unexpected {k}" for k in expect.no_tags if k in kinds])
    if expect.counts:
        reached = Counter(kinds)
        add(
            "counts",
            [
                f"{k} {reached[k]}, wanted {_describe(wanted)}"
                for k, wanted in expect.counts.items()
                if not _within(reached[k], wanted)
            ],
        )
    if expect.asks is not None:
        asked = obs.spoken.rstrip().endswith("?")
        wrong = "doesn't end with a question" if expect.asks else "ends with a question"
        add("asks", [] if asked == expect.asks else [wrong])
    if expect.board is not None:
        add("board", _board_problems(expect.board, obs, earlier))
    if expect.marks:
        add("marks", _mark_problems(turn, obs))
    for step, limit in expect.max_ms.items():
        ms = obs.timings.get(step)
        add(
            f"timing {step}",
            [] if ms is not None and ms <= limit else [f"{step} {ms} ms, limit {limit:g} ms"],
        )
    return results
