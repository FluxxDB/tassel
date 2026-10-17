"""Liveness check. It needs no auth, so the app can probe the server before registering."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from tassel import __version__

router = APIRouter(tags=["health"])


class HealthOut(BaseModel):
    status: Literal["ok"]
    version: str


@router.get("/health")
async def health() -> HealthOut:
    return HealthOut(status="ok", version=__version__)
