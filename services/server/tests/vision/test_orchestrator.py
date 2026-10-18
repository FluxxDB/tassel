"""Vision scheduling and etiquette at the channel boundary; no devices or providers."""

import asyncio
import time
from dataclasses import replace
from uuid import uuid4

import cv2
import numpy as np
import pytest
import pytest_asyncio

from tassel.domains.dfa.contract import LanguageGuess
from tassel.vision.clips import frame_at
from tassel.vision.deepcheck import TranscriptionResult
from tassel.vision.fakes.deepcheck import FixtureDeepCheck, NamedFixtureDeepCheck
from tassel.vision.orchestrator import FrameIn, VisionSession
from tassel.vision.page import decode_jpeg, encode_jpeg
from tassel.vision.ports import PREDICATES, GateError, GateResult

pytestmark = pytest.mark.asyncio


class Clock:
    def __init__(self):
        self.ms = 100_000

    def __call__(self):
        return self.ms / 1000

    def advance(self, ms):
        self.ms += ms


class Gate:
    name = "fake"

    def __init__(self, mode="worth"):
        self.mode = mode
        self.calls = []

    async def evaluate(self, gi):
        self.calls.append(gi)
        key = {"worth": 1, "complete": 0, "stuck": 2, "other": 3}[self.mode]
        return GateResult({p: float(i == key) for i, p in enumerate(PREDICATES)}, (), 3, "fake")


class Reader(NamedFixtureDeepCheck):
    def __init__(self, name="demo-wrong"):
        super().__init__(name)
        self.calls = []
        self.memberships = []
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.release.set()
        self.status = "ok"
        self.active = 0
        self.peak = 0

    async def transcribe(self, prepared, ctx):
        self.calls.append(ctx)
        self.active += 1
        self.peak = max(self.peak, self.active)
        self.started.set()
        try:
            await self.release.wait()
            if self.status != "ok":
                return TranscriptionResult(self.status, None, 1)
            return await super().transcribe(prepared, ctx)
        finally:
            self.active -= 1

    async def membership(self, problem, alphabet):
        self.memberships.append((problem, alphabet))
        return await super().membership(problem, alphabet)


class RecordingChannel:
    lang = "en"

    def __init__(self):
        self.calls = []

    async def append_note(self, text):
        self.calls.append(("note", text))

    async def run_llm(self):
        self.calls.append(("run", None))

    async def say(self, text):
        self.calls.append(("say", text))

    async def send(self, event):
        self.calls.append((event.kind, event))

    def values(self, kind):
        return [v for k, v in self.calls if k == kind]

    def delivery(self):
        return [k for k, _ in self.calls if k != "vision-debug"]


class Harness:
    def __init__(self, **kwargs):
        self.clock = Clock()
        self.gate = Gate()
        self.reader = Reader()
        self.channel = RecordingChannel()

        async def title():
            return "My automaton"

        self.s = VisionSession(
            session_id=uuid4(),
            lang="en",
            gate=self.gate,
            deepcheck=self.reader,
            thresholds={p: 0.5 for p in PREDICATES},
            title=title,
            clock=self.clock,
            **kwargs,
        )
        self.s.attach(self.channel)
        self.jpeg = encode_jpeg(np.full((240, 320, 3), 255, np.uint8))

    def frame(self, **kwargs):
        f = FrameIn(uuid4(), "ink", self.clock.ms, self.jpeg, None, None, 3)
        f = replace(f, **kwargs)
        self.s.on_frame(f)
        return f

    async def settle(self):
        for _ in range(3):
            await self.s.tick()
            await self.s.idle()

    async def invited(self):
        self.gate.mode = "complete"
        self.frame()
        await self.settle()


@pytest_asyncio.fixture
async def h():
    h = Harness()
    yield h
    await h.s.close()


