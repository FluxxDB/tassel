"""Offline gate comparison and local recording export. Live gates require explicit --gates."""

import argparse
import asyncio
import json
import math
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import UUID

import anyio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.config import Settings
from tassel.frames import repo as frames_repo
from tassel.frames.objects import ObjectStore, make_object_store
from tassel.frames.tables import Frame
from tassel.storage.db import make_engine, session_factory
from tassel.storage.tables import TutoringSession
from tassel.vision.clips import DEFAULT_CLIPS_DIR, REPO_DIR
from tassel.vision.evalset import SYNTHETIC_SET, LabeledMoment, gate_input_for, load_moments
from tassel.vision.gate import _probability, load_thresholds, make_gate
from tassel.vision.ports import (
    PREDICATES,
    DecisionGate,
    GateError,
    GateInput,
    GateResult,
    Predicate,
)
from tassel.vision.settings import VisionSettings

CACHE_ROOT = REPO_DIR / ".cache"
MAX_CONCURRENT = 4


@dataclass(frozen=True)
class PredicateScore:
    n: int
    positives: int
    accuracy: float
    balanced_accuracy: float
    brier: float
    best_threshold: float
    refusals: int


@dataclass(frozen=True)
class GateReport:
    gate: str
    scores: dict[Predicate, PredicateScore]
    p50_ms: int
    p90_ms: int
    errors: int


def _balanced(predictions: Sequence[tuple[bool, bool]]) -> float:
    # Average over represented classes; an unlabeled predicate has no measurable accuracy.
    rates = [
        sum(pred == label for pred, label in predictions if label == positive) / count
        for positive in (True, False)
        if (count := sum(label == positive for _, label in predictions))
    ]
    return sum(rates) / len(rates) if rates else 0.0


def best_threshold(pairs: Sequence[tuple[float, bool]]) -> float:
    if not pairs:
        return 0.5
    for probability, _ in pairs:
        _probability(probability)
    return max(
        (i / 20 for i in range(1, 20)),
        key=lambda threshold: (
            _balanced([(p >= threshold, label) for p, label in pairs]),
            threshold,
        ),
    )


def _percentile(values: Sequence[int], fraction: float) -> int:
    # Nearest rank, preserving observed integer latency rather than inventing interpolations.
    return sorted(values)[math.ceil(len(values) * fraction) - 1] if values else 0


async def evaluate_gate(
    gate: DecisionGate,
    moments: Sequence[LabeledMoment],
    inputs: Sequence[GateInput],
    thresholds: Mapping[Predicate, float],
) -> GateReport:
    if len(moments) != len(inputs):
        raise ValueError("each moment needs exactly one gate input")
    for p in PREDICATES:
        _probability(thresholds[p])
    limit = asyncio.Semaphore(MAX_CONCURRENT)

    async def run(moment: LabeledMoment, gi: GateInput) -> GateResult | None:
        async with limit:
            # Rebase each moment just before dispatch, so queueing never ages its transcript.
            offset = int(time.monotonic() * 1000) - moment.at_ms
            gi = replace(
                gi,
                transcript=tuple(
                    replace(line, at_ms=line.at_ms + offset) for line in gi.transcript
                ),
            )
            try:
                result = await gate.evaluate(gi)
                if set(result.probs) & set(result.refused) or (
                    set(result.probs) | set(result.refused) != set(PREDICATES)
                ):
                    raise GateError("incomplete gate result")
                for probability in result.probs.values():
                    _probability(probability)
                return result
            except (GateError, ValueError):
                return None

    results = await asyncio.gather(*(run(m, gi) for m, gi in zip(moments, inputs, strict=True)))
    scores = {}
    for p in PREDICATES:
        labeled = [
            (m.labels[p], r)
            for m, r in zip(moments, results, strict=True)
            if m.labels[p] is not None
        ]
        answered = [(r.probs[p], label) for label, r in labeled if r is not None and p in r.probs]
        # Refusals/errors stay false at every grid threshold, but their labels still
        # contribute to the class totals used to optimize the reported balanced accuracy.
        calibration = [
            (r.probs.get(p, 0.0) if r is not None else 0.0, label) for label, r in labeled
        ]
        predictions = [
            (r is not None and p in r.probs and r.probs[p] >= thresholds[p], label)
            for label, r in labeled
        ]
        n = len(labeled)
        scores[p] = PredicateScore(
            n=n,
            positives=sum(label for label, _ in labeled),
            accuracy=sum(pred == label for pred, label in predictions) / n if n else 0.0,
            balanced_accuracy=_balanced(predictions),
            brier=sum((prob - label) ** 2 for prob, label in answered) / len(answered)
            if answered
            else 0.0,
            best_threshold=best_threshold(calibration) if answered else thresholds[p],
            refusals=sum(r is not None and p in r.refused for _, r in labeled),
        )
    latencies = [r.ms for r in results if r is not None]
    return GateReport(
        gate.name,
        scores,
        _percentile(latencies, 0.5),
        _percentile(latencies, 0.9),
        sum(r is None for r in results),
    )


