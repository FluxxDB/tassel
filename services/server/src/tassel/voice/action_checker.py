"""Dry-run commands before beats; never mutate the live board during checking."""

import re
from copy import deepcopy
from dataclasses import dataclass, field

from pydantic import BaseModel, ConfigDict, Field

from tassel.beats.markup import MarkupStream
from tassel.domains.dfa.contract import DfaReading
from tassel.domains.dfa.reference import Reference
from tassel.domains.dfa.regex import compile_regex
from tassel.domains.dfa.verify import verify
from tassel.domains.network.check import check_network


class TargetLanguage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    regex: str = Field(max_length=200)
    alphabet: list[str] = Field(max_length=8)


@dataclass
class CheckedTags:
    tags: list[str]
    rejected: list[str]
    repair: str | None = None
    kinds: list[str] = field(default_factory=list)


def allowed(kind, decision):
    """Drawing is the tutor's strongest tool, so any thinker turn may draw where the turn points:
    paper turns mark her paper, board turns draw and trace on the board, explanations may use
    either. Only the director chooses the view."""
    if kind == "stage":
        return False
    paper, board = kind.startswith("paper."), kind.startswith("board.")
    # Her image (one she sent in the chat): only on turns about it, and only it.
    if decision.action == "mark_image":
        return kind.startswith("image.")
    if kind.startswith("image."):
        return decision.refers_to == "image"
    if decision.action == "mark_paper":
        return paper
    if decision.action == "draw_board":
        return board
    if decision.action == "trace":
        return board or (paper and decision.refers_to == "paper")
    return board or (paper and decision.refers_to == "paper")


def talker_allowed(kind, decision):
    """The fast talker never decides to draw: only light marks that match the director's
    action, never on an explanation turn."""
    if decision.action == "mark_paper":
        return kind in ("paper.freeze", "paper.mark", "paper.live")
    if decision.action == "draw_board":
        return kind.startswith("board.") and "trace" not in kind.lower()
    return False


# A copy of her machine as drawn, to trace a counterexample on: it is meant to be wrong.
STUDENT_COPY = re.compile(r"^yours\w*$")


def _reading(spec):
    return DfaReading.model_validate(
        dict(
            frame_id=None,
            source="board",
            kind=spec.kind,
            alphabet=sorted({s for edge in spec.transitions for s in edge.symbols if s != "ε"}),
            states=[
                dict(
                    id=s.id,
                    label=s.id,
                    start=s.id == spec.start,
                    accept=bool(s.accept),
                    center=dict(x=0.0, y=0.0),
                    r=0.0,
                    box=dict(x=0.0, y=0.0, w=0.0, h=0.0),
                    mark=None,
                    snapped=False,
                    confidence=1.0,
                )
                for s in spec.states
            ],
            transitions=[
                dict(
                    id=f"e{i}",
                    source=e.from_,
                    target=e.to,
                    symbols=e.symbols,
                    label_box=None,
                    mark=None,
                    snapped=False,
                    confidence=1.0,
                )
                for i, e in enumerate(spec.transitions)
            ],
            page=None,
            problem=None,
            problem_kind=spec.kind,
            language=None,
            uncertain=[],
        )
    )


# Her words asking for the whole board to go (a bare [[clear]]); anything less names an item.
CLEAR_ALL = re.compile(
    r"\b(?:everything|all of (?:it|them)|the whole (?:board|thing)|(?:the )?entire board|"
    r"start (?:over|fresh)|clean slate|blank board|clear (?:the|your) (?:white)?board|"
    r"wipe (?:the|your|it)\b)",
    re.I,
)
BARE_CLEAR = re.compile(r"\[\[\s*clear\s*\]\]", re.I)


def check_tags(tags, decision, board, language=None, *, allow=allowed, student_text=None):
    context = deepcopy(board)
    result = CheckedTags([], [])
    for tag in tags:
        if (
            student_text is not None
            and BARE_CLEAR.fullmatch(tag.strip())
            and not CLEAR_ALL.search(student_text)
            and len(context.specs) + len(context.diagrams) > 1
        ):
            # Live test: "delete the old drawing" wiped everything. Clear what she means.
            return CheckedTags(
                [],
                list(tags),
                "Clear only what she means: [[clear ITEM]] with its id, or [[undo]] to take back "
                "your last drawing turn. A bare [[clear]] only when she asks to clear everything.",
            )
        candidate = deepcopy(context)
        stream = MarkupStream(candidate)
        sentences = stream.feed(tag + " Check.") + stream.flush()
        actions = [a for s in sentences for _, a in s.anchors]
        if (
            not re.fullmatch(r"\[\[[^\[\]]+\]\]", tag)
            or not actions
            or any(s.problems for s in sentences)
            or not all(allow(a.kind, decision) for a in actions)
        ):
            result.rejected.append(tag)
            continue
        if any(len(s.states) > 8 or len(s.transitions) > 16 for s in candidate.specs.values()):
            result.repair = "Keep the drawing to at most 8 states and 16 edges."
        # Check each newly defined or changed machine, including edge/add commands.
        changed = [
            s
            for key, s in candidate.specs.items()
            if context.specs.get(key) != s and not STUDENT_COPY.match(key)
        ]
        if language and changed:
            try:
                machine = compile_regex(language.regex, language.alphabet)
                # Exact relative to the brief's stated language; do not claim that the LLM's
                # interpretation of the student's problem is independently trusted.
                reference = Reference(
                    "brief", None, machine, language.regex, "llm-unchecked", False
                )
                for spec in changed:
                    verdict = verify(_reading(spec), reference)
                    if verdict.counterexample is not None or verdict.status == "unreadable":
                        witness = verdict.counterexample.input if verdict.counterexample else ""
                        result.repair = (
                            f"DFA differs from the target language on input {witness!r}."
                        )
                    if any(i.kind == "unknown_symbol" for i in verdict.issues):
                        result.repair = "DFA uses a symbol outside the target alphabet."
            except ValueError:
                result.repair = "The target language could not be verified."
        for action in actions:
            if action.kind == "board.diagram":
                result.repair = check_network(action.spec) or result.repair
        if result.repair:
            # Atomic rejection: no prefix of an incorrect construction reaches the board.
            return CheckedTags([], list(tags), result.repair)
        result.tags.append(tag)
        result.kinds.extend(a.kind for a in actions)
        context = candidate
    return result
