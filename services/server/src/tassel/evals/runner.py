"""The eval loop: scenarios in order, one fresh session each, the checks after every turn, and a
hard prompt-token budget read from the session's usage meter. The run stops cleanly before a turn
once the budget is spent, or when that turn's estimate would overrun it."""

import asyncio
import traceback
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import Protocol

from tassel.evals.checks import CheckResult, Observation, check_turn
from tassel.evals.scenario import Scenario, Turn, estimate_turn

DEFAULT_BUDGET = 150_000


class Session(Protocol):
    async def turn(self, turn: Turn, index: int) -> Observation: ...

    def usage(self) -> dict: ...


@dataclass
class TurnRecord:
    index: int
    observation: Observation
    checks: list[CheckResult]

    @property
    def ok(self) -> bool:
        return all(c.ok for c in self.checks)


@dataclass
class ScenarioRecord:
    name: str
    title: str
    turns: list[TurnRecord] = field(default_factory=list)
    usage: dict = field(default_factory=dict)
    error: str | None = None
    planned: int = 0


@dataclass
class RunRecord:
    budget: int
    status: str = "complete"
    scenarios: list[ScenarioRecord] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    prompt_tokens: int = 0
    usage: dict = field(default_factory=dict)
    settings: dict = field(default_factory=dict)


def prompt_total(usage: dict) -> int:
    return sum(entry.get("prompt", 0) for entry in usage.get("llm", {}).values())


def _diff(after: dict, before: dict) -> dict:
    out = {}
    for model, entry in after.get("llm", {}).items():
        old = before.get("llm", {}).get(model, {})
        delta = {k: v - old.get(k, 0) for k, v in entry.items()}
        if any(delta.values()):
            out[model] = delta
    return out


def _merge(total: dict, usage: dict) -> None:
    llm = total.setdefault("llm", {})
    for model, entry in usage.get("llm", {}).items():
        mine = llm.setdefault(model, {})
        for k, v in entry.items():
            mine[k] = mine.get(k, 0) + v
    for key in ("tts_chars", "stt_seconds", "usd"):
        if key in usage:
            total[key] = round(total.get(key, 0) + usage[key], 6)


async def run_scenarios(
    scenarios: list[Scenario],
    open_session: Callable[[Scenario], AbstractAsyncContextManager[Session]],
    *,
    budget: int = DEFAULT_BUDGET,
    estimate=estimate_turn,
    on_turn: Callable[[ScenarioRecord, TurnRecord], None] | None = None,
    reply_gap_s: float = 0,
) -> RunRecord:
    """`reply_gap_s`: how long she listens before each later turn, as a real student does while
    Ada speaks (the ladder thinks its next step ahead in that time)."""
    run = RunRecord(budget=budget)
    spent_before = 0  # Prompt tokens of the scenarios already closed.

    def stop_here(scenario, start):
        run.status = "budget reached"
        run.skipped += [f"{scenario.name}:{i + 1}" for i in range(start, len(scenario.turns))]

    for scenario in scenarios:
        if run.status == "budget reached":
            stop_here(scenario, 0)
            continue
        record = ScenarioRecord(scenario.name, scenario.title, planned=len(scenario.turns))
        run.scenarios.append(record)
        session = None
        try:
            async with open_session(scenario) as session:
                for index, turn in enumerate(scenario.turns):
                    spent = spent_before + prompt_total(session.usage())
                    cost = estimate(turn, index, page=scenario.page_at(index))
                    if spent >= budget or spent + cost > budget:
                        stop_here(scenario, index)
                        break
                    if index and reply_gap_s:
                        await asyncio.sleep(reply_gap_s)
                    before = session.usage()
                    observation = await session.turn(turn, index)
                    after = session.usage()
                    observation.prompt_tokens = prompt_total(after) - prompt_total(before)
                    observation.tokens = _diff(after, before)
                    earlier = [t.observation for t in record.turns]
                    checks = check_turn(turn, observation, earlier=earlier)
                    turn_record = TurnRecord(index, observation, checks)
                    record.turns.append(turn_record)
                    if on_turn:
                        on_turn(record, turn_record)
        except Exception as error:  # noqa: BLE001 - one broken scenario never ends the run
            record.error = f"{type(error).__name__}: {error}\n" + traceback.format_exc(limit=6)
        if session is not None:
            record.usage = session.usage()
            spent_before += prompt_total(record.usage)
            _merge(run.usage, record.usage)
    run.prompt_tokens = spent_before
    return run
