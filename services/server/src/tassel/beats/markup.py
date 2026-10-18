"""Ada's board markup (P5-R6): [[verb args…]] tags anywhere in her text, each anchored to the word
that starts after it, or to the word it sits inside.

MarkupStream reads her response as it streams and gives back whole sentences: the clean text she
says and the captions show, the tagged text her conversation keeps, and each tag's action at its
word. A bad or unknown command is taken out of the text, anchors nothing, and is named in the
sentence's problems. Single brackets ([0,1]) are text.

- Sentences end at ".", "?" or "!" followed by whitespace or the end of the response, outside
  tags.
- Tags after a sentence's last word fire with it, as end markers, so a finished sentence waits
  for the next text that isn't a tag, or the end of the response (review I7). Tags before a
  sentence's first word anchor to that word.
- A sentence too long for one beat (80 words, 400 characters or 40 markers) is split between its
  words (review M4).

Commands (ITEM is a board item's id; EL is "start", a state such as "q0", or an edge "q0>q1"):

    dfa ITEM [hidden] [title="…"] start=S [accept=S,S] FROM-SYMS-TO…   (and nfa; "eps" is ε)
    reveal ITEM [EL…] · add ITEM S [accept] · edge ITEM FROM TO SYMS
    highlight ITEM EL · unhighlight ITEM EL · pulse ITEM EL · note ITEM "…" [near=ITEM:EL]
    trace ITEM ON INPUT [student] · step ITEM · verdict ITEM accept|reject [expected=…] [note="…"]
    focus [ITEM] · clear [ITEM] · stage paper|board|split
    circle EL · wash EL · number N EL · strike EL · underline EL · check EL · callout EL "…"
      (on paper EL may also be a numbered marker, m3, or a page region, box=x,y,w,h)
    ptrace INPUT · pstep · live · freeze [latest|frame=ID]   (review I8)
"""

import re
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

from .models import (
    BEAT_TEXT_MAX,
    EPSILON,
    MARKERS_MAX,
    WORDS_MAX,
    AutomatonSpec,
    BeatAction,
    BoardAddState,
    BoardAddTransition,
    BoardAutomaton,
    BoardClear,
    BoardDiagram,
    BoardFocus,
    BoardHighlight,
    BoardNote,
    BoardPulse,
    BoardReveal,
    BoardTrace,
    BoardTraceStep,
    BoardVerdict,
    DiagramSpec,
    PaperElements,
    PaperFrame,
    PaperFreeze,
    PaperLive,
    PaperMarkAction,
    PaperTrace,
    PaperTraceStep,
    StageAction,
)

MAX_TAG = 1000
"""How long an open "[[" may run, in characters, before it's taken as unclosed."""


# How many of her drawing turns [[undo]] can take back.
UNDO_DEPTH = 10


