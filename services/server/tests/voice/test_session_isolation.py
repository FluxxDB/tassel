"""Nothing but preferences carries between sessions: the memory keeps tone, pace, language and
hint style and never a topic, value or answer; the greeting renders no memory at all; the
prompts' worked examples hold placeholders, never values Ada could copy; and a request to draw
"problem two" with no page in sight asks to see it. Fake providers only."""

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_retest8_fixes import decision
from test_two_tier import brief as base_brief

from tassel.beats.markup import BoardContext
from tassel.learner_memory import (
    EXTRACTION_INSTRUCTION,
    MemoryOut,
    memory_instruction,
    preference_lines,
)
from tassel.voice import illustrator, prompts
from tassel.voice.memory import ConversationMemory
from tassel.voice.settings import VoiceSettings
from tassel.voice.thinker import SEE_PAGE, TutorCoordinator

LEAKY_DOCUMENT = """# Preferences
- Prefers one hint at a time, never the full answer.
- Likes a slow pace and short explanations.
- Prefers Spanish for explanations.
# Topics
- Worked on subnetting a 10.0.0.0/24 office network.
- Built a DFA for strings ending in 01; q3 should accept.
Ongoing topic: subnetting 10.0.0.0/24 for an office network.
- Struggles with broadcast addresses (saw it once).
"""


def test_preference_lines_keep_how_she_likes_to_be_taught_and_drop_content():
    kept = preference_lines(LEAKY_DOCUMENT)
    assert kept == [
        "Prefers one hint at a time, never the full answer.",
        "Likes a slow pace and short explanations.",
        "Prefers Spanish for explanations.",
    ]
    assert "10.0.0.0/24" not in "\n".join(kept)
    assert preference_lines("") == []


def test_the_rendered_memory_is_preferences_and_never_invites_a_recap():
    text = memory_instruction(
        MemoryOut(enabled=True, content="Prefers one hint at a time.", revision=1)
    )
    assert "Prefers one hint at a time." in text
    assert "Learner preferences" in text
    assert "last time" not in text.lower() or "never" in text.lower()
    assert "From earlier sessions" not in text
    assert "earlier session" in text.lower()  # the rule that none is mentioned
    assert memory_instruction(MemoryOut(enabled=False, content="x", revision=1)) == ""


def test_the_extraction_prompt_records_preferences_only():
    low = EXTRACTION_INSTRUCTION.lower()
    assert "10.0.0.0" not in EXTRACTION_INSTRUCTION
    assert "ongoing topics" not in low
    assert "preference" in low and "never" in low and "topic" in low


@pytest.mark.asyncio
async def test_extracted_notes_are_filtered_to_preference_lines(monkeypatch):
    from tassel import learner_memory

    class Response:
        choices = [
            SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=LEAKY_DOCUMENT))
        ]

    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        async def create(self, **kwargs):
            return Response()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            pass

    monkeypatch.setattr(learner_memory, "AsyncOpenAI", Client)
    settings = VoiceSettings(providers="live", llm_provider="openai", openai_api_key="sk-test")
    result = await learner_memory.extract_notes(settings, "", "user: hi\nassistant: hello")
    assert result == (
        "Prefers one hint at a time, never the full answer.\n"
        "Likes a slow pace and short explanations.\n"
        "Prefers Spanish for explanations."
    )


def test_worked_examples_hold_placeholders_and_the_rule_not_to_copy_them():
    illustrator_prompt = illustrator.SYSTEM
    thinker_prompt = prompts.thinker_system_prompt({"type": "object"})
    for text in (illustrator_prompt, thinker_prompt):
        assert "10.0.0" not in text and "192.168" not in text
        assert "never copy" in text.lower()
    assert "{{" in json.dumps(illustrator.EXAMPLES) or "<" in json.dumps(illustrator.EXAMPLES)


def test_conversation_memory_is_keyed_per_session():
    memory = ConversationMemory()
    first, second = uuid4(), uuid4()
    memory.remember(first, [{"role": "user", "content": "10.0.0.0/24"}], "en")
    assert memory.recall(second) == ([], None)
    assert memory.recall(first)[0] == [{"role": "user", "content": "10.0.0.0/24"}]


class ScriptedThinker:
    def __init__(self, *briefs):
        self.briefs = list(briefs)
        self.learner_notes = ""
        self.settings = VoiceSettings()

    async def think(self, messages, effort=None):
        return self.briefs.pop(0)

    async def close(self):
        pass


class SpyIllustrator:
    def __init__(self):
        self.intents = []

    async def draw(self, intent, board_items, lang):
        self.intents.append(intent)
        return None

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_designing_from_problem_two_without_a_page_asks_to_see_it():
    thinker = ScriptedThinker(
        base_brief().model_copy(
            update={
                "page": "",
                "intent": "draw network zones",
                "say": "Each subnet gets its own router.",
                "draw": "3 zones with routers and PCs",
            }
        )
    )
    events = []
    c = TutorCoordinator(
        thinker,
        BoardContext(),
        transcript=SimpleNamespace(record=lambda e, d: events.append((e, d))),
    )
    spy = SpyIllustrator()
    c.illustrator = spy
    text = "Design a network based on problem two."
    await c.prepare(
        LLMContext([{"role": "user", "content": text}]),
        text,
        decision=decision(
            action="draw_board", focus="board", refers_to="board", needs_vision=False
        ),
    )
    result = await c.result()
    assert result.draw in (None, "")
    assert result.say == SEE_PAGE["en"]
    assert spy.intents == []
    assert any(e == "needs_page" for e, _ in events)
    await c.close()


@pytest.mark.asyncio
async def test_designing_from_problem_two_with_the_page_draws():
    thinker = ScriptedThinker(
        base_brief().model_copy(
            update={"page": "Problem 2: three zones", "draw": "3 zones from problem two"}
        )
    )
    c = TutorCoordinator(
        thinker, BoardContext(), transcript=SimpleNamespace(record=lambda *a: None)
    )
    spy = SpyIllustrator()
    c.illustrator = spy

    async def page():
        return b"jpeg", "problem two"

    text = "Design a network based on problem two."
    await c.prepare(
        LLMContext([{"role": "user", "content": text}]),
        text,
        decision=decision(action="draw_board", focus="board", refers_to="board"),
        page=page,
    )
    result = await c.result()
    assert result.draw == "3 zones from problem two"
    await c.close()


def test_the_greeting_turn_renders_no_memory():
    """Three live sessions opened with "Welcome back! Ready to dive back into subnetting?": the
    memory refresh ran before the greeting too. Before her first turn there are no notes."""
    from tassel.voice.bot import is_greeting_turn, talker_instruction

    notes = '\nLearner preferences: ["Prefers one hint at a time."]'
    assert is_greeting_turn([])
    assert is_greeting_turn([{"role": "system", "content": "rules"}])
    assert is_greeting_turn([{"role": "user", "content": "[note] The app switched the view."}])
    assert not is_greeting_turn([{"role": "user", "content": "Hi Ada."}])
    greeting = talker_instruction("en", tools=True, two_tier=True, notes=notes, greeting=True)
    assert "Prefers one hint" not in greeting
    later = talker_instruction("en", tools=True, two_tier=True, notes=notes)
    assert later.endswith(notes)
