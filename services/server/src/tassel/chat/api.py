"""The chat sidebar's REST surface: images the student sends, and the saved conversation.

The live conversation travels as ``message`` server events (``tassel.voice.messages``); these
routes upload a student's image before its ``student-message`` event, serve it back, and return
a session's saved conversation when the app reopens it.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from tassel.auth import current_learner
from tassel.storage.tables import Learner
from tassel.voice.messages import MessageAction, MessageAttachment

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


@router.post("/{session_id}/attachments", status_code=201, response_model=AttachmentOut)
async def upload_attachment(
    session_id: uuid.UUID,
    image: UploadFile | None = File(None),
    frame_id: uuid.UUID | None = None,
    learner: Learner = Depends(current_learner),
) -> AttachmentOut:
    """A JPEG or PNG the student sends (8 MiB at most), or ``frame_id``: her latest paper frame
    ("Snap my paper"). Stored downscaled to 2048 px on the long side."""
    raise HTTPException(501, "Attachments are not implemented yet")


@router.get(
    "/{session_id}/attachments/{attachment_id}",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}, "image/png": {}}}},
)
async def get_attachment(
    session_id: uuid.UUID,
    attachment_id: uuid.UUID,
    learner: Learner = Depends(current_learner),
) -> Response:
    raise HTTPException(501, "Attachments are not implemented yet")


@router.get("/{session_id}/messages", response_model=ChatHistoryOut)
async def list_messages(
    session_id: uuid.UUID,
    learner: Learner = Depends(current_learner),
) -> ChatHistoryOut:
    """The session's saved conversation, oldest first."""
    raise HTTPException(501, "Chat history is not implemented yet")
