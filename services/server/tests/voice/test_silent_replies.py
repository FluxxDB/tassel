"""Ada always says something, within a bounded time (real-token eval, paper-marks turn 3): "Put a
callout on q3" came back with its callout tag written inside say, so say was empty once the tag
was lifted out. The reply was tags alone, and the TTS holds a response's end until its audio
ends: with no words there was no audio, so the turn never ended and she was silent for 90 s."""

import asyncio

import pytest
from pipecat.frames.frames import LLMFullResponseEndFrame, LLMFullResponseStartFrame, LLMTextFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.tests.utils import run_test
from test_honest_actions import DRAW, Thinker
from test_two_tier import brief

from tassel.beats.markup import BoardContext
from tassel.evals.scenario import Scenario
from tassel.evals.session import PipelineSession
from tassel.voice.settings import VoiceSettings
from tassel.voice.thinker import (
    LOOK,
    NOT_FINISHED,
    ThinkerOutput,
    TutorCoordinator,
    spoken_words,
)

MACHINE = "[[dfa m start=q0 accept=q0 q0-0,1-q0]]"


async def reply(coordinator):
    frames, _ = await run_test(
        ThinkerOutput(coordinator),
        frames_to_send=[LLMFullResponseStartFrame(), LLMFullResponseEndFrame()],
    )
    assert isinstance(frames[-1], LLMFullResponseEndFrame)
    return "".join(f.text for f in frames if isinstance(f, LLMTextFrame))


class Hanging:
    """A thinker whose request never answers."""

    async def think(self, messages, effort=None):
        await asyncio.Event().wait()

    async def close(self):
        pass


def test_spoken_words_ignore_tags():
    assert spoken_words('[[freeze]][[callout m4 "Should be accepting"]]') == ""
    assert spoken_words("[[clear office]]Gone.") == "Gone."


@pytest.mark.asyncio
async def test_a_reply_of_tags_alone_still_says_something():
    request = "Can you draw a DFA on the board?"
    c = TutorCoordinator(
        Thinker(brief().model_copy(update={"say": MACHINE})), BoardContext(), lang=lambda: "en"
    )
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    text = await reply(c)
    await c.close()
    assert text.startswith(MACHINE)
    assert spoken_words(text) == LOOK["board"]["en"]


@pytest.mark.parametrize("lang", ["en", "es", "ko"])
def test_the_paper_line_points_at_her_paper(lang):
    from tassel.voice.thinker import fill_silence

    filled = fill_silence(
        brief().model_copy(update={"say": "", "paper": ["[[freeze]]", "[[circle m4]]"]}), lang
    )
    assert filled.say == LOOK["paper"][lang]
    empty = fill_silence(brief().model_copy(update={"say": " "}), lang)
    assert empty.say == NOT_FINISHED[lang]
    kept = fill_silence(brief(), lang)
    assert kept.say == brief().say


@pytest.mark.asyncio
async def test_a_thinker_that_never_answers_gets_the_honest_line_in_bounded_time():
    request = "Put a callout on q3 on my paper saying it should be an accepting state."
    c = TutorCoordinator(Hanging(), BoardContext(), lang=lambda: "ko", reply_timeout_s=0.2)
    await c.prepare(LLMContext([{"role": "user", "content": request}]), request, decision=DRAW)
    async with asyncio.timeout(5):
        text = await reply(c)
    assert text == NOT_FINISHED["ko"]
    assert c.task is None  # the hung request was cancelled, not left running
    await c.close()


class TagOnlyThinker:
    settings = None
    on_usage = None

    async def think(self, messages, effort=None):
        return brief().model_copy(update={"say": MACHINE})

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_a_tags_only_brief_ends_the_turn_through_the_whole_pipeline(tmp_path):
    """The stall itself, on fake providers: the turn ends and she speaks."""
    scenario = Scenario.model_validate(
        {
            "name": "silent",
            "title": "Tags alone",
            "fake_script": "dfa-board",
            "stage": {"view": "board"},
            "turns": [{"student": "Can you draw a DFA on the board?"}],
        }
    )
    settings = VoiceSettings(
        providers="fake", fake_tts="tone", transcript_dir=tmp_path / "transcripts"
    )
    async with PipelineSession(scenario, settings, turn_timeout_s=10) as session:
        session.coordinator.thinker = TagOnlyThinker()
        observation = await session.turn(scenario.turns[0], 0)
    assert observation.finished
    assert observation.spoken == LOOK["board"]["en"]
    assert any(a["kind"] == "board.automaton" for a in observation.actions)
