"""The thinker's place in a fake session: each scenario turn's scripted brief, so a fake session
draws through the same path as the live tutor (director → thinker → action checker → beats)."""

import asyncio
import json
from collections.abc import Callable

from tassel.models import Lang
from tassel.voice.fakes.scenario import FakeScenario, scripted_turn
from tassel.voice.thinker import GuidanceBrief


class FakeThinker:
    settings = None

    def __init__(self, scenario: FakeScenario, lang: Callable[[], Lang], *, delay_s: float = 0.3):
        self.scenario, self.lang, self.delay_s = scenario, lang, delay_s
        self.on_usage = None

    async def think(self, messages: list[dict], effort=None) -> GuidanceBrief:
        user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
        content = user.get("content", "") if user else ""
        if isinstance(content, list):
            content = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
        turn = scripted_turn(self.scenario, self.lang(), content, "brief")
        if turn is None or turn.brief is None:
            raise LookupError("No scripted brief for this turn")
        await asyncio.sleep(self.delay_s)
        brief = turn.brief
        return GuidanceBrief.model_validate_json(
            json.dumps(
                dict(
                    page="",
                    intent=turn.when or "",
                    diagnosis="",
                    plan=["Follow the scenario"],
                    say=brief.say,
                    board=brief.board,
                    paper=brief.paper,
                    confidence=1.0,
                    followups=[],
                    language=brief.language,
                )
            )
        )

    async def close(self):
        pass


def scripted_thinker(scenario: FakeScenario, lang: Callable[[], Lang]) -> FakeThinker | None:
    """A fake thinker when the scenario scripts any brief; otherwise none, as before."""
    if any(turn.brief for script in scenario.langs.values() for turn in script.turns):
        return FakeThinker(scenario, lang)
    return None
