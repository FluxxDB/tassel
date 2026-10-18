"""What she asked a drawing to show, as a typed checklist, and the deterministic checks of a
drawing against it.

The Illustrator's extraction call turns her request into a ``Checklist`` (diagrams); her words
alone give an automaton's (``automaton_checklist``). ``verify`` and ``verify_automaton`` name
every requirement a drawing misses, in words the repair prompt and Ada's honest line can use.
Only ``fuzzy`` items (a shape or style no rule can check) go to a model check.
"""

import ipaddress
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from tassel.beats.models import AutomatonSpec, DiagramNode, DiagramSpec

Icon = Literal[
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


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Ends(_Strict):
    """Which nodes an edge requirement means: label contains, icon, and the group they sit in
    ("*": any group, null: anywhere)."""

    label: str | None
    icon: Icon | None
    group: str | None


class Requirement(_Strict):
    kind: Literal["group", "count", "label", "edge", "cidr", "direction", "fuzzy"]
    # The detail in her words, in the session language: what Ada names if it can't be drawn.
    text: str = Field(min_length=1, max_length=120)
    # group/cidr/count/label: the group label it's about; "*" every group; null the diagram.
    group: str | None
    # label: the text to show; cidr: a CIDR to show (or null with n hosts).
    label: str | None
    icon: Icon | None
    # count: how many; cidr: usable hosts the group's subnet needs.
    n: int | None
    # count: exactly n (true) or at least n; cidr: the smallest subnet that fits n.
    exact: bool
    source: Ends | None
    target: Ends | None
    # edge: every source node connects (true), or at least one.
    each: bool
    direction: Literal["LR", "TB"] | None


class Checklist(_Strict):
    # The board item this request edits, or null for a new drawing.
    item: str | None
    # Labels of existing groups or nodes this request removes or renames.
    remove: list[str]
    requirements: list[Requirement] = Field(max_length=30)


def checklist_schema():
    """Strict provider schema: every property required, nulls allowed where optional."""
    schema = Checklist.model_json_schema()

    def normalize(node):
        node.pop("default", None)
        node.pop("maxLength", None)
        node.pop("minLength", None)
        node.pop("maxItems", None)
        for definition in node.get("$defs", {}).values():
            normalize(definition)
        if "properties" in node:
            node["required"] = list(node["properties"])
            node["additionalProperties"] = False
            for prop in node["properties"].values():
                normalize(prop)
        if "items" in node:
            normalize(node["items"])
        for alternative in node.get("anyOf", []):
            normalize(alternative)

    normalize(schema)
    return schema


def fold(text: str | None) -> str:
    """Case, spaces and punctuation ignored: "Guest Wi-Fi" is "guestwifi"."""
    return re.sub(r"[\W_]+", "", (text or "").casefold())


def _has(texts, wanted: str | None) -> bool:
    return wanted is None or any(fold(wanted) in fold(t) for t in texts if t)


def _groups(spec: DiagramSpec, name: str | None):
    if name in (None, "*"):
        return list(spec.groups)
    return [g for g in spec.groups if _has([g.label, g.sublabel], name)]


def _node_texts(node: DiagramNode):
    return [node.label, node.sublabel]


def _matches(node: DiagramNode, ends: Ends, spec: DiagramSpec) -> bool:
    if ends.icon is not None and node.icon != ends.icon:
        return False
    if not _has(_node_texts(node), ends.label):
        return False
    if ends.group == "*":
        return node.group is not None
    if ends.group is not None:
        return node.group in {g.id for g in _groups(spec, ends.group)}
    return True


def usable(net: ipaddress.IPv4Network) -> int:
    return max(net.num_addresses - 2, 0) if net.prefixlen < 31 else 2


def cidrs(text: str | None) -> list[ipaddress.IPv4Network]:
    found = []
    for raw in re.findall(r"\d+\.\d+\.\d+\.\d+/\d+", text or ""):
        try:
            found.append(ipaddress.ip_network(raw, strict=False))
        except ValueError:
            continue
    return found


def smallest_prefix(hosts: int) -> int:
    prefix = 30
    while prefix > 0 and usable(ipaddress.ip_network(f"0.0.0.0/{prefix}")) < hosts:
        prefix -= 1
    return prefix


def _check(req: Requirement, spec: DiagramSpec) -> str | None:
    """Why the drawing misses this requirement, or None when it meets it."""
    if req.kind == "group":
        name = req.label or req.group
        return None if _groups(spec, name) else f"no group labeled {name!r}"
    if req.kind == "direction":
        if req.direction and spec.direction != req.direction:
            return f"direction is {spec.direction}, wanted {req.direction}"
        return None
    if req.kind == "label":
        if req.group not in (None, "*"):
            groups = _groups(spec, req.group)
            if not groups:
                return f"no group labeled {req.group!r}"
            ids = {g.id for g in groups}
            texts = [t for g in groups for t in (g.label, g.sublabel)]
            texts += [t for n in spec.nodes if n.group in ids for t in _node_texts(n)]
        else:
            texts = [spec.title, *(t for g in spec.groups for t in (g.label, g.sublabel))]
            texts += [t for n in spec.nodes for t in _node_texts(n)]
            texts += [e.label for e in spec.edges]
        return None if _has(texts, req.label) else f"no label {req.label!r}"
    if req.kind == "count":
        n = req.n or 0
        if req.group is None:
            got = sum(1 for node in spec.nodes if req.icon is None or node.icon == req.icon)
            return _count_problem(got, n, req, "the diagram")
        groups = _groups(spec, req.group)
        if not groups:
            return f"no group labeled {req.group!r}"
        problems = []
        for group in groups:
            got = sum(
                1
                for node in spec.nodes
                if node.group == group.id and (req.icon is None or node.icon == req.icon)
            )
            problem = _count_problem(got, n, req, group.label)
            if problem:
                problems.append(problem)
        return "; ".join(problems) or None
    if req.kind == "edge":
        if req.source is None or req.target is None:
            return None
        targets = {n.id for n in spec.nodes if _matches(n, req.target, spec)}
        # "Every switch connects to the Core Switch": the Core Switch isn't one of them.
        sources = [n for n in spec.nodes if _matches(n, req.source, spec) and n.id not in targets]
        if not sources:
            return f"no node for {_ends(req.source)}"
        if not targets:
            return f"no node for {_ends(req.target)}"
        linked = {}
        for edge in spec.edges:
            linked.setdefault(edge.from_, set()).add(edge.to)
            linked.setdefault(edge.to, set()).add(edge.from_)
        joined = [s for s in sources if (linked.get(s.id, set()) - {s.id}) & targets]
        if req.each and len(joined) < len(sources):
            loose = ", ".join(s.label for s in sources if s not in joined)
            return f"{loose} not connected to {_ends(req.target)}"
        if not joined:
            return f"no edge {_ends(req.source)} - {_ends(req.target)}"
        return None
    if req.kind == "cidr":
        groups = _groups(spec, req.group) if req.group not in (None, "*") else None
        if groups == []:
            return f"no group labeled {req.group!r}"
        texts = (
            [t for g in groups for t in (g.label, g.sublabel)]
            if groups
            else [t for g in spec.groups for t in (g.label, g.sublabel)]
            + [t for n in spec.nodes for t in _node_texts(n)]
        )
        if req.label and not _has(texts, req.label):
            return f"no {req.label} on {req.group or 'the diagram'}"
        if req.n:
            nets = [net for t in texts for net in cidrs(t)]
            if not nets:
                return f"{req.group or 'the diagram'} shows no CIDR"
            fits = [net for net in nets if usable(net) >= req.n]
            if not fits:
                best = max(usable(net) for net in nets)
                return f"{req.group}'s subnet has {best} usable hosts, needs {req.n}"
            prefix = smallest_prefix(req.n)
            if req.exact and all(net.prefixlen != prefix for net in fits):
                return f"{req.group} should be the smallest subnet for {req.n} hosts (/{prefix})"
        return None
    return None


def _count_problem(got: int, n: int, req: Requirement, where: str) -> str | None:
    what = req.icon or "node"
    if (req.exact and got != n) or got < n:
        return f"{where} has {got} {what}, wanted {'' if req.exact else 'at least '}{n}"
    return None


def _ends(ends: Ends) -> str:
    parts = [p for p in (ends.label, ends.icon) if p]
    where = {"*": " in each group", None: ""}.get(ends.group, f" in {ends.group}")
    return " ".join(parts) + where if parts else "any node" + where


def keep_problems(spec: DiagramSpec, before: DiagramSpec | None, remove: list[str]) -> list[str]:
    """An edit keeps what was there: every group and node whose label she didn't remove is still
    there, under the same id (the board outline names parts by id)."""
    if before is None:
        return []
    gone = [fold(r) for r in remove if fold(r)]

    def removed(*texts) -> bool:
        return any(g and g in fold(t) for g in gone for t in texts if t)

    problems = []
    now = {g.id: g for g in spec.groups} | {n.id: n for n in spec.nodes}
    for old in [*before.groups, *before.nodes]:
        if removed(old.label, old.sublabel):
            continue
        same = now.get(old.id)
        if same is not None and fold(same.label) == fold(old.label):
            continue
        moved = next(
            (e for e in now.values() if fold(e.label) == fold(old.label) and e.id != old.id), None
        )
        if moved is not None and old.id not in now:
            problems.append(f"keep the id {old.id} for {old.label!r} (it became {moved.id})")
        elif same is None and moved is None:
            problems.append(f"keep {old.label!r} (id {old.id}); she didn't ask to remove it")
    return problems


def verify(spec: DiagramSpec, checklist: Checklist | None, before: DiagramSpec | None = None):
    """(requirement or None, why) for every requirement this drawing misses; fuzzy items are
    left to the model check. A None requirement is a kept element the edit lost."""
    missing = []
    if checklist is not None:
        for req in checklist.requirements:
            if req.kind == "fuzzy":
                continue
            why = _check(req, spec)
            if why:
                missing.append((req, why))
    for why in keep_problems(spec, before, checklist.remove if checklist else []):
        missing.append((None, why))
    return missing


# Automata: her words give the checklist; the language itself is the exact verifier's.
NUMBER = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
}
_N = r"(\d+|" + "|".join(NUMBER) + r")"


