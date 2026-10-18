"""The chat sidebar's REST surface: images the student sends, and the saved conversation.

The live conversation travels as ``message`` server events (``tassel.voice.messages``); these
routes upload a student's image before its ``student-message`` event, serve it back, and return
a session's saved conversation when the app reopens it. Another learner's session or image is
"not found".
"""

import contextlib
import logging
import uuid
from datetime import datetime
from typing import Any, Literal

import anyio
import anyio.to_thread
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner
from tassel.chat import repo
from tassel.chat.images import PreparedImage, UnsupportedImage, prepare
from tassel.chat.store import attachment_key
from tassel.chat.tables import SessionAttachment
from tassel.frames import repo as frames_repo
from tassel.frames.api import STORE_UNAVAILABLE
from tassel.frames.objects import ObjectStore, get_object_store
from tassel.storage import sessions_repo
from tassel.storage.db import get_db
from tassel.storage.tables import Learner
from tassel.voice.messages import MessageAction, MessageAttachment

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["chat"])

ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024


class AttachmentOut(MessageAttachment):
    """An uploaded image: its id for ``student-message`` and its stored size in pixels."""


class ChatMessageOut(BaseModel):
    """A saved line of the conversation, as the ``message`` event carried it when final."""

    model_config = ConfigDict(extra="forbid")
    id: str
    client_id: str | None
    role: str
    source: str | None
    text: str
    interrupted: bool
    attachments: list[MessageAttachment]
    action: MessageAction | None
    created_at: datetime


class ChatHistoryOut(BaseModel):
    messages: list[ChatMessageOut]


class ElementBoxOut(BaseModel):
    x: float
    y: float
    w: float
    h: float


class ImageElementOut(BaseModel):
    id: str
    kind: Literal["circle", "label"]
    box: ElementBoxOut


class ImageElementsOut(BaseModel):
    """An image's Set-of-Mark: the beats ``DetectedElements`` shape, in the image's pixels."""

    width: int
    height: int
    items: list[ImageElementOut]


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found")


async def _owned(db: AsyncSession, learner: Learner, session_id: uuid.UUID) -> None:
    if await sessions_repo.get_for(db, learner.id, session_id) is None:
        raise _not_found("Session")


async def _prepared(data: bytes) -> PreparedImage:
    try:
        # Decoding and resizing must not block voice and WebSocket IO.
        return await anyio.to_thread.run_sync(prepare, data)
    except UnsupportedImage as error:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=f"The image is {error}"
        ) from None


async def _sent_image(image: UploadFile) -> PreparedImage:
    data = await image.read(ATTACHMENT_MAX_BYTES + 1)
    if len(data) > ATTACHMENT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"The image is larger than {ATTACHMENT_MAX_BYTES} bytes",
        )
    return await _prepared(data)


async def _snapped_paper(
    db: AsyncSession, store: ObjectStore, learner: Learner, session_id: uuid.UUID, frame_id
) -> PreparedImage:
    """Her paper frame as the turn image sees it: the flattened page (the whole frame when no
    page was found), without the model's candidate numbers."""
    from tassel.vision.turn_image import page_view_for_frame

    row = await frames_repo.get_for(db, learner.id, session_id, frame_id)
    if row is None:
        raise _not_found("Frame")
    view = await page_view_for_frame(row, store=store)
    if view is None:
        raise _not_found("Frame image")
    return await _prepared(view.page_jpeg)


_UPLOAD_ERRORS: dict[int | str, dict[str, Any]] = {
    404: {"description": "No such session, or frame, for this learner"},
    413: {"description": "The image is over 8 MiB"},
    415: {"description": "The image isn't a JPEG, PNG or WebP that decodes"},
    **STORE_UNAVAILABLE,
}


