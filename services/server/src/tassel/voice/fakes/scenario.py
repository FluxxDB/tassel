"""Validated scripts used only by explicitly selected fake providers."""

import re
from collections.abc import Sequence
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from tassel.models import Lang
from tassel.voice.messages import LANGUAGE_SWITCH_PREFIX

SCENARIOS_DIR = Path(__file__).with_name("scenarios")
DROP_DIRECTIVE = "/drop"


class ScriptTool(BaseModel):
    name: Literal["show_stage", "set_language"]
    arguments: dict[str, str]


class ScriptTurn(BaseModel):
    when: str | None = None
    say: str
    tools: list[ScriptTool] = Field(default_factory=list)


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
