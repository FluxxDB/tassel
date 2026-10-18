"""Paper frames: the desktop app's uploads, their list, and their images.

Every route needs a device token, and another learner's session is "not found". An upload
holds its session row's lock while it writes the JPEGs, then the row, then the session's
activity, so seq and the rate limit can't race. If any step fails, it deletes what it wrote.
"""

import contextlib
import logging
import uuid
from datetime import timedelta
from typing import Annotated, Any

import anyio
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse
from pydantic import Json
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner
from tassel.config import Settings
from tassel.frames import repo
from tassel.frames.jpeg import NotJpeg, jpeg_dimensions
from tassel.frames.keys import FramePart, frame_key, frame_prefix
from tassel.frames.models import FrameList, FrameMeta, FrameOut
from tassel.frames.objects import ObjectStore, ObjectStoreError, get_object_store
from tassel.frames.tables import Frame
from tassel.storage import sessions_repo
from tassel.storage.db import get_db
from tassel.storage.tables import Learner

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions/{session_id}/frames", tags=["frames"])

JPEG = "image/jpeg"
# The parts of FrameMeta kept in the row's meta column; the rest have columns of their own.
_ROW_META = {"page_found", "page_quad", "crop_rect", "mask", "detector", "trigger"}


# The store's own failures, and boto's when an S3 store is down or refuses the request.
STORE_ERRORS = (ObjectStoreError, BotoCoreError, ClientError)


# For the OpenAPI schema of each route that uses the store.
STORE_UNAVAILABLE: dict[int | str, dict[str, Any]] = {
    503: {"description": "The frame store is unavailable; try again later"}
}


async def store_unavailable(request: Request, error: Exception) -> JSONResponse:
    """Answers a failed object store with a 503.

    ``create_app`` registers it for ``STORE_ERRORS``. Starlette runs such handlers inside the
    CORS middleware, so the app can read the 503 and count it as the server's trouble. An
    unhandled error would become a 500 without CORS headers, which the app sees as offline.
    """
    logger.error("The object store failed: %s %s", request.method, request.url.path, exc_info=error)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Frame storage is unavailable. Try again later."},
    )


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found")


async def _read_jpeg(part: UploadFile, name: str, limit: int) -> tuple[bytes, int, int]:
    """The part's bytes and the JPEG's size. Reads at most one byte past the limit."""
    data = await part.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"The {name} is larger than {limit} bytes",
        )
    try:
        width, height = jpeg_dimensions(data)
    except NotJpeg as error:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=f"The {name} is {error}"
        ) from None
    return data, width, height


async def _undo_upload(db: AsyncSession, store: ObjectStore, prefix: str) -> None:
    """Releases the session row, then deletes the objects a failed upload wrote.

    Shielded, so a cancelled request still cleans up. A failure here is only logged, so it
    can't hide the upload's own error.
    """
    with anyio.CancelScope(shield=True):
        with contextlib.suppress(Exception):  # the request's session closes either way
            await db.rollback()
        try:
            await store.delete_prefix(prefix)
        except Exception:
            logger.exception("Couldn't delete the objects of a failed upload, under %s", prefix)


def frame_out(frame: Frame) -> FrameOut:
    return FrameOut(
        id=frame.id,
        session_id=frame.session_id,
        seq=frame.seq,
        reason=frame.reason,
        source=frame.source,
        captured_at=frame.captured_at,
        created_at=frame.created_at,
        width=frame.width,
        height=frame.height,
        has_crop=frame.crop_key is not None,
        bytes=frame.bytes,
        page_found=frame.meta["page_found"],
        page_quad=frame.meta["page_quad"],
        crop_rect=frame.meta["crop_rect"],
        mask=frame.meta["mask"],
        # Rows from before triggers were recorded came from the detector.
        trigger=frame.meta.get("trigger", "detector"),
    )


_UPLOAD_ERRORS: dict[int | str, dict[str, Any]] = {
    404: {"description": "No such session for this learner"},
    413: {"description": "The frame or the crop is over its size limit"},
    415: {"description": "A part isn't a JPEG with a SOF0, SOF1 or SOF2 frame header"},
    429: {"description": "The session's newest frame is too recent; see Retry-After"},
    **STORE_UNAVAILABLE,
}


