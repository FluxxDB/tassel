"""Bounded, process-local conversation memory; no persistence of student paper images."""

import time
from collections.abc import Callable
from copy import deepcopy
from uuid import UUID

from tassel.models import Lang


class ConversationMemory:
    def __init__(
        self,
        *,
        ttl_s: float = 1800,
        max_messages: int = 40,
        clock: Callable[[], float] = time.monotonic,
    ):
        if max_messages < 1 or ttl_s <= 0:
            raise ValueError("Memory limits must be positive")
        self._ttl, self._max, self._clock = ttl_s, max_messages, clock
        self._entries: dict[UUID, tuple[float, list[dict], Lang]] = {}

    def _expire(self):
        now = self._clock()
        self._entries = {k: v for k, v in self._entries.items() if v[0] > now}

    def recall(self, session_id: UUID) -> tuple[list[dict], Lang | None]:
        self._expire()
        entry = self._entries.get(session_id)
        return (deepcopy(entry[1]), entry[2]) if entry else ([], None)

    def remember(self, session_id: UUID, messages: list[dict], lang: Lang) -> None:
        self._expire()
        history = deepcopy([m for m in messages if m.get("role") != "system"])
        # Images belong to a live turn, not reconnect history.
        for message in history:
            content = message.get("content")
            if isinstance(content, list):
                message["content"] = [b for b in content if b.get("type") != "image_url"]
        if len(history) > self._max:
            history = history[-self._max :]
            cut = next((i for i, m in enumerate(history) if m.get("role") == "user"), len(history))
            history = history[cut:]
        self._entries[session_id] = (self._clock() + self._ttl, history, lang)
