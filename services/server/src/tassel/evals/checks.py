"""Outcome checks for one eval turn, from what the pipeline recorded: stage events, the actions
that reached beats, the board before and after, where paper marks landed, what Ada said and how
long each step took. They check outcomes, never wording."""

import ipaddress
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
    # The titler's name for the session, when this turn produced one.
    title: dict | None = None
    decision: dict | None = None
    view_request: str | None = None
    board_before: dict = field(default_factory=lambda: {"automata": {}, "diagrams": {}})
    board_after: dict = field(default_factory=lambda: {"automata": {}, "diagrams": {}})
    page: str | None = None
    elements: dict[str, dict] = field(default_factory=dict)
    # The latest image she sent (a fixture name) and its Set-of-Mark boxes in fixture pixels.
    image: str | None = None
    image_elements: dict[str, dict] = field(default_factory=dict)
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


def _fold(text: str | None) -> str:
    """Case, spaces and punctuation ignored: "Guest Wi-Fi" is "guestwifi"."""
    return re.sub(r"[\W_]+", "", (text or "").casefold())


def _has(texts, wanted: str) -> bool:
    return any(_fold(wanted) in _fold(t) for t in texts)


def _texts(diagram: dict) -> list[str]:
    parts = [diagram.get("title")]
    for element in [*diagram.get("groups", []), *diagram.get("nodes", [])]:
        parts += [element.get("label"), element.get("sublabel")]
    parts += [e.get("label") for e in diagram.get("edges", [])]
    return [p for p in parts if p]


def _groups_named(diagrams: dict, name: str) -> list[tuple[dict, dict]]:
    return [
        (d, g)
        for d in diagrams.values()
        for g in d.get("groups", [])
        if name == "*" or _has([g.get("label"), g.get("sublabel")], name)
    ]


def usable_hosts(text: str | None) -> int:
    """The most usable hosts of any IPv4 CIDR written in this text (0 when there's none)."""
    best = 0
    for cidr in re.findall(r"\d+\.\d+\.\d+\.\d+/\d+", text or ""):
        try:
            net = ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            continue
        best = max(best, max(net.num_addresses - 2, 0) if net.prefixlen < 31 else 2)
    # A bare prefix ("/26 (50 addresses)") sizes the zone too, when no network was given.
    for prefix in re.findall(r"(?:^|[\s(])/(\d{1,2})\b", text or ""):
        if 0 < int(prefix) < 31:
            best = max(best, 2 ** (32 - int(prefix)) - 2)
    return best


def _detail_problems(expect, diagrams: dict) -> list[str]:
    problems = []
    texts = [t for d in diagrams.values() for t in _texts(d)]
    problems += [f"no label {t!r}" for t in expect.labels if not _has(texts, t)]
    problems += [f"label {t!r} still there" for t in expect.lacks_labels if _has(texts, t)]
    for name, icons in expect.group_icons.items():
        groups = _groups_named(diagrams, name)
        if not groups:
            problems.append(f"no group {name!r}")
        for diagram, group in groups:
            members = Counter(
                n.get("icon") for n in diagram.get("nodes", []) if n.get("group") == group["id"]
            )
            for icon, wanted in icons.items():
                if not _within(members[icon], wanted):
                    problems.append(
                        f"{group.get('label')}: {members[icon]} {icon}, wanted {_describe(wanted)}"
                    )
    for edge in expect.edges:
        found = False
        for d in diagrams.values():
            label = {n["id"]: [n.get("label"), n.get("sublabel")] for n in d.get("nodes", [])}
            for e in d.get("edges", []):
                ends = (label.get(e.get("from"), []), label.get(e.get("to"), []))
                for a, b in (ends, ends[::-1]):
                    found = found or (_has(a, edge.from_) and _has(b, edge.to))
        if not found:
            problems.append(f"no edge {edge.from_} - {edge.to}")
    for name, hosts in expect.group_hosts.items():
        groups = _groups_named(diagrams, name)
        best = max(
            (usable_hosts(f"{g.get('label')} {g.get('sublabel')}") for _, g in groups), default=0
        )
        if best < hosts:
            problems.append(f"{name}: {best} usable hosts, wanted {hosts}")
    if expect.zone_hosts:
        free = sorted(
            usable_hosts(f"{g.get('label')} {g.get('sublabel')}")
            for _, g in _groups_named(diagrams, "*")
        )
        for hosts in sorted(expect.zone_hosts, reverse=True):
            fit = next((h for h in free if h >= hosts), None)
            if fit is None:
                problems.append(f"no zone fits {hosts} hosts (zones: {free})")
            else:
                free.remove(fit)
    return problems


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
    problems += _detail_problems(expect, diagrams)
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


def _image_mark_problems(turn: Turn, obs: Observation) -> list[str]:
    if obs.image is None:
        return ["no image she sent"]
    image = render(obs.image)
    marks = [a["mark"] for a in obs.actions if a.get("kind") == "image.mark"]
    problems = []
    for wanted in turn.expect.image_marks:
        truth = image.truths[wanted.truth]
        landed = False
        for mark in (m for m in marks if m.get("type") == wanted.type):
            target = mark.get("target", {})
            if "el" in target:
                box = obs.image_elements.get(target["el"])
            else:
                box = _mark_box(target, obs, image.width, image.height)
            landed = landed or (box is not None and overlap_ok(box, truth))
        if not landed:
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
    if expect.image_marks:
        add("image marks", _image_mark_problems(turn, obs))
    for step, limit in expect.max_ms.items():
        ms = obs.timings.get(step)
        add(
            f"timing {step}",
            [] if ms is not None and ms <= limit else [f"{step} {ms} ms, limit {limit:g} ms"],
        )
    return results
