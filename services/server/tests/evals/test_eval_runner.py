"""The run loop and the command line: the hard token budget, the dry run, and the refusal to
start a real run without the voice env file. No provider is called here."""

import io
import json
from contextlib import asynccontextmanager

import pytest

from tassel.evals import live
from tassel.evals.checks import Observation
from tassel.evals.runner import prompt_total, run_scenarios
from tassel.evals.scenario import Scenario, load_scenarios
from tassel.voice.settings import VoiceSettings


def scenario(name, *lines):
    return Scenario.model_validate(
        {"name": name, "title": name, "turns": [{"student": line} for line in lines]}
    )


class StubSession:
    """Each turn spends `cost` prompt tokens on the meter, like a live talker turn."""

    def __init__(self, cost, opened):
        self.cost, self.prompt = cost, 0
        opened.append(self)
        self.said = []

    async def turn(self, turn, index):
        self.said.append(turn.student)
        self.prompt += self.cost
        return Observation(student=turn.student, spoken=f"Answer {index}.")

    def usage(self):
        return {
            "llm": {"talker": {"calls": 1, "prompt": self.prompt, "cached": 0, "completion": 5}}
        }


def opener(cost, opened):
    @asynccontextmanager
    async def open_session(scenario):
        yield StubSession(cost, opened)

    return open_session


@pytest.mark.asyncio
async def test_the_budget_stops_the_run_before_the_next_turn():
    opened = []
    record = await run_scenarios(
        [scenario("a", "one", "two", "three"), scenario("b", "four")],
        opener(600, opened),
        budget=1000,
        estimate=lambda turn, index, page=None: 0,
    )
    assert record.status == "budget reached"
    assert [s.said for s in opened] == [["one", "two"]]
    assert record.prompt_tokens == 1200
    assert record.skipped == ["a:3", "b:1"]
    assert [t.observation.prompt_tokens for t in record.scenarios[0].turns] == [600, 600]


@pytest.mark.asyncio
async def test_the_estimate_stops_a_turn_that_would_overrun():
    opened = []
    record = await run_scenarios(
        [scenario("a", "Back to camera, please.", "Draw a DFA on the board")],
        opener(0, opened),
        budget=1000,
        estimate=lambda turn, index, page=None: 0 if index == 0 else 5000,
    )
    assert record.status == "budget reached"
    assert opened[0].said == ["Back to camera, please."]
    assert record.skipped == ["a:2"]


@pytest.mark.asyncio
async def test_a_full_run_totals_tokens_by_model():
    opened = []
    record = await run_scenarios(
        [scenario("a", "one"), scenario("b", "two", "three")],
        opener(100, opened),
        budget=10_000,
        estimate=lambda turn, index, page=None: 0,
    )
    assert record.status == "complete" and not record.skipped
    assert record.prompt_tokens == 300
    assert record.usage["llm"]["talker"]["prompt"] == 300
    assert all(r.ok for s in record.scenarios for t in s.turns for r in t.checks)


@pytest.mark.asyncio
async def test_a_failing_session_is_reported_and_the_run_goes_on():
    @asynccontextmanager
    async def broken(scenario):
        if scenario.name == "a":
            raise RuntimeError("pipeline would not start")
        yield StubSession(10, [])

    record = await run_scenarios(
        [scenario("a", "one"), scenario("b", "two")],
        broken,
        budget=1000,
        estimate=lambda turn, index, page=None: 0,
    )
    assert "pipeline would not start" in record.scenarios[0].error
    assert record.scenarios[1].turns and record.status == "complete"


def test_prompt_total_sums_every_model():
    assert prompt_total({"llm": {"a": {"prompt": 3}, "b": {"prompt": 4}}}) == 7
    assert prompt_total({}) == 0


def never_load():
    raise AssertionError("the dry run and a refused run never load provider settings")


def test_dry_run_lists_every_scenario_without_settings(monkeypatch):
    monkeypatch.delenv("TASSEL_VOICE_ENV_FILE", raising=False)
    out = io.StringIO()
    assert live.main(["--dry-run", "all"], load_settings=never_load, out=out) == 0
    text = out.getvalue()
    for s in load_scenarios(["all"]):
        assert s.name in text
        assert s.turns[0].student in text
    assert "estimate" in text.lower()


def test_a_real_run_needs_the_voice_env_file(monkeypatch):
    out = io.StringIO()
    monkeypatch.delenv("TASSEL_VOICE_ENV_FILE", raising=False)
    assert live.main(["views"], load_settings=never_load, out=out) == 2
    assert "TASSEL_VOICE_ENV_FILE" in out.getvalue()
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", "")
    assert live.main(["views"], load_settings=never_load, out=out) == 2


def test_live_settings_keep_speech_fake_and_apply_overrides(monkeypatch, tmp_path):
    env_file = tmp_path / "voice.env"
    env_file.write_text("")
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", str(env_file))
    args = live.parse_args(
        ["--thinker-effort", "low", "--thinker-model", "gpt-6-astra", "--pointer-effort", "low"]
    )

    def load():
        return VoiceSettings(openai_api_key="sk-test-one", openrouter_api_key="sk-test-two")

    settings, described = live.live_settings(args, tmp_path, load_settings=load)
    assert settings.stt_provider == "fake" and settings.tts_provider == "fake"
    assert settings.fake_tts == "tone" and settings.two_tier_enabled
    assert settings.thinker_effort == "low" and settings.thinker_model == "gpt-6-astra"
    assert settings.transcript_dir == tmp_path / "transcripts"
    assert described["thinker"] == {"model": "gpt-6-astra", "effort": "low", "draw_effort": "low"}
    assert described["pointer"]["effort"] == "low"
    assert "sk-test" not in json.dumps(described)


def test_live_settings_refuse_without_both_llm_keys(monkeypatch, tmp_path):
    env_file = tmp_path / "voice.env"
    env_file.write_text("")
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", str(env_file))
    with pytest.raises(live.RefusedRun, match="OPENAI_API_KEY"):
        live.live_settings(live.parse_args([]), tmp_path, load_settings=VoiceSettings)


def test_live_settings_refuse_a_missing_env_file(monkeypatch, tmp_path):
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", str(tmp_path / "missing.env"))
    with pytest.raises(live.RefusedRun, match="does not exist"):
        live.live_settings(live.parse_args([]), tmp_path, load_settings=never_load)


@pytest.mark.asyncio
async def test_pointer_effort_rewrites_only_the_reasoning():
    seen = []

    async def create(**request):
        seen.append(request)
        return "response"

    patched = live.with_effort(create, "low")
    assert await patched(model="gpt-6-luna", reasoning_effort="none", messages=[]) == "response"
    assert seen[-1]["reasoning_effort"] == "low"
    await patched(model="qwen", extra_body={"provider": {}, "reasoning": {"enabled": False}})
    assert seen[-1]["extra_body"]["reasoning"] == {"effort": "low"}
