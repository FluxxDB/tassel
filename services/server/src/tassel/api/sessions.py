"""Tutoring sessions. Every route needs a device token, and a learner only sees their own."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner
from tassel.frames import repo as frames_repo
from tassel.frames.api import STORE_UNAVAILABLE
from tassel.frames.keys import session_prefix
from tassel.frames.objects import ObjectStore, get_object_store
from tassel.models import SessionCreate, SessionList, SessionOut, SessionPatch, SessionSort
from tassel.storage import sessions_repo
from tassel.storage.db import get_db
from tassel.storage.tables import Learner

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _not_found() -> HTTPException:
    # Another learner's session is "not found" too, so ids can't be probed.
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_session(
    new: SessionCreate,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    return SessionOut.model_validate(await sessions_repo.create(db, learner.id, new))


@router.get("")
async def list_sessions(
    sort: SessionSort = "recent",
    q: str | None = None,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> SessionList:
    found = await sessions_repo.list_for(db, learner.id, sort, q.strip() if q else None)
    return SessionList(items=[SessionOut.model_validate(session) for session in found])


@router.get("/{session_id}")
async def get_session(
    session_id: uuid.UUID,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    session = await sessions_repo.get_for(db, learner.id, session_id)
    if session is None:
        raise _not_found()
    return SessionOut.model_validate(session)


@router.patch("/{session_id}")
async def patch_session(
    session_id: uuid.UUID,
    patch: SessionPatch,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    session = await sessions_repo.patch_for(db, learner.id, session_id, patch)
    if session is None:
        raise _not_found()
    return SessionOut.model_validate(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT, responses=STORE_UNAVAILABLE)
async def delete_session(
    session_id: uuid.UUID,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
    store: ObjectStore = Depends(get_object_store),
) -> None:
    """Deletes the session's frame images first, then the session, whose frame rows cascade."""
    # Locked until the delete commits, so no upload can add a frame in between.
    if await frames_repo.lock_session(db, learner.id, session_id) is None:
        raise _not_found()
    if await frames_repo.has_frames(db, session_id):
        # If any image survives, this raises and the rows stay, so deleting again can retry.
        await store.delete_prefix(session_prefix(learner.id, session_id))
    if not await sessions_repo.delete_for(db, learner.id, session_id):
        raise _not_found()
