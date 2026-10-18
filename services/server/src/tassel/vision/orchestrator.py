"""Per-session vision work, with monotonic timers and speech-safe delivery.

Inputs are synchronous; tick schedules owned tasks rather than waiting on providers. Every
result is tied to an input revision, so an old page/check cannot critique newer work.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from functools import partial
from typing import Literal, Protocol
from uuid import UUID

import anyio
from pydantic import BaseModel

from tassel.domains.dfa.contract import DfaReading, DfaVerdict, Pt
from tassel.domains.dfa.reference import Reference, catalog_match, resolve_reference
from tassel.domains.dfa.regex import RegexError, compile_regex
from tassel.domains.dfa.verify import verify
from tassel.models import Lang
from tassel.vision.deepcheck import CPU_LIMITER, DeepCheck, ProblemContext, prepare
from tassel.vision.gate import GATE_MIN_INTERVAL_MS
from tassel.vision.log import VisionLog
from tassel.vision.messages import (
    CheckDebug,
    GateDebug,
    PolicyDebug,
    ReadbackEvent,
    Rung,
    VisionDebugEvent,
)
from tassel.vision.notes import HOLDING_LINES, render_note
from tassel.vision.page import GATE_LONG_SIDE, decode_jpeg, encode_jpeg, flatten_page, resized
from tassel.vision.policy import (
    NOTE_TTL_MS,
    UNPROMPTED_CHECK_INTERVAL_MS,
    Etiquette,
    Moment,
    NotePlan,
    ProblemState,
    Signals,
    apply,
    may_speak,
    plan,
    plan_request,
    signals,
)
from tassel.vision.ports import (
    STALL_MS,
    DecisionGate,
    GateInput,
    GateReason,
    Predicate,
    TranscriptLine,
)
from tassel.vision.transcription import snap

FRESH_FRAME_WAIT_MS = 6000
MAX_RERUNS = 2
TICK_MS = 250
VISION_CPU_TOKENS = 2
TRANSCRIPT_MS = 120_000
_EMPTY_REPLY_MS = 1500
_PRIORITY = {"stall": 0, "speech": 1, "board": 2, "frame": 3}
_LOG = logging.getLogger(__name__)


class TutorChannel(Protocol):
    lang: Lang

    async def append_note(self, text: str) -> None: ...
    async def run_llm(self) -> None: ...
    async def say(self, text: str) -> None: ...
    async def send(self, event: BaseModel) -> None: ...


class StageEvent(BaseModel):
    """P2's wire shape, kept local until its voice contract is merged (Task 14)."""

    kind: Literal["stage"] = "stage"
    view: Literal["split"] = "split"


@dataclass(frozen=True)
class FrameIn:
    id: UUID
    reason: Literal["ink", "page"]
    received_ms: int
    full_jpeg: bytes = field(repr=False)
    crop_jpeg: bytes | None = field(repr=False)
    quad: list[Pt] | None
    changed_cells: int


class VisionSnapshot(BaseModel):
    reading: DfaReading | None = None
    verdict: DfaVerdict | None = None
    rung: Rung | None = None
    hints: int = 0
    frames_seen: int = 0
    last_gate: GateDebug | None = None
    last_decision: PolicyDebug | None = None
    pen_busy: bool = False
    pending_note: bool = False
    waiting_for_frame: bool = False


@dataclass
class _Pending:
    plan: NotePlan
    created_ms: int
    revision: int
    delivered: bool = False
    ran: bool = False
    rerun: bool = False
    reruns: int = 0


@dataclass(frozen=True)
class _Check:
    frame: FrameIn
    revision: int
    sig: Signals
    invited_at: int | None
    ink_epoch: int
    problem_epoch: int


def _gate_image(frame: FrameIn) -> bytes:
    return encode_jpeg(resized(flatten_page(frame.full_jpeg, frame.quad).rgb, GATE_LONG_SIDE))


def _board_image(image: bytes | None) -> bytes | None:
    return None if image is None else encode_jpeg(resized(decode_jpeg(image), GATE_LONG_SIDE))


def _catalog(regex: str, alphabet: list[str]) -> Reference | None:
    return catalog_match(compile_regex(regex, alphabet))


