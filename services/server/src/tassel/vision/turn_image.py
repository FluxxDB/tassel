"""Stored paper for one tutor turn. No provider calls and no live capture.

Main binds ``make_turn_image_for(app.state.session_factory, app.state.object_store,
context=board_context)`` per bot, then calls the returned async ``(session_id)`` seam.
The context and marked image are produced together, so [[freeze]] pins that exact frame.
Internal helpers take an already-authorized session id; HTTP ownership lives in frames/api.py.
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta

import anyio
import cv2
import numpy as np
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
from tassel.vision.ink_boxes import refine_box
from tassel.vision.marks import Candidates, draw_marks, find_candidates
from tassel.vision.page import (
    FlatPage,
    decode_jpeg,
    encode_jpeg,
    enhance_for_llm,
    flatten_page,
    ink_mask,
)


@dataclass(frozen=True)
class PageView:
    marked_jpeg: bytes
    page_jpeg: bytes
    elements: tuple[DetectedElement, ...]
    frame_id: uuid.UUID
    captured_at: datetime
    width: int
    height: int
    # The page's ink mask, so a mark's box lands on her ink (tassel.vision.ink_boxes).
    ink: np.ndarray | None = field(default=None, repr=False, compare=False)

    def set_context(self, context: BoardContext) -> None:
        context.paper_frame = PaperFrame(
            kind="paper", id=str(self.frame_id), captured_at=self.captured_at.isoformat()
        )
        ink = self.ink
        context.paper_ink = (
            None
            if ink is None
            else (str(self.frame_id), lambda verb, box: refine_box(ink, verb, box))
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


MODEL_LONG_SIDE = 1024
MODEL_JPEG_BUDGET = 60_000


def _model_jpeg(rgb: np.ndarray) -> bytes:
    """Bound the upload even for unusually textured/noisy camera frames."""
    h, w = rgb.shape[:2]
    scale = min(1, MODEL_LONG_SIDE / max(h, w))
    if scale < 1:
        rgb = cv2.resize(rgb, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    while True:
        for quality in range(85, 59, -5):
            jpeg = encode_jpeg(rgb, quality=quality)
            if len(jpeg) < MODEL_JPEG_BUDGET:
                return jpeg
        h, w = rgb.shape[:2]
        rgb = cv2.resize(
            rgb, (max(1, round(w * 0.85)), max(1, round(h * 0.85))), interpolation=cv2.INTER_AREA
        )


TURN_MAX_MARKS = 12  # The voice model's page: drawn circles first, then the largest ink labels.


def _turn_candidates(c: Candidates) -> Candidates:
    """Few, meaningful marks for the voice model; the deep reader keeps the full set."""
    circles = list(c.circles)[:TURN_MAX_MARKS]
    room = TURN_MAX_MARKS - len(circles)
    labels = sorted(c.labels, key=lambda m: m.w * m.h, reverse=True)[: max(0, room)]
    return replace(
        c,
        circles=tuple(circles) if isinstance(c.circles, tuple) else circles,
        labels=tuple(labels) if isinstance(c.labels, tuple) else labels,
    )


def _page_view(jpeg: bytes, row: Frame) -> PageView | None:
    stored_quad = row.meta.get("page_quad")
    # Without a page, the detector sends the fallback region it compared (the frame's middle
    # 80 %): not a page. Flattening it cut off the owner's first lines and kept the desk band.
    if row.meta.get("page_found") is False:
        stored_quad = None
    quad = None if stored_quad is None else [Pt(**point) for point in stored_quad]
    page = flatten_page(jpeg, quad)
    if not page.found:
        # The page finder often fails on real Desk View frames. Desk View is already top-down,
        # so the whole frame stands in for the page (never flatten_page's central crop), and
        # marks are in the whole frame's coordinates.
        rgb = decode_jpeg(jpeg)
        h, w = rgb.shape[:2]
        corners = (Pt(x=0, y=0), Pt(x=w, y=0), Pt(x=w, y=h), Pt(x=0, y=h))
        page = FlatPage(rgb, w, h, corners, False)
    ink = ink_mask(page)
    candidates = _turn_candidates(find_candidates(page, ink, ink_mask(page, faint=True)))
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
    drawn: set[int] = set()
    marked = draw_marks(model_page, candidates, drawn=drawn, ink_page=page, mask=ink)
    return PageView(
        marked_jpeg=_model_jpeg(marked),
        page_jpeg=encode_jpeg(page.rgb),
        elements=tuple(el for el in elements if int(el.id[1:]) in drawn),
        frame_id=row.id,
        captured_at=row.captured_at,
        width=page.width,
        height=page.height,
        ink=ink != 0,
    )


async def page_view_for_frame(row: Frame, *, store: ObjectStore) -> PageView | None:
    """Analyze an authorized frame. A missing object produces no view; a frame without a found
    page is viewed whole."""
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
    "Target IDs with [[circle m3]], [[wash m3]], [[number 1 m3]], [[strike m3]], [[underline m3]], "
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
    return None if view is None else (view.marked_jpeg, CAPTION + legend(view))


def legend(view: PageView) -> str:
    """Where each mark ID sits, in words: the thinker misread small badge numbers live (retest #8
    called m4, in the heading, 'near the final state'), so it can cross-check them here."""
    if not view.elements:
        return ""

    def where(e):
        cx = (e.box.x + e.box.w / 2) / max(view.width, 1)
        cy = (e.box.y + e.box.h / 2) / max(view.height, 1)
        across = "left" if cx < 1 / 3 else "center" if cx < 2 / 3 else "right"
        down = "top" if cy < 1 / 3 else "middle" if cy < 2 / 3 else "bottom"
        return f"{e.id} {e.kind} at {down} {across}"

    ordered = sorted(view.elements, key=lambda e: e.box.x + e.box.w / 2)
    return (
        " Marks from left to right: "
        + "; ".join(where(e) for e in ordered)
        + ". Cross-check an ID's position here before marking it."
    )


@dataclass(frozen=True)
class TurnPage:
    """What a student turn shows the model of her paper: the marked page and its caption, or,
    when there's no current view, no image and a note saying so."""

    image: bytes | None
    caption: str
    ink_image: bytes | None = None


