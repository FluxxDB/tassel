"""One Pipecat worker per session, with explicit provider and language routing."""

import asyncio
import base64
import re
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from pipecat.frames.frames import (
    AggregatedTextFrame,
    CancelFrame,
    DataFrame,
    EndFrame,
    FunctionCallResultProperties,
    InterruptionFrame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMMessagesAppendFrame,
    LLMRunFrame,
    LLMTextFrame,
    LLMUpdateSettingsFrame,
    StartFrame,
    TTSTextFrame,
    UserStartedSpeakingFrame,
    VADUserStartedSpeakingFrame,
)
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tassel.beats.markup import BoardContext
from tassel.beats.processor import BeatTagProcessor
from tassel.models import Lang, SessionPatch
from tassel.storage import sessions_repo
from tassel.vision.turn_image import TurnPage
from tassel.voice.events import ServerEvents, VadForwarder
from tassel.voice.fakes.llm import FakeLLMService
from tassel.voice.fakes.scenario import load_scenario
from tassel.voice.memory import ConversationMemory
from tassel.voice.messages import (
    CLIENT_EVENTS,
    ENVELOPE,
    BackchannelEvent,
    ClientMetricsEvent,
    LanguageEvent,
    OfferRequestData,
    PaperFrameEvent,
    PushToTalkEvent,
    RouteEvent,
    SensitivityEvent,
    StageEvent,
    SttKind,
    is_note,
)
from tassel.voice.prompts import language_switch_note, system_prompt
from tassel.voice.providers import llm_tools_supported, make_llm, make_stt, make_tts, stt_kind
from tassel.voice.routes import VoiceRoute, route_for
from tassel.voice.settings import VoiceSettings, resolve_mode
from tassel.voice.thinker import ThinkerOutput, TutorCoordinator, make_thinker
from tassel.voice.tools import TOOLS
from tassel.voice.transcripts import DevTranscript
from tassel.voice.turns import PushToTalkFrame, TurnTuning, make_turn_strategies, make_vad

TurnImage = Callable[[UUID, datetime], Awaitable[TurnPage | None]]
"""The per-turn seam: the session's page for a turn that began at the given time (an image and
its caption, or no image and a note), or None for a session without paper."""

# The most a student turn waits for its page before Ada answers without one. The seam itself
# waits up to 1 s for the app's fresh frame; this also bounds a slow store or decode.
TURN_IMAGE_WAIT_S = 2.5


def _image_url(image: bytes) -> str:
    mime = "image/jpeg" if image.startswith(b"\xff\xd8") else "image/png"
    return f"data:{mime};base64," + base64.b64encode(image).decode()


@dataclass
class BotContext:
    learner_id: UUID
    session_id: UUID
    lang: Lang
    titled: bool
    request: OfferRequestData
    settings: VoiceSettings
    memory: ConversationMemory
    sessions: async_sessionmaker[AsyncSession]
    # The latest stored page of her paper for a student turn (vision-lite), or None without one.
    turn_image: TurnImage | None = None
    # Ada's board for this bot: her automata, mark numbers and the frozen page (P4, P5).
    board: BoardContext = field(default_factory=BoardContext)


@dataclass
class _LanguageChange(DataFrame):
    lang: Lang
    done: asyncio.Event = field(default_factory=asyncio.Event)