@dataclass
class BoardContext:
    """One per bot: the automata Ada has defined, which trace copies, and the paper-mark counter.
    P4 sets the frozen paper's ink and the automaton read from it, which freeze sends (I8)."""

    specs: dict[str, AutomatonSpec] = field(default_factory=dict)
    diagrams: dict[str, DiagramSpec] = field(default_factory=dict)
    pending_diagrams: dict[str, DiagramSpec] = field(default_factory=dict)
    next_mark: int = 1
    paper_frame: PaperFrame | None = None
    paper_elements: PaperElements | None = None
    paper_spec: AutomatonSpec | None = None
    # Moves a mark's box onto her ink on the paper_frame it names: (frame id, refine), where
    # refine(verb, box) gives the box on her ink or None (tassel.vision.ink_boxes).
    paper_ink: tuple[str, Callable[[str, dict[str, float]], dict[str, float] | None]] | None = None
    # Her edit history: the board (automata and diagrams) as it was before each of her last
    # drawing turns, newest last, so [[undo]] can put it back (owner, 2026-10-18).
    history: list[tuple[dict[str, AutomatonSpec], dict[str, DiagramSpec]]] = field(
        default_factory=list
    )
    _turn_start: tuple[dict[str, AutomatonSpec], dict[str, DiagramSpec]] | None = None
    # What [[undo]] took away, newest last, for [[redo]]; a new drawing turn clears it.
    redo_stack: list[tuple[dict[str, AutomatonSpec], dict[str, DiagramSpec]]] = field(
        default_factory=list
    )
    _stepped: bool = False

    def _state(self) -> tuple[dict[str, AutomatonSpec], dict[str, DiagramSpec]]:
        return deepcopy(self.specs), deepcopy(self.diagrams)

    def begin_turn(self) -> None:
        """One of her replies begins: remember the board as it is."""
        self._turn_start = self._state()
        self._stepped = False

    def end_turn(self) -> None:
        """Her reply ended: a reply that changed the board is a step [[undo]] can take back, and
        a new drawing (not an undo or redo) ends what [[redo]] could put back."""
        start, self._turn_start = self._turn_start, None
        if start is not None and start != (self.specs, self.diagrams):
            self.history = [*self.history[-(UNDO_DEPTH - 1) :], start]
            if not self._stepped:
                self.redo_stack.clear()

    def undo(self) -> list[BeatAction]:
        """The actions that put back the board as it was before her last drawing turn: what it
        added is cleared, what it changed or cleared is drawn again whole."""
        if not self.history:
            return []
        self.redo_stack.append(self._state())
        return self._restore(self.history.pop())

    def redo(self) -> list[BeatAction]:
        """The actions that put back what her last [[undo]] took away."""
        if not self.redo_stack:
            return []
        self.history = [*self.history[-(UNDO_DEPTH - 1) :], self._state()]
        return self._restore(self.redo_stack.pop())

    def redo_items(self) -> list[str]:
        """The items [[redo]] would change, for the thinker's Board items."""
        if not self.redo_stack:
            return []
        specs, diagrams = self.redo_stack[-1]
        return sorted(
            item
            for item in {*specs, *diagrams, *self.specs, *self.diagrams}
            if specs.get(item) != self.specs.get(item)
            or diagrams.get(item) != self.diagrams.get(item)
        )

    def _restore(self, state) -> list[BeatAction]:
        specs, diagrams = state
        actions: list[BeatAction] = [
            _make(BoardClear, item=item)
            for item in [*self.specs, *self.diagrams]
            if item not in specs and item not in diagrams
        ]
        for item, spec in specs.items():
            if self.specs.get(item) != spec:
                actions.append(_make(BoardAutomaton, item=item, spec=_dumped(spec), reveal="all"))
        for item, diagram in diagrams.items():
            if self.diagrams.get(item) != diagram:
                actions.append(_make(BoardDiagram, item=item, spec=diagram, reveal="all"))
        self.specs, self.diagrams = deepcopy(specs), deepcopy(diagrams)
        self._stepped = True
        if self._turn_start is not None:
            # The step isn't one of its own: what else this reply draws is.
            self._turn_start = self._state()
        return actions


@dataclass(frozen=True)
class Sentence:
    clean: str
    """What she says, and the captions show: her words, without tags."""
    tagged: str
    """What she wrote, tags included, for her conversation."""
    anchors: list[tuple[int, BeatAction]]
    """Each tag's action at the index of its word; len(words) for after the last one."""
    problems: list[str]


class MarkupError(ValueError):
    """Why a command can't be read."""


def parse_command(command: str, ctx: BoardContext) -> BeatAction | None:
    """The action for one tag (what's between "[[" and "]]"), or None when it's bad or unknown.
    It changes `ctx` as the command does: dfa remembers its automaton, a mark takes a number."""
    try:
        return _command(command, ctx)
    except MarkupError:
        return None


