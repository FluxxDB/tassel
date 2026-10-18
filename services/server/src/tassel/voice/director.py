"""Bounded per-turn decisions; the deterministic policy is also the offline fallback."""

import asyncio
import json
import re
import time
from typing import Literal

from loguru import logger
from openai import AsyncOpenAI, InternalServerError, RateLimitError
from pydantic import BaseModel, ConfigDict, model_validator

from tassel.voice.ladder import checking, failed

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
    action: Literal["none", "explain", "draw_board", "mark_paper", "mark_image", "trace"]
    # "image": an image she sent in the chat (a screenshot, a photo), never her paper.
    refers_to: Literal["paper", "board", "image", "conversation"]

    @model_validator(mode="after")
    def no_paper_on_board(self):
        if self.refers_to in ("board", "image"):
            self.needs_vision = False
        return self


PAPER = re.compile(
    r"\b(paper|page|camera|circle mine|on top of my|my drawing|my work|my sketch)\b", re.I
)
# An image she sent in the chat: "my screenshot", "the picture I sent", "on my image".
IMAGE = re.compile(
    r"\b(?:screen\s?shots?|images?|(?<!big )pictures?|photos?|pics?|attachments?|"
    r"(?:the )?(?:file|one) I (?:sent|attached|uploaded))\b",
    re.I,
)
SIMPLE = re.compile(r"^\W*(what(?: is|'s| are)|define|what does .{1,30} mean)\b", re.I)
BOARD = re.compile(r"\b(board|whiteboard)\b", re.I)
DRAW = re.compile(r"\b(draw|mark|highlight|circle|wash|strike|underline|callout)\b", re.I)
MARK = re.compile(r"\b(mark|highlight|circle|wash|strike|underline|callout)\b", re.I)
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
# only: "show me … on the board" or "put it on the board" asks for a drawing, never a view.
_PAPER_VIEW = r"(?:camera|paper|desk\s*view|desk|my\s+page)(?:\s+view)?"
_BOARD_VIEW = r"(?:white\s*board|board)(?:\s+view)?"
_VIEW = rf"(?:(?P<paper>{_PAPER_VIEW})|(?P<board>{_BOARD_VIEW}))"
_FULL = r"(?:full[\s-]?screen|maximi[sz]e[ds]?)"
_SWITCH = (
    r"(?:switch(?:\s+back)?\s+to|go(?:\s+back)?\s+to|go\s+back|back\s+to|change\s+to|"
    r"open\s+(?:up\s+)?|bring\s+(?:up|back)|i\s+want|"
    r"show\s+me\s+(?:my|the)\s+(?=camera|paper|desk|split))"
)
SPLIT_VIEW = re.compile(
    r"\b(?:side\s+by\s+side|split\s+(?:view|screen)|split\b(?=[^.?!]*\bview))", re.I
)
_VIEW_REQUESTS = (
    # "the board to full screen", "desk view full screen", "make the camera full screen".
    re.compile(rf"\b{_VIEW}\b[^.?!]{{0,25}}?\b{_FULL}", re.I),
    re.compile(rf"\b{_FULL}\s+(?:the\s+|my\s+)*{_VIEW}\b", re.I),
    # "go back to the camera", "go back desk view", "switch to the board".
    re.compile(rf"\b{_SWITCH}\s*(?:the\s+|my\s+)*{_VIEW}\b", re.I),
    # Just a view's name: "Desk view, please.", "The whiteboard, please."
    re.compile(
        rf"^\W*(?:(?:okay|ok|no|yes|so|now|and)\b[,.]?\s*)*(?:the\s+|my\s+)?{_VIEW}"
        r"\s*(?:,?\s*(?:please|now))?\W*$",
        re.I,
    ),
)


