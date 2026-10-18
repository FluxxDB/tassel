"""Bounded per-turn decisions; the deterministic policy is also the offline fallback."""

import asyncio
import json
import re
import time
from typing import Literal

from loguru import logger
from openai import AsyncOpenAI, InternalServerError, RateLimitError
from pydantic import BaseModel, ConfigDict, model_validator

# Cerebras sometimes answers 429 for a few seconds; the same Qwen model on these hosts measured
# 250–450 ms to first token (2026-10-18), so a busy Cerebras never silences Ada.
QWEN_PRIMARY_PROVIDER = {"only": ["cerebras"], "allow_fallbacks": False}
QWEN_BACKUP_PROVIDER = {
    "order": ["deepinfra", "ionstream", "parasail"],
    "allow_fallbacks": True,
    "ignore": ["cerebras"],
}
BUSY = (RateLimitError, InternalServerError)


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    focus: Literal["paper", "board", "split", "none"]
    needs_vision: bool
    route: Literal["talker", "thinker"]
    action: Literal["none", "explain", "draw_board", "mark_paper", "trace"]
    refers_to: Literal["paper", "board", "conversation"]

    @model_validator(mode="after")
    def no_paper_on_board(self):
        if self.refers_to == "board":
            self.needs_vision = False
        return self


PAPER = re.compile(
    r"\b(paper|page|camera|circle mine|on top of my|my drawing|my work|my sketch)\b", re.I
)
SIMPLE = re.compile(r"^\W*(what(?: is|'s| are)|define|what does .{1,30} mean)\b", re.I)
BOARD = re.compile(r"\b(board|whiteboard)\b", re.I)
DRAW = re.compile(r"\b(draw|mark|highlight|circle|wash|strike|callout)\b", re.I)
# Her own work ("the DFA I tried to draw", "my DFA") is a paper reference, not a draw request.
SELF_WORK = re.compile(
    r"\b(?:I (?:try|tried|was trying|am trying|'m trying) to draw|I drew|I(?:'ve| have) drawn|"
    r"what I (?:drew|wrote|did)|my (?:dfa|nfa|automaton|machine|diagram|chain|answer))\b",
    re.I,
)
# Show/point requests that name the paper or the board are drawing requests there.
SHOW = re.compile(r"\b(show|point|walk (?:me )?through|counter.?example)\b", re.I)
# "…on your whiteboard": the board as the place to show an explanation.
ON_BOARD = re.compile(r"\b(?:on|onto|in) (?:the |your |a )?(?:white)?board\b", re.I)
# "I don't see anything on the whiteboard": she expected a drawing that never came.
BOARD_MISSING = re.compile(
    r"\b(?:don'?t|do not|can'?t|cannot) see (?:anything|it|that|the drawing|your drawing)\b"
    r"[^.?!]{0,30}\b(?:board|whiteboard)\b|\bnothing on (?:the |your )?(?:white)?board\b",
    re.I,
)
# "Help me make/fix…" asks for guidance on her own work, not for the answer (retest #8).
HELP = re.compile(
    r"\bhelp me (?:make|build|draw|fix|with|understand)\b|"
    r"\b(?:i'?m|i am) trying to (?:make|draw|build|write)\b|"
    r"\bfix (?:this|my) (?:dfa|nfa|automaton|machine)\b",
    re.I,
)
ANSWER = re.compile(
    r"\b(?:(?:show|give|tell) me (?:the )?(?:answer|solution)|correct version|"
    r"(?:write|draw) (?:me )?(?:an?|the) (?:correct )?(?:dfa|nfa))\b",
    re.I,
)
CONFUSED = re.compile(
    r"\b(?:i'?m not sure|not sure|i (?:still )?don'?t (?:quite |really |fully )?"
    r"(?:understand|get it|get that|follow|know)|"
    r"confus\w*|what do you mean|repeating yourself|i'?m lost|makes? no sense)\b",
    re.I,
)
# A new machine or a changed version of hers is a board construction unless she names her paper.
CONSTRUCT = re.compile(
    r"\b(?:(?:show|draw|build|construct|make|design|convert|modify|write|give)\b[^.?!]{0,40}\b"
    r"(?:nfa|dfa|automat\w*|machine|version)|modified version|correct version)\b",
    re.I,
)
COMPLEX = re.compile(
    r"\b(check|diagnos\w*|find (?:a |the |my )?mistake|why|prove|derive|step.by.step|"
    r"what'?s wrong|what is wrong|walk (?:me )?through|counter.?example|"
    r"is (?:it|this|that|my \w+) (?:right|correct)|does (?:it|this|that) work|"
    r"(?:show|draw|build|construct|make|design|convert|modify)\b[^.?!]{0,40}\b(?:nfa|dfa|"
    r"automat\w*|machine|version)|modified version|minimi[sz]e|trace)\b",
    re.I,
)