class MarkupStream:
    """Ada's text, chunk by chunk, as whole sentences: feed() each chunk, then flush() at the
    end of her response."""

    def __init__(self, ctx: BoardContext) -> None:
        self._ctx = ctx
        self._pending = ""
        """Raw text not yet read: an open "[[" and what follows it, or a lone "[" at the end."""
        self._tokens: list[_Token] = []
        """The sentence being written."""
        self._held: list[_Token] | None = None
        """A finished sentence, waiting to see what follows it."""

    def feed(self, chunk: str) -> list[Sentence]:
        """The sentences `chunk` completes."""
        self._pending += chunk
        self._read(final=False)
        return self._take(final=False)

    def flush(self) -> list[Sentence]:
        """The rest, at the end of her response. An unclosed "[[" is dropped. The stream is then
        ready for her next response; its context carries on."""
        self._read(final=True)
        return self._take(final=True)

    def _read(self, *, final: bool) -> None:
        """Turns pending text into tokens, each complete tag parsed once, in order."""
        while self._pending:
            opening = self._pending.find("[[")
            if opening < 0:
                # A lone "[" at the end may be half of a "[[" still streaming.
                keep = 1 if not final and self._pending.endswith("[") else 0
                self._add(_Text(self._pending[: len(self._pending) - keep]))
                self._pending = self._pending[len(self._pending) - keep :]
                return
            if opening > 0:
                self._add(_Text(self._pending[:opening]))
                self._pending = self._pending[opening:]
            closing = self._pending.find("]]", 2)
            if closing >= 0:
                raw = self._pending[: closing + 2]
                self._pending = self._pending[closing + 2 :]
                step = raw[2:-2].strip().lower()
                if step in ("undo", "redo"):
                    # One tag, as many actions as the step changes items.
                    for action in self._ctx.undo() if step == "undo" else self._ctx.redo():
                        self._add(_Tag(raw, action, None))
                else:
                    self._add(self._tag(raw))
            elif final:
                self._add(
                    _Tag(self._pending, None, f"unclosed tag dropped: {_short(self._pending)}")
                )
                self._pending = ""
            elif len(self._pending) > MAX_TAG:
                # It will never close: drop the "[[" and read on.
                self._add(_Tag("[[", None, f"unclosed tag dropped: {_short(self._pending)}"))
                self._pending = self._pending[2:]
            else:
                return

    def _tag(self, raw: str) -> "_Tag":
        notes: list[str] = []
        try:
            action = _command(raw[2:-2], self._ctx, notes)
            # Read, but with parts dropped: they're logged with the sentence's problems.
            return _Tag(raw, action, f"{_short(raw)}: {'; '.join(notes)}" if notes else None)
        except _UnknownVerb:
            return _Tag(raw, None, f"unknown command {_short(raw)}")
        except MarkupError as error:
            return _Tag(raw, None, f"bad command {_short(raw)}: {error}")

    def _add(self, token: "_Token") -> None:
        if isinstance(token, _Text):
            if not token.text:
                return
            if self._tokens and isinstance(self._tokens[-1], _Text):
                token = _Text(self._tokens.pop().text + token.text)
        self._tokens.append(token)

    def _take(self, *, final: bool) -> list[Sentence]:
        """The sentences that are settled: each ended, and followed by a word or by the end."""
        out: list[Sentence] = []
        while True:
            if self._held is not None:
                if _has_words(self._tokens):
                    out += _sentences(self._held)
                    self._held = None
                elif final:
                    # Nothing but tags after its last word: they fire with it (I7).
                    out += _sentences(self._held + self._tokens)
                    self._held, self._tokens = None, []
                    return out
                else:
                    return out
            cut = _sentence_end(self._tokens, final=final)
            if cut is None:
                if final and self._tokens:
                    out += _sentences(self._tokens)
                    self._tokens = []
                return out
            self._held, self._tokens = _split(self._tokens, cut)


# Tokens: her text, and tags as they were written with their parsed action.


@dataclass(frozen=True)
class _Text:
    text: str


@dataclass(frozen=True)
class _Tag:
    raw: str
    action: BeatAction | None
    problem: str | None


_Token = _Text | _Tag


def _has_words(tokens: list[_Token]) -> bool:
    return any(isinstance(token, _Text) and token.text.strip() for token in tokens)


def _sentence_end(tokens: list[_Token], *, final: bool) -> tuple[int, int] | None:
    """Where the first sentence in `tokens` ends: just after a ".", "?" or "!" that whitespace
    follows (tags between don't count), or that ends the response. None while it's unsure."""
    for i, token in enumerate(tokens):
        if not isinstance(token, _Text):
            continue
        for j, char in enumerate(token.text):
            if char not in ".?!":
                continue
            after = _next_char(tokens, i, j + 1)
            if after is None:
                return (i, j + 1) if final else None
            if after.isspace():
                return (i, j + 1)
    return None


def _next_char(tokens: list[_Token], i: int, j: int) -> str | None:
    """The first character of text from tokens[i] at j on, skipping tags; None if none yet."""
    for k in range(i, len(tokens)):
        token = tokens[k]
        if isinstance(token, _Text):
            rest = token.text[j:] if k == i else token.text
            if rest:
                return rest[0]
    return None


def _split(tokens: list[_Token], cut: tuple[int, int]) -> tuple[list[_Token], list[_Token]]:
    i, j = cut
    token = tokens[i]
    assert isinstance(token, _Text)
    head = [*tokens[:i], _Text(token.text[:j])]
    tail = [_Text(token.text[j:]), *tokens[i + 1 :]]
    return [t for t in head if t != _Text("")], [t for t in tail if t != _Text("")]