class VisionSession:
    def __init__(
        self,
        *,
        session_id: UUID,
        lang: Lang,
        gate: DecisionGate,
        deepcheck: DeepCheck,
        thresholds: Mapping[Predicate, float],
        title: Callable[[], Awaitable[str | None]],
        clock: Callable[[], float] = time.monotonic,
        log: VisionLog | None = None,
        etiquette: Etiquette = Etiquette(),
        stall_ms: int = STALL_MS,
        limiter: anyio.CapacityLimiter | None = None,
    ):
        self.session_id, self.lang = session_id, lang
        self.gate, self.deepcheck = gate, deepcheck
        self.thresholds, self.title, self.clock = thresholds, title, clock
        self.log, self.etiquette, self.stall_ms = log or VisionLog(None), etiquette, stall_ms
        self.limiter = limiter
        self.last_activity_ms = self.now
        self.problem = ProblemState("")
        self.reading: DfaReading | None = None
        self.verdict: DfaVerdict | None = None
        self._frame: FrameIn | None = None
        self._frames_seen = 0
        self._revision = 0
        self._ink_epoch = 0
        self._problem_epoch = 0
        self._speech_pending = False
        self._board: DfaReading | None = None
        self._board_jpeg: bytes | None = None
        self._board_ready = False
        self._transcript: list[TranscriptLine] = []
        self._early_lines: list[str] = []
        self._user_speaking = self._bot_speaking = self._reply = self._pen_busy = False
        self._reply_ended: int | None = None
        self._user_stopped: int | None = None
        self._pen_still: int | None = None
        self._speech_at: int | None = None
        self._bot_spoke: int | None = None
        self._last_unprompted: int | None = None
        self._last_check: int | None = None
        self._last_gate_at: int | None = None
        self._last_gate: GateDebug | None = None
        self._last_decision: PolicyDebug | None = None
        self._reason: GateReason | None = None
        self._stall_requested = False
        self._waiting = False
        self._pending: _Pending | None = None
        self._channel: TutorChannel | None = None
        self._shown: ReadbackEvent | None = None
        self._events: list[BaseModel] = []
        self._tasks: set[asyncio.Task] = set()
        self._gate_task: asyncio.Task | None = None
        self._check_task: asyncio.Task | None = None
        self._board_task: asyncio.Task | None = None
        self._check_request: _Check | None = None
        self._checking: _Check | None = None
        self._check_started: int | None = None
        self._holding_sent = False
        self._cache: tuple[UUID, DfaReading | None, DfaVerdict | None] | None = None
        self._references: dict[tuple, Reference | None] = {}
        self._closed = False
        self._tick_lock = asyncio.Lock()

    @property
    def now(self) -> int:
        return round(self.clock() * 1000)

    def _touch(self):
        self.last_activity_ms = self.now

    async def _cpu(self, fn, *args, **kwargs):
        if self.limiter is None:
            self.limiter = anyio.CapacityLimiter(VISION_CPU_TOKENS)
        return await anyio.to_thread.run_sync(
            partial(fn, *args, **kwargs),
            limiter=self.limiter,
            abandon_on_cancel=True,
        )

    def _spawn(self, work):
        task = asyncio.create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def _request_gate(self, reason: GateReason):
        if self._reason is None or _PRIORITY[reason] > _PRIORITY[self._reason]:
            self._reason = reason

    def _debug(self, debug, **record):
        if isinstance(debug, GateDebug):
            self._last_gate = debug
        elif isinstance(debug, PolicyDebug):
            self._last_decision = debug
        self.log.write(self.session_id, debug.model_dump(mode="json") | record)
        if self._channel is not None:
            self._events.append(VisionDebugEvent(debug=debug))

    def _decision(self, action, why, rung=None):
        debug = PolicyDebug(action=action, why=why, rung=rung)
        if debug != self._last_decision:
            self._debug(debug)

    def _reset_problem(self):
        self._problem_epoch += 1
        self.problem = ProblemState("")
        self.reading = self.verdict = self._pending = self._cache = None
        self._references.clear()
        self._early_lines.clear()
        self._last_check = None
        self._shown = ReadbackEvent(reading=None, verdict=None)
        self._events.clear()
        if self._channel is not None:
            self._events.append(self._shown)

    def on_frame(self, f: FrameIn) -> None:
        if self._closed:
            return
        self._touch()
        self._revision += 1
        self._ink_epoch += 1
        self._frame, self._board = f, None
        self._board_ready = False
        self._frames_seen += 1
        self._stall_requested = False
        self._pending = None
        if f.reason == "page":
            self._reset_problem()
            self._check_request = None
        elif self._checking is not None and self._checking.problem_epoch == self._problem_epoch:
            # Coalesce an in-flight check to the newest pixels, retaining its invitation.
            c = self._checking
            self._check_request = _Check(
                f, self._revision, c.sig, c.invited_at, self._ink_epoch, self._problem_epoch
            )
        self._request_gate("frame")

    def on_board_edit(self, reading: DfaReading, image: bytes | None) -> None:
        if self._closed:
            return
        self._touch()
        self._revision += 1
        self._pending = self._check_request = None
        self._board = reading.model_copy(deep=True, update={"source": "board"})
        self._board_ready = False
        self._board_task = self._spawn(self._verify_board(self._board, image, self._revision))
        self._request_gate("board")

    def _recent(self):
        self._transcript = [
            line for line in self._transcript if self.now - line.at_ms <= TRANSCRIPT_MS
        ]
        return tuple(self._transcript)

    def on_user_text(self, text: str, *, typed: bool) -> None:
        self._touch()
        self._transcript.append(TranscriptLine("student", text, self.now))
        self._recent()
        if len(text.split()) >= 3 and len(self._early_lines) < 3:
            self._early_lines.append(text)
        if typed:
            self._user_stopped = self.now
        self._speech_at = self.now
        self._speech_pending = True
        self._stall_requested = False
        if self._frame is not None or self._board is not None:
            self._request_gate("speech")

    def on_tutor_text(self, text: str) -> None:
        self._touch()
        self._transcript.append(TranscriptLine("tutor", text, self.now))
        self._recent()
        self._bot_spoke = self.now

    def on_user_speaking(self, speaking: bool, *, stopped_ms_ago: int = 0) -> None:
        self._touch()
        self._user_speaking = speaking
        self._stall_requested = False
        if not speaking:
            self._user_stopped = self.now - max(0, stopped_ms_ago)

    def on_bot(
        self, *, speaking: bool | None = None, reply: Literal["started", "ended"] | None = None
    ) -> None:
        self._touch()
        if reply == "started":
            self._reply, self._reply_ended = True, None
        elif reply == "ended" and self._reply:
            self._reply_ended = self.now
        if speaking is not None:
            self._bot_speaking = speaking
            if speaking:
                self._bot_spoke = self.now
                if self._pending is not None and self._pending.ran:
                    p = self._pending.plan
                    self.problem = apply(self.problem, p)
                    if p.unprompted:
                        self._last_unprompted = self.now
                    self._pending = None
            else:
                self._reply, self._reply_ended = False, None

    def on_interruption(self) -> None:
        self._touch()
        self._reply = self._bot_speaking = False
        self._reply_ended = None
        if self._pending is not None and self._pending.delivered:
            self._pending.rerun = True

    def on_pen(self, busy: bool) -> None:
        self._touch()
        self._pen_busy = busy
        if busy:
            self._ink_epoch += 1
            self._stall_requested = False
            if self._pending is not None and self._pending.plan.unprompted:
                self._pending = None
                self._decision("drop", "new ink")
        else:
            self._pen_still = self.now

    def attach(self, channel: TutorChannel) -> None:
        self._touch()
        self._channel = channel
        self._events.clear()
        if self._shown is not None:
            self._events.append(self._shown)

    def detach(self) -> None:
        self._channel = None
        self._events.clear()

    def _moment(self):
        if (
            self._reply_ended is not None
            and not self._bot_speaking
            and self.now - self._reply_ended >= _EMPTY_REPLY_MS
        ):
            self._reply = False
        return Moment(
            self.now,
            self._user_speaking,
            self._user_stopped,
            self._bot_speaking or self._reply,
            self._pen_busy,
            self._pen_still,
            self._last_unprompted,
        )

    def _fresh(self):
        return self._frame is not None and (
            self._pen_still is None or self._frame.received_ms > self._pen_still
        )

    def _quiet(self):
        start = self._pen_still
        if start is None and self._frame is not None:
            start = self._frame.received_ms
        return 0 if self._pen_busy else (None if start is None else max(0, self.now - start))

    def _silence(self):
        return (
            0
            if self._user_speaking
            else (
                self.stall_ms
                if self._user_stopped is None
                else max(0, self.now - self._user_stopped)
            )
        )

    async def tick(self) -> None:
        async with self._tick_lock:
            if self._closed:
                return
            if (
                self._frame is not None
                and not self._stall_requested
                and (self._quiet() or 0) >= self.stall_ms
                and self._silence() >= self.stall_ms
            ):
                self._stall_requested = True
                self._request_gate("stall")
            self._schedule_gate()
            self._schedule_check()
            await self._flush()
            await self._holding()
            await self._deliver()
            if self._pending is not None and self.now - self._pending.created_ms >= NOTE_TTL_MS:
                self._pending = None
                self._decision("drop", "note expired")
            await self._flush()

    def _schedule_gate(self):
        reason = self._reason
        if reason is None or (self._frame is None and self._board is None):
            return
        if self._board is not None and not self._board_ready:
            return
        wait = (
            self._speech_pending
            and self._board is None
            and not self._fresh()
            and self._speech_at is not None
            and self.now - self._speech_at < FRESH_FRAME_WAIT_MS
        )
        self._waiting = wait
        if wait:
            self._decision("hold", "waiting for a fresh frame")
            return
        if self._gate_task is not None and not self._gate_task.done():
            return
        if self._last_gate_at is not None and self.now - self._last_gate_at < GATE_MIN_INTERVAL_MS:
            return
        self._reason = None
        self._speech_pending = False
        self._gate_task = self._spawn(
            self._evaluate(reason, self._revision, self._frame, self._ink_epoch)
        )

    async def _evaluate(self, reason, revision, frame, ink_epoch):
        try:
            board = self._board is not None
            image = self._board_jpeg if board else await self._cpu(_gate_image, frame)
            gi = GateInput(
                image,
                self._recent(),
                self.lang,
                reason,
                self._quiet(),
                self._silence(),
                not board and (self._cache is None or self._cache[0] != frame.id),
                0 if board else frame.changed_cells,
            )
            self._last_gate_at = self.now
            result = await self.gate.evaluate(gi)
            if revision != self._revision:
                return
            self._debug(
                GateDebug(
                    reason=reason, probs=result.probs, ms=result.ms, provider=result.provider
                ),
                frame_id=None if board else str(frame.id),
                quiet_ms=gi.quiet_ms,
                silence_ms=gi.silence_ms,
                new_ink=gi.new_ink,
                changed_cells=gi.changed_cells,
                transcript=[[x.speaker, x.text, x.at_ms] for x in gi.transcript],
                refused=list(result.refused),
            )
            sig = signals(result.probs, result.refused, self.thresholds)
            if sig.not_schoolwork:
                self._check_request = None
                return
            if not sig.complete and ink_epoch != self._ink_epoch:
                return
            if self._speech_pending and self._board is None and not self._fresh():
                return
            if board:
                self._set_plan(plan(self.verdict, self.reading, sig, self.problem))
            elif sig.complete or sig.worth_checking or sig.stuck:
                if self._cache is not None and self._cache[0] == frame.id:
                    self.reading, self.verdict = self._cache[1:]
                    self._set_plan(plan(self.verdict, self.reading, sig, self.problem))
                else:
                    self._check_request = _Check(
                        frame, revision, sig, self._speech_at, ink_epoch, self._problem_epoch
                    )
                    self._schedule_check()
        except Exception:
            _LOG.warning("Vision gate failed for session %s", self.session_id)
            if revision == self._revision:
                self._debug(CheckDebug(status="failed", witness=None, blame=None, ms=0))

    def _schedule_check(self):
        c = self._check_request
        if c is None or (self._check_task is not None and not self._check_task.done()):
            return
        if c.revision != self._revision:
            self._check_request = None
            return
        if self._cache is not None and self._cache[0] == c.frame.id:
            # A second gate may have requested this frame while its first check was running.
            # Reuse that result, retaining the newer invitation, instead of transcribing twice.
            self._check_request = None
            if c.sig.complete or c.ink_epoch == self._ink_epoch:
                self._set_plan(plan(self.verdict, self.reading, c.sig, self.problem))
            return
        if (
            not c.sig.complete
            and self._last_check is not None
            and self.now - self._last_check < UNPROMPTED_CHECK_INTERVAL_MS
        ):
            return
        self._check_request = None
        self._last_check = self._check_started = self.now
        self._checking, self._holding_sent = c, False
        self._check_task = self._spawn(self._check(c))

    async def _reference(self, reading: DfaReading):
        regex = reading.language.regex if reading.language else None
        key = (" ".join((reading.problem or "").casefold().split()), regex, tuple(reading.alphabet))
        if key in self._references:
            return self._references[key]
        reference = None
        if regex is not None:
            try:
                reference = await self._cpu(_catalog, regex, reading.alphabet)
                if reference is None:
                    predicate = await self.deepcheck.membership(
                        reading.problem or "", reading.alphabet
                    )
                    reference = await self._cpu(
                        resolve_reference,
                        regex=regex,
                        alphabet=reading.alphabet,
                        predicate=predicate,
                        title=reading.problem,
                    )
            except RegexError:
                pass
        self._references[key] = reference
        return reference

    def _publish(self, reading, verdict):
        key = " ".join((reading.problem or "").casefold().split()) if reading else ""
        if key and self.problem.key and key != self.problem.key:
            self._reset_problem()
        if key:
            self.problem.key = key
        self.reading, self.verdict = reading, verdict

    def _checked(self, status, verdict, started):
        ce = verdict.counterexample if verdict else None
        blame = None
        if ce and ce.blame:
            b = ce.blame
            blame = f"{b.state} -{b.symbol}-> {b.target}" if b.kind == "transition" else b.state
        self._debug(
            CheckDebug(
                status=status,
                witness=ce.input if ce else None,
                blame=blame,
                ms=max(0, self.now - started),
            )
        )

    async def _check(self, c: _Check):
        started = self.now
        reading = verdict = None
        status = "failed"
        try:
            prepared = await self._cpu(prepare, c.frame.full_jpeg, c.frame.quad, c.frame.crop_jpeg)
            ctx = ProblemContext(
                await self.title(), tuple(self._early_lines), self._recent(), self.lang
            )
            # The optional local fixture reader inherits this task's budget; network adapters
            # keep the same port and do no CPU-heavy work here.
            token = CPU_LIMITER.set(self.limiter)
            try:
                result = await self.deepcheck.transcribe(prepared, ctx)
            finally:
                CPU_LIMITER.reset(token)
            status = result.status
            if status == "ok":
                if result.reading is not None:
                    reading = result.reading.model_copy(
                        deep=True, update={"frame_id": str(c.frame.id)}
                    )
                elif result.transcription is not None:
                    reading = await self._cpu(
                        snap,
                        result.transcription,
                        prepared.page,
                        prepared.candidates,
                        frame_id=str(c.frame.id),
                    )
                if reading is not None:
                    reference = await self._reference(reading)
                    verdict = await self._cpu(verify, reading, reference)
                    status = verdict.status
                else:
                    status = "failed"
        except Exception:
            _LOG.warning("Vision check failed for session %s", self.session_id)
            status = "failed"
        finally:
            self._checking = None
        if c.revision == self._revision and not self._closed:
            self._publish(reading, verdict)
            self._cache = (c.frame.id, reading, verdict)
            self._checked(status, verdict, started)
            p = plan(verdict, reading, c.sig, self.problem)
            if p is not None and (not p.unprompted or c.ink_epoch == self._ink_epoch):
                self._set_plan(p)
        # This task is still running, so release its slot before starting a coalesced check.
        self._check_task = None
        self._schedule_check()

    async def _verify_board(self, reading, image, revision):
        started = self.now
        try:
            jpeg = await self._cpu(_board_image, image)
            reference = await self._reference(reading)
            verdict = await self._cpu(verify, reading, reference)
            if revision == self._revision:
                self._board_jpeg, self._board_ready = jpeg, True
                self._publish(reading, verdict)
                self._checked(verdict.status, verdict, started)
        except Exception:
            _LOG.warning("Vision board check failed for session %s", self.session_id)
            if revision == self._revision:
                self._debug(CheckDebug(status="failed", witness=None, blame=None, ms=0))

    def _set_plan(self, p):
        if p is not None:
            if (
                self._pending is not None
                and self._pending.revision == self._revision
                and self._pending.plan == p
            ):
                return
            self._pending = _Pending(p, self.now, self._revision)

    async def _flush(self):
        while self._events and self._channel is not None:
            event = self._events.pop(0)
            await self._channel.send(event)

    async def _holding(self):
        c, channel = self._checking, self._channel
        if (
            c is None
            or not c.sig.complete
            or c.revision != self._revision
            or channel is None
            or self._holding_sent
            or self._check_started is None
            or self.now - self._check_started < self.etiquette.holding_after_ms
        ):
            return
        invited_at = c.invited_at if c.invited_at is not None else self._check_started
        if self._bot_spoke is not None and self._bot_spoke >= invited_at:
            return
        if may_speak(self._moment(), self.etiquette, unprompted=False)[0]:
            self._holding_sent = True
            self._decision("holding-line", "check in progress")
            await channel.say(HOLDING_LINES[self.lang])

    async def _deliver(self):
        pending, channel = self._pending, self._channel
        if pending is None or channel is None:
            return
        p = pending.plan

        def still_open():
            # Every channel await is a suspension point where page, pen, VAD or attachment
            # can change. Never continue an old delivery across that change.
            if (
                self._closed
                or pending is not self._pending
                or channel is not self._channel
                or pending.revision != self._revision
                or self.now - pending.created_ms >= NOTE_TTL_MS
            ):
                return False
            allowed, why = may_speak(self._moment(), self.etiquette, unprompted=p.unprompted)
            if not allowed:
                self._decision("hold", why, p.rung)
            return allowed

        if not still_open():
            return
        if not pending.delivered:
            if (
                p.split_stage
                and p.reading is not None
                and p.reading.states
                and p.reading.source != "board"
            ):
                readback = ReadbackEvent(reading=p.reading, verdict=p.verdict)
                if readback != self._shown:
                    self._shown = readback
                    await channel.send(readback)
                    if not still_open():
                        return
                await channel.send(StageEvent())
                if not still_open():
                    return
            # Mark the append before awaiting it: an interruption during append must retain
            # the same context note and may only rerun, never append a second copy.
            pending.delivered = True
            await channel.append_note(render_note(p))
            if not still_open():
                return
        if pending.ran:
            if not pending.rerun or pending.reruns >= MAX_RERUNS:
                return
            pending.reruns += 1
        pending.rerun = False
        pending.ran = True
        self._decision("speak", "ok", p.rung)
        await channel.run_llm()

    async def explain(self, level: Literal["walkthrough", "solution"]) -> dict:
        self._touch()
        p = plan_request(level, self.verdict, self.reading, self.problem)
        if p is None:
            return {
                "ok": False,
                "reason": "nothing to show"
                if self.verdict is None or level == "walkthrough"
                else "no trusted reference",
            }
        self._set_plan(p)
        return {"ok": True}

    def snapshot(self) -> VisionSnapshot:
        return VisionSnapshot(
            reading=self.reading,
            verdict=self.verdict,
            rung=self.problem.rung,
            hints=self.problem.hints,
            frames_seen=self._frames_seen,
            last_gate=self._last_gate,
            last_decision=self._last_decision,
            pen_busy=self._pen_busy,
            pending_note=self._pending is not None,
            waiting_for_frame=self._waiting,
        )

    async def idle(self) -> None:
        while self._tasks:
            await asyncio.gather(*tuple(self._tasks))

    async def close(self) -> None:
        self._closed = True
        self.detach()
        tasks = tuple(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._frame = self._board = self._pending = self._check_request = None