NO_VIEW = (
    "[paper] The view didn't come through. Use the latest page notes, identified as previous "
    "observations, without inventing new ink or making new marks. Mention the missing view "
    "only if the student asked about the page; say plainly: my view didn't come through. "
    "Never attribute a delivery failure to the student or to motion."
)

# How long a turn waits for the frame the app takes for it, how old a frame may be to stand in
# when that one doesn't come, and how often the frames table is checked meanwhile.
FRESH_WAIT_S = 1.0
STAND_IN_MAX_AGE_S = 10.0
POLL_S = 0.1
# Clocks: the speech start is the server's, created_at the database's, on the same machine.
SINCE_SLACK = timedelta(milliseconds=500)


async def fresh_turn_image_for(
    session_id: uuid.UUID,
    since: datetime,
    *,
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    context: BoardContext,
    wait_s: float = FRESH_WAIT_S,
    max_age_s: float = STAND_IN_MAX_AGE_S,
) -> TurnPage | None:
    """The page for a turn that began at ``since``: the frame the app took for it, waiting up to
    ``wait_s``; else the newest frame if it's under ``max_age_s`` old; else no image and the
    NO_VIEW note. None for a session that has never had a paper frame (Just talk), at once."""
    context.paper_frame = None
    context.paper_elements = None
    context.paper_spec = None
    async with sessions() as db:
        if not await repo.has_frames(db, session_id):
            return None
    floor = since - SINCE_SLACK
    deadline = asyncio.get_running_loop().time() + wait_s
    row = None
    while True:
        async with sessions() as db:
            newest = (await repo.list_for(db, session_id, limit=1) or [None])[0]
            now = await repo.db_now(db)
        if newest is not None and newest.created_at >= floor:
            row = newest
            break
        if asyncio.get_running_loop().time() >= deadline:
            if newest is not None and now - newest.created_at < timedelta(seconds=max_age_s):
                row = newest
            break
        await asyncio.sleep(POLL_S)
    view = None if row is None else await page_view_for_frame(row, store=store)
    if view is None:
        return TurnPage(None, NO_VIEW)
    view.set_context(context)
    return TurnPage(view.marked_jpeg, CAPTION + legend(view), ink_image=view.page_jpeg)


def make_turn_image_for(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    *,
    context: BoardContext,
) -> Callable[[uuid.UUID, datetime], Awaitable[TurnPage | None]]:
    """The per-turn seam, using the app's existing store and DB pool: a turn's page, given when
    the turn began (the student's speech start, or the typed line's arrival)."""

    async def image_for(session_id: uuid.UUID, since: datetime) -> TurnPage | None:
        return await fresh_turn_image_for(
            session_id, since, sessions=sessions, store=store, context=context
        )

    return image_for
