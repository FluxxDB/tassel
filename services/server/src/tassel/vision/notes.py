"""English vision context and its deterministic template adapter; no I/O or model calls."""

import re
from dataclasses import dataclass

from tassel.domains.dfa.contract import EPSILON
from tassel.domains.dfa.describe import describe_machine, describe_trace
from tassel.domains.dfa.machine import machine_from_spec
from tassel.models import Lang
from tassel.vision.messages import Rung
from tassel.vision.policy import RUNGS, NotePlan, Trigger

HOLDING_LINES: dict[Lang, str] = {
    "en": "Let me look at that.",
    "es": "Déjame mirarlo.",
    "ko": "잠깐만요, 확인해 볼게요.",
}
_EVENTS: dict[Trigger, str] = {
    "attempt": "DFA attempt complete",
    "stuck": "She seems stuck",
    "slip": "Structural slip",
    "asked-walkthrough": "She asked to see it",
    "asked-solution": "She asked for the answer",
}
_VERDICTS = {
    "correct",
    "probably correct (judged)",
    "wrong",
    "probably wrong (judged)",
    "unknown target language",
    "unreadable",
}


def _word(value: str) -> str:
    return value or EPSILON


def _unword(value: str) -> str:
    return "" if value in (EPSILON, "nothing") else value


def _guidance(
    verdict: str, rung: Rung | None, witness: str | None, judged: bool, uncertain: list[str]
) -> list[str]:
    lines = {
        "hint": "Give one short hint as a question; don't name the fix",
        "guiding_question": "Ask one guiding question about that step; don't name the fix",
        "counterexample": (
            f"Ask her to run {_word(witness or '')} through her DFA and say where it ends; "
            "don't name the fix"
        ),
        "walkthrough": (
            "Walk through the trace on her paper, one state at a time, then say where it goes wrong"
        ),
        "solution": "Describe the solution state by state, and explain the dead state",
    }
    if rung is not None:
        result = [lines[rung]]
    elif verdict in ("correct", "probably correct (judged)"):
        result = ["Confirm briefly and ask her why it works"]
    elif verdict == "unreadable":
        result = ["Say you can't read her DFA and ask her to hold the page still"]
    elif verdict == "unknown target language":
        result = ["Ask her which strings her DFA should accept"]
    else:
        result = []
    if judged:
        result.append("Say you think so; don't claim to be sure")
    if uncertain:
        result.append(f"Ask her to check the board's reading of {', '.join(uncertain)} first")
    return result


def render_note(p: NotePlan) -> str:
    v = p.verdict
    verdict = "unreadable" if v is None else v.status
    ce = v.counterexample if v else None
    if verdict == "unsure":
        verdict = "probably wrong (judged)" if ce else "probably correct (judged)"
    elif verdict == "unknown":
        verdict = "unknown target language"
    parts = [f"[vision] {_EVENTS[p.trigger]}", f"Verdict: {verdict}"]
    if ce is not None:
        accepts, should = (
            ("Accepts", "reject") if ce.direction == "false_accept" else ("Rejects", "accept")
        )
        parts.append(f"{accepts} {_word(ce.input)} but should {should}")
        b = ce.blame
        if b is not None:
            if b.kind == "transition":
                parts.append(f"Blame: {b.state} on {b.symbol} goes to {b.target}")
            elif b.kind == "missing_transition":
                parts.append(
                    f"Blame: {b.state} has no move on {b.symbol} "
                    f"after reading {b.prefix or 'nothing'}"
                )
            else:
                should = "accept" if ce.direction == "false_reject" else "not accept"
                parts.append(f"Blame: {b.state} should {should} after reading {_word(b.prefix)}")
        if p.rung == "walkthrough":
            parts.append(f"Trace: {describe_trace(ce.input, ce.student_trace)}")
    if p.rung == "solution" and v and v.reference and v.reference.machine:
        parts.append(f"Solution: {describe_machine(machine_from_spec(v.reference.machine))}")
    uncertain = p.reading.uncertain if p.reading else []
    if uncertain:
        parts.append(f"Unsure reading: {', '.join(uncertain)}")
    parts.append(f"Escalation: {p.rung or 'none'}")
    parts.extend(
        _guidance(verdict, p.rung, ce.input if ce else None, "(judged)" in verdict, uncertain)
    )
    return ". ".join(parts) + "."