def _sentences(tokens: list[_Token]) -> list[Sentence]:
    """`tokens` as one sentence, or as several when it's too long for one beat (M4)."""
    raw = ""
    clean = ""
    raw_at: list[int] = []
    """Where each character of `clean` is in `raw`."""
    tags: list[tuple[int, int, _Tag]] = []
    """Each tag with where it is in `clean` and in `raw`."""
    for token in tokens:
        if isinstance(token, _Text):
            raw_at.extend(range(len(raw), len(raw) + len(token.text)))
            clean += token.text
            raw += token.text
        else:
            tags.append((len(clean), len(raw), token))
            raw += token.raw

    units = _units(clean)
    anchors = [(_anchor(units, at), tag.action) for at, _, tag in tags if tag.action is not None]
    if not units and not anchors and not any(tag.problem for _, _, tag in tags):
        return []

    out: list[Sentence] = []
    ranges = _chunks(units, [index for index, _ in anchors])
    for a, b in ranges:
        last = b == len(units)
        start = 0 if a == 0 else raw_at[units[a - 1][1] - 1] + 1
        end = len(raw) if last else raw_at[units[b - 1][1] - 1] + 1
        mine = [
            (index - a, action)
            for index, action in anchors
            if a <= index < b or (last and index == len(units))
        ]
        problems = [tag.problem for _, at, tag in tags if tag.problem and start <= at < end]
        words = " ".join(clean[s:e] for s, e in units[a:b])
        # More than MARKERS_MAX tags on one word: the rest go in wordless beats after it.
        out.append(Sentence(words, raw[start:end].strip(), mine[:MARKERS_MAX], problems))
        for overflow in range(MARKERS_MAX, len(mine), MARKERS_MAX):
            extra = [(0, action) for _, action in mine[overflow : overflow + MARKERS_MAX]]
            out.append(Sentence("", "", extra, []))
    return out


def _units(clean: str) -> list[tuple[int, int]]:
    """The words of `clean` as (start, end); a word longer than a beat's text is cut up."""
    units: list[tuple[int, int]] = []
    for match in re.finditer(r"\S+", clean):
        for start in range(match.start(), match.end(), BEAT_TEXT_MAX):
            units.append((start, min(start + BEAT_TEXT_MAX, match.end())))
    return units


def _anchor(units: list[tuple[int, int]], at: int) -> int:
    """The word a tag at `at` belongs to: the one it's inside, else the next one to start."""
    for index, (start, end) in enumerate(units):
        if start < at < end or start >= at:
            return index
    return len(units)


def _chunks(units: list[tuple[int, int]], anchored: list[int]) -> list[tuple[int, int]]:
    """Runs of whole words, each as long as fits a beat: at most WORDS_MAX words, BEAT_TEXT_MAX
    characters and MARKERS_MAX markers (a marker after the last word counts with it)."""
    if not units:
        return [(0, 0)]
    marks = [0] * len(units)
    for index in anchored:
        marks[min(index, len(units) - 1)] += 1
    chunks: list[tuple[int, int]] = []
    a = 0
    while a < len(units):
        b = a + 1
        length = units[a][1] - units[a][0]
        count = marks[a]
        while b < len(units):
            longer = length + 1 + units[b][1] - units[b][0]
            more = count + marks[b]
            if b - a + 1 > WORDS_MAX or longer > BEAT_TEXT_MAX or more > MARKERS_MAX:
                break
            length, count = longer, more
            b += 1
        chunks.append((a, b))
        a = b
    return chunks


def _short(raw: str) -> str:
    return raw if len(raw) <= 60 else f"{raw[:57]}…"


# Commands


class _UnknownVerb(MarkupError):
    pass


@dataclass(frozen=True)
class _Arg:
    text: str
    """Without its quotes."""
    quoted: bool
    """The whole argument was one quoted string."""


_ARG = re.compile(r'(?:[^\s"]+|"[^"]*")+')


def _args(command: str) -> list[_Arg]:
    if command.count('"') % 2:
        raise MarkupError("a quote isn't closed")
    return [
        _Arg(
            raw.replace('"', ""), raw.startswith('"') and raw.endswith('"') and raw.count('"') == 2
        )
        for raw in _ARG.findall(command)
    ]