class _RoutedService(Pipeline):
    """Replace only the active service; never open inactive provider sockets.

    A language marker follows the normal data queue, so old text/audio drains
    first. Replacement gets its own setup/StartFrame; that private StartFrame
    never escapes into the session. Old services are disconnected and cleaned.
    """

    def __init__(self, factory, lang):
        self.factory, self.lang = factory, lang
        self.service = factory(lang)
        self._setup_data = None
        self._restart_id = None
        self._restarted = asyncio.Event()
        self._failed = False
        super().__init__([self.service])

    async def setup(self, setup):
        self._setup_data = setup
        await super().setup(setup)

    async def push_frame(self, frame, direction=FrameDirection.DOWNSTREAM):
        if frame.id == self._restart_id:
            self._restarted.set()
            return
        await super().push_frame(frame, direction)

    async def process_frame(self, frame, direction):
        if self._failed:
            # A failed replacement must still let cancellation reach the worker
            # sink, even when the old processor has already been cleaned up.
            if isinstance(frame, (CancelFrame, EndFrame)):
                await FrameProcessor.process_frame(self, frame, direction)
                await self.push_frame(frame, direction)
            return
        if (
            isinstance(frame, _LanguageChange)
            and direction == FrameDirection.DOWNSTREAM
            and frame.lang != self.lang
        ):
            try:
                async with asyncio.timeout(20):
                    old = self.service
                    await old.cancel(CancelFrame())
                    await old.cleanup()
                    self.service = self.factory(frame.lang)
                    self._processors[1] = self.service
                    self._link_processors()
                    await self.service.setup(self._setup_data)
                    start = StartFrame()
                    self._restart_id = start.id
                    self._restarted.clear()
                    await self.service.queue_frame(start)
                    await self._restarted.wait()
                self.lang = frame.lang
            except Exception:
                self._failed = True
                await self.push_error("Could not switch voice language", fatal=True)
                return
        await super().process_frame(frame, direction)


class _TurnContext(FrameProcessor):
    def __init__(self, session_id: UUID | None = None, turn_image: TurnImage | None = None):
        super().__init__()
        self.pending_image = None
        self.coordinator = None
        self._last_user = None
        self.on_language = None
        self._session_id = session_id
        self._turn_image = turn_image
        # When this turn began (her speech start), once the app has been asked for its frame.
        self._since: datetime | None = None
        # Sends the app the paper-frame request; the bot binds it to its server events.
        self.request_frame: Callable[[], Awaitable[None]] | None = None

    async def speech_started(self) -> None:
        """Her turn began: ask the app for her paper as it is now, once a turn."""
        if self._turn_image is None or self._since is not None:
            return
        self._since = datetime.now(UTC)
        await self._ask_for_frame()

    async def _ask_for_frame(self) -> None:
        if self.request_frame is None:
            return
        try:
            await self.request_frame()
        except Exception as error:  # noqa: BLE001 - a lost request leaves the turn a stand-in
            logger.info("Couldn't ask the app for a page frame: {}", type(error).__name__)

    async def _turn_page(self):
        """The page for the turn now reaching the model. No paper, a slow store or an error
        means no image, never a failed turn."""
        if self._turn_image is None or self._session_id is None:
            return None
        since = self._since
        self._since = None
        if since is None:  # A typed line: its turn begins now.
            since = datetime.now(UTC)
            await self._ask_for_frame()
        try:
            return await asyncio.wait_for(
                self._turn_image(self._session_id, since), TURN_IMAGE_WAIT_S
            )
        except Exception as error:  # noqa: BLE001 - any failure leaves the turn imageless
            logger.info("No page for this turn: {}", type(error).__name__)
            return None

    def add_turn_image(self, png_bytes: bytes, caption: str):
        # The vision producer owns flattening/numbering. Replace any unconsumed
        # frame, and attach only when a real user turn reaches the LLM.
        self.pending_image = (bytes(png_bytes), caption)

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, _LanguageChange):
            await self.on_language(frame.lang)
        elif isinstance(frame, LLMContextFrame):
            messages = frame.context.get_messages()
            user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
            if (
                user
                and user is not self._last_user
                and isinstance(user.get("content"), str)
                and not is_note(user["content"])
            ):
                self._last_user = user
                student_text = user["content"]
                ink_image = None
                note = None
                page = await self._turn_page()
                if page is not None and page.image is not None:
                    self.pending_image = (page.image, page.caption)
                    ink_image = page.ink_image or page.image
                    logger.info(
                        "Page image for this turn: session={} bytes={}",
                        self._session_id,
                        len(page.image),
                    )
                elif page is not None:
                    note = page.caption
                    logger.info("No current view of the paper: session={}", self._session_id)
                # Keep a single latest paper image in the live context as well.
                for message in messages:
                    if isinstance(message.get("content"), list):
                        message["content"] = [
                            b for b in message["content"] if b.get("type") != "image_url"
                        ]
                if self.pending_image:
                    png, caption = self.pending_image
                    ink_image = ink_image or png
                    user["content"] = [
                        {"type": "text", "text": user["content"]},
                        {"type": "text", "text": caption},
                        {
                            "type": "image_url",
                            "image_url": {"url": _image_url(png)},
                        },
                    ]
                    self.pending_image = None
                elif note is not None:
                    user["content"] = [
                        {"type": "text", "text": user["content"]},
                        {"type": "text", "text": note},
                    ]
                if self.coordinator:
                    await self.coordinator.prepare(frame.context, student_text, ink_image)
        await self.push_frame(frame, direction)


