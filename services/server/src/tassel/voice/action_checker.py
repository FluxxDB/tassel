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
    if kind == "stage":
        return False  # Only the director can choose the view.
    if decision.action == "mark_paper":
        return kind in ("paper.freeze", "paper.mark", "paper.live")
    if decision.action == "draw_board":
        return kind.startswith("board.") and "trace" not in kind.lower()
    if decision.action == "trace":
        prefix = "paper." if decision.refers_to == "paper" else "board."
        return kind.startswith(prefix) and kind in (
            "paper.freeze",
            "paper.trace",
            "paper.traceStep",
            "board.trace",
            "board.traceStep",
            "board.verdict",
        )
    return False


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


def check_tags(tags, decision, board, language=None):
    context = deepcopy(board)
    result = CheckedTags([], [])
    for tag in tags:
        candidate = deepcopy(context)
        stream = MarkupStream(candidate)
        sentences = stream.feed(tag + " Check.") + stream.flush()
        actions = [a for s in sentences for _, a in s.anchors]
        if (
            not re.fullmatch(r"\[\[[^\[\]]+\]\]", tag)
            or not actions
            or any(s.problems for s in sentences)
            or not all(allowed(a.kind, decision) for a in actions)
        ):
            result.rejected.append(tag)
            continue
        if any(len(s.states) > 8 or len(s.transitions) > 16 for s in candidate.specs.values()):
            result.repair = "Keep the drawing to at most 8 states and 16 edges."
        # Check each newly defined or changed machine, including edge/add commands.
        changed = [s for key, s in candidate.specs.items() if context.specs.get(key) != s]
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
        if result.repair:
            # Atomic rejection: no prefix of an incorrect construction reaches the board.
            return CheckedTags([], list(tags), result.repair)
        result.tags.append(tag)
        result.kinds.extend(a.kind for a in actions)
        context = candidate
    return result