def view_request(text) -> Literal["paper", "board", "split"] | None:
    """The view she asks the app for, or None: "back to the camera" is her paper full screen,
    "the board with the camera view" the board (her desk camera floats over it), "side by side"
    the split view. Questions about a view ("where's the camera view?") aren't requests."""
    if re.match(r"^\W*(?:where|what|which|why|is|are|does|do)\b", text, re.I):
        return None
    if SPLIT_VIEW.search(text):
        return "split"
    for pattern in _VIEW_REQUESTS:
        found = pattern.search(text)
        if found:
            return "paper" if found.group("paper") else "board"
    return None


# Taking something off the board: erase, delete, undo, "get rid of".
ERASE = re.compile(
    r"\b(?:erase|delete|undo|remove|get rid of|take (?:it|that|them) (?:off|away)|"
    r"clear (?:it|that|the|your|this))\b",
    re.I,
)


# Putting something back on the board: "put the PCs back", "restore", "redo".
RESTORE = re.compile(
    r"\b(?:(?:put|add|bring)\s+(?:\w+\s+){0,3}back|restore|redo)\b",
    re.I,
)


# Something with a picture, and a request to explain how it works: drawn, not only told.
VISUAL = re.compile(
    r"\b(?:dfa|nfa|automat\w*|state machine|machine|transitions?|network|subnet\w*|"
    r"topolog\w*|router|diagram|graph|tree|flowchart|circuit)s?\b",
    re.I,
)
EXPLAIN_HOW = re.compile(
    r"\b(?:explain|how (?:does|do|would|can|is)|why (?:does|is|do|would)|walk me through|"
    r"show me how|what happens)\b",
    re.I,
)


def _draw_request(text):
    return bool(DRAW.search(SELF_WORK.sub(" ", text)))


def _image_ref(text, *, image=False) -> bool:
    """Her words point at an image she sent: they name one and neither her paper nor the board,
    or (`image`: this message carries one) they ask to draw without naming either."""
    if PAPER.search(text) or BOARD.search(text):
        return False
    # A message that carries an image and asks for a mark (circle, underline…) means that
    # image; "show me the answer" or "draw a DFA" with a screenshot asks Ada to solve it, which
    # she does on the board.
    return bool(IMAGE.search(text)) or (image and bool(MARK.search(SELF_WORK.sub(" ", text))))


def rules(text, *, focus="none", page_changed=False, image=False, **_):
    if _image_ref(text, image=image):
        # Her image shows in the paper panel's slot; only the thinker sees it, numbered.
        mark = _draw_request(text) or bool(SHOW.search(text)) or bool(ERASE.search(text))
        explain = COMPLEX.search(text) or re.search(r"\b(explain|what is|how)\b", text, re.I)
        return Decision(
            focus="paper",
            needs_vision=False,
            route="thinker",
            action="mark_image" if mark else "explain" if explain else "none",
            refers_to="image",
        )
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


def guard(text, decision, *, image=False):
    """Explicit words beat the model: naming the paper or camera (and not the board) means
    paper marks; naming an image she sent (or asking to draw on the one this message carries)
    means her image; her own drawing means the paper; board requests and complaints mean a
    board drawing; anything that needs the page or a construction goes to the thinker."""
    if _image_ref(text, image=image):
        wanted = rules(text, image=image)
        if decision.refers_to != "image" or decision.action in ("draw_board", "mark_paper"):
            decision = wanted
        elif wanted.action == "mark_image":
            decision = decision.model_copy(update={"action": "mark_image"})
        return decision.model_copy(update={"route": "thinker", "needs_vision": False})
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
    if (ERASE.search(text) or RESTORE.search(text)) and not named_paper:
        # Erasing or undoing her drawing is board work: the thinker picks what to take back.
        update.update(action="draw_board", refers_to="board", needs_vision=False, route="thinker")
        if decision.focus not in ("board", "split"):
            update["focus"] = "board"
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
    final = decision.model_copy(update=update) if update else decision
    if final.route == "talker" and VISUAL.search(text) and EXPLAIN_HOW.search(text):
        # Explaining something visual is drawn on the board, step by step: the thinker's turn
        # (the talker never draws).
        action = "explain" if final.action == "none" else final.action
        final = final.model_copy(update={"route": "thinker", "action": action})
    return final


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
    if _image_ref(text) and (_draw_request(text) or SHOW.search(text)):
        return guard(text, rules(text))
    return None