@router.post(
    "/{session_id}/attachments",
    status_code=201,
    response_model=AttachmentOut,
    responses=_UPLOAD_ERRORS,
)
async def upload_attachment(
    session_id: uuid.UUID,
    image: UploadFile | None = File(None),
    frame_id: uuid.UUID | None = None,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
    store: ObjectStore = Depends(get_object_store),
) -> AttachmentOut:
    """A JPEG or PNG the student sends (8 MiB at most), or ``frame_id``: her latest paper frame
    ("Snap my paper"). Stored downscaled to 2048 px on the long side."""
    if (image is None) == (frame_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Send exactly one of image or frame_id",
        )
    await _owned(db, learner, session_id)
    if image is not None:
        prepared = await _sent_image(image)
    else:
        prepared = await _snapped_paper(db, store, learner, session_id, frame_id)
    attachment_id = uuid.uuid4()
    key = attachment_key(learner.id, session_id, attachment_id, prepared.mime)
    try:
        await store.put(key, prepared.data, prepared.mime)
        await repo.insert_attachment(
            db,
            SessionAttachment(
                id=attachment_id,
                session_id=session_id,
                object_key=key,
                mime=prepared.mime,
                width=prepared.width,
                height=prepared.height,
            ),
        )
        await db.commit()
    except BaseException:
        with anyio.CancelScope(shield=True):
            with contextlib.suppress(Exception):
                await db.rollback()
            try:
                await store.delete_prefix(key)
            except Exception:
                logger.exception("Couldn't delete the image of a failed upload, %s", key)
        raise
    return AttachmentOut(id=str(attachment_id), w=prepared.width, h=prepared.height)


@router.get(
    "/{session_id}/attachments/{attachment_id}",
    response_class=Response,
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}}},
        404: {"description": "No such image for this learner"},
        **STORE_UNAVAILABLE,
    },
)
async def get_attachment(
    session_id: uuid.UUID,
    attachment_id: uuid.UUID,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
    store: ObjectStore = Depends(get_object_store),
) -> Response:
    row = await repo.attachment_for(db, learner.id, session_id, attachment_id)
    if row is None:
        raise _not_found("Attachment")
    data = await store.get(row.object_key)
    if data is None:
        raise _not_found("Image")
    return Response(
        content=data, media_type=row.mime, headers={"Cache-Control": "private, no-store"}
    )


@router.get(
    "/{session_id}/attachments/{attachment_id}/elements",
    response_model=ImageElementsOut,
    responses={404: {"description": "No such image for this learner"}, **STORE_UNAVAILABLE},
)
async def get_attachment_elements(
    session_id: uuid.UUID,
    attachment_id: uuid.UUID,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
    store: ObjectStore = Depends(get_object_store),
) -> Response:
    """The image's numbered Set-of-Mark boxes in its own pixels: the markers Ada's marks on it
    name (``image.mark`` with ``el: mN``), the same ones she was shown."""
    from tassel.chat.student_image import detected_elements, view_of

    row = await repo.attachment_for(db, learner.id, session_id, attachment_id)
    if row is None:
        raise _not_found("Attachment")
    data = await store.get(row.object_key)
    if data is None:
        raise _not_found("Image")
    view = await view_of(str(row.id), data)
    if view is None:
        raise _not_found("Image")
    return Response(
        content=detected_elements(view).model_dump_json(by_alias=True),
        media_type="application/json",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get(
    "/{session_id}/messages",
    response_model=ChatHistoryOut,
    responses={404: {"description": "No such session for this learner"}},
)
async def list_messages(
    session_id: uuid.UUID,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> ChatHistoryOut:
    """The session's saved conversation, oldest first."""
    await _owned(db, learner, session_id)
    rows = await repo.messages_for(db, session_id)
    wanted = {uuid.UUID(i) for row in rows for i in row.attachment_ids}
    sizes = {
        str(a.id): MessageAttachment(id=str(a.id), w=a.width, h=a.height)
        for a in await repo.attachments_for(db, learner.id, session_id, list(wanted))
    }
    return ChatHistoryOut(
        messages=[
            ChatMessageOut(
                id=str(row.id),
                client_id=row.client_id,
                role=row.role,
                source=row.source,
                text=row.text,
                interrupted=row.interrupted,
                attachments=[sizes[i] for i in row.attachment_ids if i in sizes],
                action=MessageAction.model_validate(row.action) if row.action else None,
                created_at=row.created_at,
            )
            for row in rows
        ]
    )