class _SpeechStarts(BaseObserver):
    """Tells the turn context when the student starts speaking, wherever the frame is pushed."""

    def __init__(self, turn_context: _TurnContext):
        super().__init__(observe_every_push=False)
        self.turn_context = turn_context

    async def on_push_frame(self, data: FramePushed):
        if data.first_push and isinstance(
            data.frame, (UserStartedSpeakingFrame, VADUserStartedSpeakingFrame)
        ):
            await self.turn_context.speech_started()


class _RouteMonitor(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.bot = None
        self.on_language = None
        self.last_provider = None
        self._history = deque()
        self._history_offset = 0

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, _LanguageChange):
            await self.on_language(frame.lang)
            frame.done.set()
            return
        if isinstance(frame, InterruptionFrame):
            self._history.clear()
            self._history_offset = 0
        elif isinstance(frame, AggregatedTextFrame) and not isinstance(frame, TTSTextFrame):
            if frame.raw_text:
                self._history.append(frame.raw_text)
        elif isinstance(frame, TTSTextFrame) and frame.raw_text and self._history:
            # Pipecat trims whitespace from raw slices, sometimes in the middle
            # of a tag. Recover each slice from the original sentence so the
            # assistant aggregator neither inserts nor loses spaces inside tags.
            raw = self._history[0]
            start = self._history_offset
            end = start
            count = sum(not c.isspace() for c in frame.raw_text)
            while end < len(raw) and count:
                count -= not raw[end].isspace()
                end += 1
            while end < len(raw) and raw[end].isspace():
                end += 1
            frame.raw_text = raw[start:end]
            frame.includes_inter_frame_spaces = True
            self._history_offset = end
            if end == len(raw):
                frame.raw_text += " "
                self._history.popleft()
                self._history_offset = 0
        if isinstance(frame, LLMFullResponseEndFrame):
            bot = self.bot
            if self.last_provider != bot.active_provider:
                await bot.send_route()
                self.last_provider = bot.active_provider
            if bot.last_completion:
                logger.info(
                    "Voice completion session={} lang={} details={}",
                    bot.session_id,
                    bot.route.lang,
                    bot.last_completion,
                )
        await self.push_frame(frame, direction)


@dataclass
class Bot:
    worker: PipelineWorker
    context: LLMContext
    tuning: TurnTuning
    events: ServerEvents
    route: VoiceRoute
    stt: SttKind
    session_id: UUID
    llm: FrameProcessor
    _stt: _RoutedService
    _tts: _RoutedService
    _turn_context: _TurnContext
    last_client_metrics: ClientMetricsEvent | None = None

    @property
    def active_provider(self):
        return getattr(self.llm, "active_provider", "fake")

    @property
    def last_completion(self):
        return getattr(self.llm, "last_completion", None)

    @property
    def stt_service(self):
        return self._stt.service

    @property
    def tts_service(self):
        return self._tts.service

    def add_turn_image(self, png_bytes: bytes, caption: str):
        self._turn_context.add_turn_image(png_bytes, caption)

    async def send_route(self):
        from tassel.voice.fakes.tts import FakeTTSService

        await self.events.send(
            RouteEvent(
                lang=self.route.lang,
                stt=self.stt,
                llm=self.active_provider,
                tts="fake" if isinstance(self.tts_service, FakeTTSService) else "elevenlabs",
            )
        )