def _command(command: str, ctx: BoardContext, notes: list[str] | None = None) -> BeatAction:
    notes = [] if notes is None else notes
    verb = command.strip().split(" ", 1)[0].lower()
    if verb in ("dfa", "nfa"):
        command = _tidy_moves(command)
    args = _args(command)
    if not args:
        raise MarkupError("an empty tag")
    verb = args[0].text.lower()
    rest = args[1:]
    if verb in ("dfa", "nfa"):
        return _automaton(verb, rest, ctx, notes)
    if verb == "edge" and len(rest) == 2 and not rest[1].quoted:
        # One move for the edge: [[edge ITEM FROM-SYMS->TO]].
        found = _MOVE.fullmatch(_tidy_moves(rest[1].text))
        if found is not None and found.group(3):
            start, _, symbols, end = found.groups()
            return _add_edge([rest[0].text, start, end, symbols], ctx)
    if verb == "diagram":
        [item] = _between(rest, 1, 1, "diagram ITEM")
        spec = ctx.pending_diagrams.get(item)
        if spec is None:
            raise MarkupError(f"no pending diagram {item}")
        action = _make(BoardDiagram, item=item, spec=spec, reveal="all")
        ctx.pending_diagrams.pop(item)
        ctx.diagrams[item] = spec
        return action
    if verb == "reveal":
        item, *els = _between(rest, 1, None, "reveal ITEM [EL…]")
        return _make(BoardReveal, item=item, els=[_element(el) for el in els] or None)
    if verb == "add":
        return _add_state(_between(rest, 2, 3, "add ITEM STATE [accept]"), ctx)
    if verb == "edge":
        return _add_edge(_between(rest, 4, 4, "edge ITEM FROM TO SYMS"), ctx)
    if verb in ("highlight", "unhighlight"):
        item, el = _between(rest, 2, 2, f"{verb} ITEM EL")
        return _make(BoardHighlight, item=item, el=_element(el), on=verb == "highlight")
    if verb == "pulse":
        item, el = _between(rest, 2, 2, "pulse ITEM EL")
        return _make(BoardPulse, item=item, el=_element(el))
    if verb == "note":
        return _note(rest)
    if verb == "trace":
        return _trace(_between(rest, 3, 4, "trace ITEM ON INPUT [student]"), ctx)
    if verb == "step":
        [item] = _between(rest, 1, 1, "step ITEM")
        return _make(BoardTraceStep, item=item)
    if verb == "verdict":
        return _verdict(rest)
    if verb in ("focus", "clear"):
        item = next(iter(_between(rest, 0, 1, f"{verb} [ITEM]")), None)
        if verb == "focus":
            return _make(BoardFocus, item=item)
        action = _make(BoardClear, item=item)
        if item is None:
            ctx.specs.clear()
            ctx.diagrams.clear()
            ctx.pending_diagrams.clear()
        else:
            ctx.specs.pop(item, None)
            ctx.diagrams.pop(item, None)
            ctx.pending_diagrams.pop(item, None)
        return action
    if verb == "stage":
        [view] = _between(rest, 1, 1, "stage paper|board|split")
        return _make(StageAction, view=view)
    if verb in ("circle", "wash", "number", "strike", "underline", "check", "callout"):
        return _mark(verb, rest, ctx)
    if verb == "ptrace":
        [text] = _between(rest, 1, 1, "ptrace INPUT")
        return _make(PaperTrace, input=text)
    if verb == "pstep":
        _between(rest, 0, 0, "pstep")
        return _make(PaperTraceStep)
    if verb == "live":
        _between(rest, 0, 0, "live")
        return _make(PaperLive)
    if verb == "freeze":
        return _freeze(rest, ctx)
    raise _UnknownVerb(f"no command {verb}")


# A move: FROM-SYMS-TO, or FROM-SYMS->TO; SYMS may hold commas. FROM->TO has no symbols.
_MOVE = re.compile(r"(?<![\w'-])([\w']+)-(?:(>)|([^\s>]*?)(?:->|-(?=[\w'])))([\w']+)")
_STATE = re.compile(r"[\w']+")


def _tidy_moves(command: str) -> str:
    """Closes up the spacing models write in moves and lists, outside quoted strings:
    "q0 -0-> q1" to "q0-0->q1", and "q0, q1" or "accept=q1, q2" to "q0,q1" and "accept=q1,q2"."""
    parts = command.split('"')
    for i in range(0, len(parts), 2):
        part = re.sub(r"\s*-\s*>\s*", "->", parts[i])
        part = re.sub(r"(?<=\w)\s+-(?=\S)", "-", part)
        parts[i] = re.sub(r",\s+", ",", part)
    return '"'.join(parts)


