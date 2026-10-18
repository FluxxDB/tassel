"""Facts from earlier sessions never pass for the page in front of her (live session 3d8b1d78:
the memory's 10.0.0.0/24 became the thinker's page read and the Pointer's target over a paper
that said 192.168.1.0/24). Fake providers only."""

import json
from types import SimpleNamespace

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext
from test_pointer_marks import Client
from test_retest8_fixes import decision
from test_two_tier import brief as base_brief

from tassel.beats.markup import BoardContext
from tassel.learner_memory import MemoryOut, memory_instruction
from tassel.voice import thinker
from tassel.voice.pointer import Pointer
from tassel.voice.settings import VoiceSettings
from tassel.voice.thinker import Thinker, TutorCoordinator

MEMORY = memory_instruction(
    MemoryOut(
        enabled=True,
        content="Ongoing topic: subnetting 10.0.0.0/24 for an office network.",
        revision=2,
    )
)
FIRST_READ = "Problem 2: 192.168.1.0/24; subnet mask 255.255.255.128; 64 usable addresses."
LEAKED_READ = "Problem 2 shows “10.0.0.0/24” and a subnet mask; m1 is the handwritten IP address."
LEAKED_TARGET = "the handwritten IP address 10.0.0.0/24"
UNDERLINE_LEAKED = [thinker.MarkIntent(verb="underline", target=LEAKED_TARGET)]
DESCRIBED = "Problem two says 192.168.1.0/24, mask 255.255.255.128, and 64 usable addresses."
MARKED = "I'll underline the IP address in Problem 2."


def brief(**changes):
    return base_brief().model_copy(update=changes)


class ScriptedThinker:
    """Returns its briefs in order; carries the learner memory like the live Thinker."""

    def __init__(self, *briefs):
        self.briefs = list(briefs)
        self.learner_notes = MEMORY
        self.settings = VoiceSettings()

    async def think(self, messages, effort=None):
        return self.briefs.pop(0)

    async def close(self):
        pass


def marked_board():
    ctx = BoardContext()
    element = SimpleNamespace(id="m1", kind="label", box=SimpleNamespace(x=100, y=60, w=240, h=40))
    ctx.paper_elements = SimpleNamespace(
        detected=SimpleNamespace(items=[element], width=1000, height=800)
    )
    ctx.paper_frame = "frame-1"
    return ctx


def coordinator_with(thinker_, pointer_client):
    pointer = Pointer(VoiceSettings(), client=pointer_client)
    events = []
    transcript = SimpleNamespace(record=lambda e, d: events.append((e, d)))
    c = TutorCoordinator(thinker_, marked_board(), pointer=pointer, transcript=transcript)
    pointer.log = c.log
    return c, events


async def turn(c, text, action="mark_paper"):
    async def marked_page():
        return b"jpeg", "m1 label at top center"

    await c.prepare(
        LLMContext([{"role": "user", "content": text}]),
        text,
        decision=decision(action=action),
        page=marked_page,
    )
    return await c.result()


@pytest.mark.asyncio
async def test_a_memory_fact_the_page_read_disagrees_with_leaves_page_and_marks():
    client = Client([{"i": 0, "id": "m1", "box": None}])
    c, events = coordinator_with(
        ScriptedThinker(
            brief(page=FIRST_READ, intent="describe", say=DESCRIBED),
            brief(page=LEAKED_READ, marks=UNDERLINE_LEAKED, say=MARKED),
        ),
        client,
    )
    first = await turn(c, "What do you see on my paper right now?", action="none")
    assert first.page == FIRST_READ
    result = await turn(c, "Can you underline the IP address I wrote on my paper?")
    assert "10.0.0.0/24" not in result.page
    assert "192.168.1.0/24" in result.page
    [mark] = result.marks
    assert mark.target == "the handwritten IP address 192.168.1.0/24"
    sent = json.loads(client.requests[0]["messages"][1]["content"][0]["text"])
    assert sent["intents"][0]["target"] == "the handwritten IP address 192.168.1.0/24"
    assert result.paper == ["[[freeze]]", "[[underline m1]]"]
    assert any(
        e == "memory_not_paper" and d["fact"] == "10.0.0.0/24" and d["page"] == "192.168.1.0/24"
        for e, d in events
    )
    # The talker's notes carry the corrected read, not the leak.
    note = next(m for m in c.context.get_messages() if m.get("role") == "system")
    assert "10.0.0.0/24" not in note["content"] and "192.168.1.0/24" in note["content"]
    await c.close()