async def test_ink_frame_runs_the_gate_and_a_silent_check(h, clip):
    files = clip("dfa-demo")
    h.s.deepcheck = FixtureDeepCheck(files.truth)
    h.frame(full_jpeg=frame_at(files.mjpeg, 26700))
    await h.settle()
    assert len(h.gate.calls) == 1
    assert h.s.snapshot().verdict.status == "wrong"
    assert not h.channel.values("note")


async def test_gate_is_called_at_most_every_5s(h):
    h.frame()
    await h.settle()
    for _ in range(4):
        h.clock.advance(1000)
        h.frame()
        await h.settle()
    assert len(h.gate.calls) == 1
    h.clock.advance(1000)
    await h.settle()
    assert len(h.gate.calls) == 2


async def test_one_check_in_flight_and_the_latest_frame_wins(h):
    h.gate.mode = "complete"
    h.reader.release.clear()
    h.frame()
    await h.s.tick()
    await asyncio.wait_for(h.reader.started.wait(), 3)
    h.frame()
    latest = h.frame()
    h.reader.release.set()
    await h.settle()
    assert h.reader.peak == 1 and len(h.reader.calls) == 2
    assert h.s.snapshot().reading.frame_id == str(latest.id)
    assert len(h.channel.values("note")) == 1


async def test_unprompted_checks_15s_apart(h):
    h.frame()
    await h.settle()
    h.clock.advance(5000)
    h.frame()
    await h.settle()
    assert len(h.reader.calls) == 1
    h.clock.advance(10000)
    await h.settle()
    assert len(h.reader.calls) == 2


@pytest.mark.parametrize("fresh", [True, False])
async def test_done_waits_for_a_fresh_frame(h, clip, fresh):
    files = clip("dfa-demo")
    h.s.deepcheck = FixtureDeepCheck(files.truth)
    h.frame(full_jpeg=frame_at(files.mjpeg, 38500))
    await h.settle()
    h.clock.advance(5000)
    h.s.on_pen(True)
    h.s.on_pen(False)
    h.s.on_user_text("I think I'm done.", typed=True)
    h.gate.mode = "complete"
    await h.settle()
    await h.settle()
    assert len(h.gate.calls) == 1 and h.s.snapshot().waiting_for_frame
    holds = [
        e.debug
        for e in h.channel.values("vision-debug")
        if e.debug.stage == "policy" and e.debug.why == "waiting for a fresh frame"
    ]
    assert len(holds) == 1
    h.clock.advance(1600 if fresh else 6000)
    if fresh:
        h.frame(full_jpeg=frame_at(files.mjpeg, 47100))
    await h.settle()
    assert not h.s.snapshot().waiting_for_frame and len(h.gate.calls) == 2
    assert ("1010" in h.channel.values("note")[0]) if fresh else h.channel.values("note")


async def test_stall_hint(h, clip, monkeypatch):
    from tassel.vision.gate import FakeGate

    monkeypatch.setattr("tassel.vision.gate.time.monotonic", h.clock)
    files = clip("dfa-demo")
    h.s.gate = FakeGate()
    h.s.deepcheck = FixtureDeepCheck(files.truth)
    h.frame(full_jpeg=frame_at(files.mjpeg, 26700))
    await h.settle()
    h.clock.advance(6000)
    await h.settle()
    assert "after reading 010" in h.channel.values("note")[0]
    assert h.channel.delivery() == ["note", "run"]
    assert h.s.snapshot().last_gate.reason == "stall"


async def test_hint_is_dropped_when_she_draws_again(h):
    h.gate.mode = "stuck"
    h.s.on_user_speaking(True)
    h.frame()
    await h.settle()
    assert h.s.snapshot().pending_note
    h.s.on_pen(True)
    h.s.on_pen(False)
    h.s.on_user_speaking(False)
    h.clock.advance(2000)
    await h.settle()
    assert not h.channel.values("note") and not h.s.snapshot().pending_note


