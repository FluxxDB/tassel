"""Authenticated ephemeral screen control and JPEG ingestion; never the paper uploader."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
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


class ScreenAck(BaseModel):
    epoch: int
    active: bool


class ScreenPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class ScreenDrawing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frame_id: str = Field(max_length=80)
    kind: Literal["pointer", "circle", "underline", "arrow"]
    points: list[ScreenPoint] = Field(min_length=1, max_length=2)


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
