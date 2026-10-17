"""Device registration, and ``GET /v1/me`` to check a token."""

import uuid

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.auth import current_learner, hash_token, new_token
from tassel.models import Lang
from tassel.storage.db import get_db
from tassel.storage.tables import Device, Learner

router = APIRouter(tags=["devices"])


class DeviceRegistration(BaseModel):
    device_id: uuid.UUID
    token: str


class MeOut(BaseModel):
    learner_id: uuid.UUID
    ui_language: Lang


@router.post("/devices", status_code=status.HTTP_201_CREATED)
async def register_device(db: AsyncSession = Depends(get_db)) -> DeviceRegistration:
    """Creates a learner and their device. The token in the response is never shown again."""
    token = new_token()
    learner = Learner()
    db.add(learner)
    await db.flush()
    device = Device(learner_id=learner.id, token_hash=hash_token(token))
    db.add(device)
    await db.commit()
    return DeviceRegistration(device_id=device.id, token=token)


@router.get("/me")
async def me(learner: Learner = Depends(current_learner)) -> MeOut:
    return MeOut(learner_id=learner.id, ui_language=learner.ui_language)
