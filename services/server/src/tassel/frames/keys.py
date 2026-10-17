"""Object keys for frame images. They nest by learner and session, so either can be deleted by
prefix."""

import uuid
from typing import Literal

FramePart = Literal["full", "crop"]


def session_prefix(learner_id: uuid.UUID, session_id: uuid.UUID) -> str:
    return f"learners/{learner_id}/sessions/{session_id}/"


def frame_prefix(learner_id: uuid.UUID, session_id: uuid.UUID, frame_id: uuid.UUID) -> str:
    return f"{session_prefix(learner_id, session_id)}frames/{frame_id}/"


def frame_key(
    learner_id: uuid.UUID, session_id: uuid.UUID, frame_id: uuid.UUID, part: FramePart
) -> str:
    return f"{frame_prefix(learner_id, session_id, frame_id)}{part}.jpg"