async def test_waits_for_her_pause_and_pen(h):
    h.s.on_user_speaking(True)
    h.s.on_pen(True)
    await h.invited()
    assert not h.channel.values("note")
    h.s.on_pen(False)
    h.clock.advance(1000)
    h.s.on_user_speaking(False)
    h.clock.advance(599)
    await h.s.tick()
    assert not h.channel.values("note")
    h.clock.advance(1)
    await h.s.tick()
    assert len(h.channel.values("note")) == 1


@pytest.mark.parametrize("audio", [True, False])
async def test_never_over_ada(h, audio):
    h.s.on_bot(reply="started")
    if audio:
        h.s.on_bot(speaking=True)
    await h.invited()
    assert not h.channel.values("note")
    h.s.on_bot(reply="ended")
    h.clock.advance(1499)
    await h.s.tick()
    assert not h.channel.values("note")
    h.clock.advance(1)
    if audio:
        await h.s.tick()
        assert not h.channel.values("note")
        h.s.on_bot(speaking=False)
    await h.s.tick()
    assert len(h.channel.values("note")) == 1


@pytest.mark.parametrize("mode,spoke", [("complete", False), ("worth", False), ("complete", True)])
async def test_holding_line_after_2s_for_an_invited_check(h, mode, spoke):
    h.frame()
    await h.settle()
    h.clock.advance(5000)
    h.s.on_pen(False)
    h.s.on_user_text("I think I'm done.", typed=True)
    if spoke:
        h.s.on_bot(speaking=True)
        h.s.on_bot(speaking=False)
    h.clock.advance(2000)
    h.gate.mode = mode
    h.reader.release.clear()
    h.reader.started.clear()
    h.frame()
    # Unprompted checks have a separate 15 s limit.
    if mode == "worth":
        h.clock.advance(10000)
    await h.s.tick()
    await asyncio.wait_for(h.reader.started.wait(), 3)
    h.clock.advance(1999)
    await h.s.tick()
    assert not h.channel.values("say")
    h.clock.advance(1)
    await h.s.tick()
    await h.s.tick()
    assert len(h.channel.values("say")) == int(mode == "complete" and not spoke)
    h.reader.release.set()


@pytest.mark.parametrize(
    "mode,order",
    [
        ("complete", ["readback", "stage", "note", "run"]),
        ("stuck", ["note", "run"]),
    ],
)
async def test_delivery_order(h, mode, order):
    h.gate.mode = mode
    h.frame()
    await h.settle()
    assert h.channel.delivery() == order
    if mode == "complete":
        assert h.channel.values("stage")[0].view == "split"


async def test_tutor_lines_reach_the_gate(h):
    h.s.on_user_text("Hi Ada, help me", typed=True)
    h.s.on_tutor_text("Great, draw it on paper")
    h.frame()
    await h.settle()
    assert [x.speaker for x in h.gate.calls[0].transcript] == ["student", "tutor"]
    assert h.reader.calls[0].early_lines == ("Hi Ada, help me",)
    h.clock.advance(120001)
    h.frame()
    await h.settle()
    assert h.gate.calls[-1].transcript == ()


@pytest.mark.parametrize("operation", ["prepare", "compile_regex"])
async def test_checks_never_block_the_loop(h, monkeypatch, operation):
    import tassel.vision.orchestrator as module

    original = getattr(module, operation)

    def slow(*args, **kwargs):
        time.sleep(0.3)
        return original(*args, **kwargs)

    monkeypatch.setattr(module, operation, slow)
    gaps = []
    stop = asyncio.Event()

    async def probe():
        previous = time.monotonic()
        while not stop.is_set():
            await asyncio.sleep(0.01)
            now = time.monotonic()
            gaps.append(now - previous)
            previous = now

    task = asyncio.create_task(probe())
    try:
        h.frame()
        await h.settle()
    finally:
        stop.set()
        await task
    assert len(gaps) > 15 and max(gaps) < 0.1