class AutomatonChecklist(_Strict):
    states: int | None = None
    states_bound: Literal["exactly", "at most", "at least"] = "exactly"
    accepting: int | None = None
    alphabet: list[str] | None = None

    @property
    def empty(self) -> bool:
        return self.states is None and self.accepting is None and self.alphabet is None


def _number(word: str) -> int:
    return int(word) if word.isdigit() else NUMBER[word.lower()]


def automaton_checklist(text: str) -> AutomatonChecklist:
    """State count, accepting-state count and alphabet, when her words give them."""
    found = AutomatonChecklist()
    states = re.search(
        r"(at most|no more than|at least|exactly)?\s*" + _N + r"\s+(?:\w+\s+)?states?\b",
        text,
        re.I,
    )
    if states and not re.match(r"accept", text[states.end(2) :].strip(), re.I):
        found.states = _number(states.group(2))
        bound = (states.group(1) or "exactly").lower()
        found.states_bound = "at most" if bound in ("at most", "no more than") else bound
    accepting = re.search(_N + r"\s+(?:final|accept(?:ing)?)\s+states?\b", text, re.I)
    if accepting:
        found.accepting = _number(accepting.group(1))
        if states and states.group(2) == accepting.group(1) and states.start() == accepting.start():
            found.states = None
    alphabet = re.search(
        r"(?:over|alphabet(?: is)?|symbols?)\s*(?:the alphabet\s*)?(?:Σ\s*=\s*)?\{([^}]*)\}",
        text,
        re.I,
    )
    if alphabet:
        found.alphabet = sorted({s.strip() for s in alphabet.group(1).split(",") if s.strip()})
    elif re.search(r"\bbinary\b", text, re.I):
        found.alphabet = ["0", "1"]
    else:
        pair = re.search(r"\bover\s+(\w)\s*(?:,|and)\s*(\w)\b", text, re.I)
        if pair:
            found.alphabet = sorted({pair.group(1), pair.group(2)})
    return found


def verify_automaton(spec: AutomatonSpec, wanted: AutomatonChecklist) -> list[str]:
    problems = []
    states = len(spec.states)
    if wanted.states is not None:
        bound, n = wanted.states_bound, wanted.states
        if (
            (bound == "exactly" and states != n)
            or (bound == "at most" and states > n)
            or (bound == "at least" and states < n)
        ):
            problems.append(f"{states} states, she asked for {bound} {n}")
    if wanted.accepting is not None:
        accepting = sum(1 for s in spec.states if s.accept)
        if accepting != wanted.accepting:
            problems.append(f"{accepting} accepting states, she asked for {wanted.accepting}")
    if wanted.alphabet is not None:
        used = {symbol for t in spec.transitions for symbol in t.symbols}
        extra = sorted(used - set(wanted.alphabet))
        if extra:
            problems.append(f"symbols {extra} outside her alphabet {wanted.alphabet}")
        if spec.kind == "dfa":
            unused = sorted(set(wanted.alphabet) - used)
            if unused:
                problems.append(f"no transition reads {unused}")
    return problems
