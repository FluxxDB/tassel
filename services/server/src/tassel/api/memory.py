"""Authenticated learner memory and explicit end-of-visit extraction."""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner
from tassel.learner_memory import (
    MemoryOut,
    MemoryPatch,
    claim_extraction,
    read_memory,
    save_memory,
    transcript_text,
    update_after_session,
)
from tassel.learner_personalization import (
    PersonalizationOut,
    PersonalizationPatch,
    read_personalization,
    save_personalization,
)
from tassel.storage import sessions_repo
from tassel.storage.db import get_db
from tassel.storage.tables import Learner

router = APIRouter(tags=["memory"])


@router.get("/learner/memory")
async def get_memory(
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> MemoryOut:
    return await read_memory(db, learner.id)


@router.patch(
    "/learner/memory", responses={409: {"description": "Memory changed; reload before saving"}}
)
async def patch_memory(
    body: MemoryPatch,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> MemoryOut:
    result = await save_memory(db, learner.id, body)
    if result is None:
        raise HTTPException(409, "Memory changed; reload before saving")
    return result


@router.post("/sessions/{session_id}/memory", status_code=204)
async def finish_memory(
    session_id: UUID,
    request: Request,
    background: BackgroundTasks,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if await sessions_repo.get_for(db, learner.id, session_id) is None:
        raise HTTPException(404, "Session not found")
    await request.app.state.voice.finish(learner.id, session_id)
    messages, _ = request.app.state.voice.memory.recall(session_id)
    transcript = transcript_text(messages)
    snapshot = await claim_extraction(db, learner.id, session_id, transcript)
    if snapshot is not None:
        background.add_task(
            update_after_session,
            request.app.state.session_factory,
            request.app.state.voice_settings,
            learner.id,
            snapshot,
            transcript,
        )
    return Response(status_code=204)


@router.get("/learner/personalization")
async def get_personalization(
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> PersonalizationOut:
    return await read_personalization(db, learner.id)


@router.patch(
    "/learner/personalization",
    responses={409: {"description": "Tutor style changed; reload before saving"}},
)
async def patch_personalization(
    body: PersonalizationPatch,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> PersonalizationOut:
    result = await save_personalization(db, learner.id, body)
    if result is None:
        raise HTTPException(409, "Tutor style changed; reload before saving")
    return result