async def test_ready_reading_skips_snap(h, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("ready readings must not be snapped")

    monkeypatch.setattr("tassel.vision.orchestrator.snap", forbidden)
    frame = h.frame()
    await h.settle()
    assert h.s.snapshot().verdict.counterexample.input == "1010"
    assert h.s.snapshot().reading.frame_id == str(frame.id)


async def test_barge_in_before_speech_reruns_once(h):
    await h.invited()
    for expected in (2, 3, 3):
        h.s.on_user_speaking(True)
        h.s.on_interruption()
        await h.s.tick()
        h.s.on_user_speaking(False)
        h.clock.advance(600)
        await h.s.tick()
        assert len(h.channel.values("run")) == expected
    assert len(h.channel.values("note")) == 1
    h.s.on_bot(speaking=True)
    h.s.on_interruption()
    h.clock.advance(600)
    await h.s.tick()
    assert len(h.channel.values("run")) == 3


async def test_spoken_note_climbs_the_ladder(h):
    await h.invited()
    assert h.s.snapshot().rung is None
    h.s.on_bot(speaking=True)
    assert h.s.snapshot().rung == "counterexample"
    h.s.on_bot(speaking=False)
    h.clock.advance(5000)
    h.frame()
    await h.settle()
    assert "Escalation: walkthrough" in h.channel.values("note")[-1]


async def test_unprompted_rate_limit(h):
    h.gate.mode = "stuck"
    h.frame()
    await h.settle()
    h.s.on_bot(speaking=True)
    h.s.on_bot(speaking=False)
    assert h.s.snapshot().hints == 1
    h.clock.advance(20000)
    h.frame()
    await h.settle()
    assert len(h.channel.values("note")) == 1
    h.clock.advance(25000)
    await h.s.tick()
    assert len(h.channel.values("note")) == 2


async def test_page_frame_resets_the_problem(h):
    await h.invited()
    h.s.on_bot(speaking=True)
    h.s.on_bot(speaking=False)
    h.frame(reason="page")
    await h.s.tick()
    state = h.s.snapshot()
    assert state.reading is None and state.verdict is None and state.rung is None
    assert not state.pending_note and state.hints == 0
    assert h.channel.values("readback")[-1].reading is None


async def test_notes_expire(h):
    h.s.on_user_speaking(True)
    await h.invited()
    h.clock.advance(30001)
    h.s.on_user_speaking(False, stopped_ms_ago=1000)
    await h.s.tick()
    assert not h.channel.values("note") and not h.s.snapshot().pending_note
    assert h.s.snapshot().last_decision.action == "drop"


async def test_not_schoolwork_skips_the_check(h):
    h.gate.mode = "other"
    h.frame()
    await h.settle()
    assert not h.reader.calls and not h.channel.values("note")


@pytest.mark.parametrize("mode", ["complete", "worth"])
@pytest.mark.parametrize("status", ["refused", "timeout", "failed"])
async def test_failed_check_speaks_only_when_invited(h, mode, status):
    h.gate.mode = mode
    h.reader.status = status
    h.frame()
    await h.settle()
    assert bool(h.channel.values("note")) == (mode == "complete")
    assert any(
        e.debug.stage == "check" and e.debug.status == status
        for e in h.channel.values("vision-debug")
    )
    assert not h.channel.values("readback")


@pytest.mark.parametrize("catalog", [True, False])
async def test_reference_resolution_is_cached(h, catalog):
    if not catalog:
        h.reader._reading.language = LanguageGuess(regex="0(0|1)*", confidence=1)
        h.reader._reading.problem = "binary strings beginning with zero"
    await h.invited()
    h.s.on_bot(speaking=True)
    h.s.on_bot(speaking=False)
    h.clock.advance(5000)
    h.frame()
    await h.settle()
    assert len(h.reader.memberships) == (0 if catalog else 1)


async def test_explain(h):
    assert await h.s.explain("solution") == {"ok": False, "reason": "nothing to show"}
    h.frame()
    await h.settle()
    assert await h.s.explain("walkthrough") == {"ok": True}
    await h.s.tick()
    assert "Trace:" in h.channel.values("note")[-1]
    h.s.on_bot(speaking=True)
    h.s.on_bot(speaking=False)
    assert await h.s.explain("solution") == {"ok": True}
    await h.s.tick()
    assert "Solution:" in h.channel.values("note")[-1]


async def test_board_edit_skips_the_deep_check(h):
    h.gate.mode = "complete"
    image = cv2.imencode(".png", np.full((1200, 1600, 3), 255, np.uint8))[1].tobytes()
    reading = h.reader._reading.model_copy(update={"source": "board"})
    h.s.on_board_edit(reading, image)
    await h.settle()
    assert not h.reader.calls and not h.channel.values("readback")
    assert h.s.snapshot().verdict.counterexample.input == "1010"
    assert h.gate.calls[0].reason == "board"
    jpeg = h.gate.calls[0].image_jpeg
    assert jpeg.startswith(b"\xff\xd8") and max(decode_jpeg(jpeg).shape[:2]) <= 1024


@pytest.mark.parametrize("mode", ["complete", "stuck"])
async def test_attach_resends_the_readback(h, mode):
    h.gate.mode = mode
    h.frame()
    await h.settle()
    channel = RecordingChannel()
    h.s.detach()
    h.s.attach(channel)
    await h.s.tick()
    assert len(channel.values("readback")) == int(mode == "complete")


async def test_gate_error_is_debug_only(h):
    async def fail(gi):
        raise GateError("secret provider detail must not be logged")

    h.gate.evaluate = fail
    h.frame()
    await h.settle()
    assert not h.reader.calls and not h.channel.values("note")
    assert h.channel.values("vision-debug")[-1].debug.status == "failed"


async def test_page_reset_discards_an_in_flight_check(h):
    h.gate.mode = "complete"
    h.reader.release.clear()
    h.frame()
    await h.s.tick()
    await asyncio.wait_for(h.reader.started.wait(), 3)
    h.frame(reason="page")
    h.reader.release.set()
    await h.settle()
    assert h.s.snapshot().reading is None
    assert not h.channel.values("note")
    assert h.channel.values("readback")[-1].reading is None


async def test_close_abandons_cpu_work(h, monkeypatch):
    import threading

    import tassel.vision.orchestrator as module

    entered = threading.Event()
    finished = threading.Event()
    release = threading.Event()
    original = module.prepare

    def slow(*args):
        entered.set()
        try:
            release.wait(3)
            return original(*args)
        finally:
            finished.set()

    monkeypatch.setattr(module, "prepare", slow)
    h.frame()
    await h.s.tick()
    for _ in range(300):
        if entered.is_set():
            break
        await asyncio.sleep(0.01)
    assert entered.is_set()
    try:
        await asyncio.wait_for(h.s.close(), 0.1)
        assert not finished.is_set()
    finally:
        release.set()
        for _ in range(300):
            if finished.is_set():
                break
            await asyncio.sleep(0.01)
    assert not h.channel.values("note")


async def test_pen_must_be_still_for_1500ms(h):
    h.s.on_pen(True)
    await h.invited()
    h.s.on_pen(False)
    h.clock.advance(1499)
    await h.s.tick()
    assert not h.channel.values("note")
    h.clock.advance(1)
    await h.s.tick()
    assert len(h.channel.values("note")) == 1


async def test_pending_frame_does_not_bypass_a_done_freshness_wait(h):
    h.frame()
    await h.settle()
    h.clock.advance(1000)
    stale = h.frame()
    h.clock.advance(100)
    h.s.on_pen(False)
    h.s.on_user_text("I think I'm done.", typed=True)
    h.gate.mode = "complete"
    h.clock.advance(3900)
    await h.settle()
    assert len(h.gate.calls) == 1 and h.s.snapshot().waiting_for_frame
    assert not h.channel.values("note")
    h.clock.advance(1)
    fresh = h.frame()
    await h.settle()
    assert len(h.gate.calls) == 2
    assert h.s.snapshot().reading.frame_id == str(fresh.id) != str(stale.id)
    assert len(h.channel.values("note")) == 1


async def test_page_change_during_readback_cannot_deliver_old_note(h):
    original = h.channel.send

    async def send(event):
        await original(event)
        if event.kind == "readback" and event.reading is not None:
            h.frame(reason="page")
            await asyncio.sleep(0)

    h.channel.send = send
    await h.invited()
    assert not h.channel.values("note")
    assert not h.channel.values("stage")
    assert not h.channel.values("run")
    assert h.channel.values("readback")[-1].reading is None


async def test_cached_gate_cannot_append_an_interrupted_note_twice(h):
    await h.invited()
    h.s.on_interruption()
    h.clock.advance(5000)
    h.s.on_user_text("Wait", typed=True)
    h.clock.advance(600)
    await h.settle()
    assert len(h.channel.values("note")) == 1
    assert len(h.channel.values("run")) == 2


async def test_new_page_ink_does_not_inherit_old_check_invitation(h):
    h.gate.mode = "complete"
    h.reader.release.clear()
    h.frame()
    await h.s.tick()
    await asyncio.wait_for(h.reader.started.wait(), 3)
    h.frame(reason="page")
    h.gate.mode = "other"
    h.frame()
    h.reader.release.set()
    await h.settle()
    assert len(h.reader.calls) == 1
    assert h.s.snapshot().reading is None
    assert not h.channel.values("note")


async def test_pen_resuming_during_gate_invalidates_stall_hint(h):
    started, release = asyncio.Event(), asyncio.Event()
    original = h.gate.evaluate

    async def evaluate(gi):
        started.set()
        await release.wait()
        return await original(gi)

    h.gate.evaluate = evaluate
    h.gate.mode = "stuck"
    h.frame()
    await h.s.tick()
    await asyncio.wait_for(started.wait(), 3)
    h.s.on_pen(True)
    h.s.on_pen(False)
    release.set()
    h.clock.advance(1600)
    await h.settle()
    assert not h.channel.values("note")


async def test_fixture_sampling_obeys_the_shared_cpu_budget(clip, monkeypatch):
    import threading

    import anyio

    import tassel.vision.fakes.deepcheck as module

    lock = threading.Lock()
    active = peak = entered = 0
    ready = asyncio.Event()
    original = module._sample

    def sample(*args):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        try:
            time.sleep(0.15)
            return original(*args)
        finally:
            with lock:
                active -= 1

    class BarrierReader(FixtureDeepCheck):
        async def transcribe(self, prepared, ctx):
            nonlocal entered
            entered += 1
            if entered == 3:
                ready.set()
            await ready.wait()
            return await super().transcribe(prepared, ctx)

    monkeypatch.setattr(module, "_sample", sample)
    limiter = anyio.CapacityLimiter(2)
    reader = BarrierReader(clip("dfa-demo").truth)
    sessions = [Harness(limiter=limiter) for _ in range(3)]
    try:
        for h in sessions:
            h.s.deepcheck = reader
            h.frame()
        await asyncio.wait_for(asyncio.gather(*(h.settle() for h in sessions)), 5)
        assert peak == 2
    finally:
        await asyncio.gather(*(h.s.close() for h in sessions))


async def test_repeated_gate_during_check_reuses_the_completed_reading(h):
    h.gate.mode = "complete"
    h.reader.release.clear()
    h.frame()
    await h.s.tick()
    await asyncio.wait_for(h.reader.started.wait(), 3)
    h.clock.advance(6000)
    await h.s.tick()  # The stall episode can gate while the initial check is still running.
    for _ in range(100):
        if len(h.gate.calls) == 2:
            break
        await asyncio.sleep(0.01)
    assert len(h.gate.calls) == 2
    h.reader.release.set()
    await h.settle()
    assert len(h.reader.calls) == 1
    assert len(h.channel.values("note")) == 1
