import re

import pytest
from pipecat.frames.frames import (
    AggregatedTextFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.tests.utils import SleepFrame, run_test

from tassel.beats.markup import BoardContext
from tassel.beats.processor import BeatTagProcessor

pytestmark = pytest.mark.asyncio
SAY = (
    "[[dfa fix hidden start=q0 accept=q1 q0-0-q1]][[stage split]]Here's one that works. "
    "We start at [[reveal fix start q0]]q zero. [[reveal fix q0>q1]]A zero takes us to q one."
)


def response(text):
    words = text.split()
    return [
        LLMFullResponseStartFrame(),
        *[LLMTextFrame(" ".join(words[i : i + 3]) + " ") for i in range(0, len(words), 3)],
        LLMFullResponseEndFrame(),
    ]


async def capture(frames):
    log = []

    class Events:
        async def send(self, event):
            log.append(event)

    class Recorder(FrameProcessor):
        async def process_frame(self, frame, direction):
            await super().process_frame(frame, direction)
            if isinstance(frame, (AggregatedTextFrame, LLMTextFrame)):
                log.append(frame)
            await self.push_frame(frame, direction)

    await run_test(
        Pipeline(
            [
                BeatTagProcessor(events=Events(), lang=lambda: "en", board=BoardContext()),
                Recorder(),
            ]
        ),
        frames_to_send=frames,
    )
    return log


async def test_strips_tags_and_sends_beats_before_matching_text():
    log = await capture(response(SAY))
    assert len(log) == 6
    events = [e for e in log if hasattr(e, "beat")]
    frames = [f for f in log if isinstance(f, AggregatedTextFrame)]
    for event, frame in zip(events, frames, strict=True):
        assert log.index(event) < log.index(frame)
        assert event.kind == "beat"
        assert isinstance(frame, AggregatedTextFrame)
        assert "[[" not in frame.text
        assert event.beat.segment == str(frame.id)
        assert event.beat.text == frame.text
        assert "[[" in frame.raw_text
        assert re.fullmatch("[0-9a-f]{8}", event.beat.turn)
    assert len({event.beat.id for event in events}) == 3
    assert len({event.beat.turn for event in events}) == 1
    assert events[1].beat.markers[0].word == 3


async def test_tags_only_send_wordless_beat_without_text():
    log = await capture(response("[[circle m1]][[stage split]]"))
    assert len(log) == 1
    assert log[0].beat.words == []
    assert log[0].beat.markers[0].action.mark.target.el == "m1"


async def test_interruption_drops_unfinished_sentence_and_next_turn_is_fresh():
    log = await capture(
        [
            *response("First."),
            LLMFullResponseStartFrame(),
            LLMTextFrame("Dropped [[stage board]] unfinished"),
            SleepFrame(),
            InterruptionFrame(),
            SleepFrame(),
            LLMFullResponseEndFrame(),
            *response("[[stage split]]Next."),
        ]
    )
    events = [entry for entry in log if hasattr(entry, "beat")]
    assert [e.beat.text for e in events] == ["First.", "Next."]
    assert events[0].beat.turn != events[1].beat.turn
    assert events[0].beat.segment != events[1].beat.segment


async def test_rejected_tags_are_logged_with_their_reason_and_never_spoken():
    from loguru import logger

    lines = []
    sink = logger.add(lambda message: lines.append(str(message)), level="INFO")
    try:
        log = await capture(
            response("[[frobnicate fix q0]]Look here. [[dfa d start=q0 q0->q1]]And here.")
        )
    finally:
        logger.remove(sink)
    spoken = " ".join(f.text for f in log if isinstance(f, AggregatedTextFrame))
    assert "[[" not in spoken and "frobnicate" not in spoken
    rejected = [line for line in lines if "Board tag" in line]
    assert any("unknown command" in line and "frobnicate" in line for line in rejected)
    assert any("q0->q1" in line and "no symbol" in line for line in rejected)


async def test_conflicting_dfa_is_drawn_and_logged_as_trimmed():
    from loguru import logger

    lines = []
    sink = logger.add(lambda message: lines.append(message), level="INFO")
    try:
        log = await capture(response("[[dfa d start=q0 q0-0-q1 q0-0-q2]]Look here."))
    finally:
        logger.remove(sink)
    assert any(
        m.action.kind == "board.automaton"
        for e in log
        if hasattr(e, "beat")
        for m in e.beat.markers
    )
    assert any(
        "Board tag trimmed:" in str(line) and line.record["level"].name == "INFO" for line in lines
    )
