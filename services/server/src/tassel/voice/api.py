"""Authenticated WebRTC signaling. Provider credentials never enter this contract."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner
from tassel.storage import sessions_repo
from tassel.storage.db import get_db
from tassel.storage.tables import Learner
from tassel.voice.messages import ICE_SERVERS_ROUTE, OFFER_ROUTE, OfferRequestData
from tassel.voice.settings import VoiceConfigError


class OfferBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    sdp: str
    type: Literal["offer"]
    pc_id: str | None = None
    restart_pc: bool | None = None
    request_data: OfferRequestData | None = Field(None, alias="requestData")


class OfferAnswer(BaseModel):
    sdp: str
    type: str
    pc_id: str


class IceCandidateIn(BaseModel):
    candidate: str
    sdp_mid: str
    sdp_mline_index: int


class IcePatch(BaseModel):
    pc_id: str
    candidates: list[IceCandidateIn]


class IceServerOut(BaseModel):
    urls: list[str]
    username: str | None = None
    credential: str | None = None


class IceServersOut(BaseModel):
    ice_servers: list[IceServerOut]


router = APIRouter(tags=["voice"])


async def _owned_session(db, learner_id, session_id):
    session = await sessions_repo.get_for(db, learner_id, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post(
    OFFER_ROUTE,
    responses={
        404: {"description": "Session not found"},
        409: {"description": "Peer connection ended or unknown"},
        503: {"description": "Voice unavailable"},
    },
)
async def offer(
    session_id: UUID,
    body: OfferBody,
    request: Request,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> OfferAnswer:
    from tassel.voice.registry import VoiceConflict

    session = await _owned_session(db, learner.id, session_id)
    try:
        return await request.app.state.voice.offer(
            learner_id=learner.id, session=session, body=body
        )
    except VoiceConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except VoiceConfigError as error:
        raise HTTPException(status_code=503, detail=str(error)) from None


@router.patch(
    OFFER_ROUTE,
    status_code=204,
    responses={404: {"description": "Session or peer connection not found"}},
)
async def patch_ice(
    session_id: UUID,
    body: IcePatch,
    request: Request,
    learner: Learner = Depends(current_learner),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _owned_session(db, learner.id, session_id)
    await request.app.state.voice.patch(learner_id=learner.id, session_id=session_id, patch=body)
    return Response(status_code=204)


@router.get(ICE_SERVERS_ROUTE)
async def ice_servers(
    request: Request, learner: Learner = Depends(current_learner)
) -> IceServersOut:
    return IceServersOut(
        ice_servers=[
            IceServerOut(
                urls=server.urls,
                username=server.username,
                credential=server.credential.get_secret_value() if server.credential else None,
            )
            for server in request.app.state.voice_settings.ice_servers
        ]
    )