def _write_json(path: Path, body: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as f:
            temporary = Path(f.name)
            json.dump(body, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write("\n")
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_thresholds(path: Path, reports: Sequence[GateReport]) -> None:
    body = json.loads(path.read_text(encoding="utf-8"))
    for report in reports:
        # Validate the version and gate keys before touching a calibration file.
        load_thresholds(path, report.gate)
        body[report.gate] = {
            p: max(0.5 if report.gate != "fake" else 0.0, score.best_threshold)
            if score.n
            else body[report.gate][p]
            for p, score in report.scores.items()
        }
    _write_json(path, body)


def _export_path(out: Path) -> Path:
    resolved = out.resolve()
    if not resolved.is_relative_to(CACHE_ROOT.resolve()):
        raise ValueError("export --out must be under this checkout's .cache/")
    return resolved


async def export_session(
    session_id: UUID,
    out: Path,
    *,
    db: AsyncSession,
    store: ObjectStore,
) -> int:
    out = _export_path(out)
    session = await db.get(TutoringSession, session_id)
    if session is None:
        raise ValueError("session not found")
    count = await db.scalar(
        select(func.count()).select_from(Frame).where(Frame.session_id == session_id)
    )
    frames = sorted(
        await frames_repo.list_for(db, session_id, limit=count or 0), key=lambda f: f.seq
    )
    # Refuse overwriting a recording or the owner's handwritten labels.
    await anyio.to_thread.run_sync(lambda: out.mkdir(parents=True, exist_ok=False))
    await anyio.to_thread.run_sync(lambda: (out / "frames").mkdir())
    origin = min((f.captured_at for f in frames), default=None)
    moments = []
    for frame in frames:
        data = await store.get(frame.full_key)
        if data is None:
            raise ValueError("a session frame is missing from the object store")
        filename = f"frames/{frame.seq}.jpg"
        await anyio.to_thread.run_sync((out / filename).write_bytes, data)
        moments.append(
            {
                "id": str(frame.id),
                "variant": filename,
                "at_ms": round((frame.captured_at - origin).total_seconds() * 1000),
                "lang": session.language,
                "reason": "frame",
                "transcript": [],
                "quiet_ms": None,
                "silence_ms": None,
                "new_ink": False,
                "changed_cells": 0,
                "labels": dict.fromkeys(PREDICATES),
            }
        )
    await anyio.to_thread.run_sync(
        _write_json, out / "labels.json", {"version": 1, "moments": moments}
    )
    return len(moments)


async def _export(session_id: UUID, out: Path) -> int:
    _export_path(out)  # Fail before settings, database connections or object-store access.
    settings = Settings()
    engine = make_engine(settings.database_url)
    try:
        async with session_factory(engine)() as db:
            return await export_session(session_id, out, db=db, store=make_object_store(settings))
    finally:
        await engine.dispose()


def _recommendation(reports: Sequence[GateReport]) -> str | None:
    # Incomplete provider runs are diagnostic results, not candidates for deployment.
    # In particular, an all-failed run's empty latency sample must never win a tie.
    eligible = [r for r in reports if not r.errors and any(s.n for s in r.scores.values())]
    return (
        min(
            eligible,
            key=lambda r: (
                -sum(s.balanced_accuracy for s in r.scores.values() if s.n)
                / sum(bool(s.n) for s in r.scores.values()),
                r.p90_ms,
            ),
        ).gate
        if eligible
        else None
    )


def _print_reports(reports: Sequence[GateReport]) -> None:
    print("gate    predicate                    n  balanced  best   Brier  refusals")
    for report in reports:
        for p, score in report.scores.items():
            print(
                f"{report.gate:<7} {p:<28} {score.n:3}  {score.balanced_accuracy:8.3f}  "
                f"{score.best_threshold:.2f}  {score.brier:6.3f}  {score.refusals:3}"
            )
        print(f"{report.gate}: p50={report.p50_ms}ms p90={report.p90_ms}ms errors={report.errors}")
    print(
        f"Recommendation: {_recommendation(reports) or 'unavailable (no error-free labeled run)'}"
    )


async def _evaluate(names: list[str], set_name: str, write: bool, out_json: Path | None) -> int:
    # The fake-only command never reads an env file and ignores live-provider mode overrides.
    settings = VisionSettings() if names == ["fake"] else VisionSettings.load()
    source = SYNTHETIC_SET if set_name == "synthetic" else Path(set_name) / "labels.json"
    clips_dir = DEFAULT_CLIPS_DIR if set_name == "synthetic" else Path(set_name)
    moments = load_moments(source)
    gates = []
    try:
        for name in names:
            config = settings.model_copy(
                update={
                    "gate_provider": "fake" if name == "fake" else "live",
                    "gate_live": "clef" if name == "clef" else "openai",
                }
            )
            gates.append(make_gate(config))
        inputs = [await anyio.to_thread.run_sync(gate_input_for, m, clips_dir) for m in moments]
        reports = [
            await evaluate_gate(
                gate, moments, inputs, load_thresholds(settings.thresholds_path, gate.name)
            )
            for gate in gates
        ]
        _print_reports(reports)
        if write:
            write_thresholds(settings.thresholds_path, reports)
        if out_json:
            _write_json(
                out_json,
                {
                    "reports": [asdict(r) for r in reports],
                    "recommendation": _recommendation(reports),
                },
            )
        return 1 if any(r.errors for r in reports) else 0
    finally:
        for gate in gates:
            if close := getattr(gate, "aclose", None):
                await close()


def main(argv: list[str] | None = None) -> int:
    # Capture streams in tests may lack reconfigure; real Windows streams always get UTF-8.
    for stream in (sys.stdout, sys.stderr):
        if reconfigure := getattr(stream, "reconfigure", None):
            reconfigure(encoding="utf-8")
    args = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description=__doc__)
    if args[:1] == ["export"]:
        parser.add_argument("--session", type=UUID, required=True)
        parser.add_argument("--out", type=Path, required=True)
        parsed = parser.parse_args(args[1:])
        try:
            count = asyncio.run(_export(parsed.session, parsed.out))
            print(f"Exported {count} frames locally; label labels.json before evaluation.")
            return 0
        except ValueError:
            print(
                "Export failed: check the session, object availability and --out under .cache/.",
                file=sys.stderr,
            )
            return 2
        except Exception:
            print(
                "Export failed; check database/store settings and use a new output directory.",
                file=sys.stderr,
            )
            return 2
    parser.add_argument("--gates", default="fake")
    parser.add_argument("--set", default="synthetic")
    parser.add_argument("--write-thresholds", action="store_true")
    parser.add_argument("--json", type=Path)
    parsed = parser.parse_args(args)
    names = parsed.gates.split(",")
    if len(set(names)) != len(names) or any(
        name not in {"fake", "openai", "clef"} for name in names
    ):
        parser.error("--gates expects unique names from fake,openai,clef")
    try:
        return asyncio.run(_evaluate(names, parsed.set, parsed.write_thresholds, parsed.json))
    except Exception:
        # No SDK, settings or storage exception text: these can contain credentials or images.
        print(
            "Evaluation failed; check the set, clip files, thresholds and requested gate settings.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
