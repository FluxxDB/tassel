"""Authenticated, ephemeral renderer snapshots for board reasoning."""

import base64
import binascii
import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner
from tassel.storage import sessions_repo
from tassel.storage.db import get_db
from tassel.storage.tables import Learner

router = APIRouter(prefix="/sessions", tags=["board"])
MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024


class BoardSnapshotUpload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    image_png: str


@router.post("/{session_id}/board/snapshot", status_code=204)
async def upload_snapshot(
    session_id: uuid.UUID,
    body: BoardSnapshotUpload,
    request: Request,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> None:
    if await sessions_repo.get_for(db, learner.id, session_id) is None:
        raise HTTPException(404, "Session not found")
    if len(body.image_png) > 4 * ((MAX_SNAPSHOT_BYTES + 2) // 3):
        raise HTTPException(413, "Board snapshot exceeds 2 MiB")
    try:
        png = base64.b64decode(body.image_png, validate=True)
    except (ValueError, binascii.Error) as error:
        raise HTTPException(422, "Invalid base64 PNG") from error
    if len(png) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "Board snapshot exceeds 2 MiB")
    try:
        with Image.open(io.BytesIO(png)) as image:
            if image.format != "PNG":
                raise ValueError("Not a PNG")
            image.verify()
    except (
        ValueError,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
    ) as error:
        raise HTTPException(422, "Invalid PNG") from error
    request.app.state.board_snapshots.put(session_id, png)