# A short attempt at Ada's ladder question: a state, an input, a fix ("q3 should accept").
ATTEMPT = re.compile(
    r"\bq\s*\d+\b|\bq (?:zero|one|two|three|four|five)\b|\b[01]{2,}\b|"
    r"\b(?:should|needs?|missing|instead|change|add|remove|accept\w*|reject\w*|is it|maybe|"
    r"because|wrong)\b",
    re.I,
)
ACK = re.compile(
    r"^\W*(?:ok(?:ay)?|got it|i see|thanks|thank you|cool|great|yes|yeah|sure|alright|"
    r"makes sense)\W*$",
    re.I,
)
TRACE_WORD = re.compile(r"\btrace\b", re.I)
# On an open ladder: "just show me the answer", "what's the fix": the correct one now (step 2).
GIVE_UP = re.compile(
    r"\b(?:(?:show|give|tell) me (?:the )?(?:answer|solution|fix|correct (?:one|version))|"
    r"what'?s the (?:answer|fix|solution))\b",
    re.I,
)


def _asks(text) -> bool:
    """Her words ask for something of their own: a mark or drawing, a construction, the answer,
    an erase or undo, or a trace. Such a turn is a new request, not a ladder answer."""
    return bool(
        _draw_request(text)
        or ERASE.search(text)
        or RESTORE.search(text)
        or CONSTRUCT.search(HELP.sub(" ", text))
        or TRACE_WORD.search(text)
    )


def _attempt(text) -> bool:
    words = len(text.split())
    return bool(
        words <= 25
        and ATTEMPT.search(text)
        and not ACK.search(text)
        and not GREETING.search(text)
        and not re.match(r"^\W*(?:why|how|what)\b", text, re.I)
    )


def _rung(problem, step, decision):
    """The decision for a ladder rung: step 0 diagnoses where her work is, steps 1 and 2 draw on
    the board (her page stays beside it for a paper problem: the thinker copies from it)."""
    if problem == "board":
        update = dict(refers_to="board", needs_vision=False)
        update["focus"] = "split" if decision.focus == "split" else "board"
    else:
        update = dict(refers_to="paper", needs_vision=True)
        if step == 0:
            update["focus"] = decision.focus if decision.focus in ("paper", "split") else "paper"
        else:
            update["focus"] = "split"
    update.update(route="thinker", action="explain" if step == 0 else "draw_board")
    return decision.model_copy(update=update)


def ladder_decides(text, ladder, *, answered) -> bool:
    """The ladder routes this turn whatever the director says (``escalate``'s branches that
    replace the decision): a check of her own work opens it; on an open ladder, after Ada spoke,
    "show me the answer", "no", "I don't get it" or an attempt climbs it. Such a turn needs no
    model call (0.3-0.8 s that ``escalate`` threw away)."""
    if ladder is None:
        return False
    asks = _asks(text)
    if checking(text) and not asks and (SELF_WORK.search(text) or PAPER.search(text)):
        return True
    if not (ladder.open and answered):
        return False
    if GIVE_UP.search(text):
        return True
    return not asks and bool(failed(text) or CONFUSED.search(text) or _attempt(text))


