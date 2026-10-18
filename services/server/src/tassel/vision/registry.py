"""Application-owned vision sessions, tickers and their shared two-worker CPU budget."""

import asyncio
import logging
import time
from uuid import UUID

import anyio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tassel.domains.dfa.contract import Pt
from tassel.frames.models import FrameOut
from tassel.models import Lang
from tassel.storage import sessions_repo
from tassel.storage.tables import TutoringSession
from tassel.vision.deepcheck import DeepCheck, make_deepcheck
from tassel.vision.gate import load_thresholds, make_gate
from tassel.vision.log import VisionLog
from tassel.vision.orchestrator import TICK_MS, VISION_CPU_TOKENS, FrameIn, VisionSession
from tassel.vision.ports import DecisionGate
from tassel.vision.settings import VisionSettings

IDLE_SESSION_MS = 30 * 60 * 1000
_LOG = logging.getLogger(__name__)


class VisionRegistry:
    def __init__(
        self,
        *,
        settings: VisionSettings,
        sessions: async_sessionmaker[AsyncSession],
        gate: DecisionGate | None = None,
        deepcheck: DeepCheck | None = None,
        clock=time.monotonic,
    ):
        self.gate = gate if gate is not None else make_gate(settings)
        self.deepcheck = deepcheck if deepcheck is not None else make_deepcheck(settings)
        self.settings, self.sessions, self.clock = settings, sessions, clock
        self.thresholds = load_thresholds(settings.thresholds_path, self.gate.name)
        self.limiter = anyio.CapacityLimiter(VISION_CPU_TOKENS)
        self.log = VisionLog(settings.vision_log)
        self._sessions: dict[UUID, VisionSession] = {}
        self._owners: dict[UUID, UUID] = {}
        self._tickers: dict[UUID, asyncio.Task] = {}
        self._closed = False

    def session(self, *, learner_id: UUID, session_id: UUID, lang: Lang) -> VisionSession:
        if self._closed:
            raise RuntimeError("Vision registry is closed")
        if session_id in self._sessions:
            if self._owners[session_id] != learner_id:
                raise ValueError("Vision session belongs to another learner")
            return self._sessions[session_id]

        async def title():
            async with self.sessions() as db:
                row = await sessions_repo.get_for(db, learner_id, session_id)
                return row.title if row else None

        session = VisionSession(
            session_id=session_id,
            lang=lang,
            gate=self.gate,
            deepcheck=self.deepcheck,
            thresholds=self.thresholds,
            title=title,
            clock=self.clock,
            log=self.log,
            stall_ms=self.settings.vision_stall_ms,
            limiter=self.limiter,
        )
        self._sessions[session_id] = session
        self._owners[session_id] = learner_id
        self._tickers[session_id] = asyncio.create_task(self._ticker(session))
        return session

    def get(self, session_id: UUID) -> VisionSession | None:
        return self._sessions.get(session_id)

    async def _ticker(self, session: VisionSession):
        try:
            while True:
                await asyncio.sleep(TICK_MS / 1000)
                if round(self.clock() * 1000) - session.last_activity_ms >= IDLE_SESSION_MS:
                    await session.close()
                    self._sessions.pop(session.session_id, None)
                    self._owners.pop(session.session_id, None)
                    self._tickers.pop(session.session_id, None)
                    return
                try:
                    await session.tick()
                except Exception:
                    _LOG.warning("Vision tick failed for session %s", session.session_id)
        except asyncio.CancelledError:
            raise

    def on_frame(
        self,
        *,
        learner_id: UUID,
        session: TutoringSession,
        frame: FrameOut,
        full: bytes,
        crop: bytes | None,
    ) -> None:
        self.session(learner_id=learner_id, session_id=session.id, lang=session.language).on_frame(
            FrameIn(
                id=frame.id,
                reason=frame.reason,
                received_ms=round(self.clock() * 1000),
                full_jpeg=full,
                crop_jpeg=crop,
                quad=None
                if frame.page_quad is None
                else [Pt(x=p.x, y=p.y) for p in frame.page_quad],
                changed_cells=len(frame.mask.cells) if frame.mask else 0,
            )
        )

    async def shutdown(self) -> None:
        self._closed = True
        tickers = tuple(self._tickers.values())
        for task in tickers:
            task.cancel()
        await asyncio.gather(*tickers, return_exceptions=True)
        await asyncio.gather(*(session.close() for session in self._sessions.values()))
        self._sessions.clear()
        self._owners.clear()
        self._tickers.clear()
        # Adapters may own SDK clients; close only through their public lifecycle, if present.
        for provider in (self.gate, self.deepcheck):
            close = getattr(provider, "aclose", None)
            if close is not None:
                await close()
