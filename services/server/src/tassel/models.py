"""The session model shared by the API and the tables. The app's TypeScript types come from it."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SessionType = Literal["homework", "studying", "research", "other"]
Lang = Literal["en", "es", "ko"]
Source = Literal["paper", "screen", "talk"]
TitleSource = Literal["ai", "student"]
SessionSort = Literal["recent", "created", "topic"]


class SessionCreate(BaseModel):
    type: SessionType
    language: Lang
    source: Source


class SessionPatch(BaseModel):
    """Changes only the fields that are sent. ``null`` clears the title or the subject."""

    model_config = ConfigDict(str_strip_whitespace=True)

    title: str | None = Field(None, min_length=1, max_length=80)
    subject: str | None = Field(None, max_length=40)
    type: SessionType | None = None
    language: Lang | None = None

    @field_validator("subject")
    @classmethod
    def _blank_subject_is_none(cls, subject: str | None) -> str | None:
        return subject or None

    @model_validator(mode="after")
    def _type_and_language_are_never_null(self) -> "SessionPatch":
        for name in ("type", "language"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None
    title_source: TitleSource | None
    subject: str | None
    type: SessionType
    language: Lang
    source: Source
    created_at: datetime
    last_activity_at: datetime


class SessionList(BaseModel):
    items: list[SessionOut]