def escalate(text, decision, *, ladder=None, answered=True):
    """The whiteboard ladder (voice/ladder.py), enforced. A check of her work opens it at step 0;
    after Ada's question, "no", "I can't see it" or a wrong attempt climbs it one step (the
    answer outright, step 2); a new request closes it. With no ladder open, still confused after
    an explanation means drawing: her paper's machine as step 1, anything else on the board.
    `answered`: Ada has spoken in this conversation. Sets ``ladder.turn`` for the coordinator."""
    if ladder is None:
        return decision
    ladder.turn, ladder.attempt = None, False
    lost = answered and bool(CONFUSED.search(text))
    if decision.refers_to == "image":
        # Her own image: point at it; there is no copy of it to trace.
        if lost:
            return decision.model_copy(update=dict(route="thinker", action="mark_image"))
        return decision
    asks = _asks(text)
    if checking(text) and not asks:
        # Her own work ("my DFA") is on her paper, even checked "on your whiteboard": that asks
        # to see it on the board, so the ladder starts at step 1. "Check my network on the
        # board" is her work on the board.
        mine = bool(SELF_WORK.search(text) or PAPER.search(text))
        problem = "board" if decision.refers_to == "board" and not mine else "paper"
        step = 1 if problem == "paper" and ON_BOARD.search(text) else 0
        ladder.begin(problem, step=step)
        return _rung(problem, step, decision)
    if ladder.open and answered and GIVE_UP.search(text):
        ladder.climb(to=2)
        return _rung(ladder.problem, ladder.turn, decision)
    if asks:
        if decision.route == "thinker":
            ladder.reset()  # Something new: a new problem.
        return decision
    if ladder.open and answered and (failed(text) or CONFUSED.search(text)):
        ladder.climb()
        return _rung(ladder.problem, ladder.turn, decision)
    if ladder.open and answered and _attempt(text):
        ladder.climb(attempt=True)
        return _rung(ladder.problem, ladder.turn, decision)
    if lost and not ladder.open:
        if decision.refers_to == "paper" or decision.focus == "paper":
            ladder.begin("paper", step=1)
            return _rung("paper", 1, decision)
        return decision.model_copy(
            update=dict(
                route="thinker",
                action="draw_board",
                focus="split" if decision.focus == "split" else "board",
                needs_vision=False,
            )
        )
    return decision


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


def fallback_reason(error: BaseException, budget_s: float) -> str:
    """Why the director fell back to rules, in words: never only an exception type, and never a
    provider's own message (it can carry account details)."""
    if isinstance(error, TimeoutError):
        return f"no decision within {budget_s:g} s"
    status = getattr(error, "status_code", None)
    if status is not None:
        return f"provider HTTP {status} ({type(error).__name__})"
    errors = getattr(error, "errors", None)
    if callable(errors):
        first = (errors() or [{}])[0]
        where = ".".join(str(p) for p in first.get("loc", ())) or "reply"
        return f"invalid decision at {where}: {first.get('msg', '')}"[:200]
    return f"{type(error).__name__} calling the director"


class Director:
    def __init__(self, *, client=None, budget_s=0.8, log=None, on_usage=None, script=None):
        self.client, self.budget_s, self.log = client, budget_s, log
        self.on_usage = on_usage
        # Fake providers only: the scenario's decision for these words, or None for the rules.
        self.script = script

    async def decide(
        self,
        text,
        history,
        *,
        focus="none",
        board_items=None,
        frozen=False,
        page_changed=False,
        image=False,
        ladder=None,
        answered=False,
    ):
        """`image`: this message carries an image she sent. `ladder` and `answered`: a turn the
        whiteboard ladder decides (``ladder_decides``) skips the model."""
        started = time.monotonic()
        source = "rules"
        decision = rules(text, focus=focus, page_changed=page_changed, image=image)
        sure = certain(text)
        scripted = self.script(text) if self.script is not None else None
        if scripted is not None:
            decision, source = scripted, "script"
        elif sure is not None:
            decision, source = sure, "rules-certain"
        elif not image and ladder_decides(text, ladder, answered=answered):
            source = "ladder"
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
                                    "Focus is a suggestion that the stage manager applies. "
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
                                    "empty means draw_board. An image she sent in the chat "
                                    "(a screenshot, photo or picture; sent_image: one comes "
                                    "with this message) is refers_to image, never her paper: "
                                    "marking it means mark_image. Resolve intent from "
                                    "context; don't reconfirm clear intent."
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
                                        sent_image=image,
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
                reason = fallback_reason(error, self.budget_s)
                logger.warning("Director fell back to rules ({})", reason)
                if self.log:
                    self.log("director_fallback", reason=reason)
        decision = guard(text, decision, image=image)
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
