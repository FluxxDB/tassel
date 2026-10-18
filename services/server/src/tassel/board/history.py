"""Persist emitted board actions and rebuild the tutor's board context on reconnect."""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from typing import Any

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tassel.beats.markup import BoardContext
from tassel.beats.models import BEAT_ACTION, AutomatonSpec, BeatAction
from tassel.storage import sessions_repo

logger = logging.getLogger(__name__)
MAX_ACTIONS = 200


class BoardHistory:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        learner_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> None:
        self._sessions = sessions
        self._learner_id = learner_id
        self._session_id = session_id
        self._actions: list[BeatAction] = []
        self._dirty = False
        self._task: asyncio.Task | None = None
        self._closed = False

    @property
    def board_items(self) -> dict[str, dict[str, Any]]:
        """Ada's surviving item declarations, detached from the persisted action models.

        Verdicts, highlights and other mutations do not declare standalone items.
        The semantic BoardContext supplies the current automaton and diagram specs.
        """
        items: dict[str, dict[str, Any]] = {}
        for action in self._actions:
            if action.kind in ("board.automaton", "board.diagram", "board.note", "board.trace"):
                items[action.item] = action.model_dump(mode="json", exclude_none=True)
            elif action.kind == "board.clear":
                if action.item is None:
                    items.clear()
                elif action.item in items:
                    items = {
                        item: declaration
                        for item, declaration in items.items()
                        if item != action.item
                        and not (
                            declaration["kind"] == "board.note"
                            and declaration.get("near", {}).get("item") == action.item
                        )
                    }
        return items

    async def load(self) -> list[BeatAction]:
        async with self._sessions() as db:
            saved = await sessions_repo.load_board_actions(db, self._learner_id, self._session_id)
        actions = []
        for value in saved:
            try:
                action = BEAT_ACTION.validate_python(value)
            except ValidationError:
                logger.warning("Ignoring an invalid persisted board action")
                continue
            if action.kind.startswith("board."):
                actions.append(action)
        self._actions = actions[-MAX_ACTIONS:]
        return [action.model_copy(deep=True) for action in self._actions]

    def record(self, actions: Sequence[BeatAction]) -> None:
        if self._closed:
            return
        for action in actions:
            if not action.kind.startswith("board."):
                continue
            if action.kind == "board.clear" and action.item is None:
                self._actions.clear()
            self._actions.append(action.model_copy(deep=True))
            self._actions = self._actions[-MAX_ACTIONS:]
            self._dirty = True
        if self._dirty and (self._task is None or self._task.done()):
            self._task = asyncio.create_task(self._write_later())

    async def _write_later(self) -> None:
        while self._dirty and not self._closed:
            await asyncio.sleep(1)
            try:
                await self._flush()
            except Exception as error:
                # SQL errors can embed bound board text; log only the error's type.
                logger.warning(
                    "Could not persist board history (%s); will retry", type(error).__name__
                )

    async def _flush(self) -> None:
        if not self._dirty:
            return
        snapshot = [action.model_dump(mode="json", exclude_none=True) for action in self._actions]
        self._dirty = False
        try:
            async with self._sessions() as db:
                await sessions_repo.save_board_actions(
                    db, self._learner_id, self._session_id, snapshot
                )
        except BaseException:
            self._dirty = True
            raise

    async def close(self) -> None:
        self._closed = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._flush()


def replay(board: BoardContext, actions: Sequence[BeatAction]) -> None:
    """Restore semantic board state without mutating the saved action models."""
    for action in actions:
        if action.kind == "board.automaton":
            board.specs[action.item] = action.spec.model_copy(deep=True)
        elif action.kind == "board.diagram":
            board.diagrams[action.item] = action.spec.model_copy(deep=True)
        elif action.kind in ("board.addState", "board.addTransition"):
            known = board.specs.get(action.item)
            if known is None:
                continue
            data = known.model_dump(mode="json", exclude_none=True)
            if action.kind == "board.addState":
                data["states"].append({"id": action.id, "accept": bool(action.accept)})
            else:
                edge = next(
                    (
                        edge
                        for edge in data["transitions"]
                        if (edge["from"], edge["to"]) == (action.from_, action.to)
                    ),
                    None,
                )
                if edge is None:
                    data["transitions"].append(
                        {
                            "from": action.from_,
                            "to": action.to,
                            "symbols": list(action.symbols),
                        }
                    )
                else:
                    edge["symbols"] = list(dict.fromkeys([*edge["symbols"], *action.symbols]))
            try:
                board.specs[action.item] = AutomatonSpec.model_validate(data)
            except ValidationError:
                logger.warning("Ignoring an invalid persisted board mutation")
        elif action.kind == "board.clear":
            for items in (board.specs, board.diagrams, board.pending_diagrams):
                if action.item is None:
                    items.clear()
                else:
                    items.pop(action.item, None)
