"""What her erase request takes off the board, read from her words against the board's items.

Real-token eval (clear-one): "Please erase the network diagram but keep the DFA" got a brief with
no [[clear]] tag, and Ada said "The network is erased; the DFA stays." When the brief takes
nothing off the board, ``pick`` chooses the item deterministically; when her words fit no single
item it chooses nothing, and Ada says she couldn't tell (``COULD_NOT_ERASE``)."""

import re
from copy import deepcopy

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.voice.action_checker import CLEAR_ALL

# A tag that takes something off the board.
REMOVAL = re.compile(r"\[\[\s*(?:clear|undo|remove)\b[^\]]*\]\]", re.I)
CLEAR_ITEM = re.compile(r"\[\[\s*clear\s+(\S+?)\s*\]\]", re.I)
BARE_CLEAR = re.compile(r"\[\[\s*clear\s*\]\]", re.I)
REMOVE_TAG = re.compile(r"\[\[\s*remove\s+([^\]]+?)\s*\]\]", re.I)

# What she wants to stay: "but keep the DFA", "everything except the network", "leave the DFA".
KEEP = re.compile(
    r"\b(?:keep(?:ing)?|leave|leaving|except(?:\s+for)?|but\s+not|other\s+than|apart\s+from|"
    r"(?<=everything )but|(?<=all )but)\b(?P<rest>[^.?!;]*)",
    re.I,
)
UNDO = re.compile(r"\bundo\b", re.I)
# Her words for "the one thing on the board", when there is just one.
PRONOUN = re.compile(r"\b(?:it|that|this|them|those)\b", re.I)

AUTOMATON = ("automaton", "automata", "machine", "state machine", "state diagram")
NETWORK_ICONS = {"router", "switch", "pc", "laptop", "server", "cloud", "firewall", "phone"}
# Words for any drawing: they pick an item only when nothing more specific fits.
WEAK = ("diagram", "drawing", "picture", "graph", "sketch", "one")
STOP = {"the", "and", "for", "with", "diagram", "drawing", "board"}

COULD_NOT_ERASE = {
    "en": "I couldn't tell which drawing to erase, so I left the board as it is. Which one "
    "should go?",
    "es": "No supe qué dibujo borrar, así que dejé la pizarra como está. ¿Cuál quito?",
    "ko": "어떤 그림을 지울지 알 수 없어서 칠판은 그대로 두었어요. 어느 것을 지울까요?",
}
ERASED = {
    "en": "Done, that's erased.",
    "es": "Listo, ya lo borré.",
    "ko": "네, 지웠어요.",
}
# Her say claims something came off the board.
CLAIMS_REMOVAL = re.compile(
    r"\b(?:eras\w*|remov\w*|delet\w*|clear\w*|gone|undone|wiped|taken (?:off|away)|"
    r"borr\w*|elimin\w*|quit\w*)\b|지웠|지워|삭제|없앴",
    re.I,
)


ASK_ALL = {
    "en": "That would clear the whole board. Should I go ahead?",
    "es": "Eso borraría toda la pizarra. ¿Lo hago?",
    "ko": "그러면 칠판 전체가 지워져요. 지울까요?",
}
ASK_PART = {
    "en": "That would take {what} off the board, more than half of it. Should I go ahead?",
    "es": "Eso quitaría {what} de la pizarra, más de la mitad. ¿Lo hago?",
    "ko": "그러면 {what}까지 지워져서 칠판의 절반 넘게 사라져요. 지울까요?",
}
# Her yes to "Should I go ahead?".
CONFIRM = re.compile(
    r"^\W*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|do it|go ahead|please do|correct|right|"
    r"sí|si|claro|vale|네|응|예|좋아)(?!\w)",
    re.I,
)
# A request that takes something off the board: the director's words, or "clear"/"wipe" with
# anything after ("clear everything", which ERASE leaves out).
ERASING = re.compile(r"\bclear\s+(?:everything|all|off|out|up)\b|\bwipe\b", re.I)
# Her words for the whole of an item, never just its parts: "the whole network diagram".
WHOLE = re.compile(r"\b(?:whole|entire|all of the)\b", re.I)
NOTES = re.compile(r"\bnotes?\b", re.I)
# Icons by her words for them: "the PCs" are every pc; "the router" is one when there's one.
ICON_WORDS = {
    "pc": ("pc", "computer"),
    "laptop": ("laptop",),
    "router": ("router",),
    "switch": ("switch",),
    "server": ("server",),
    "firewall": ("firewall",),
    "phone": ("phone",),
    "cloud": ("cloud",),
    "database": ("database",),
}
# Words in zone labels that say nothing about which zone.
GENERIC = {"zone", "group", "network", "subnet", "lan", "net", "the", "and", "area"}
IP = re.compile(r"\d{1,3}(?:\.\d{1,3}){1,3}(?:/\d{1,2})?")

