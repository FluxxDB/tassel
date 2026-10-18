"""The session's conversation as the chat sidebar shows it, line by line, live and saved.

The voice bot feeds it: the student's lines (spoken, from the turn the model sees; typed, from
``student-message``), Ada's clean sentences as they reach the output (so a spoken line grows in
step with her voice), and what her tags and stage events did (action rows). Each line goes to
the app as a ``message`` event; a tutor line is updated in place under one id per response,
``final`` when the response ends and ``interrupted`` when she was cut off.

Every final line is saved with the next seq of the session, in the order lines first appeared.
Saving runs in its own task and only logs a failure: the chat never blocks or breaks her voice.
"""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Literal

from tassel.beats.markup import Sentence
from tassel.chat.actions import rows_for, view_row
from tassel.voice.messages import ChatMessageEvent, MessageAction, MessageAttachment, StageEvent

logger = logging.getLogger(__name__)

Source = Literal["voice", "typed"]
Send = Callable[[ChatMessageEvent], Awaitable[None]]
Save = Callable[[int, ChatMessageEvent], Awaitable[None]]


@dataclass
class _Tutor:
    id: str
    seq: int
    source: Source
    parts: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return " ".join(self.parts)


class ChatLog:
    def __init__(self, send: Send, *, save: Save | None = None, first_seq: int = 0):
        self._send, self._save = send, save
        self._seq = first_seq
        self._tutor: _Tutor | None = None
        # How Ada's next lines answer: "typed" after a typed message, "voice" after speech.
        self._source: Source = "voice"
        # Action rows waiting for their sentence to be heard, by its text frame's id.
        self._waiting: dict[int, list[MessageAction]] = {}
        # Which side the app shows (and which of her images), as far as the chat knows: a
        # view row only for a change.
        self._side: tuple[str, str | None] | None = None
        self._tasks: set[asyncio.Task] = set()

    def _next(self) -> int:
        self._seq += 1
        return self._seq

    async def _emit(self, message: ChatMessageEvent, seq: int) -> None:
        try:
            await self._send(message)
        except Exception as error:  # noqa: BLE001 - the chat never breaks the voice
            logger.warning("Couldn't send a chat line: %s", type(error).__name__)
        if message.final and self._save is not None:
            task = asyncio.create_task(self._saving(seq, message))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _saving(self, seq: int, message: ChatMessageEvent) -> None:
        try:
            await self._save(seq, message)
        except Exception as error:  # noqa: BLE001 - SQL errors can embed her words
            logger.warning("Couldn't save a chat line: %s", type(error).__name__)

    # The student

    async def student(
        self,
        text: str,
        *,
        source: Source,
        client_id: str | None = None,
        attachments: Sequence[MessageAttachment] = (),
    ) -> str:
        """Her line, final at once; Ada's lines after it answer it the same way."""
        self._source = source
        message_id = str(uuid.uuid4())
        await self._emit(
            ChatMessageEvent(
                id=message_id,
                client_id=client_id,
                role="student",
                source=source,
                text=text,
                final=True,
                interrupted=False,
                attachments=list(attachments),
                action=None,
            ),
            self._next(),
        )
        return message_id

    # Ada

    def _tutor_event(self, tutor: _Tutor, *, final: bool, interrupted: bool = False):
        return ChatMessageEvent(
            id=tutor.id,
            client_id=None,
            role="tutor",
            source=tutor.source,
            text=tutor.text,
            final=final,
            interrupted=interrupted,
            attachments=[],
            action=None,
        )

    async def heard(self, text: str, frame_id: int | None = None) -> None:
        """One of her sentences reached the output: spoken now, or shown when she types."""
        text = text.strip()
        if text:
            if self._tutor is None:
                self._tutor = _Tutor(str(uuid.uuid4()), self._next(), self._source)
            self._tutor.parts.append(text)
            await self._emit(self._tutor_event(self._tutor, final=False), self._tutor.seq)
        if frame_id is not None:
            await self._rows(self._waiting.pop(frame_id, []))

    async def ended(self) -> None:
        """Her response ended: its line is final, and anything it did is shown."""
        waiting = [row for rows in self._waiting.values() for row in rows]
        self._waiting.clear()
        tutor, self._tutor = self._tutor, None
        if tutor is not None:
            await self._emit(self._tutor_event(tutor, final=True), tutor.seq)
        await self._rows(waiting)

    async def interrupted(self) -> None:
        """She was cut off: her line ends where she stopped, and what she never got to say
        never happened."""
        self._waiting.clear()
        tutor, self._tutor = self._tutor, None
        if tutor is not None:
            await self._emit(self._tutor_event(tutor, final=True, interrupted=True), tutor.seq)

    # What she did

    async def sentence(self, sentence: Sentence, frame_id: int | None) -> None:
        """A sentence of hers, before it's spoken: its action rows wait for its words, or show
        now when it has none (a wordless beat fires as the app loads it)."""
        try:
            rows = rows_for(sentence)
        except Exception as error:  # noqa: BLE001
            logger.warning("Couldn't read a sentence's actions: %s", type(error).__name__)
            return
        if not rows:
            return
        if frame_id is None:
            await self._rows(rows)
        else:
            self._waiting.setdefault(frame_id, []).extend(rows)

    async def _rows(self, rows: Iterable[MessageAction]) -> None:
        for row in rows:
            if row.kind == "view":
                shown = (row.side, row.attachment_id)
                if shown == self._side:
                    continue
                self._side = shown
            await self._emit(
                ChatMessageEvent(
                    id=str(uuid.uuid4()),
                    client_id=None,
                    role="action",
                    source=None,
                    text="",
                    final=True,
                    interrupted=False,
                    attachments=[],
                    action=row,
                ),
                self._next(),
            )

    async def server_event(self, event) -> None:
        """A server event on its way to the app: a stage switch is a view row."""
        if isinstance(event, StageEvent):
            await self._rows([view_row(event.view)])

    def app_view(self, view: Literal["paper", "board", "split"]) -> None:
        """What the app says it shows now."""
        self._side = (view_row(view).side, None)

    async def close(self, timeout: float = 5.0) -> None:
        """Waits for the last saves."""
        if not self._tasks:
            return
        _, pending = await asyncio.wait(set(self._tasks), timeout=timeout)
        for task in pending:
            task.cancel()
