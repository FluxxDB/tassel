import asyncio
import json
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from tassel.frames.objects import MemoryObjectStore
from tassel.frames.tables import Frame
from tassel.storage.tables import Learner, TutoringSession
from tassel.vision import gate_eval
from tassel.vision.evalset import SYNTHETIC_SET, load_moments
from tassel.vision.gate import FakeGate
from tassel.vision.gate_eval import best_threshold, evaluate_gate, export_session, main
from tassel.vision.ports import PREDICATES, GateError, GateInput, GateResult
from tassel.vision.settings import VisionSettings


def inputs_for(moments):
    return [
        GateInput(
            None,
            m.transcript,
            m.lang,
            m.reason,
            m.quiet_ms,
            m.silence_ms,
            m.new_ink,
            m.changed_cells,
        )
        for m in moments
    ]


THRESHOLDS = dict.fromkeys(PREDICATES, 0.5)


def test_best_threshold():
    # The prose's higher-tie rule wins over the brief's contradictory 0.45 example.
    assert best_threshold([(0.2, False), (0.4, False), (0.6, True), (0.9, True)]) == 0.6
    assert best_threshold([(0.05, False), (0.05, True)]) == 0.95
    assert best_threshold([]) == 0.5


@pytest.mark.asyncio
async def test_fake_gate_scores_perfectly():
    moments = load_moments(SYNTHETIC_SET)
    inputs = inputs_for(moments)
    before = tuple(inputs)
    report = await evaluate_gate(FakeGate(), moments, inputs, THRESHOLDS)
    assert report.errors == 0 and report.gate == "fake"
    assert report.p50_ms == report.p90_ms == 0
    for p, score in report.scores.items():
        assert score.n == 24
        assert score.positives == (9 if p == "new_work_worth_checking" else 4)
        assert score.balanced_accuracy == (0.5 if p == "not_schoolwork" else 1.0)
        assert score.refusals == 0
    assert report.scores["diagram_attempt_complete"].brier == pytest.approx(0.01)
    assert tuple(inputs) == before  # Rebase per call without changing recorded data.


@pytest.mark.asyncio
async def test_refusals_count_false_and_are_counted():
    moments = [
        replace(load_moments(SYNTHETIC_SET)[0], labels=dict.fromkeys(PREDICATES, value))
        for value in (True, False)
    ]

    class Stub:
        name = "stub"

        async def evaluate(self, gi):
            return GateResult({}, PREDICATES, 17, self.name)

    report = await evaluate_gate(Stub(), moments, inputs_for(moments), THRESHOLDS)
    for score in report.scores.values():
        assert (score.n, score.positives, score.refusals) == (2, 1, 2)
        assert score.accuracy == score.balanced_accuracy == 0.5
        assert score.brier == 0.0  # no answered items
    assert report.p50_ms == report.p90_ms == 17


@pytest.mark.asyncio
@pytest.mark.parametrize("unanswered", ["refusal", "error"])
async def test_calibration_keeps_unanswered_labels_in_class_totals(unanswered):
    examples = [(0.4, True), (0.3, False), (0.5, False), (0.6, False)]
    examples += [(None, True)] * 3
    moments = [
        replace(load_moments(SYNTHETIC_SET)[0], labels=dict.fromkeys(PREDICATES, label))
        for _, label in examples
    ]
    probabilities = iter(prob for prob, _ in examples)

    class Stub:
        name = "stub"

        async def evaluate(self, gi):
            prob = next(probabilities)
            if prob is None:
                if unanswered == "error":
                    raise GateError("unavailable")
                return GateResult({}, PREDICATES, 10, self.name)
            return GateResult(dict.fromkeys(PREDICATES, prob), (), 10, self.name)

    report = await evaluate_gate(Stub(), moments, inputs_for(moments), THRESHOLDS)
    for score in report.scores.values():
        # Optimizing only answered items picks .4, which scores worse on the full set.
        assert score.best_threshold == 0.95
        assert score.brier == pytest.approx(0.265)
        assert score.n == 7 and score.positives == 4
        assert score.refusals == (3 if unanswered == "refusal" else 0)
    assert report.errors == (3 if unanswered == "error" else 0)


@pytest.mark.asyncio
async def test_errors_unknown_labels_and_concurrency():
    moments = load_moments(SYNTHETIC_SET)[:8]
    moments[0] = replace(moments[0], labels=dict.fromkeys(PREDICATES, None))
    active = peak = calls = 0

    class Stub:
        name = "stub"

        async def evaluate(self, gi):
            nonlocal active, peak, calls
            active += 1
            calls += 1
            peak = max(peak, active)
            call = calls
            try:
                await asyncio.sleep(0.001)
                if call == 2:
                    raise GateError("not printed")
                return GateResult(dict.fromkeys(PREDICATES, 0.2), (), call * 10, self.name)
            finally:
                active -= 1

    report = await evaluate_gate(Stub(), moments, inputs_for(moments), THRESHOLDS)
    assert peak == 4 and active == 0 and calls == 8
    assert report.errors == 1
    assert all(score.n == 7 for score in report.scores.values())
    assert report.p50_ms == 50 and report.p90_ms == 80