def _automaton(
    kind: str, args: list[_Arg], ctx: BoardContext, notes: list[str] | None = None
) -> BeatAction:
    """[[dfa ITEM [hidden] [title=…] start=S accept=S,… [S,S,…] MOVE …]], read tolerantly where
    it's unambiguous: moves with -> arrows, commas between moves, an optional state list. What
    can't be read for sure (a move with no symbol, "...") is dropped and noted."""
    notes = [] if notes is None else notes
    if not args:
        raise MarkupError(f"{kind} needs an item")
    if "=" in args[0].text or _MOVE.search(args[0].text):
        # No item name (the real-token eval's [[dfa start=q0 …]]): name it, never drop it.
        name = (
            kind
            if kind not in ctx.specs
            else next(f"{kind}{n}" for n in range(2, 100) if f"{kind}{n}" not in ctx.specs)
        )
        args = [_Arg(name, False), *args]
        notes.append(f"named {name}")
    item = args[0].text
    hidden = False
    title: str | None = None
    start: str | None = None
    accept: list[str] = []
    loose: list[str] = []
    for arg in args[1:]:
        key, equals, value = arg.text.partition("=")
        if arg.text == "hidden" and not arg.quoted:
            hidden = True
        elif equals and key == "title":
            title = value
        elif equals and key == "start":
            start = value
        elif equals and key == "accept":
            accept = [state for state in value.split(",") if state]
        elif not equals and not arg.quoted:
            loose.append(arg.text)
        else:
            raise MarkupError(f"{kind} can't read {arg.text!r}")
    if start is None:
        raise MarkupError(f"{kind} needs start=STATE")
    text = " ".join(loose)
    moves: list[dict[str, Any]] = []
    for found in _MOVE.finditer(text):
        source, arrow, symbols, target = found.groups()
        if arrow or not symbols or not symbols.strip(","):
            notes.append(f"dropped {source}->{target}: no symbol")
            continue
        moves.append({"from": source, "to": target, "symbols": _symbols(symbols.strip(","))})
    listed: list[str] = []
    for token in re.split(r"[\s,]+", _MOVE.sub(" ", text)):
        if not token:
            continue
        if _STATE.fullmatch(token):
            listed.append(token)
        elif token.strip(".…") == "":
            notes.append(f"ignored {token}")
        else:
            notes.append(f"can't read {token!r}")
    # Spec order: the start state, the states listed, then each as its first move names it.
    order = list(
        dict.fromkeys([start, *listed, *(m[end] for m in moves for end in ("from", "to")), *accept])
    )
    spec = {
        "kind": kind,
        "states": [{"id": s, "accept": True} if s in accept else {"id": s} for s in order],
        "start": start,
        "transitions": moves,
    }
    action = _make(
        BoardAutomaton, item=item, spec=spec, title=title, reveal="none" if hidden else None
    )
    ctx.specs[action.item] = action.spec
    return action


def _move(text: str) -> dict[str, Any]:
    """FROM-SYMS-TO. No state id holds "-", so the first and last ones split it."""
    first, last = text.find("-"), text.rfind("-")
    if first <= 0 or first == last or last == len(text) - 1:
        raise MarkupError(f"can't read the move {text!r}")
    return {
        "from": text[:first],
        "to": text[last + 1 :],
        "symbols": _symbols(text[first + 1 : last]),
    }


def _symbols(text: str) -> list[str]:
    return [EPSILON if symbol == "eps" else symbol for symbol in text.split(",")]


def _add_state(args: list[str], ctx: BoardContext) -> BeatAction:
    item, state, *flags = args
    if flags not in ([], ["accept"]):
        raise MarkupError(f"add can't read {flags[0]!r}")
    action = _make(BoardAddState, item=item, id=state, accept=True if flags else None)
    known = ctx.specs.get(item)
    if known is not None:
        added = {"id": state, "accept": True} if flags else {"id": state}
        ctx.specs[item] = _respec(known, states=[*_dumped(known)["states"], added])
    return action


def _add_edge(args: list[str], ctx: BoardContext) -> BeatAction:
    item, start, end, symbols = args
    action = _make(BoardAddTransition, item=item, from_=start, to=end, symbols=_symbols(symbols))
    known = ctx.specs.get(item)
    if known is not None:
        moves = _dumped(known)["transitions"]
        pair = next((m for m in moves if (m["from"], m["to"]) == (start, end)), None)
        if pair is None:
            moves.append({"from": start, "to": end, "symbols": list(action.symbols)})
        else:
            pair["symbols"] = list(dict.fromkeys([*pair["symbols"], *action.symbols]))
        ctx.specs[item] = _respec(known, transitions=moves)
    return action


