"""The latest renderer snapshot, timestamped on the server's monotonic clock."""

import asyncio
import time
import uuid

MAX_SESSIONS = 128
SNAPSHOT_TTL_S = 60


class BoardSnapshots:
    def __init__(self) -> None:
        self._latest: dict[uuid.UUID, tuple[float, bytes]] = {}
        self._revision: dict[uuid.UUID, int] = {}
        self._sequence = 0
        self._waiters: dict[uuid.UUID, set[asyncio.Event]] = {}

    def _prune(self, now: float) -> None:
        for session_id, (created, _) in list(self._latest.items()):
            if now - created >= SNAPSHOT_TTL_S:
                del self._latest[session_id]
                self._revision.pop(session_id, None)

    def put(self, session_id: uuid.UUID, png: bytes) -> None:
        now = time.monotonic()
        self._prune(now)
        # Dict insertion order tracks the last update, including refreshed sessions.
        self._latest.pop(session_id, None)
        self._latest[session_id] = (now, png)
        self._sequence += 1
        self._revision[session_id] = self._sequence
        while len(self._latest) > MAX_SESSIONS:
            oldest = next(iter(self._latest))
            del self._latest[oldest]
            self._revision.pop(oldest, None)
        for waiter in self._waiters.get(session_id, ()):
            waiter.set()

    def revision(self, session_id: uuid.UUID) -> int:
        return self._revision.get(session_id, 0)

    async def wait(
        self,
        session_id: uuid.UUID,
        since: float,
        timeout: float = 1.5,
        *,
        revision: int | None = None,
    ) -> bytes | None:
        waiter = asyncio.Event()
        self._waiters.setdefault(session_id, set()).add(waiter)
        try:
            async with asyncio.timeout(timeout):
                while True:
                    self._prune(time.monotonic())
                    latest = self._latest.get(session_id)
                    fresh = (
                        self.revision(session_id) > revision
                        if revision is not None
                        else latest is not None and latest[0] > since
                    )
                    if latest is not None and fresh:
                        return latest[1]
                    waiter.clear()
                    await waiter.wait()
        except TimeoutError:
            return None
        finally:
            waiters = self._waiters[session_id]
            waiters.discard(waiter)
            if not waiters:
                del self._waiters[session_id]