@pytest.mark.asyncio
async def test_mismatched_inputs_fail_before_gate_calls():
    with pytest.raises(ValueError):
        await evaluate_gate(FakeGate(), load_moments(SYNTHETIC_SET), [], THRESHOLDS)


def test_cli_prints_the_table_and_writes_thresholds(tmp_path, monkeypatch, capsys):
    thresholds = tmp_path / "thresholds.json"
    thresholds.write_text(VisionSettings().thresholds_path.read_text())
    original = json.loads(thresholds.read_text())
    monkeypatch.setenv("TASSEL_THRESHOLDS_PATH", str(thresholds))
    monkeypatch.setattr(gate_eval, "gate_input_for", lambda m, _: inputs_for([m])[0])
    # --gates fake must not read an env file or instantiate a live SDK.
    monkeypatch.setattr(VisionSettings, "load", classmethod(lambda cls: pytest.fail("env read")))
    out = tmp_path / "report.json"
    assert main(["--gates", "fake", "--write-thresholds", "--json", str(out)]) == 0
    printed = capsys.readouterr().out
    for text in [
        "balanced",
        "Brier",
        "refusals",
        "p50",
        "p90",
        "Recommendation: fake",
        *PREDICATES,
    ]:
        assert text in printed
    written = json.loads(thresholds.read_text())
    assert written["fake"]["diagram_attempt_complete"] == 0.9
    assert written["fake"]["new_work_worth_checking"] == 0.8
    assert written["openai"] == original["openai"]
    assert written["clef"] == original["clef"]
    assert json.loads(out.read_text())["reports"][0]["gate"] == "fake"


def test_write_thresholds_live_floor_and_unknown_labels(tmp_path):
    path = tmp_path / "thresholds.json"
    path.write_text(VisionSettings().thresholds_path.read_text())
    score = gate_eval.PredicateScore(2, 1, 1, 1, 0.01, 0.2, 0)
    report = gate_eval.GateReport("openai", dict.fromkeys(PREDICATES, score), 10, 20, 0)
    gate_eval.write_thresholds(path, [report])
    assert set(json.loads(path.read_text())["openai"].values()) == {0.5}


def test_recommendation_ranks_accuracy_then_latency_and_excludes_failed_runs():
    score = gate_eval.PredicateScore(24, 4, 0.5, 0.5, 0.2, 0.5, 0)
    fast = gate_eval.GateReport("fast", dict.fromkeys(PREDICATES, score), 10, 20, 0)
    accurate = replace(
        fast,
        gate="accurate",
        scores=dict.fromkeys(PREDICATES, replace(score, balanced_accuracy=1.0)),
        p90_ms=100,
    )
    slow = replace(fast, gate="slow", p90_ms=200)
    failed = replace(fast, gate="failed", errors=24, p50_ms=0, p90_ms=0)
    partial = replace(accurate, gate="partial", errors=1)
    assert gate_eval._recommendation([fast, accurate]) == "accurate"
    assert gate_eval._recommendation([slow, fast]) == "fast"
    assert gate_eval._recommendation([failed, partial, fast]) == "fast"
    assert gate_eval._recommendation([failed]) is None


def test_export_refuses_paths_outside_cache(tmp_path, monkeypatch, capsys):
    cache = tmp_path / ".cache"
    cache.mkdir()
    (cache / "escape").symlink_to(tmp_path / "elsewhere", target_is_directory=True)
    monkeypatch.setattr(gate_eval, "CACHE_ROOT", cache)
    for path in [tmp_path / "outside", cache / "escape" / "recording"]:
        assert main(["export", "--session", str(uuid.uuid4()), "--out", str(path)]) == 2
        assert not path.exists()
    assert ".cache" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_export_writes_all_frames_and_reloadable_null_labels(db, tmp_path, monkeypatch):
    cache = tmp_path / ".cache"
    monkeypatch.setattr(gate_eval, "CACHE_ROOT", cache)
    learner = Learner(id=uuid.uuid4())
    session = TutoringSession(
        id=uuid.uuid4(), learner_id=learner.id, type="homework", language="ko", source="paper"
    )
    db.add(learner)
    await db.flush()
    db.add(session)
    await db.flush()
    store = MemoryObjectStore()
    for seq in (2, 1):
        data = f"synthetic frame {seq}".encode()
        key = f"local/{session.id}/{seq}"
        await store.put(key, data, "image/jpeg")
        db.add(
            Frame(
                session_id=session.id,
                seq=seq,
                reason="ink",
                source="fake-clip",
                captured_at=datetime(2026, 10, 17, tzinfo=UTC) + timedelta(seconds=seq),
                width=320,
                height=240,
                bytes=len(data),
                full_key=key,
                crop_key=None,
                meta={},
            )
        )
    await db.flush()
    out = cache / "recording"
    assert await export_session(session.id, out, db=db, store=store) == 2
    moments = load_moments(out / "labels.json")
    assert [m.variant for m in moments] == ["frames/1.jpg", "frames/2.jpg"]
    assert [m.at_ms for m in moments] == [0, 1000]
    assert all(m.lang == "ko" and m.transcript == () for m in moments)
    assert all(set(m.labels.values()) == {None} for m in moments)
    assert (out / "frames/1.jpg").read_bytes() == b"synthetic frame 1"
    with pytest.raises(FileExistsError):
        await export_session(session.id, out, db=db, store=store)