# Her spoken view requests (English; the app's controls work in every language). Switching verbs
# only: "show me … on the board" asks for a drawing, never a view.
_SWITCH = (
    r"(?:switch(?:\s+back)?\s+to|go(?:\s+back)?\s+to|back\s+to|change\s+to|open\s+(?:up\s+)?"
    r"|bring\s+(?:up|back)|i\s+want|show\s+me\s+(?:my|the)\s+(?=camera|paper|desk|split))"
)
_PAPER_VIEW = r"(?:camera|paper|desk\s*view|desk|my\s+page)"
_BOARD_VIEW = r"(?:white\s*board|board)"
SPLIT_VIEW = re.compile(
    r"\b(?:side\s+by\s+side|split\s+(?:view|screen)|split\b(?=[^.?!]*\bview))", re.I
)
BOARD_FULL = re.compile(
    rf"\b{_BOARD_VIEW}\s+(?:in\s+)?full[\s-]?screen\b|\bfull[\s-]?screen\s+(?:the\s+)?{_BOARD_VIEW}\b"
    rf"|\b{_SWITCH}\s+(?:the\s+|my\s+)*{_BOARD_VIEW}\b",
    re.I,
)
PAPER_FULL = re.compile(rf"\b{_SWITCH}\s+(?:the\s+|my\s+)*{_PAPER_VIEW}\b", re.I)


def view_request(text) -> Literal["paper", "board", "split"] | None:
    """The view she asks the app for, or None: "back to the camera" is her paper full screen,
    "the board with the camera view" the board (her desk camera floats over it), "side by side"
    the split view. Questions about a view ("where's the camera view?") aren't requests."""
    if re.match(r"^\W*where\b", text, re.I):
        return None
    if SPLIT_VIEW.search(text):
        return "split"
    if BOARD_FULL.search(text):
        return "board"
    if PAPER_FULL.search(text):
        return "paper"
    return None


def _draw_request(text):
    return bool(DRAW.search(SELF_WORK.sub(" ", text)))


def rules(text, *, focus="none", page_changed=False, **_):
    board = bool(BOARD.search(text))
    paper = bool(PAPER.search(text)) or (bool(SELF_WORK.search(text)) and not board)
    if (
        not paper
        and not board
        and re.search(r"\b(check this|look at this|this page|my work)\b", text, re.I)
    ):
        paper, board = focus in ("paper", "split"), focus == "board"
    ref = "paper" if paper else "board" if board else "conversation"
    target = "paper" if paper else "board" if board else focus
    action = "none"
    show = SHOW.search(text) and (paper or board)
    if _draw_request(text) or BOARD_MISSING.search(text) or show:
        action = "mark_paper" if paper else "draw_board"
        target = "paper" if paper else "board"
        ref = target
    elif re.search(r"\btrace\b", text, re.I):
        action = "trace"
    elif COMPLEX.search(text) or re.search(r"\b(explain|what is|how)\b", text, re.I):
        action = "explain"
    changed = page_changed and target in ("paper", "split") and ref != "board"
    complex_turn = bool(
        action in ("draw_board", "mark_paper", "trace") or COMPLEX.search(text) or changed or paper
    )
    return Decision(
        focus=target,
        needs_vision=paper or changed,
        route="thinker" if complex_turn else "talker",
        action=action,
        refers_to=ref,
    )


