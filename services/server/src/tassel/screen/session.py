"""Ephemeral screen grants and revision-bound frames. No image is persisted."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID


@dataclass(frozen=True)
class ScreenFrame:
    id: str
    source: str
    epoch: int
    revision: int
    captured_at: datetime
    image: bytes


class ScreenSession:
    def __init__(self):
        self.source = ""
        self.epoch = 0
        self.revision = 0
        self.active = False
        self.frame: ScreenFrame | None = None
        self.cancel: Callable[[], Awaitable[None]] | None = None
        self.changed = asyncio.Event()
        self.cancel_pending = False
        self.lock = asyncio.Lock()
        self.updated_at = datetime.now(UTC)

    def matches(self, source: str, epoch: int) -> bool:
        return (
            self.active
            and not self.cancel_pending
            and self.source == source
            and self.epoch == epoch
        )

    def control(self, *, source: str, epoch: int, active: bool) -> bool:
        if epoch <= self.epoch:
            return False
        self.source, self.epoch, self.active = source, epoch, active
        self.revision = 0
        self.frame = None
        self.updated_at = datetime.now(UTC)
        self.changed.set()
        return True

    async def reset(self, *, source: str, epoch: int, active: bool):
        async with self.lock:
            changed = self.control(source=source, epoch=epoch, active=active)
            if changed:
                self.cancel_pending = True
            if self.epoch == epoch and self.cancel_pending:
                if self.cancel:
                    await self.cancel()
                self.cancel_pending = False

    def put(self, frame: ScreenFrame) -> bool:
        if not self.matches(frame.source, frame.epoch) or frame.revision < self.revision:
            return False
        self.revision = frame.revision
        self.frame = frame
        self.updated_at = datetime.now(UTC)
        self.changed.set()
        return True

    async def fresh(self, since: datetime) -> ScreenFrame | None:
        epoch = self.epoch
        try:
            async with asyncio.timeout(2):
                while self.active and epoch == self.epoch:
                    self.changed.clear()
                    frame = self.frame
                    if frame and frame.epoch == epoch and frame.captured_at >= since:
                        return frame
                    await self.changed.wait()
        except TimeoutError:
            pass
        return None


class ScreenSessions:
    """At most one ephemeral screen session per authenticated learner."""

    def __init__(self):
        self.items: dict[UUID, tuple[UUID, ScreenSession]] = {}

    def get(self, learner: UUID, session: UUID) -> ScreenSession:
        current = self.items.get(learner)
        if current is None or current[0] != session:
            if current:
                current[1].active = False
                current[1].frame = None
                current[1].changed.set()
            screen = ScreenSession()
            self.items[learner] = (session, screen)
            return screen
        return current[1]