def _note(args: list[_Arg]) -> BeatAction:
    if len(args) < 2 or not args[1].quoted:
        raise MarkupError('note needs ITEM "TEXT"')
    near = None
    for arg in args[2:]:
        key, equals, value = arg.text.partition("=")
        item, colon, el = value.partition(":")
        if not (equals and key == "near" and colon) or near is not None:
            raise MarkupError(f"note can't read {arg.text!r}")
        near = {"item": item, "el": _element(el)}
    return _make(BoardNote, item=args[0].text, text=args[1].text.replace("\\n", "\n"), near=near)


def _trace(args: list[str], ctx: BoardContext) -> BeatAction:
    item, on, text, *flags = args
    if flags not in ([], ["student"]):
        raise MarkupError(f"trace can't read {flags[0]!r}")
    spec = ctx.specs.get(on)
    if spec is None:
        raise MarkupError(f"no automaton {on} to trace")
    return _make(
        BoardTrace, item=item, spec=spec, input=text, on=on, subject="student" if flags else None
    )


def _verdict(args: list[_Arg]) -> BeatAction:
    if len(args) < 2:
        raise MarkupError("verdict needs ITEM accept|reject")
    options: dict[str, str] = {}
    for arg in args[2:]:
        key, equals, value = arg.text.partition("=")
        if not equals or key not in ("expected", "note") or key in options:
            raise MarkupError(f"verdict can't read {arg.text!r}")
        options[key] = value
    return _make(
        BoardVerdict,
        item=args[0].text,
        got=args[1].text,
        expected=options.get("expected"),
        note=options.get("note"),
    )


def _mark(verb: str, args: list[_Arg], ctx: BoardContext) -> BeatAction:
    mark: dict[str, Any] = {"id": f"m{ctx.next_mark}"}
    if verb == "number":
        n, el = _between(args, 2, 2, "number N EL")
        if not re.fullmatch(r"[0-9]+", n):
            raise MarkupError(f"{n!r} isn't a number")
        mark |= {"type": "step", "n": int(n), "target": _paper_target(el)}
    elif verb == "callout":
        if len(args) != 2 or not args[1].quoted:
            raise MarkupError('callout needs EL "TEXT"')
        mark |= {
            "type": "callout",
            "target": _paper_target(args[0].text),
            "text": args[1].text,
        }
    else:
        [el] = _between(args, 1, 1, f"{verb} EL")
        mark |= {"type": "circle" if verb == "wash" else verb, "target": _paper_target(el)}
        if verb == "wash":
            mark["wash"] = True
    mark["target"] = _on_ink(verb, mark["target"], ctx)
    action = _make(PaperMarkAction, mark=mark)
    ctx.next_mark += 1
    return action


def _freeze(args: list[_Arg], ctx: BoardContext) -> BeatAction:
    [which] = _between(args, 0, 1, "freeze [latest|frame=ID]") or ["latest"]
    key, equals, value = which.partition("=")
    if which == "latest":
        frame: dict[str, str] = {"kind": "latest"}
    elif equals and key == "frame":
        frame = {"kind": "frame", "id": value}
    else:
        raise MarkupError(f"freeze can't read {which!r}")
    if ctx.paper_frame is not None:
        if which == "latest" or value == ctx.paper_frame.id:
            return _make(
                PaperFreeze, frame=ctx.paper_frame, elements=ctx.paper_elements, spec=ctx.paper_spec
            )
        # We only know the geometry of the image supplied to this turn.
        return _make(PaperFreeze, frame=frame)
    return _make(PaperFreeze, frame=frame, elements=ctx.paper_elements, spec=ctx.paper_spec)


def _between(args: list[_Arg], low: int, high: int | None, usage: str) -> list[str]:
    if len(args) < low or (high is not None and len(args) > high):
        raise MarkupError(f"usage: {usage}")
    return [arg.text for arg in args]


# Marks whose line must find her ink's own edge, not a marker's padded box: an underline
# under a padded label ran into the line below on her tight lines (live, 2026-10-18).
_ON_INK = {"underline", "strike"}


def _on_ink(verb: str, target: dict[str, Any], ctx: BoardContext) -> dict[str, Any]:
    """A box target moved onto the ink it points at, and an underline's or strike's handwriting
    marker turned into its ink's box, when this turn's paper has the ink; else `target`."""
    if ctx.paper_ink is None or ctx.paper_frame is None or ctx.paper_ink[0] != ctx.paper_frame.id:
        return target
    refine = ctx.paper_ink[1]
    if "box" in target:
        refined = refine(verb, target["box"])
        return target if refined is None else {"box": refined}
    detected = ctx.paper_elements.detected if ctx.paper_elements else None
    if verb not in _ON_INK or detected is None or not detected.width or not detected.height:
        return target
    item = next((i for i in detected.items if i.id == target.get("el")), None)
    if item is None or item.kind != "label":
        return target
    box = {
        "x": item.box.x / detected.width,
        "y": item.box.y / detected.height,
        "w": item.box.w / detected.width,
        "h": item.box.h / detected.height,
    }
    refined = refine(verb, box)
    return target if refined is None else {"box": refined}