def guard(text, decision):
    """Explicit words beat the model: naming the paper or camera (and not the board) means
    paper marks; her own drawing means the paper; board requests and complaints mean a board
    drawing; anything that needs the page or a construction goes to the thinker."""
    named_paper, board = bool(PAPER.search(text)), bool(BOARD.search(text))
    self_work = bool(SELF_WORK.search(text)) and not board
    draw = _draw_request(text) or bool(SHOW.search(text))
    update = {}
    if named_paper and not board and (draw or decision.action == "draw_board"):
        update.update(action="mark_paper", focus="paper", refers_to="paper", needs_vision=True)
    elif HELP.search(text) and not ANSWER.search(HELP.sub(" ", text)) and not board:
        update.update(focus="paper", refers_to="paper", needs_vision=True)
        if decision.action == "draw_board":
            update["action"] = "explain"
    elif self_work and not named_paper and decision.refers_to != "paper":
        update.update(focus="paper", refers_to="paper", needs_vision=True)
        if decision.action == "draw_board":
            update["action"] = "explain"
    elif (
        board
        and not named_paper
        and (draw or BOARD_MISSING.search(text) or (ON_BOARD.search(text) and COMPLEX.search(text)))
    ):
        update.update(action="draw_board", focus="board", refers_to="board", needs_vision=False)
    elif BOARD_MISSING.search(text):
        update.update(action="draw_board", focus="board", refers_to="board", needs_vision=False)
    elif (
        CONSTRUCT.search(HELP.sub(" ", text))
        and not named_paper
        and (decision.action != "draw_board" or decision.focus not in ("board", "split"))
    ):
        update.update(action="draw_board", focus="split" if decision.focus == "split" else "board")
    merged = decision.model_copy(update=update)
    if merged.route == "talker" and (
        merged.needs_vision
        or merged.action in ("draw_board", "mark_paper", "trace")
        or _draw_request(text)
        or COMPLEX.search(text)
    ):
        # The talker is fast only without the page or a construction; the thinker reads both.
        update["route"] = "thinker"
    elif (
        merged.route == "thinker"
        and SIMPLE.search(text)
        and not (named_paper or board or self_work or draw or COMPLEX.search(text))
        and not merged.needs_vision
        and len(text.split()) <= 12
    ):
        # Short definitional questions are the fast talker's: instant, no brief needed.
        update.update(route="talker", action="explain")
    return decision.model_copy(update=update) if update else decision


GREETING = re.compile(
    r"^\W*(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening)|"
    r"can you hear me)\b",
    re.I,
)


def certain(text):
    """The decision when the words alone settle it, so the director's model call is skipped:
    a short greeting or thanks, or an explicit drawing request that names exactly one of her
    paper and the board. Yes/no answers are never certain: they depend on Ada's last question."""
    named_paper, board = bool(PAPER.search(text)), bool(BOARD.search(text))
    words = len(text.split())
    if (
        words <= 6
        and GREETING.search(text)
        and not (
            named_paper
            or board
            or _draw_request(text)
            or COMPLEX.search(text)
            or SELF_WORK.search(text)
            or HELP.search(text)
            or CONFUSED.search(text)
        )
    ):
        return guard(text, rules(text))
    if (_draw_request(text) or SHOW.search(text)) and named_paper != board:
        return guard(text, rules(text))
    return None


def escalate(text, decision, *, confusions, drew_last=False):
    """The playbook's ladder, enforced: still confused after one explanation means drawing.
    First point at her paper; if that was already done, trace the counterexample."""
    if confusions <= 0 or not CONFUSED.search(text):
        return decision
    on_board = decision.refers_to == "board" or decision.focus == "board"
    if confusions + drew_last <= 1:
        if on_board:
            update = dict(route="thinker", action="draw_board")
        else:
            update = dict(
                route="thinker",
                action="mark_paper",
                focus="paper",
                refers_to="paper",
                needs_vision=True,
            )
    elif on_board:
        update = dict(
            route="thinker", action="trace", focus="board", refers_to="board", needs_vision=False
        )
    else:
        update = dict(
            route="thinker", action="trace", focus="split", refers_to="paper", needs_vision=True
        )
    return decision.model_copy(update=update)


def report_usage(on_usage, model, response):
    """Hand a chat completion's usage to the session meter, if there is one."""
    usage = getattr(response, "usage", None)
    if on_usage is None or usage is None:
        return
    details = getattr(usage, "prompt_tokens_details", None)
    on_usage(
        model,
        prompt=getattr(usage, "prompt_tokens", 0) or 0,
        cached=getattr(details, "cached_tokens", 0) or 0,
        completion=getattr(usage, "completion_tokens", 0) or 0,
    )