_UNITS = {
    w: n
    for n, w in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
        "fifteen sixteen seventeen eighteen nineteen".split()
    )
}
_TENS = {
    w: 10 * n
    for n, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split(), start=2)
}


def spoken(text: str) -> str:
    """Her spoken numbers as digits, and an address as she says it as written: "ten dot o dot o"
    is 10.0.0, "one ninety two dot one sixty eight" is 192.168, "slash twenty four" is /24."""
    words = re.findall(r"[\w/.']+|[^\w\s]", text.lower())
    numeric = []  # (token, is_number)
    for i, word in enumerate(words):
        near_dot = any(0 <= j < len(words) and words[j] in ("dot", "point") for j in (i - 1, i + 1))
        if word in _UNITS:
            numeric.append([str(_UNITS[word]), True])
        elif word in ("o", "oh") and near_dot:
            numeric.append(["0", True])
        elif word in _TENS:
            numeric.append([str(_TENS[word]), True])
        elif word.isdigit():
            numeric.append([word, True])
        else:
            numeric.append([word, False])
    # "ninety two" is 92.
    merged: list[list] = []
    for token in numeric:
        last = merged[-1] if merged else None
        if (
            last
            and last[1]
            and token[1]
            and last[0].endswith("0")
            and len(last[0]) == 2
            and len(token[0]) == 1
        ):
            last[0] = str(int(last[0]) + int(token[0]))
        else:
            merged.append(token)
    out: list[str] = []
    run: list[str] = []

    def close():
        if run:
            dotted = any(t in ("dot", "point", "slash") for t in run)
            pieces = [{"dot": ".", "point": ".", "slash": "/"}.get(t, t) for t in run]
            out.append("".join(pieces) if dotted else " ".join(pieces))
            run.clear()

    for i, (token, number) in enumerate(merged):
        joiner = token in ("dot", "point", "slash")
        after = i + 1 < len(merged) and merged[i + 1][1]
        if number or (joiner and run and after):
            run.append(token)
        else:
            close()
            out.append(token)
    close()
    return " ".join(out)


def _has(text: str, term: str) -> bool:
    words = r"\s+".join(map(re.escape, term.split()))
    return re.search(rf"\b{words}s?\b", text, re.I) is not None


def _terms(board: BoardContext) -> dict[str, tuple[set[str], set[str]]]:
    """Each item's words: strong ones name it, weak ones fit any drawing."""
    items = {}
    for item, spec in board.specs.items():
        items[item] = ({item, spec.kind, *AUTOMATON}, set(WEAK))
    for item, spec in board.diagrams.items():
        strong = {item}
        if spec.title:
            strong |= {w for w in re.findall(r"[^\W\d_]{3,}", spec.title.lower()) if w not in STOP}
        if any(n.icon in NETWORK_ICONS for n in spec.nodes):
            strong |= {"network", "topology"}
        items[item] = (strong, set(WEAK))
    return items


def _matches(text: str, terms: set[str]) -> bool:
    return any(_has(text, t) for t in terms)


def split_keep(text: str) -> tuple[str, str]:
    """Her words as (what to erase, what to keep)."""
    kept = " ".join(m.group("rest") for m in KEEP.finditer(text))
    return KEEP.sub(" ", text), kept


def kept_items(text: str, board: BoardContext) -> set[str]:
    _, kept = split_keep(text)
    if not kept.strip():
        return set()
    return {item for item, (strong, _) in _terms(board).items() if _matches(kept, strong)}