@dataclass(frozen=True)
class ParsedNote:
    trigger: Trigger
    verdict: str
    rung: Rung | None
    witness: str | None
    direction: str | None
    blame_kind: str | None
    state: str | None
    symbol: str | None
    target: str | None
    prefix: str | None
    trace: list[str]
    solution: str | None
    judged: bool
    uncertain: list[str]


def parse_note(text: str) -> ParsedNote | None:
    if not text.endswith("."):
        return None
    parts = text[:-1].split(". ")
    events = {f"[vision] {event}": trigger for trigger, event in _EVENTS.items()}
    if len(parts) < 3 or parts[0] not in events or not parts[1].startswith("Verdict: "):
        return None
    verdict = parts[1].removeprefix("Verdict: ")
    if verdict not in _VERDICTS:
        return None
    escalation = [i for i, part in enumerate(parts) if part.startswith("Escalation: ")]
    if len(escalation) != 1:
        return None
    stop = escalation[0]
    rung = parts[stop].removeprefix("Escalation: ")
    if stop < 2 or rung not in (*RUNGS, "none"):
        return None
    rung = None if rung == "none" else rung
    witness = direction = blame_kind = state = symbol = target = prefix = solution = None
    trace, uncertain = [], []
    previous_rank = 0
    for part in parts[2:stop]:
        if match := re.fullmatch(r"(Accepts|Rejects) (.*?) but should (reject|accept)", part):
            rank = 1
            verb, word, should = match.groups()
            if (verb == "Accepts") != (should == "reject"):
                return None
            witness = _unword(word)
            direction = "false_accept" if verb == "Accepts" else "false_reject"
        elif part.startswith("Blame: "):
            rank = 2
            if match := re.fullmatch(r"Blame: (.+?) on (.+?) goes to (.+)", part):
                blame_kind = "transition"
                state, symbol, target = match.groups()
                # The specified transition sentence contains no prefix; leave it unknown.
            elif match := re.fullmatch(
                r"Blame: (.+?) has no move on (.+?) after reading (.+)", part
            ):
                blame_kind = "missing_transition"
                state, symbol, prefix = match.groups()
                prefix = _unword(prefix)
            elif match := re.fullmatch(
                r"Blame: (.+?) should (?:not )?accept after reading (.+)", part
            ):
                blame_kind = "accept_flag"
                state, prefix = match.groups()
                prefix = _unword(prefix)
            else:
                return None
        elif part.startswith("Trace: "):
            rank = 3
            trace = re.split(r" -.*?-> ", part.removeprefix("Trace: "))
        elif part.startswith("Solution: "):
            rank = 4
            solution = part.removeprefix("Solution: ")
        elif part.startswith("Unsure reading: "):
            rank = 5
            uncertain = part.removeprefix("Unsure reading: ").split(", ")
        else:
            return None
        if rank <= previous_rank:
            return None
        previous_rank = rank
    judged = "(judged)" in verdict
    if parts[stop + 1 :] != _guidance(verdict, rung, witness, judged, uncertain):
        return None
    return ParsedNote(
        events[parts[0]],
        verdict,
        rung,
        witness,
        direction,
        blame_kind,
        state,
        symbol,
        target,
        prefix,
        trace,
        solution,
        judged,
        uncertain,
    )


def template_key(n: ParsedNote) -> str:
    if n.trigger == "slip":
        return "hint.slip"
    if n.trigger == "stuck":
        kind = n.blame_kind or "transition"
        if kind == "missing_transition" and n.prefix == "":
            kind = "missing_transition_start"
        return f"hint.{kind}"
    if n.rung == "walkthrough":
        return f"walkthrough.{n.direction}"
    if n.rung is not None:
        return n.rung
    if n.verdict in ("correct", "probably correct (judged)"):
        return "correct"
    return "unreadable" if n.verdict == "unreadable" else "unknown"


def template_slots(n: ParsedNote) -> dict[str, str]:
    return {
        "witness": _word(n.witness) if n.witness is not None else "",
        "prefix": "nothing" if n.prefix == "" else n.prefix or "",
        "state": n.state or "",
        "symbol": n.symbol or "",
        "target": n.target or "",
        "trace": ", ".join(n.trace),
        "end": n.trace[-1] if n.trace else "",
        "solution": n.solution or "",
    }
