"""Validated scripts used only by explicitly selected fake providers."""

import re
from collections.abc import Sequence
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from tassel.models import Lang
from tassel.voice.director import Decision
from tassel.voice.messages import LANGUAGE_SWITCH_PREFIX

SCENARIOS_DIR = Path(__file__).with_name("scenarios")
DROP_DIRECTIVE = "/drop"


class ScriptTool(BaseModel):
    name: Literal["show_stage", "set_language"]
    arguments: dict[str, str]


class ScriptBrief(BaseModel):
    """The thinker's brief for a turn: what Ada says after the talker's bridge, and the tags the
    action checker vets before they reach the board or her paper."""

    model_config = ConfigDict(extra="forbid")
    say: str
    board: list[str] = Field(default_factory=list)
    paper: list[str] = Field(default_factory=list)
    # Her image: marks in words for the Pointer, and raw [[image …]] tags.
    image_marks: list[dict[str, object]] = Field(default_factory=list)
    image: list[str] = Field(default_factory=list)
    language: dict[str, object] | None = None


class ScriptTurn(BaseModel):
    when: str | None = None
    say: str
    tools: list[ScriptTool] = Field(default_factory=list)
    # The director's decision for this turn, in place of its rules (fake providers only).
    decision: Decision | None = None
    brief: ScriptBrief | None = None


class ScriptLang(BaseModel):
    greeting: str
    after_switch: str
    fallback: str
    turns: list[ScriptTurn]
    student: list[str] = Field(default_factory=list)


class FakeScenario(BaseModel):
    name: str
    title: str | None = None
    subject: str | None = None
    langs: dict[Lang, ScriptLang]


def load_scenario(name: str) -> FakeScenario:
    if not re.fullmatch(r"[a-z0-9-]{1,40}", name):
        raise ValueError("Invalid fake scenario name")
    path = SCENARIOS_DIR / f"{name}.json"
    if not path.is_file():
        raise ValueError(f"Unknown fake scenario: {name}")
    return FakeScenario.model_validate_json(path.read_text(encoding="utf-8"))


def next_turn(script: ScriptLang, user_text: str | None, said: Sequence[str]) -> ScriptTurn:
    if user_text is None and script.greeting not in said:
        return ScriptTurn(say=script.greeting)
    if user_text is not None and user_text.startswith(LANGUAGE_SWITCH_PREFIX):
        return ScriptTurn(say=script.after_switch)
    text = (user_text or "").casefold()
    unused = [turn for turn in script.turns if turn.say not in said]
    for turn in unused:
        if turn.when is not None and turn.when.casefold() in text:
            return turn
    for turn in unused:
        if turn.when is None:
            return turn
    return ScriptTurn(say=script.fallback)


def scripted_turn(
    scenario: FakeScenario,
    lang: Lang,
    user_text: str,
    field: Literal["decision", "brief"] = "decision",
) -> ScriptTurn | None:
    """The scripted turn whose `when` the student's words contain and that carries `field`."""
    text = user_text.casefold()
    for turn in scenario.langs[lang].turns:
        if turn.when is not None and turn.when.casefold() in text and getattr(turn, field):
            return turn
    return None