def _ip_fits(said: str, label: str | None) -> bool:
    """Her address names this one: 10.0.0 fits 10.0.0.0/26, never 10.0.0.20."""
    if not label:
        return False
    return any(
        found == said or found.startswith(said + ".") or found.startswith(said + "/")
        for found in IP.findall(label)
    )


def _label_terms(label: str) -> set[str]:
    words = {w for w in re.findall(r"[^\W\d_]{3,}", label.lower()) if w not in GENERIC | STOP}
    return words | {label.lower()}


def parts(text: str, board: BoardContext, skip: set[str] = frozenset()) -> dict[str, list[str]]:
    """The zones, nodes and states her words name, by item, in the item's order: a zone by its
    name or address, a node by its label, address or id, "the PCs" by icon (in the zones she
    named, if she named any), a state by its id. A node inside a named zone goes with it."""
    said = spoken(text)
    ips = IP.findall(said)
    found: dict[str, list[str]] = {}
    for item, spec in board.diagrams.items():
        if item in skip:
            continue
        zones = [
            g.id
            for g in spec.groups
            if any(_ip_fits(ip, g.label) or _ip_fits(ip, g.sublabel) for ip in ips)
            or _matches(said, _label_terms(g.label))
            or (any(c.isdigit() for c in g.id) and _has(said, g.id))
        ]
        icons = [
            icon
            for icon, words in ICON_WORDS.items()
            if any(re.search(rf"\b{w}s\b|\b{w}es\b", said) for w in words)
        ]
        nodes = []
        for node in spec.nodes:
            if node.group in zones:
                continue
            by_icon = node.icon in icons and (not zones or node.group in zones)
            named = (
                _has(said, node.label.lower())
                or (not zones and any(_ip_fits(ip, node.sublabel) for ip in ips))
                or (any(c.isdigit() for c in node.id) and _has(said, node.id))
            )
            if by_icon or named:
                nodes.append(node.id)
        if icons and zones:
            # "the PCs in problem 2": the PCs, not the zone.
            nodes = [n.id for n in spec.nodes if n.icon in icons and n.group in zones]
            zones = []
        if not zones and not nodes and not icons:
            # "the server" when there is one server.
            for icon, words in ICON_WORDS.items():
                same = [n.id for n in spec.nodes if n.icon == icon]
                if len(same) == 1 and any(_has(said, w) for w in words):
                    nodes = same
        ids = set(zones) | set(nodes)
        ordered = [g.id for g in spec.groups if g.id in ids] + [
            n.id for n in spec.nodes if n.id in ids
        ]
        if ordered:
            found[item] = ordered
    for item, spec in board.specs.items():
        if item in skip:
            continue
        states = [s.id for s in spec.states if s.id != spec.start and _has(said, s.id.lower())]
        if states:
            found[item] = states
    return found


# "Rename the sales zone to Sales floor", "call problem two Guest Wi-Fi instead".
RENAME = re.compile(
    r"\b(?:rename|call)\s+(?P<what>.+?)\s+(?:to|as|into)\s+(?P<name>[^.?!]+)|"
    r"\bchange\s+the\s+name\s+of\s+(?P<what2>.+?)\s+to\s+(?P<name2>[^.?!]+)",
    re.I,
)


RENAMED = {
    "en": "Done, it's called {name} now.",
    "es": "Listo, ahora se llama {name}.",
    "ko": "네, 이제 이름은 {name}이에요.",
}
CLAIMS_RENAME = re.compile(r"\b(?:renam\w*|call\w*|nam\w*|llama|nombre)\b|이름", re.I)
RENAME_TAG = re.compile(r"\[\[\s*rename\b", re.I)


def pick_rename(text: str, board: BoardContext) -> list[str]:
    """[[rename ITEM.PART "NAME"]] for "rename X to NAME" when X names exactly one zone or node
    (or the one diagram), else []."""
    found = RENAME.search(text)
    if found is None:
        return []
    what = found.group("what") or found.group("what2")
    name = (found.group("name") or found.group("name2")).strip().strip("\"'“”")
    if not name or '"' in name:
        return []
    named = parts(what, board)
    targets = [f"{item}.{part}" for item, ids in named.items() for part in ids]
    if len(targets) == 1 and targets[0].split(".", 1)[0] in board.diagrams:
        return [f'[[rename {targets[0]} "{name}"]]']
    strong = [item for item, (s, _) in _terms(board).items() if _matches(what, s)]
    if not named and len(strong) == 1 and strong[0] in board.diagrams:
        return [f'[[rename {strong[0]} "{name}"]]']
    return []