@router.post("", status_code=status.HTTP_201_CREATED, responses=_UPLOAD_ERRORS)
async def upload_frame(
    session_id: uuid.UUID,
    *,
    frame: Annotated[UploadFile, File(description="The whole frame, as a JPEG.")],
    crop: Annotated[
        UploadFile | None,
        File(description="The changed part of the page, as a JPEG. Ink needs it."),
    ] = None,
    meta: Annotated[Json[FrameMeta], Form(description="FrameMeta, as JSON text.")],
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
    store: ObjectStore = Depends(get_object_store),
    settings: Settings = Depends(_settings),
) -> FrameOut:
    if meta.reason == "ink" and crop is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="An ink frame needs its crop part",
        )
    full, width, height = await _read_jpeg(frame, "frame", settings.frame_max_bytes)
    cropped = None if crop is None else (await _read_jpeg(crop, "crop", settings.crop_max_bytes))[0]

    if await repo.lock_session(db, learner.id, session_id) is None:
        raise _not_found("Session")
    newest = await repo.newest(db, session_id)
    # A turn's frame is the server's own request, once a turn: it never waits out the guard.
    if (
        meta.trigger != "turn"
        and newest is not None
        and newest.age < timedelta(seconds=settings.frame_min_interval_s)
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="This session's last frame was too recent",
            headers={"Retry-After": "1"},
        )

    frame_id = uuid.uuid4()
    full_key = frame_key(learner.id, session_id, frame_id, "full")
    crop_key = None if cropped is None else frame_key(learner.id, session_id, frame_id, "crop")
    try:
        await store.put(full_key, full, JPEG)
        if cropped is not None:
            await store.put(crop_key, cropped, JPEG)
        row = await repo.insert(
            db,
            Frame(
                id=frame_id,
                session_id=session_id,
                seq=1 if newest is None else newest.seq + 1,
                reason=meta.reason,
                source=meta.source,
                captured_at=meta.captured_at,
                width=width,
                height=height,
                bytes=len(full),
                full_key=full_key,
                crop_key=crop_key,
                meta=meta.model_dump(mode="json", include=_ROW_META),
            ),
        )
        await repo.touch_session(db, session_id)
        await db.commit()
    except BaseException:
        await _undo_upload(db, store, frame_prefix(learner.id, session_id, frame_id))
        raise
    return frame_out(row)


@router.get("", responses={404: {"description": "No such session for this learner"}})
async def list_frames(
    session_id: uuid.UUID,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> FrameList:
    """The session's frames, newest first."""
    if await sessions_repo.get_for(db, learner.id, session_id) is None:
        raise _not_found("Session")
    return FrameList(items=[frame_out(row) for row in await repo.list_for(db, session_id, limit)])


@router.get(
    "/{frame_id}/image",
    response_class=Response,
    responses={
        200: {
            "description": "The JPEG",
            "content": {JPEG: {"schema": {"type": "string", "format": "binary"}}},
        },
        404: {"description": "No such frame, no crop, or no stored image"},
        **STORE_UNAVAILABLE,
    },
)
async def frame_image(
    session_id: uuid.UUID,
    frame_id: uuid.UUID,
    part: FramePart,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
    store: ObjectStore = Depends(get_object_store),
) -> Response:
    """The frame's full JPEG or its crop, served by the API rather than a signed URL."""
    row = await repo.get_for(db, learner.id, session_id, frame_id)
    if row is None:
        raise _not_found("Frame")
    key = row.full_key if part == "full" else row.crop_key
    if key is None:
        raise _not_found("Crop")
    data = await store.get(key)
    if data is None:
        raise _not_found("Image")
    return Response(content=data, media_type=JPEG, headers={"Cache-Control": "private, no-store"})


@router.get(
    "/{frame_id}/page",
    response_class=Response,
    responses={
        200: {
            "description": "The unmarked flattened page JPEG",
            "content": {JPEG: {"schema": {"type": "string", "format": "binary"}}},
        },
        404: {"description": "No such frame, stored image, or detected page"},
        **STORE_UNAVAILABLE,
    },
)
async def frame_page(
    session_id: uuid.UUID,
    frame_id: uuid.UUID,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
    store: ObjectStore = Depends(get_object_store),
) -> Response:
    """The exact page used by the per-turn image helper, without its model-only numbers."""
    from tassel.vision.turn_image import page_view_for_frame

    row = await repo.get_for(db, learner.id, session_id, frame_id)
    if row is None:
        raise _not_found("Frame")
    view = await page_view_for_frame(row, store=store)
    if view is None:
        raise _not_found("Page")
    return Response(
        content=view.page_jpeg, media_type=JPEG, headers={"Cache-Control": "private, no-store"}
    )
