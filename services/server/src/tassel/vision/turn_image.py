"""Stored paper for one tutor turn. No provider calls and no live capture.

Main binds ``make_turn_image_for(app.state.session_factory, app.state.object_store,
context=board_context)`` per bot, then calls the returned async ``(session_id)`` seam.
The context and marked image are produced together, so [[freeze]] pins that exact frame.
Internal helpers take an already-authorized session id; HTTP ownership lives in frames/api.py.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime

import anyio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tassel.beats.markup import BoardContext
from tassel.beats.models import (
    DetectedElement,
    DetectedElements,
    PaperElements,
    PaperFrame,
    PixelBox,
)
from tassel.domains.dfa.contract import Pt
from tassel.frames import repo
from tassel.frames.objects import ObjectStore
from tassel.frames.tables import Frame
from tassel.vision.marks import draw_marks, find_candidates
from tassel.vision.page import encode_jpeg, enhance_for_llm, flatten_page


@dataclass(frozen=True)
class PageView:
    marked_jpeg: bytes
    page_jpeg: bytes
    elements: tuple[DetectedElement, ...]
    frame_id: uuid.UUID
    captured_at: datetime
    width: int
    height: int

    def set_context(self, context: BoardContext) -> None:
        context.paper_frame = PaperFrame(
            kind="paper", id=str(self.frame_id), captured_at=self.captured_at.isoformat()
        )
        context.paper_elements = PaperElements(
            states={},
            edges={},
            detected=DetectedElements(
                width=self.width, height=self.height, items=list(self.elements)
            ),
        )
        # Geometry candidates are not a semantic automaton reading.
        context.paper_spec = None


def _page_view(jpeg: bytes, row: Frame) -> PageView | None:
    stored_quad = row.meta.get("page_quad")
    quad = None if stored_quad is None else [Pt(**point) for point in stored_quad]
    page = flatten_page(jpeg, quad)
    if not page.found:
        return None  # Never show flatten_page's central-crop fallback as detected paper.
    candidates = find_candidates(page)
    elements = []
    for circle in candidates.circles:
        x, y = max(0, circle.cx - circle.r), max(0, circle.cy - circle.r)
        right, bottom = (
            min(page.width, circle.cx + circle.r),
            min(page.height, circle.cy + circle.r),
        )
        elements.append(
            DetectedElement(
                id=f"m{circle.mark}",
                kind="circle",
                box=PixelBox(x=x, y=y, w=right - x, h=bottom - y),
            )
        )
    for label in candidates.labels:
        elements.append(
            DetectedElement(
                id=f"m{label.mark}",
                kind="label",
                box=PixelBox(x=label.x, y=label.y, w=label.w, h=label.h),
            )
        )
    # Detect against faithful pixels; enhance only the model copy and draw crisp tags last.
    model_page = replace(page, rgb=enhance_for_llm(page.rgb))
    return PageView(
        marked_jpeg=encode_jpeg(draw_marks(model_page, candidates)),
        page_jpeg=encode_jpeg(page.rgb),
        elements=tuple(elements),
        frame_id=row.id,
        captured_at=row.captured_at,
        width=page.width,
        height=page.height,
    )


async def page_view_for_frame(row: Frame, *, store: ObjectStore) -> PageView | None:
    """Analyze an authorized frame. Missing objects and pageless images produce no view."""
    jpeg = await store.get(row.full_key)
    if jpeg is None:
        return None
    # Decoding, perspective transforms and circle detection must not block voice/WebSocket IO.
    return await anyio.to_thread.run_sync(_page_view, jpeg, row)


async def latest_page_view(
    session_id: uuid.UUID, *, db: AsyncSession, store: ObjectStore
) -> PageView | None:
    """Highest stored seq wins, even if its device timestamp is older or it has no page."""
    rows = await repo.list_for(db, session_id, limit=1)
    return None if not rows else await page_view_for_frame(rows[0], store=store)


CAPTION = (
    "Student's flattened paper. Blue numbers are visual candidate IDs, not student ink: "
    "number 3 means element m3 (likewise each other number). They identify circles or labels, "
    "not verified state names. Before drawing, use [[freeze]] to show this exact paper frame. "
    "Target IDs with [[circle m3]], [[wash m3]], [[number 1 m3]], [[strike m3]], "
    '[[check m3]], or [[callout m3 "Look here"]]. Use only IDs visible in this image. '
    "[[live]] returns to live paper."
)


async def turn_image_for(
    session_id: uuid.UUID,
    *,
    db: AsyncSession,
    store: ObjectStore,
    context: BoardContext | None = None,
) -> tuple[bytes, str] | None:
    """JPEG bytes plus model instructions. Bind dependencies with make_turn_image_for."""
    # Clear before awaiting: a storage/decode error or cancellation must not retain old ink.
    if context is not None:
        context.paper_frame = None
        context.paper_elements = None
        context.paper_spec = None
    view = await latest_page_view(session_id, db=db, store=store)
    if context is not None and view is not None:
        view.set_context(context)
    return None if view is None else (view.marked_jpeg, CAPTION)


def make_turn_image_for(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    *,
    context: BoardContext,
) -> Callable[[uuid.UUID], Awaitable[tuple[bytes, str] | None]]:
    """The one-argument per-turn seam, using the app's existing store and DB pool."""

    async def image_for(session_id: uuid.UUID) -> tuple[bytes, str] | None:
        async with sessions() as db:
            return await turn_image_for(session_id, db=db, store=store, context=context)

    return image_for