def _paper_target(text: str) -> dict[str, Any]:
    if text.startswith("box="):
        return {"box": paper_box(text)}
    return {"el": text if re.fullmatch(r"m[1-9][0-9]{0,2}", text) else _element(text)}


# A box target's sides, as fractions of the page: big enough to be ink, smaller than the page.
BOX_MIN_SIDE = 0.005
BOX_MAX_SIDE = 0.95
_BOX_EDGE = 1e-6  # Float slack at the page's right and bottom edges.
_NUMBER = re.compile(r"[0-9]*\.?[0-9]+")


def paper_box(text: str) -> dict[str, float]:
    """`box=x,y,w,h` as a NormRect on the page, or a MarkupError: four plain numbers, inside the
    page, each side from BOX_MIN_SIDE to BOX_MAX_SIDE of it."""
    _, equals, value = text.partition("=")
    parts = value.split(",")
    if not equals or len(parts) != 4 or not all(_NUMBER.fullmatch(p) for p in parts):
        raise MarkupError(f"box needs x,y,w,h, not {value!r}")
    x, y, w, h = map(float, parts)
    if not (BOX_MIN_SIDE <= w <= BOX_MAX_SIDE and BOX_MIN_SIDE <= h <= BOX_MAX_SIDE):
        raise MarkupError(f"box sides must be from {BOX_MIN_SIDE} to {BOX_MAX_SIDE} of the page")
    if x + w > 1 + _BOX_EDGE or y + h > 1 + _BOX_EDGE:
        raise MarkupError("box runs off the page")
    return {"x": x, "y": y, "w": w, "h": h}


def box_arg(x: float, y: float, w: float, h: float) -> str:
    """The `box=` argument for a page region, to three decimals, kept on the page."""
    x, y = min(max(round(x, 3), 0.0), 1.0), min(max(round(y, 3), 0.0), 1.0)
    w, h = min(round(w, 3), round(1 - x, 3)), min(round(h, 3), round(1 - y, 3))
    return f"box={x:.3f},{y:.3f},{w:.3f},{h:.3f}"


def _element(text: str) -> str:
    """'start', a state such as 'q0', or an edge such as 'q0>q1', as an element ref."""
    if text.startswith(("node:", "group:", "edge:", "state:")):
        return text
    if text == "start":
        return "start"
    return f"edge:{text}" if ">" in text else f"state:{text}"


_KINDS: dict[type[BaseModel], str] = {
    BoardDiagram: "board.diagram",
    BoardAutomaton: "board.automaton",
    BoardAddState: "board.addState",
    BoardAddTransition: "board.addTransition",
    BoardReveal: "board.reveal",
    BoardHighlight: "board.highlight",
    BoardPulse: "board.pulse",
    BoardNote: "board.note",
    BoardTrace: "board.trace",
    BoardTraceStep: "board.traceStep",
    BoardVerdict: "board.verdict",
    BoardFocus: "board.focus",
    BoardClear: "board.clear",
    PaperFreeze: "paper.freeze",
    PaperMarkAction: "paper.mark",
    PaperTrace: "paper.trace",
    PaperTraceStep: "paper.traceStep",
    PaperLive: "paper.live",
    StageAction: "stage",
}


def _make(cls: type[Any], **fields: Any) -> Any:
    """`cls`'s action from `fields`, the absent (None) ones left out, checked as the app would."""
    try:
        return cls(kind=_KINDS[cls], **{k: v for k, v in fields.items() if v is not None})
    except ValidationError as error:
        first = error.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise MarkupError(f"{where}: {first['msg']}" if where else first["msg"]) from error


def _dumped(spec: AutomatonSpec) -> dict[str, Any]:
    return spec.model_dump(mode="json")


def _respec(spec: AutomatonSpec, **changes: Any) -> AutomatonSpec:
    """`spec` with `changes`, checked: a change that breaks it is a bad command."""
    try:
        return AutomatonSpec.model_validate({**_dumped(spec), **changes})
    except ValidationError as error:
        raise MarkupError(error.errors()[0]["msg"]) from error
