"""One end-to-end eval run through the real voice pipeline with FAKE providers: typed turns,
the director, the scripted thinker, beats and fake TTS, so CI never spends a token."""

import json

import pytest

from tassel.evals import live
from tassel.evals.scenario import Scenario
from tassel.evals.session import PipelineSession
from tassel.voice.settings import VoiceSettings


def test_the_fake_smoke_run_passes_and_writes_reports(tmp_path, monkeypatch):
    monkeypatch.delenv("TASSEL_VOICE_ENV_FILE", raising=False)
    out = tmp_path / "out"
    code = live.main(["--fake", "smoke", "--out", str(out)], out=open(tmp_path / "log", "w"))
    report = json.loads((out / "report.json").read_text())
    assert code == 0, (tmp_path / "log").read_text()
    assert report["status"] == "complete"
    assert report["prompt_tokens"] == 0
    assert report["settings"]["mode"] == "fake"
    (smoke,) = report["scenarios"]
    turns = smoke["turns"]
    assert [t["student"] for t in turns] == [
        "Back to camera, please.",
        "Can you show me the answer?",
        "Thanks, that helps.",
    ]
    failures = [(t["student"], c) for t in turns for c in t["checks"] if not c["ok"]]
    assert failures == []
    assert turns[0]["stage"] == [{"view": "paper", "pinned": True}]
    assert "board.automaton" in turns[1]["tags"]
    assert turns[1]["timings"]["thinker"] is None or turns[1]["timings"]["thinker"] >= 0
    assert turns[1]["timings"]["director"] is not None
    markdown = (out / "report.md").read_text()
    assert "smoke" in markdown and "Can you show me the answer?" in markdown


@pytest.mark.asyncio
async def test_a_fake_session_serves_fixture_pages_and_board_seeds(tmp_path):
    scenario = Scenario.model_validate(
        {
            "name": "pages",
            "title": "Pages",
            "fake_script": "dfa-opening",
            "seed_tags": ["[[dfa saved start=q0 q0-0-q1]]"],
            "turns": [{"student": "What is on my paper now?", "page": "dfa-page"}],
        }
    )
    settings = VoiceSettings(
        providers="fake", fake_tts="tone", transcript_dir=tmp_path / "transcripts"
    )
    async with PipelineSession(scenario, settings) as session:
        observation = await session.turn(scenario.turns[0], 0)
    assert observation.finished
    assert "saved" in observation.board_before["automata"]
    assert observation.page == "dfa-page"
    # The fake director's rules ask for the page on a paper question: the fixture was served.
    assert observation.elements
    assert observation.spoken
