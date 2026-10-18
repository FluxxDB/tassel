"""Authenticated ephemeral screen control and JPEG ingestion; never the paper uploader."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner
from tassel.frames.jpeg import NotJpeg, jpeg_dimensions
from tassel.screen.session import ScreenFrame
from tassel.storage import sessions_repo
from tassel.storage.db import get_db
from tassel.storage.tables import Learner

router = APIRouter(prefix="/sessions/{session_id}/screen", tags=["screen"])


class ScreenControl(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: str = Field(min_length=1, max_length=200)
    epoch: int = Field(ge=1, le=9007199254740991)
    active: bool


class ScreenActivity(ScreenControl):
    revision: int = Field(ge=0)


class ScreenAck(BaseModel):
    epoch: int
    active: bool


class ScreenPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class ScreenPrimitive(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["pointer", "circle", "underline", "arrow", "rectangle", "text", "freehand"]
    points: list[ScreenPoint] = Field(min_length=1, max_length=512)
    text: str | None = Field(default=None, max_length=500)
    color: Literal["violet", "red", "blue", "green", "orange", "black", "white"] = "violet"

    @model_validator(mode="after")
    def shape_geometry(self):
        if getattr(self, "target", None) and self.kind in (
            "pointer",
            "circle",
            "underline",
            "rectangle",
        ):
            # The dedicated pointer supplies the geometry; the talker need not guess coordinates.
            return self
        if self.kind == "freehand":
            if len(self.points) < 2:
                raise ValueError("freehand requires at least two points")
            return self
        if self.kind == "text" and not (self.text and self.text.strip()):
            raise ValueError("text requires a nonempty label")
        expected = 1 if self.kind in ("pointer", "text") else 2
        if len(self.points) != expected:
            raise ValueError(f"{self.kind} requires {expected} points")
        if expected == 2:
            a, b = self.points
            if a == b or (self.kind in ("circle", "rectangle") and (a.x == b.x or a.y == b.y)):
                raise ValueError("Shape must have nonzero extent")
        return self


class ScreenDrawing(ScreenPrimitive):
    points: list[ScreenPoint] = Field(default_factory=list, max_length=512)
    frame_id: str = Field(min_length=1, max_length=80)
    target: str | None = Field(default=None, min_length=1, max_length=500)


class ScreenIllustration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frame_id: str = Field(min_length=1, max_length=80)
    strokes: list[ScreenPrimitive] = Field(min_length=1, max_length=100)


class ScreenObject(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    kind: str = Field(min_length=1, max_length=30)
    author: Literal["student", "tutor"]
    points: list[ScreenPoint] = Field(min_length=1, max_length=2)
    color: str = Field(max_length=20)
    text: str | None = Field(default=None, max_length=500)


class ScreenObjects(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: str = Field(min_length=1, max_length=200)
    epoch: int = Field(ge=1)
    version: int = Field(ge=1)
    objects: list[ScreenObject] = Field(max_length=300)


class ScreenResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: str = Field(min_length=1, max_length=200)
    epoch: int = Field(ge=1)
    request_id: str = Field(min_length=1, max_length=80)
    ok: bool
    reason: (
        Literal[
            "screen-session-changed",
            "screen-frame-changed",
            "invalid-edit",
            "invalid-board-action",
            "invalid-board-structure",
            "invalid-marks",
        ]
        | None
    ) = None


async def owned(request, learner, db, session_id):
    if await sessions_repo.get_for(db, learner.id, session_id) is None:
        raise HTTPException(404, "Session not found")
    return request.app.state.screens.get(learner.id, session_id)


@router.post("/control")
async def control(
    session_id: uuid.UUID,
    body: ScreenControl,
    request: Request,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> ScreenAck:
    screen = await owned(request, learner, db, session_id)
    await screen.reset(**body.model_dump())
    return ScreenAck(epoch=screen.epoch, active=screen.active)


@router.post("/activity")
async def activity(
    session_id: uuid.UUID,
    body: ScreenActivity,
    request: Request,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> ScreenAck:
    screen = await owned(request, learner, db, session_id)
    async with screen.lock:
        if (
            screen.source != body.source
            or screen.epoch != body.epoch
            or body.revision < screen.revision
            or screen.cancel_pending
        ):
            raise HTTPException(409, "Obsolete screen activity")
        # Pausing capture is independent of cancelling a spoken response.
        screen.activity_version += 1
        screen.active = body.active
        screen.revision = body.revision
        screen.frame = None
        screen.changed.set()
    return ScreenAck(epoch=screen.epoch, active=screen.active)


@router.post("/frame", status_code=201)
async def upload(
    session_id: uuid.UUID,
    request: Request,
    source: str = Query(min_length=1, max_length=200),
    epoch: int = Query(ge=1),
    revision: int = Query(ge=0),
    frame_id: str = Query(min_length=1, max_length=80),
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> ScreenAck:
    screen = await owned(request, learner, db, session_id)
    if not screen.matches(source, epoch):
        raise HTTPException(409, "Screen source is no longer shared")
    if request.headers.get("content-type", "").split(";")[0] != "image/jpeg":
        raise HTTPException(415, "Expected image/jpeg")
    # Stream with a hard bound instead of loading an arbitrary request body into memory.
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 2_000_000:
            raise HTTPException(413, "Screen image is too large")
    try:
        width, height = jpeg_dimensions(bytes(data))
    except NotJpeg:
        raise HTTPException(415, "Invalid JPEG") from None
    if width * height > 16_000_000:
        raise HTTPException(413, "Screen dimensions are too large")
    # Receipt time is authoritative: no trust in client wall-clock synchronization.
    captured_at = datetime.now(UTC)
    if screen.frame and captured_at - screen.frame.captured_at < timedelta(milliseconds=150):
        raise HTTPException(429, "Screen frames arrived too quickly")
    if not screen.put(ScreenFrame(frame_id, source, epoch, revision, captured_at, bytes(data))):
        raise HTTPException(409, "Obsolete screen frame")
    return ScreenAck(epoch=screen.epoch, active=screen.active)


@router.post("/objects")
async def objects(
    session_id: uuid.UUID,
    body: ScreenObjects,
    request: Request,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> ScreenAck:
    screen = await owned(request, learner, db, session_id)
    if sum(len(obj.points) for obj in body.objects) > 32768:
        raise HTTPException(413, "Too many drawing points")
    async with screen.lock:
        if (
            screen.source != body.source
            or screen.epoch != body.epoch
            or body.version <= screen.object_version
        ):
            raise HTTPException(409, "Obsolete screen objects")
        screen.objects = [obj.model_dump(exclude_none=True) for obj in body.objects]
        screen.object_version = body.version
        ids = {obj["id"] for obj in screen.objects}
        screen.board_items = {
            key: value for key, value in screen.board_items.items() if f"board:{key}" in ids
        }
    return ScreenAck(epoch=screen.epoch, active=screen.active)


@router.post("/result")
async def result(
    session_id: uuid.UUID,
    body: ScreenResult,
    request: Request,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> ScreenAck:
    screen = await owned(request, learner, db, session_id)
    if screen.source != body.source or screen.epoch != body.epoch:
        raise HTTPException(409, "Obsolete screen result")
    pending = screen.pending.get(body.request_id)
    if pending is not None and not pending.done():
        if not body.ok and body.reason:
            pending.set_exception(ValueError(f"Desktop rejected drawing: {body.reason}"))
        else:
            pending.set_result(body.ok)
    return ScreenAck(epoch=screen.epoch, active=screen.active)
