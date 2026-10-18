"""Bounded per-turn decisions; the deterministic policy is also the offline fallback."""

import asyncio
import json
import re
import time
from typing import Literal

from loguru import logger
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, model_validator


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
COMPLEX = re.compile(
    r"\b(check|diagnos\w*|find (?:a |the |my )?mistake|why|prove|derive|step.by.step|"
    r"(?:show|draw|build|construct|make|design|convert|modify)\b[^.?!]{0,40}\b(?:nfa|dfa|"
    r"automat\w*|machine|version)|modified version|minimi[sz]e|trace)\b",
    re.I,
)


def rules(text, *, focus="none", page_changed=False, **_):
    paper, board = bool(PAPER.search(text)), bool(BOARD.search(text))
    if (
        not paper
        and not board
        and re.search(r"\b(check this|look at this|this page|my work)\b", text, re.I)
    ):
        paper, board = focus in ("paper", "split"), focus == "board"
    ref = "paper" if paper else "board" if board else "conversation"
    target = "paper" if paper else "board" if board else focus
    action = "none"
    if DRAW.search(text):
        action = "mark_paper" if paper else "draw_board"
        target = "paper" if paper else "board"
        ref = target
    elif re.search(r"\btrace\b", text, re.I):
        action = "trace"
    elif COMPLEX.search(text) or re.search(r"\b(explain|what is|how)\b", text, re.I):
        action = "explain"
    changed = page_changed and target in ("paper", "split") and ref != "board"
    complex_turn = bool(DRAW.search(text) or COMPLEX.search(text) or action == "trace" or changed)
    return Decision(
        focus=target,
        needs_vision=paper or changed,
        route="thinker" if complex_turn else "talker",
        action=action,
        refers_to=ref,
    )


def guard(text, decision):
    """Explicit words beat the model: naming the paper or camera (and not the board) means
    paper marks; any construction or diagnosis request goes to the thinker."""
    paper, board = bool(PAPER.search(text)), bool(BOARD.search(text))
    update = {}
    if paper and not board and decision.action == "draw_board":
        update.update(action="mark_paper", focus="paper", refers_to="paper", needs_vision=True)
    if (DRAW.search(text) or COMPLEX.search(text)) and decision.route == "talker":
        update["route"] = "thinker"
    elif (
        decision.route == "thinker"
        and SIMPLE.search(text)
        and not (paper or board or DRAW.search(text) or COMPLEX.search(text))
        and len(text.split()) <= 12
    ):
        # Short definitional questions are the fast talker's: instant, no brief needed.
        update.update(route="talker", action="explain")
    return decision.model_copy(update=update) if update else decision


class Director:
    def __init__(self, *, client=None, budget_s=0.8, log=None):
        self.client, self.budget_s, self.log = client, budget_s, log

    async def decide(
        self, text, history, *, focus="none", board_items=None, frozen=False, page_changed=False
    ):
        started = time.monotonic()
        source = "rules"
        decision = rules(text, focus=focus, page_changed=page_changed)
        if self.client is not None:
            try:
                async with asyncio.timeout(self.budget_s):
                    response = await self.client.chat.completions.create(
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
                                    "go to thinker. Resolve intent from context; don't "
                                    "reconfirm clear intent."
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
                            "provider": {
                                "only": ["cerebras"],
                                "allow_fallbacks": False,
                            },
                            # Cerebras doesn't list structured output among its parameters,
                            # so require_parameters made every call 404 (rules only).
                            "reasoning": {"enabled": False},
                        },
                        max_tokens=150,
                    )
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


def make_director(settings, *, log=None):
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
    return Director(client=client, log=log)