def pick(text: str, board: BoardContext) -> list[str]:
    """The tags that take off what she asked to erase, or [] when her words fit no single item.
    A bare [[clear]] only when she asked for everything, as the action checker's CLEAR_ALL.
    Her words name parts before items: "the ten dot o network" is that zone, not the diagram."""
    erase, _ = split_keep(text)
    terms = _terms(board)
    kept = kept_items(text, board)
    if UNDO.search(erase):
        return ["[[undo]]"] if board.history else []
    candidates = {item: t for item, t in terms.items() if item not in kept}
    if CLEAR_ALL.search(erase):
        if not kept:
            return ["[[clear]]"] if terms or board.notes or board.traces else []
        return [f"[[clear {item}]]" for item in candidates]
    strong = [item for item, (s, _) in candidates.items() if _matches(erase, s)]
    if not (WHOLE.search(erase) and strong):
        named = parts(erase, board, skip=kept)
        if named:
            return [
                f"[[remove {' '.join(f'{item}.{part}' for part in ids)}]]"
                for item, ids in named.items()
            ]
        if NOTES.search(erase) and board.notes:
            return [f"[[clear {note}]]" for note in board.notes]
    if len(strong) == 1:
        return [f"[[clear {strong[0]}]]"]
    if strong:
        return []
    if len(candidates) == 1:
        [(item, (_, weak))] = candidates.items()
        if _matches(erase, weak) or PRONOUN.search(erase):
            return [f"[[clear {item}]]"]
    return []


def elements(board: BoardContext) -> set[str]:
    """What the board holds, as she'd count it: each node, state and note."""
    found = {f"{item}.{n.id}" for item, spec in board.diagrams.items() for n in spec.nodes}
    found |= {f"{item}.{s.id}" for item, spec in board.specs.items() for s in spec.states}
    return found | set(board.notes)


def dry_run(tags: list[str], board: BoardContext) -> tuple[BoardContext, list[str]]:
    """The board after `tags`, on a copy, and what they named."""
    copy = deepcopy(board)
    stream = MarkupStream(copy)
    sentences = stream.feed(" ".join(tags) + " Check.") + stream.flush()
    return copy, [n for s in sentences for n in s.named if n]


def share(tags: list[str], board: BoardContext) -> float:
    """How much of the board `tags` take off it, 0 to 1. An [[undo]] counts for nothing: she
    asked for exactly that."""
    before = elements(board)
    tags = [t for t in tags if removes(t) and not UNDO.search(t)]
    if not before or not tags:
        return 0.0
    after, _ = dry_run(tags, board)
    return len(before - elements(after)) / len(before)


def ask(tags: list[str], board: BoardContext, lang: str) -> str:
    """Ada's question before a removal of more than half the board."""
    if any(BARE_CLEAR.fullmatch(t.strip()) for t in tags):
        return ASK_ALL[lang]
    _, named = dry_run(tags, board)
    what = ", ".join(dict.fromkeys(named)) or "that"
    return ASK_PART[lang].format(what=what)


def narrower(a: list[str], b: list[str], board: BoardContext) -> bool:
    """`a` takes off strictly less than `b`, and only what `b` would."""
    start = elements(board)
    left_a, left_b = (start - elements(dry_run(tags, board)[0]) for tags in (a, b))
    return left_a < left_b


def removes(tag: str) -> bool:
    return REMOVAL.fullmatch(tag.strip()) is not None


def clears_kept(tag: str, kept: set[str]) -> bool:
    """A clear that would take off what she asked to keep."""
    if not kept:
        return False
    if BARE_CLEAR.fullmatch(tag.strip()):
        return True
    found = CLEAR_ITEM.fullmatch(tag.strip())
    if found is not None:
        return found.group(1) in kept
    removal = REMOVE_TAG.fullmatch(tag.strip())
    return removal is not None and any(
        target.split(".", 1)[0] in kept for target in removal.group(1).split()
    )
