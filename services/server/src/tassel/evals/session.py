"""One eval scenario on the real voice pipeline, in process, as tests/voice/test_bot_pipeline.py
drives it: ``build_bot`` with a recorder for output, typed student turns through RTVI
"send-text" (no STT), fake TTS, and the configured director, talker, thinker, Illustrator and
Pointer. Its page fixtures go through the turn-image seam, and it plays the app's part for
stage state: what the app shows, the student's pins, the frozen page and the page revision.
"""

import asyncio
import copy
import json
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from loguru import logger
from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    InputTransportMessageFrame,
    LLMFullResponseEndFrame,
    TTSAudioRawFrame,
    TTSStoppedFrame,
    TTSTextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.workers.runner import WorkerRunner

from tassel.beats.markup import BoardContext, MarkupStream
from tassel.beats.models import BEAT_ACTION
from tassel.evals.checks import Observation
from tassel.evals.fixtures import page_view, render, turn_page
from tassel.evals.scenario import Scenario, Turn
from tassel.voice.bot import BotContext, build_bot
from tassel.voice.memory import ConversationMemory
from tassel.voice.messages import OfferRequestData
from tassel.voice.settings import VoiceSettings

# A session resumes after a greeting, so no turn pays for one.
GREETED = [
    {"role": "user", "content": "Hi Ada."},
    {"role": "assistant", "content": "Hi! What are we working on today?"},
]


class _Passthrough(FrameProcessor):
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)


class _Recorder(FrameProcessor):
    """The app's end of the pipeline: every frame, and the server events among them."""

    def __init__(self):
        super().__init__()
        self.frames = []
        self.last_at = time.monotonic()

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        self.frames.append(frame)
        self.last_at = time.monotonic()
        await self.push_frame(frame, direction)
        if isinstance(frame, TTSStoppedFrame):
            await self.push_frame(BotStoppedSpeakingFrame(), FrameDirection.UPSTREAM)

    def events(self, start=0):
        return [
            f.message["data"]["tassel"]
            for f in self.frames[start:]
            if isinstance(getattr(f, "message", None), dict)
            and f.message.get("type") == "server-message"
            and "tassel" in f.message.get("data", {})
        ]


class _NoMemory:
    """No learner memory: the eval's learner is new, and no database is needed."""

    async def get(self, *args, **kwargs):
        return None


@asynccontextmanager
async def _no_db():
    yield _NoMemory()


class _FixtureChat:
    """The bot's chat store for the eval: a turn's images are page fixtures, prepared as an
    upload is, and saved lines stay in memory."""

    def __init__(self):
        self.saved = []

    async def load_attachments(self, learner_id, session_id, ids):
        from tassel.chat.images import prepare
        from tassel.chat.store import LoadedAttachment

        out = []
        for name in ids:
            image = await asyncio.to_thread(prepare, render(name).jpeg)
            out.append(LoadedAttachment(name, image.data, image.mime, image.width, image.height))
        return out

    async def last_seq(self, session_id):
        return 0

    async def save(self, session_id, seq, line):
        self.saved.append((seq, line))


def with_effort(create, effort):
    """A chat-completions ``create`` that asks for this reasoning effort instead."""

    async def patched(**request):
        request = copy.deepcopy(request)
        if "reasoning_effort" in request:
            request["reasoning_effort"] = effort
        extra = request.get("extra_body")
        if isinstance(extra, dict) and "reasoning" in extra:
            extra["reasoning"] = {"enabled": False} if effort == "none" else {"effort": effort}
        return await create(**request)

    return patched


def install_pointer_effort(coordinator, effort: str) -> bool:
    """Give the coordinator its Pointer now, asking for `effort` (the app's asks for none)."""
    from tassel.voice.pointer import Pointer

    thinker = coordinator.thinker
    settings = getattr(thinker, "settings", None)
    if settings is None:
        return False
    pointer = Pointer(settings, log=coordinator.log)
    pointer.client.on_usage = thinker.on_usage
    completions = pointer.client.client.chat.completions
    completions.create = with_effort(completions.create, effort)
    coordinator.pointer = pointer
    return True


def turn_decision(log: list[dict]) -> dict | None:
    """The decision the turn ran on: the ladder's escalation when there was one (the director's
    own decision is what the ladder overrode), else the director's."""
    for name in ("escalate", "director"):
        found = next((e.get("decision") for e in log if e["event"] == name), None)
        if found is not None:
            return found
    return None


def seed_actions(scenario: Scenario):
    actions = []
    if scenario.seed_tags:
        stream = MarkupStream(BoardContext())
        sentences = stream.feed(" ".join(scenario.seed_tags)) + stream.flush()
        problems = [p for s in sentences for p in s.problems]
        if problems:
            raise ValueError(f"{scenario.name}: seed tags refused: {problems}")
        actions += [action for s in sentences for _, action in s.anchors]
    actions += [BEAT_ACTION.validate_python(a) for a in scenario.seed_actions]
    return actions


