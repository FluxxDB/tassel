from dataclasses import replace
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from tassel.vision.gate import FakeGate, gate_text, load_thresholds, make_gate
from tassel.vision.ports import GateInput, TranscriptLine
from tassel.vision.settings import VisionConfigError, VisionSettings


@pytest.fixture
def gi(monkeypatch):
    monkeypatch.setattr("tassel.vision.gate.time", SimpleNamespace(monotonic=lambda: 100.0))
    return GateInput(
        image_jpeg=b"synthetic-jpeg",
        transcript=(),
        lang="en",
        reason="frame",
        quiet_ms=7000,
        silence_ms=9000,
        new_ink=True,
        changed_cells=40,
    )


@pytest.mark.parametrize(
    "reason, explanation",
    [
        ("frame", "new ink appeared"),
        ("speech", "she just said something"),
        ("stall", "no new ink and no speech for a while"),
        ("board", "she edited the board"),
    ],
)
@pytest.mark.parametrize("lang, language", [("en", "English"), ("es", "Spanish"), ("ko", "Korean")])
def test_gate_text(gi, reason, explanation, lang, language):
    gi = replace(
        gi,
        reason=reason,
        lang=lang,
        transcript=(
            TranscriptLine("student", "다 했어요", 97000),
            TranscriptLine("tutor", "Take your time.", 80000),
            TranscriptLine("student", "old", 79999),
            TranscriptLine("student", "future", 100001),
        ),
    )
    assert gate_text(gi) == (
        "A student is working on paper during a live tutoring session on automata "
        "(states drawn as circles, transitions as arrows).\n"
        f"Session language: {language}. The transcript is in that language.\n"
        f"Asked because: {explanation}.\n"
        "Seconds since new ink: 7. Seconds since she last spoke: 9. "
        "New ink since the last check: yes.\n"
        "Transcript, last 20 seconds, oldest first:\n"
        "Ada: Take your time.\nStudent: 다 했어요"
    )


def test_gate_text_unknown_and_fractional_seconds(gi):
    text = gate_text(replace(gi, quiet_ms=None, silence_ms=1500, new_ink=False))
    assert "Seconds since new ink: unknown. Seconds since she last spoke: 1.5." in text
    assert "New ink since the last check: no." in text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "lang, text, at_ms, speaker, want",
    [
        ("en", "I think I'm done.", 97000, "student", 0.9),
        ("ko", "다 했어요", 97000, "student", 0.9),
        ("es", "Creo que ya está…", 97000, "student", 0.9),
        ("en", "I THINK THAT'S IT…", 85000, "student", 0.9),
        ("en", "I'm done", 84000, "student", 0.1),
        ("en", "I'm done", 100001, "student", 0.1),
        ("en", "I'm done", 97000, "tutor", 0.1),
        ("en", "still drawing", 97000, "student", 0.1),
    ],
)
async def test_fake_gate(gi, lang, text, at_ms, speaker, want):
    result = await FakeGate().evaluate(
        replace(
            gi,
            lang=lang,
            transcript=(TranscriptLine(speaker, text, at_ms),),
        )
    )
    assert result.probs == {
        "diagram_attempt_complete": want,
        "new_work_worth_checking": 0.8,
        "student_seems_stuck": 0.85,
        "not_schoolwork": 0.05,
    }
    assert (result.ms, result.provider, result.refused) == (0, "fake", ())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "quiet, silent, ink, cells, stall, stuck, worth",
    [
        (7000, 2000, True, 40, 6000, 0.1, 0.8),
        (6000, 6000, True, 2, 6000, 0.85, 0.8),
        (5999, 9000, True, 1, 6000, 0.1, 0.1),
        (7000, 9000, False, 40, 6000, 0.85, 0.1),
        (None, None, False, 0, 6000, 0.1, 0.1),
        (7000, 9000, True, 40, 10000, 0.1, 0.8),
    ],
)
async def test_fake_gate_activity(gi, quiet, silent, ink, cells, stall, stuck, worth):
    result = await make_gate(VisionSettings(vision_stall_ms=stall)).evaluate(
        replace(
            gi,
            quiet_ms=quiet,
            silence_ms=silent,
            new_ink=ink,
            changed_cells=cells,
        )
    )
    assert result.probs["student_seems_stuck"] == stuck
    assert result.probs["new_work_worth_checking"] == worth


@pytest.mark.parametrize(
    "mode, live, key, want",
    [
        (None, "openai", None, "fake"),
        ("auto", "openai", None, "fake"),
        ("auto", "clef", None, "fake"),
        ("live", "openai", "openai_api_key", "openai"),
        ("live", "clef", "vultr_inference_api_key", "clef"),
        ("auto", "openai", "openai_api_key", "openai"),
        ("auto", "clef", "vultr_inference_api_key", "clef"),
    ],
)
@pytest.mark.asyncio
async def test_make_gate_and_thresholds(mode, live, key, want):
    settings = VisionSettings(
        gate_provider=mode, gate_live=live, **({key: SecretStr("test-key")} if key else {})
    )
    gate = make_gate(settings)
    assert gate.name == want
    if want != "fake":
        await gate.aclose()
    assert load_thresholds(settings.thresholds_path, "openai")["student_seems_stuck"] == 0.7
    assert set(load_thresholds(settings.thresholds_path, "fake").values()) == {0.5}


def test_make_gate_requires_key():
    with pytest.raises(VisionConfigError, match="OPENAI_API_KEY"):
        make_gate(VisionSettings(gate_provider="live"))


@pytest.mark.parametrize("bad", [True, -0.1, 1.1, "0.6", None])
def test_invalid_thresholds(tmp_path, bad):
    import json

    path = tmp_path / "thresholds.json"
    path.write_text(json.dumps({"version": 1, "openai": {"student_seems_stuck": bad}}))
    with pytest.raises(ValueError):
        load_thresholds(path, "openai")
