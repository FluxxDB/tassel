"""Process-local ownership and lifecycle of one voice bot per learner."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID
from weakref import WeakValueDictionary

from fastapi import HTTPException
from loguru import logger
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    IceCandidate,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tassel.beats.markup import BoardContext
from tassel.board.snapshots import BoardSnapshots
from tassel.screen.session import ScreenSessions
from tassel.storage.tables import TutoringSession
from tassel.voice.api import IcePatch, OfferAnswer, OfferBody
from tassel.voice.bot import BotContext, TurnImage, run_bot
from tassel.voice.memory import ConversationMemory
from tassel.voice.messages import OfferRequestData
from tassel.voice.providers import require_session_providers
from tassel.voice.settings import VoiceSettings

STOP_TIMEOUT_S = 5


class VoiceConflict(Exception):
    """The caller must create a fresh offer after its previous bot has ended."""


@dataclass
class LiveBot:
    session_id: UUID
    pc_ids: set[str]
    task: asyncio.Task
    connection: SmallWebRTCConnection
    handler: SmallWebRTCRequestHandler


class VoiceRegistry:
    def __init__(
        self,
        *,
        settings: VoiceSettings,
        sessions: async_sessionmaker[AsyncSession],
        memory: ConversationMemory | None = None,
        start_bot: Callable[[SmallWebRTCConnection, BotContext], Awaitable[None]] = run_bot,
        turn_images: Callable[[BoardContext], TurnImage] | None = None,
        board_snapshots: BoardSnapshots | None = None,
        chat=None,
        screens: ScreenSessions | None = None,
    ):
        self.settings, self.sessions = settings, sessions
        self.screens = screens or ScreenSessions()
        # Makes each bot its page-image seam (vision-lite) on that bot's board context.
        self.turn_images = turn_images
        self.board_snapshots = board_snapshots
        # Each bot's chat storage (chat.store.ChatStore): her images and the saved lines.
        self.chat = chat
        self.memory = memory if memory is not None else ConversationMemory()
        self._start_bot = start_bot
        self._bots: dict[UUID, LiveBot] = {}
        self._locks: WeakValueDictionary[UUID, asyncio.Lock] = WeakValueDictionary()
        self._closing = False

    def turn_image_for_bot(self, board: BoardContext) -> TurnImage | None:
        return self.turn_images(board) if self.turn_images else None

    def _lock(self, learner_id):
        lock = self._locks.get(learner_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[learner_id] = lock
        return lock

    def live_bot(self, learner_id: UUID) -> LiveBot | None:
        bot = self._bots.get(learner_id)
        return bot if bot is not None and not bot.task.done() else None

    def _owned(self, learner_id, session_id, pc_id):
        bot = self.live_bot(learner_id)
        return bot if bot and bot.session_id == session_id and pc_id in bot.pc_ids else None

    async def _run(self, connection, ctx, handler):
        try:
            await self._start_bot(connection, ctx)
        finally:
            # Also closes injected runners and every alias created by an ICE restart.
            try:
                await connection.disconnect()
            finally:
                await handler.close()

    def _finished(self, learner_id, task):
        bot = self._bots.get(learner_id)
        if bot and bot.task is task:
            self._bots.pop(learner_id)
        if not task.cancelled() and (error := task.exception()) is not None:
            # Provider exceptions can carry credentials/response bodies. Never log them.
            logger.error("Voice bot ended with {}", type(error).__name__)

    async def _stop(self, bot):
        if not bot.task.done():
            bot.task.cancel()
            _, pending = await asyncio.wait({bot.task}, timeout=STOP_TIMEOUT_S)
            if pending:
                # Stop media even if a runner refuses cancellation; never overlap bots.
                await bot.handler.close()
                raise VoiceConflict("Previous voice session is still closing; retry shortly")
        await bot.handler.close()

    async def offer(
        self, *, learner_id: UUID, session: TutoringSession, body: OfferBody
    ) -> OfferAnswer:
        async with self._lock(learner_id):
            if self._closing:
                raise VoiceConflict("Voice server is shutting down")
            if session.learner_id != learner_id:
                raise VoiceConflict("Peer connection ended or unknown; create a fresh offer")
            bot = self.live_bot(learner_id)
            if body.pc_id is not None:
                bot = self._owned(learner_id, session.id, body.pc_id)
                if bot is None:
                    raise VoiceConflict("Peer connection ended or unknown; create a fresh offer")
                handler = bot.handler
            else:
                require_session_providers(self.settings)
                if bot:
                    await self._stop(bot)
                # One handler per live connection isolates peers and retires restart aliases.
                handler = SmallWebRTCRequestHandler(
                    ice_servers=[
                        IceServer(
                            urls=s.urls,
                            username=s.username,
                            credential=s.credential.get_secret_value() if s.credential else None,
                        )
                        for s in self.settings.ice_servers
                    ]
                )

            created = None
            unexpected_connection = None

            async def connected(connection):
                nonlocal created, unexpected_connection
                # Pipecat can silently create a new peer for an unknown id. Registry
                # ownership is authoritative; never start another bot on renegotiation.
                if body.pc_id is not None:
                    unexpected_connection = connection
                    return
                board = BoardContext()
                ctx = BotContext(
                    learner_id=learner_id,
                    session_id=session.id,
                    lang=session.language,
                    titled=session.title is not None,
                    request=body.request_data or OfferRequestData(),
                    settings=self.settings,
                    memory=self.memory,
                    sessions=self.sessions,
                    turn_image=self.turn_image_for_bot(board),
                    board=board,
                    board_snapshots=self.board_snapshots,
                    chat=self.chat,
                    screen=self.screens.get(learner_id, session.id),
                )
                task = asyncio.create_task(
                    self._run(connection, ctx, handler), name=f"voice-{session.id}"
                )
                created = LiveBot(session.id, {connection.pc_id}, task, connection, handler)
                self._bots[learner_id] = created
                task.add_done_callback(lambda task: self._finished(learner_id, task))

            try:
                answer = await handler.handle_web_request(
                    SmallWebRTCRequest(
                        sdp=body.sdp,
                        type=body.type,
                        pc_id=body.pc_id,
                        restart_pc=body.restart_pc,
                        request_data=body.request_data.model_dump() if body.request_data else None,
                    ),
                    connected,
                )
                if self._closing:
                    raise VoiceConflict("Voice server is shutting down")
                if unexpected_connection:
                    await unexpected_connection.disconnect()
                    raise VoiceConflict("Peer connection ended or unknown; create a fresh offer")
                current = created or bot
                await asyncio.sleep(0)  # Start the task before offering it to a replacement.
                if current is None or current.task.done():
                    raise VoiceConflict("Voice bot ended; create a fresh offer")
                result = OfferAnswer.model_validate(answer)
                current.pc_ids.add(result.pc_id)
                return result
            except BaseException:
                if created:
                    await self._stop(created)
                elif body.pc_id is None:
                    await handler.close()
                raise

    async def patch(self, *, learner_id: UUID, session_id: UUID, patch: IcePatch) -> None:
        async with self._lock(learner_id):
            bot = self._owned(learner_id, session_id, patch.pc_id)
            if self._closing or bot is None:
                raise HTTPException(status_code=404, detail="Peer connection not found")
            await bot.handler.handle_patch_request(
                SmallWebRTCPatchRequest(
                    pc_id=patch.pc_id,
                    candidates=[
                        IceCandidate(**candidate.model_dump()) for candidate in patch.candidates
                    ],
                )
            )

    async def finish(self, learner_id: UUID, session_id: UUID) -> None:
        """Explicitly leaving a screen, unlike a transient transport reconnect."""
        async with self._lock(learner_id):
            bot = self.live_bot(learner_id)
            if bot and bot.session_id == session_id:
                await self._stop(bot)

    async def shutdown(self) -> None:
        self._closing = True
        # Wait for in-flight offers/patches before closing their connections.
        locks = list(self._locks.values())
        for lock in locks:
            async with lock:
                pass
        results = await asyncio.gather(
            *(self._stop(bot) for bot in list(self._bots.values())), return_exceptions=True
        )
        for result in results:
            if isinstance(result, BaseException):
                logger.error("Voice shutdown failed with {}", type(result).__name__)