class Director:
    def __init__(self, *, client=None, budget_s=0.8, log=None, on_usage=None, script=None):
        self.client, self.budget_s, self.log = client, budget_s, log
        self.on_usage = on_usage
        # Fake providers only: the scenario's decision for these words, or None for the rules.
        self.script = script

    async def decide(
        self, text, history, *, focus="none", board_items=None, frozen=False, page_changed=False
    ):
        started = time.monotonic()
        source = "rules"
        decision = rules(text, focus=focus, page_changed=page_changed)
        sure = certain(text)
        scripted = self.script(text) if self.script is not None else None
        if scripted is not None:
            decision, source = scripted, "script"
        elif sure is not None:
            decision, source = sure, "rules-certain"
        elif self.client is not None:
            try:
                async with asyncio.timeout(self.budget_s):
                    request = dict(
                        model="qwen/qwen3.8-27b",
                        messages=[
                            {
                                "role": "system",
                                "content": (
                                    "Direct this tutor turn; return only the schema. "
                                    "Default focus is the "
                                    "current stage. Paper/camera requests mean mark_paper, "
                                    "board requests "
                                    "mean draw_board. Board turns never need vision. Vision "
                                    "is needed only "
                                    "for paper questions or meaningful page changes in "
                                    "paper/split focus. "
                                    "Greetings, simple explanations and established "
                                    "followups go to talker. "
                                    "Drawing, marking, diagnosis, new why questions and "
                                    "multi-step reasoning "
                                    "go to thinker. 'The DFA I drew' or 'my DFA' is her "
                                    "paper (needs vision). A complaint that the board is "
                                    "empty means draw_board. Resolve intent from context; "
                                    "don't reconfirm clear intent."
                                ),
                            },
                            {
                                "role": "user",
                                "content": json.dumps(
                                    dict(
                                        transcript=text,
                                        last_turns=history[-4:],
                                        focus=focus,
                                        board_items=board_items or {},
                                        frozen=frozen,
                                        page_changed=page_changed,
                                    )
                                ),
                            },
                        ],
                        response_format={
                            "type": "json_schema",
                            "json_schema": {
                                "name": "turn_decision",
                                "strict": True,
                                "schema": Decision.model_json_schema(),
                            },
                        },
                        extra_body={
                            "provider": dict(QWEN_PRIMARY_PROVIDER),
                            # Cerebras doesn't list structured output among its parameters,
                            # so require_parameters made every call 404 (rules only).
                            "reasoning": {"enabled": False},
                        },
                        max_tokens=150,
                    )
                    try:
                        response = await self.client.chat.completions.create(**request)
                    except BUSY as busy:
                        logger.warning(
                            "Director retrying on backup providers ({})", type(busy).__name__
                        )
                        request["extra_body"] = {
                            **request["extra_body"],
                            "provider": dict(QWEN_BACKUP_PROVIDER),
                        }
                        response = await self.client.chat.completions.create(**request)
                    report_usage(self.on_usage, "director:qwen/qwen3.8-27b", response)
                    decision = Decision.model_validate_json(response.choices[0].message.content)
                    source = "model"
            except Exception as error:
                # No provider details in the transcript; rules preserve the turn.
                logger.warning("Director fell back to rules ({})", type(error).__name__)
                if self.log:
                    self.log("director_fallback", reason=type(error).__name__)
        decision = guard(text, decision)
        if self.log:
            self.log(
                "director",
                decision=decision.model_dump(),
                source=source,
                ms=(time.monotonic() - started) * 1000,
            )
        return decision

    async def close(self):
        if self.client:
            await self.client.close()


def make_director(settings, *, log=None, on_usage=None, script=None):
    client = None
    if (
        settings.providers != "fake"
        and settings.llm_provider != "fake"
        and settings.openrouter_api_key
    ):
        client = AsyncOpenAI(
            api_key=settings.openrouter_api_key.get_secret_value(),
            base_url="https://openrouter.ai/api/v1",
            max_retries=0,
            timeout=0.8,
        )
    return Director(client=client, log=log, on_usage=on_usage, script=script)
