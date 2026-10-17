"""Device tokens, and the ``current_learner`` dependency that checks them.

A token is shown once, when its device registers. The server keeps only its SHA-256 hex.
"""

import hashlib
import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from tassel.storage.db import get_db
from tassel.storage.tables import Device, Learner

# Declares the bearer scheme in OpenAPI and parses the header (scheme in any case).
# auto_error=False: current_learner raises one 401 for every kind of bad token.
_device_token = HTTPBearer(
    scheme_name="DeviceToken",
    description="The token from POST /v1/devices.",
    auto_error=False,
)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid device token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def current_learner(
    credentials: HTTPAuthorizationCredentials | None = Depends(_device_token),
    db: AsyncSession = Depends(get_db),
) -> Learner:
    """The learner who owns the request's device token. Also records the device as seen."""
    if credentials is None:  # no header, an empty token, or a scheme other than Bearer
        raise _unauthorized()
    learner_id = await db.scalar(
        update(Device)
        .where(Device.token_hash == hash_token(credentials.credentials))
        .values(last_seen_at=func.now())
        .returning(Device.learner_id)
    )
    if learner_id is None:
        raise _unauthorized()
    learner = await db.get_one(Learner, learner_id)
    await db.commit()
    return learner
