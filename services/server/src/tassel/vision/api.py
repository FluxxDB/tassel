"""Authenticated snapshots and structured board edits. Paper uploads use frames/api.py."""

import base64
import binascii
from uuid import UUID

import cv2
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner
from tassel.domains.dfa.contract import DfaReading
from tassel.storage import sessions_repo
from tassel.storage.db import get_db
from tassel.storage.tables import Learner
from tassel.vision.orchestrator import VisionSession, VisionSnapshot
from tassel.vision.page import decode_jpeg
from tassel.vision.registry import VisionRegistry

BOARD_IMAGE_MAX_BYTES = 2 * 1024 * 1024
router = APIRouter(prefix="/sessions/{session_id}/vision", tags=["vision"])


class BoardEditIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reading: DfaReading
    image_png: str | None


def _vision(request: Request) -> VisionRegistry:
    registry = getattr(request.app.state, "vision", None)
    if registry is None:
        raise HTTPException(503, "Vision is unavailable")
    return registry


async def _session(
    session_id: UUID,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
    registry: VisionRegistry = Depends(_vision),
) -> VisionSession:
    row = await sessions_repo.get_for(db, learner.id, session_id)
    if row is None:
        raise HTTPException(404, "Session not found")
    return registry.session(learner_id=learner.id, session_id=session_id, lang=row.language)


@router.get("")
async def snapshot(session: VisionSession = Depends(_session)) -> VisionSnapshot:
    return session.snapshot()


@router.post("/board", status_code=202, responses={413: {"description": "Image exceeds 2 MiB"}})
async def board(edit: BoardEditIn, session: VisionSession = Depends(_session)) -> Response:
    image = None
    if edit.image_png is not None:
        if len(edit.image_png) > 4 * ((BOARD_IMAGE_MAX_BYTES + 2) // 3):
            raise HTTPException(413, "Board image exceeds 2 MiB")
        try:
            image = base64.b64decode(edit.image_png, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(422, "Invalid base64 PNG") from None
        if len(image) > BOARD_IMAGE_MAX_BYTES:
            raise HTTPException(413, "Board image exceeds 2 MiB")
        try:
            if not image.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("not PNG")
            await session._cpu(decode_jpeg, image)
        except (ValueError, cv2.error):
            raise HTTPException(422, "Invalid PNG image") from None
    session.on_board_edit(edit.reading, image)
    return Response(status_code=202)
