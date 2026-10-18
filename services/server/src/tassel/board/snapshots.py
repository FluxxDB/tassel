"""The latest renderer snapshot, timestamped on the server's monotonic clock."""

import asyncio
import time
import uuid

MAX_SESSIONS = 128
SNAPSHOT_TTL_S = 60


class BoardSnapshots:
    def __init__(self) -> None:
        self._latest: dict[uuid.UUID, tuple[float, bytes]] = {}
        self._waiters: dict[uuid.UUID, set[asyncio.Event]] = {}

    def _prune(self, now: float) -> None:
        for session_id, (created, _) in list(self._latest.items()):
            if now - created >= SNAPSHOT_TTL_S:
                del self._latest[session_id]

    def put(self, session_id: uuid.UUID, png: bytes) -> None:
        now = time.monotonic()
        self._prune(now)
        # Dict insertion order tracks the last update, including refreshed sessions.
        self._latest.pop(session_id, None)
        self._latest[session_id] = (now, png)
        while len(self._latest) > MAX_SESSIONS:
            del self._latest[next(iter(self._latest))]
        for waiter in self._waiters.get(session_id, ()):
            waiter.set()

    async def wait(self, session_id: uuid.UUID, since: float, timeout: float = 1.5) -> bytes | None:
        waiter = asyncio.Event()
        self._waiters.setdefault(session_id, set()).add(waiter)
        try:
            async with asyncio.timeout(timeout):
                while True:
                    self._prune(time.monotonic())
                    latest = self._latest.get(session_id)
                    if latest is not None and latest[0] > since:
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
