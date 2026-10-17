"""Explicit fixture mode samples the actual synthetic pixels, not the clip clock."""

import asyncio
import json
import threading
from dataclasses import replace

import numpy as np
import pytest

from tassel.vision.clips import REPO_DIR, frame_at
from tassel.vision.deepcheck import ProblemContext, prepare
from tassel.vision.fakes.deepcheck import FixtureDeepCheck, NamedFixtureDeepCheck
from tassel.vision.page import decode_jpeg, encode_jpeg
from tassel.vision.transcription import snap

CTX = ProblemContext(None, (), (), "en")
FIXTURES = REPO_DIR / "packages/shared/src/vision/fixtures.json"


def machine(reading):
    return (
        reading.kind,
        reading.alphabet,
        [(s.id, s.start, s.accept) for s in reading.states],
        [(e.source, e.symbols, e.target) for e in reading.transitions],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "time,name",
    [(26700, "demo-partial"), (38500, "demo-correct"), (47100, "demo-wrong"), (3000, None)],
)
async def test_fixture_reads_the_pixels(clip, time, name):
    from tassel.domains.dfa.contract import DfaReading

    files = clip("dfa-demo")
    prepared = prepare(frame_at(files.mjpeg, time), None, None)
    result = await FixtureDeepCheck(files.truth).transcribe(prepared, CTX)
    assert result.status == "ok" and result.reading is None and result.ms >= 0
    reading = snap(result.transcription, prepared.page, prepared.candidates, frame_id=None)
    if name is None:
        assert result.transcription.machine_kind == "none"
        assert reading.states == [] and reading.transitions == []
    else:
        expected = DfaReading.model_validate(json.loads(FIXTURES.read_text())["readings"][name])
        assert machine(reading) == machine(expected)
        assert reading.uncertain == []


@pytest.mark.asyncio
async def test_fixture_marks_are_real_candidates(clip):
    files = clip("dfa-demo")
    reader = FixtureDeepCheck(files.truth)
    for time in (26700, 38500, 47100):
        prepared = prepare(frame_at(files.mjpeg, time), None, None)
        result = await reader.transcribe(prepared, CTX)
        assert all(
            s.circle_mark in {c.mark for c in prepared.candidates.circles}
            for s in result.transcription.states
        )
        assert all(
            e.label_mark in {label.mark for label in prepared.candidates.labels}
            for e in result.transcription.transitions
        )


@pytest.mark.asyncio
async def test_fake_does_not_invent_ink_and_runs_sampling_off_loop(clip, monkeypatch):
    import tassel.vision.fakes.deepcheck as module

    files = clip("dfa-demo")
    prepared = prepare(frame_at(files.mjpeg, 47100), None, None)
    blank_page = replace(prepared.page, rgb=np.full_like(prepared.page.rgb, 255))
    loop_thread = threading.get_ident()
    threads = []
    original = module.ink_mask

    def sample(page):
        threads.append(threading.get_ident())
        return original(page)

    monkeypatch.setattr(module, "ink_mask", sample)
    reader = FixtureDeepCheck(files.truth, delay_ms=15)
    result = await reader.transcribe(replace(prepared, page=blank_page), CTX)
    assert result.transcription.machine_kind == "none"
    assert result.ms >= 15
    assert threads and all(t != loop_thread for t in threads)
    # Removing candidates must not make up ids even when truth says there are states.
    from tassel.vision.marks import Candidates

    unmatched = await reader.transcribe(replace(prepared, candidates=Candidates((), ())), CTX)
    assert all(s.circle_mark is None for s in unmatched.transcription.states)
    assert all(e.label_mark is None for e in unmatched.transcription.transitions)


@pytest.mark.asyncio
async def test_named_fixture_gives_a_ready_reading():
    expected = json.loads(FIXTURES.read_text())["readings"]["demo-wrong"]
    reader = NamedFixtureDeepCheck("demo-wrong")
    prepared = prepare(encode_jpeg(np.full((300, 400, 3), 200, np.uint8)), None, None)
    result = await reader.transcribe(prepared, CTX)
    assert result.transcription is None and result.status == "ok"
    assert result.reading.model_dump(mode="json") == expected
    result.reading.states.clear()
    assert (await reader.transcribe(prepared, CTX)).reading.states
    empty = await NamedFixtureDeepCheck("none").transcribe(prepared, CTX)
    assert empty.status == "ok" and empty.transcription is None
    assert not empty.reading.states and not empty.reading.transitions
    with pytest.raises(ValueError, match="unknown"):
        NamedFixtureDeepCheck("not-a-fixture")


@pytest.mark.asyncio
async def test_fixture_membership_and_variants(clip, tmp_path):
    files = clip("dfa-demo")
    truth = json.loads(files.truth.read_text())
    for variant in ("dfa-demo", "dfa-demo-hold", "dfa-short"):
        # The hold clip arrives later; its problem configuration can be exercised now.
        truth["name"] = variant
        path = tmp_path / f"{variant}.json"
        path.write_text(json.dumps(truth))
        reader = FixtureDeepCheck(path)
        p = await reader.membership("Binary strings that start with 010", ["0", "1"])
        assert p.expressible and p.any_of[0].all_of[0].op == "starts_with"
        assert p.any_of[0].all_of[0].text == "010"
        assert await reader.membership("A different problem", ["0", "1"]) is None
    assert await NamedFixtureDeepCheck("none").membership("unknown", ["a"]) is None


def test_prepare_uses_the_page_and_preserves_small_crop(clip):
    files = clip("dfa-demo")
    jpeg = frame_at(files.mjpeg, 47100)
    crop = encode_jpeg(np.full((100, 200, 3), 210, np.uint8))
    prepared = prepare(jpeg, None, crop)
    assert prepared.page.found and len(prepared.candidates.circles) == 4
    marked = decode_jpeg(prepared.marked_jpeg)
    assert marked.shape == prepared.page.rgb.shape
    assert np.any(np.max(marked.astype(int) - prepared.page.rgb.astype(int), axis=2) > 20)
    assert prepared.crop_jpeg == crop
    assert "image/jpeg" not in repr(prepared) and str(prepared.marked_jpeg) not in repr(prepared)


@pytest.mark.asyncio
async def test_fixture_delay_is_cancellable(clip):
    prepared = prepare(frame_at(clip("dfa-demo").mjpeg, 3000), None, None)
    task = asyncio.create_task(
        FixtureDeepCheck(clip("dfa-demo").truth, delay_ms=60000).transcribe(prepared, CTX)
    )
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
