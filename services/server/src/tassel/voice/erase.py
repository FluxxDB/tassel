"""What her erase request takes off the board, read from her words against the board's items.

Real-token eval (clear-one): "Please erase the network diagram but keep the DFA" got a brief with
no [[clear]] tag, and Ada said "The network is erased; the DFA stays." When the brief takes
nothing off the board, ``pick`` chooses the item deterministically; when her words fit no single
item it chooses nothing, and Ada says she couldn't tell (``COULD_NOT_ERASE``)."""

import re

from tassel.beats.markup import BoardContext
from tassel.voice.action_checker import CLEAR_ALL

# A tag that takes something off the board.
REMOVAL = re.compile(r"\[\[\s*(?:clear|undo)\b[^\]]*\]\]", re.I)
CLEAR_ITEM = re.compile(r"\[\[\s*clear\s+(\S+?)\s*\]\]", re.I)
BARE_CLEAR = re.compile(r"\[\[\s*clear\s*\]\]", re.I)

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


def pick(text: str, board: BoardContext) -> list[str]:
    """The tags that take off what she asked to erase, or [] when her words fit no single item.
    A bare [[clear]] only when she asked for everything, as the action checker's CLEAR_ALL."""
    erase, _ = split_keep(text)
    terms = _terms(board)
    kept = kept_items(text, board)
    if UNDO.search(erase):
        return ["[[undo]]"] if board.history else []
    candidates = {item: t for item, t in terms.items() if item not in kept}
    if CLEAR_ALL.search(erase):
        if not kept:
            return ["[[clear]]"] if terms else []
        return [f"[[clear {item}]]" for item in candidates]
    strong = [item for item, (s, _) in candidates.items() if _matches(erase, s)]
    if len(strong) == 1:
        return [f"[[clear {strong[0]}]]"]
    if strong:
        return []
    if len(candidates) == 1:
        [(item, (_, weak))] = candidates.items()
        if _matches(erase, weak) or PRONOUN.search(erase):
            return [f"[[clear {item}]]"]
    return []


def removes(tag: str) -> bool:
    return REMOVAL.fullmatch(tag.strip()) is not None


def clears_kept(tag: str, kept: set[str]) -> bool:
    """A clear that would take off what she asked to keep."""
    if not kept:
        return False
    if BARE_CLEAR.fullmatch(tag.strip()):
        return True
    found = CLEAR_ITEM.fullmatch(tag.strip())
    return found is not None and found.group(1) in kept