def build_bot(input: FrameProcessor, output: FrameProcessor, ctx: BotContext) -> Bot:
    route = route_for(ctx.lang)
    scenario = load_scenario(ctx.settings.fake_scenario)
    if resolve_mode("llm", ctx.settings) == "fake" and ctx.request.scenario:
        try:
            scenario = load_scenario(ctx.request.scenario)
        except (ValueError, FileNotFoundError):
            logger.warning("Invalid fake scenario request; using configured scenario")
    tuning = TurnTuning(sensitivity=ctx.request.sensitivity, ptt=ctx.request.ptt)
    saved, previous_lang = ctx.memory.recall(ctx.session_id)
    # The live factory installs Ada's persona in the constructor, before tool
    # synchronization; duplicating it here would create competing instructions.
    tools_ok = llm_tools_supported(ctx.settings)
    context = LLMContext(saved, tools=TOOLS) if tools_ok else LLMContext(saved)
    llm = make_llm(route, ctx.settings, scenario)
    stt = _RoutedService(lambda lang: make_stt(route_for(lang), ctx.settings, scenario), ctx.lang)
    tts = _RoutedService(lambda lang: make_tts(route_for(lang), ctx.settings), ctx.lang)
    kind = stt_kind(route, ctx.settings)

    async def on_ignored(text):
        await bot.events.send(BackchannelEvent(text=text))

    user, assistant = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=make_vad(),
            user_turn_strategies=make_turn_strategies(kind, tuning, ctx.lang, on_ignored),
        ),
    )
    turn_context = _TurnContext(ctx.session_id, ctx.turn_image)
    monitor = _RouteMonitor()
    events = ServerEvents()
    # One board per bot, shared with the page-image seam, so [[freeze]] and paper marks resolve
    # against the exact page Ada saw.
    transcript = DevTranscript(
        ctx.session_id,
        ctx.settings.transcript_dir,
        secrets=[
            value.get_secret_value()
            for name, value in ctx.settings
            if name.endswith("api_key") and value
        ],
    )
    beats = BeatTagProcessor(
        events=events, lang=lambda: ctx.lang, board=ctx.board, transcript=transcript
    )
    thinker = make_thinker(ctx.settings)
    reasoning = []
    if thinker is not None:
        turn_context.coordinator = TutorCoordinator(
            thinker, ctx.board, transcript=transcript, lang=lambda: ctx.lang
        )
        reasoning = [ThinkerOutput(turn_context.coordinator)]
    worker = PipelineWorker(
        Pipeline(
            [
                input,
                stt,
                user,
                turn_context,
                llm,
                *reasoning,
                beats,
                tts,
                monitor,
                output,
                assistant,
            ]
        ),
        params=PipelineParams(
            enable_metrics=True, enable_usage_metrics=True, report_only_initial_ttfb=True
        ),
        idle_timeout_secs=1800,
    )
    events.worker = worker
    bot = Bot(
        worker,
        context,
        tuning,
        events,
        route,
        kind,
        ctx.session_id,
        llm,
        stt,
        tts,
        turn_context,
    )
    monitor.bot = bot

    async def request_frame():
        await events.send(PaperFrameEvent())

    turn_context.request_frame = request_frame
    worker.add_observer(transcript)
    worker.add_observer(VadForwarder(worker))
    worker.add_observer(_SpeechStarts(turn_context))
    language_lock = asyncio.Lock()

    async def apply_language(lang):
        # Pipecat 1.12 has no public aggregator setter; isolate its controller
        # access here. Its public update_strategies cleans/setup each strategy.
        await user._user_turn_controller.update_strategies(
            make_turn_strategies(stt_kind(route_for(lang), ctx.settings), tuning, lang, on_ignored)
        )
        if isinstance(llm, FakeLLMService):
            llm.set_language(lang)
        else:
            await llm.queue_frame(
                LLMUpdateSettingsFrame(
                    delta=llm.Settings(
                        system_instruction=system_prompt(
                            lang, tools=tools_ok, two_tier=ctx.settings.two_tier_enabled
                        )
                    )
                )
            )

    async def language_ready(lang):
        ctx.lang = lang
        bot.route, bot.stt = route_for(lang), stt_kind(route_for(lang), ctx.settings)
        await bot.events.send(LanguageEvent(lang=lang))
        await bot.send_route()
        monitor.last_provider = bot.active_provider

    turn_context.on_language = apply_language
    monitor.on_language = language_ready

    response_text = ""

    @llm.event_handler("on_before_push_frame")
    async def track_response_text(service, frame):
        # This synchronous push hook runs before tools, even when downstream TTS lags.
        nonlocal response_text
        if isinstance(frame, (LLMFullResponseStartFrame, InterruptionFrame)):
            response_text = ""
        elif isinstance(frame, LLMTextFrame):
            response_text += frame.text

    async def show_stage(params):
        event = StageEvent(view=params.arguments["view"])
        await bot.events.send(event)
        spoken = re.sub(r"\[\[.*?(?:\]\]|$)", "", response_text, flags=re.S).strip().rstrip("[")
        await params.result_callback(
            {"ok": True}, properties=FunctionCallResultProperties(run_llm=not bool(spoken.strip()))
        )

    async def set_language(params):
        # Validate tool arguments before database/provider mutation.
        lang = LanguageEvent(lang=params.arguments["language"]).lang
        async with language_lock:
            if lang != ctx.lang:
                async with ctx.sessions() as db:
                    row = await sessions_repo.patch_for(
                        db, ctx.learner_id, ctx.session_id, SessionPatch(language=lang)
                    )
                if row is None:
                    await params.result_callback(
                        {"ok": False}, properties=FunctionCallResultProperties(run_llm=False)
                    )
                    return
                change = _LanguageChange(lang=lang)
                await worker.queue_frame(change)
                async with asyncio.timeout(45):
                    await change.done.wait()
        await params.result_callback(
            {"ok": True}, properties=FunctionCallResultProperties(run_llm=False)
        )

    llm.register_function("show_stage", show_stage)
    llm.register_function("set_language", set_language, cancel_on_interruption=False)

    @worker.rtvi.event_handler("on_client_ready")
    async def ready(rtvi):
        await bot.send_route()
        monitor.last_provider = bot.active_provider
        if not saved:
            await worker.queue_frame(LLMRunFrame())
        elif previous_lang != ctx.lang:
            await worker.queue_frame(
                LLMMessagesAppendFrame(
                    [{"role": "user", "content": language_switch_note(ctx.lang)}], run_llm=True
                )
            )

    @worker.rtvi.event_handler("on_client_message")
    async def client_message(rtvi, msg):
        if msg.type != ENVELOPE:
            return
        try:
            event = CLIENT_EVENTS.validate_python(msg.data)
        except ValidationError:
            logger.warning("Dropped invalid Tassel client event")
            return
        if isinstance(event, PushToTalkEvent):
            tuning.ptt_held = event.held
            await worker.queue_frame(PushToTalkFrame(held=event.held))
        elif isinstance(event, SensitivityEvent):
            tuning.sensitivity = event.level
        elif isinstance(event, ClientMetricsEvent):
            bot.last_client_metrics = event  # Task 10 consumes this alongside last_completion.

    @worker.event_handler("on_pipeline_finished")
    async def finished(worker, frame):
        ctx.memory.remember(ctx.session_id, context.get_messages(), ctx.lang)

    return bot


async def run_bot(connection, ctx: BotContext) -> None:
    bot = None
    try:
        transport = SmallWebRTCTransport(
            webrtc_connection=connection,
            params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
        )
        bot = build_bot(transport.input(), transport.output(), ctx)

        @transport.event_handler("on_client_disconnected")
        async def disconnected(transport, client):
            await bot.worker.cancel(reason="client disconnected")

        runner = WorkerRunner(handle_sigint=False)
        await runner.add_workers(bot.worker)
        await runner.run()
    finally:
        if bot is not None:
            ctx.memory.remember(ctx.session_id, bot.context.get_messages(), ctx.lang)
        await connection.disconnect()