class PipelineSession:
    def __init__(
        self,
        scenario: Scenario,
        settings: VoiceSettings,
        *,
        pointer_effort: str | None = None,
        quiet_s: float = 1.0,
        turn_timeout_s: float = 90.0,
        start_timeout_s: float = 20.0,
    ):
        self.scenario, self.settings = scenario, settings
        self.pointer_effort = pointer_effort
        self.quiet_s, self.turn_timeout_s, self.start_timeout_s = (
            quiet_s,
            turn_timeout_s,
            start_timeout_s,
        )
        self.out = _Recorder()
        self.page: str | None = None
        self.served: dict[str, dict] | None = None
        self.last_elements: dict[str, dict] = {}
        initial = scenario.stage
        self.app = {
            "view": initial.view if initial else ("paper" if scenario.has_pages else "board"),
            "pinned": initial.pinned if initial else None,
            "frozen": initial.frozen if initial else False,
            "page_revision": 0,
        }
        self._log_offset = 0

    async def __aenter__(self):
        scenario = self.scenario
        session_id = uuid4()
        memory = ConversationMemory()
        memory.remember(session_id, copy.deepcopy(GREETED), scenario.lang)
        self.board = BoardContext()
        self.ctx = BotContext(
            learner_id=uuid4(),
            session_id=session_id,
            lang=scenario.lang,
            titled=True,
            request=OfferRequestData(scenario=scenario.fake_script),
            settings=self.settings,
            memory=memory,
            sessions=_no_db,
            turn_image=self._turn_image if scenario.has_pages else None,
            board=self.board,
            board_actions=seed_actions(scenario),
            chat=_FixtureChat(),
        )
        self.bot = build_bot(_Passthrough(), self.out, self.ctx)
        self.coordinator = self.bot._turn_context.coordinator
        runner = WorkerRunner(handle_sigint=False)
        await runner.add_workers(self.bot.worker)
        self._task = asyncio.create_task(runner.run())
        try:
            await self._message("client-ready", {"version": "2.1.0"})
            await self._until(
                lambda: any(e["kind"] == "route" for e in self.out.events()),
                self.start_timeout_s,
            )
            if self.pointer_effort:
                install_pointer_effort(self.coordinator, self.pointer_effort)
            await self._send_state()
            self._read_log()  # The restore and setup belong to no turn.
        except BaseException:
            await self.__aexit__(None, None, None)
            raise
        return self

    async def __aexit__(self, *exc):
        bot = getattr(self, "bot", None)
        if bot is None:
            return
        try:
            await bot.worker.cancel()
            await asyncio.wait_for(self._task, 15)
        finally:
            if getattr(bot, "log_sink", None) is not None:
                logger.remove(bot.log_sink)
                bot.log_sink = None
            bot.transcript.record_cost()

    async def _message(self, kind, data):
        await self.bot.worker.queue_frame(
            InputTransportMessageFrame(
                message={"label": "rtvi-ai", "type": kind, "id": str(uuid4()), "data": data}
            )
        )

    async def _until(self, predicate, timeout):
        async with asyncio.timeout(timeout):
            while not predicate():
                await asyncio.sleep(0.02)

    async def _send_state(self):
        """The app's stage-state message, as the session screen sends it."""
        await self._message(
            "client-message", {"t": "tassel", "d": {"kind": "stage-state", **self.app}}
        )
        await asyncio.sleep(0.05)

    async def _turn_image(self, session_id, since):
        """The turn-image seam: the fixture on the desk, through the stored-frame page view."""
        if self.page is None:
            return None
        page = render(self.page)
        # Page finding and marks run off the loop; the board is set on it.
        await asyncio.to_thread(page_view, self.page)
        turn, elements = turn_page(page, self.board)
        self.served = self.last_elements = elements
        return turn

    def _read_log(self) -> list[dict]:
        path = self.bot.transcript.path
        if path is None or not path.exists():
            return []
        with path.open("rb") as stream:
            stream.seek(self._log_offset)
            data = stream.read()
        # Keep a half-written last line for the next read.
        end = data.rfind(b"\n") + 1
        self._log_offset += end
        events = []
        for line in data[:end].decode("utf-8").splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return events

    def _board(self) -> dict:
        return {
            "automata": {
                k: v.model_dump(mode="json", by_alias=True) for k, v in self.board.specs.items()
            },
            "diagrams": {
                k: v.model_dump(mode="json", by_alias=True) for k, v in self.board.diagrams.items()
            },
        }

    def _busy(self) -> bool:
        coordinator = self.coordinator
        if coordinator is None:
            return False
        drawing = coordinator.illustrator_task
        return coordinator.pending() or (drawing is not None and not drawing.done())

    async def _settle(self, start: int) -> bool:
        """Wait until her reply has ended, the thinker and Illustrator are done and the output has
        been quiet for a moment. False when the turn ran out of time."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.turn_timeout_s
        while loop.time() < deadline:
            await asyncio.sleep(0.05)
            ended = any(isinstance(f, LLMFullResponseEndFrame) for f in self.out.frames[start:])
            quiet = time.monotonic() - self.out.last_at >= self.quiet_s
            if ended and quiet and not self._busy():
                return True
        return False

    def usage(self) -> dict:
        return self.bot.transcript.meter.summary()

    async def turn(self, turn: Turn, index: int) -> Observation:
        page = self.scenario.page_at(index)
        dirty = False
        if page != self.page:
            self.page = page
            self.app["page_revision"] += 1
            self.app["frozen"] = False
            dirty = True
        if turn.stage is not None:
            self.app.update(turn.stage.model_dump())
            dirty = True
        if dirty:
            await self._send_state()
        before = self._board()
        frames = len(self.out.frames)
        self.served = None
        started = time.monotonic()
        if turn.images or not turn.voice:
            # The chat's composer: a student-message with her images, or her voice off.
            await self._message(
                "client-message",
                {
                    "t": "tassel",
                    "d": {
                        "kind": "student-message",
                        "client_id": f"eval-{index + 1}",
                        "text": turn.student,
                        "attachment_ids": list(turn.images),
                        "voice": turn.voice,
                    },
                },
            )
        else:
            await self._message(
                "send-text",
                {
                    "content": turn.student,
                    "options": {"run_immediately": True, "audio_response": True},
                },
            )
        finished = await self._settle(frames)
        wall_ms = (time.monotonic() - started) * 1000
        events = self.out.events(frames)
        log = self._read_log()
        stage = [
            {"view": e["view"], "pinned": bool(e.get("pinned"))}
            for e in events
            if e["kind"] == "stage"
        ]
        actions = [m["action"] for e in events if e["kind"] == "beat" for m in e["beat"]["markers"]]
        actions += [a for e in events if e["kind"] == "actions" for a in e["actions"]]
        await self._follow(stage, actions)

        def first(name, key="ms"):
            return next((e.get(key) for e in log if e["event"] == name), None)

        def total(name):
            values = [e["ms"] for e in log if e["event"] == name and "ms" in e]
            return sum(values) if values else None

        chat = [e for e in events if e["kind"] == "message"]
        spoken = " ".join(
            f.text for f in self.out.frames[frames:] if isinstance(f, TTSTextFrame)
        ).strip()
        audio = any(isinstance(f, TTSAudioRawFrame) for f in self.out.frames[frames:])
        if not spoken:
            # A text-only reply says nothing aloud: what she wrote is in the chat.
            spoken = " ".join(
                m["text"] for m in chat if m["role"] == "tutor" and m["final"]
            ).strip()
        return Observation(
            student=turn.student,
            spoken=spoken,
            chat=chat,
            audio=audio,
            stage=stage,
            actions=actions,
            tags=[e["text"] for e in log if e["event"] == "tags"],
            rejects=[
                {k: v for k, v in e.items() if k not in ("event", "at")}
                for e in log
                if e["event"] in ("reject", "director_fallback", "draw_fallback")
            ]
            + [{"warning": e.get("text")} for e in log if e["event"] == "server_warning"],
            decision=turn_decision(log),
            view_request=first("view_request", "view"),
            board_before=before,
            board_after=self._board(),
            page=self.page,
            elements=self.served if self.served is not None else dict(self.last_elements),
            timings={
                "director": first("director"),
                "thinker": total("thinker_duration"),
                "illustrator": total("illustrator_duration"),
                "pointer": total("pointer_duration"),
                "first_token": first("first_token"),
                "first_audio": first("first_audio"),
                "turn": round(wall_ms - (self.quiet_s * 1000 if finished else 0)),
            },
            finished=finished,
        )

    async def _follow(self, stage, actions):
        """What the app does with her stage events: a pinned request pins its view; Ada's own
        requests change the view unless the student pinned one. Freeze and live set frozen."""
        state = dict(self.app)
        for event in stage:
            if event["pinned"]:
                self.app["view"] = self.app["pinned"] = event["view"]
            elif self.app["pinned"] is None:
                self.app["view"] = event["view"]
        for action in actions:
            if action.get("kind") == "paper.freeze":
                self.app["frozen"] = True
            elif action.get("kind") == "paper.live":
                self.app["frozen"] = False
        if self.app != state:
            await self._send_state()
