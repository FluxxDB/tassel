"""Small explicit style preferences, combined consistently with the tutor's core instructions."""

from dataclasses import dataclass
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, update
from sqlalchemy.dialects.postgresql import insert

from tassel.learner_memory import MemoryOut, memory_instruction, read_memory
from tassel.models import Lang
from tassel.storage.tables import LearnerPersonalization
from tassel.voice.prompts import system_prompt

MAX_STYLE_CHARS = 2000


class PersonalizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    enabled: bool = True
    content: str = ""
    revision: int = 0


class PersonalizationPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    content: str = Field(max_length=MAX_STYLE_CHARS)
    revision: int = Field(ge=0)


async def read_personalization(db, learner_id: UUID) -> PersonalizationOut:
    row = await db.get(LearnerPersonalization, learner_id)
    return PersonalizationOut.model_validate(row) if row else PersonalizationOut()


async def save_personalization(db, learner_id: UUID, patch: PersonalizationPatch):
    await db.execute(
        insert(LearnerPersonalization).values(learner_id=learner_id).on_conflict_do_nothing()
    )
    row = await db.scalar(
        update(LearnerPersonalization)
        .where(
            LearnerPersonalization.learner_id == learner_id,
            LearnerPersonalization.revision == patch.revision,
        )
        .values(
            enabled=patch.enabled,
            content=patch.content.strip(),
            revision=LearnerPersonalization.revision + 1,
            updated_at=func.now(),
        )
        .returning(LearnerPersonalization)
        .execution_options(populate_existing=True)
    )
    await db.commit()
    return PersonalizationOut.model_validate(row) if row else None


@dataclass(frozen=True)
class TutorPreferences:
    personalization: PersonalizationOut
    memory: MemoryOut

    @property
    def ideal_tutor(self) -> str:
        return self.personalization.content if self.personalization.enabled else ""

    @property
    def notes(self) -> str:
        return memory_instruction(self.memory)

    def talker_prompt(self, lang: Lang, *, tools: bool, two_tier: bool) -> str:
        return (
            system_prompt(lang, tools=tools, two_tier=two_tier, ideal_tutor=self.ideal_tutor)
            + self.notes
        )


async def read_tutor_preferences(db, learner_id: UUID) -> TutorPreferences:
    return TutorPreferences(
        await read_personalization(db, learner_id), await read_memory(db, learner_id)
    )