@pytest.mark.asyncio
async def test_a_fact_she_brings_up_stays():
    """The rule is for memory-only facts: her own words make 10.0.0.0/24 current again."""
    c, events = coordinator_with(
        ScriptedThinker(
            brief(page=FIRST_READ, intent="describe", say=DESCRIBED),
            brief(page=LEAKED_READ, marks=UNDERLINE_LEAKED, say=MARKED),
        ),
        Client([{"i": 0, "id": "m1", "box": None}]),
    )
    await turn(c, "What do you see on my paper?", action="none")
    result = await turn(c, "Underline 10.0.0.0/24 on my paper, like last time.")
    assert result.page == LEAKED_READ
    assert result.marks[0].target == LEAKED_TARGET
    assert not any(e == "memory_not_paper" for e, _ in events)
    await c.close()


@pytest.mark.asyncio
async def test_without_an_earlier_read_that_disagrees_the_brief_stands():
    c, events = coordinator_with(
        ScriptedThinker(brief(page=LEAKED_READ, marks=UNDERLINE_LEAKED, say=MARKED)),
        Client([{"i": 0, "id": "m1", "box": None}]),
    )
    result = await turn(c, "Underline the IP on my paper.")
    assert result.page == LEAKED_READ
    assert result.marks[0].target == LEAKED_TARGET
    assert not any(e == "memory_not_paper" for e, _ in events)
    await c.close()


@pytest.mark.asyncio
async def test_an_ambiguous_disagreement_drops_the_fact_instead_of_guessing():
    read = "Two networks: 192.168.1.0/24 and 172.16.0.0/16."
    c, events = coordinator_with(
        ScriptedThinker(
            brief(page=read, intent="describe", say=DESCRIBED),
            brief(
                page="She wrote 10.0.0.0/24 at the top.",
                say=MARKED,
                marks=[thinker.MarkIntent(verb="circle", target=LEAKED_TARGET)],
            ),
        ),
        Client([{"i": 0, "id": "m1", "box": None}]),
    )
    await turn(c, "What do you see?", action="none")
    result = await turn(c, "Circle the IP on my paper.")
    assert "10.0.0.0/24" not in result.page
    assert result.marks[0].target == "the handwritten IP address"
    assert any(e == "memory_not_paper" and d["page"] is None for e, d in events)
    await c.close()


@pytest.mark.asyncio
async def test_the_thinker_request_labels_the_memory_as_earlier_sessions():
    calls = []

    async def complete(**kwargs):
        calls.append(kwargs)
        content = brief(page=FIRST_READ).model_dump_json()
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    t = Thinker(
        VoiceSettings(),
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=complete))),
    )
    t.learner_notes = MEMORY
    await t.think([{"role": "user", "content": "What do you see on my paper?"}])
    system = calls[0]["messages"][0]["content"]
    assert "From earlier sessions" in system
    rules = system[: system.index("From earlier sessions")]
    assert "page describes this turn's image only" in rules
    assert "10.0.0.0/24" not in rules


def test_facts_are_structured_values_only():
    assert thinker.facts("Problem 2: 192.168.1.0/24, mask 255.255.255.128, 64 usable; q0") == {
        "192.168.1.0/24",
        "255.255.255.128",
    }
    assert thinker.fact_shape("10.0.0.0/24") == "cidr"
    assert thinker.fact_shape("255.255.255.128") == "dotted"
    assert thinker.fact_shape("2026-10-18") == "other"
