"""Deterministic stage policy, using a fake monotonic clock."""

import pytest

from tassel.voice.director import Decision
from tassel.voice.messages import StageHintEvent, StageStateEvent
from tassel.voice.stage import StageManager
from tassel.voice.thinker import GuidanceBrief


def decision(**values):
    return Decision(
        **dict(
            dict(
                focus="none",
                needs_vision=False,
                route="thinker",
                action="none",
                refers_to="conversation",
            ),
            **values,
        )
    )


def brief(**values):
    return GuidanceBrief(
        **dict(
            dict(
                page="",
                intent="",
                diagnosis="",
                plan=["show"],
                say="Here.",
                board=[],
                paper=[],
                confidence=1.0,
                followups=[],
            ),
            **values,
        )
    )


def state(view="paper", pinned=None, revision=0):
    return StageStateEvent(view=view, pinned=pinned, frozen=False, page_revision=revision)


@pytest.mark.parametrize(
    "lang,side,line",
    [
        ("en", "board", "It's on the board."),
        ("es", "board", "Está en la pizarra."),
        ("ko", "board", "칠판에 있어요."),
        ("en", "paper", "Look at your paper."),
        ("es", "paper", "Mira tu hoja."),
        ("ko", "paper", "종이를 보세요."),
    ],
)
def test_pin_wins_and_hidden_drawing_is_spoken(lang, side, line):
    manager = StageManager(lang=lambda: lang)
    view = "paper" if side == "board" else "board"
    manager.on_state(state(view, view), 0)
    assert manager.on_turn(decision(action="draw_board", refers_to=side), 10) is None
    b = brief(**{side: ["drawing"]})
    assert manager.on_brief(b, decision(), 10) == StageHintEvent(side=side)
    assert b.say == "Here. " + line
    assert manager.view == view


def test_debounce_and_no_switch_when_side_is_visible():
    manager = StageManager()
    board = decision(action="draw_board")
    paper = decision(needs_vision=True)
    assert manager.on_turn(board, 0) == "board"
    assert manager.on_turn(paper, 3.999) is None
    assert manager.on_turn(paper, 4) == "paper"
    assert manager.on_turn(paper, 9) is None
    manager.on_state(state("split"), 10)
    assert manager.on_turn(board, 15) is None
    assert manager.on_turn(paper, 15) is None


def test_recent_ink_keeps_paper_visible():
    manager = StageManager()
    manager.on_state(state(), 0)
    manager.on_state(state(revision=1), 10)
    assert manager.on_turn(decision(action="draw_board"), 15.999) == "split"


@pytest.mark.parametrize(
    "fields,initial,expected",
    [
        ({"paper": ["[[circle m1]]"]}, "board", "paper"),
        ({"board": ["[[diagram d]]"]}, "paper", "board"),
        ({"draw": "a graph"}, "paper", "board"),
        ({"board": ["draw"], "paper": ["mark"]}, "paper", "split"),
        ({"board": ["draw"]}, "split", None),
    ],
)
def test_brief_makes_drawings_visible(fields, initial, expected):
    manager = StageManager()
    manager.on_state(state(initial), 0)
    assert manager.on_brief(brief(**fields), decision(action="draw_board"), 10) == expected


def test_idle_returns_to_student_choice_not_server_ack():
    manager = StageManager()
    manager.on_state(state("paper"), 0)
    assert manager.on_brief(brief(board=["draw"]), decision(), 10) == "board"
    manager.on_state(state("board"), 11)  # acknowledgement, not a student selection
    assert manager.on_idle(34.999) is None
    assert manager.on_idle(35) == "paper"
    assert manager.on_idle(60) is None


def test_pin_split_and_pin_during_idle():
    manager = StageManager()
    manager.on_state(state("split", "split"), 0)
    b = brief(board=["draw"], paper=["mark"])
    assert manager.on_brief(b, decision(), 10) is None
    assert b.say == "Here."
    assert manager.on_idle(40) is None


def test_stage_decisions_are_logged():
    records = []
    manager = StageManager(log=lambda event, data: records.append((event, data)))
    assert manager.on_turn(decision(action="draw_board"), 0) == "board"
    manager.on_turn(decision(), 1)
    assert records[0] == ("stage", {"from": "paper", "to": "board", "reason": "turn"})
    assert records[-1][0] == "stage"
    assert records[-1][1]["from"] == records[-1][1]["to"] == "board"


def test_hint_pulses_once_per_turn_even_for_late_diagram():
    manager = StageManager()
    manager.on_state(state("paper", "paper"), 0)
    d = decision(action="draw_board")
    manager.on_turn(d, 10)
    assert manager.on_brief(brief(draw="graph"), d, 11) == StageHintEvent(side="board")
    late = brief(board=["[[diagram d]]"])
    assert manager.on_brief(late, d, 20) is None
    assert late.say == "Here."
    manager.on_turn(d, 30)
    assert manager.on_brief(brief(board=["draw"]), d, 31) == StageHintEvent(side="board")


@pytest.mark.asyncio
async def test_delivery_applies_stage_before_drawing_and_speaks_hint():
    import asyncio

    from pipecat.frames.frames import LLMFullResponseEndFrame, LLMTextFrame
    from pipecat.tests.utils import run_test

    from tassel.beats.markup import BoardContext
    from tassel.voice.thinker import ThinkerOutput, TutorCoordinator

    manager = StageManager()
    manager.on_state(state("paper", "paper"), 0)
    events = []

    async def on_brief(value, d):
        events.append(manager.on_brief(value, d, 10))

    coordinator = TutorCoordinator(None, BoardContext(), on_brief=on_brief)
    coordinator.decision = decision(action="draw_board")

    async def ready():
        return brief(board=["[[diagram d]]"])

    coordinator.task = asyncio.create_task(ready())
    frames, _ = await run_test(
        ThinkerOutput(coordinator), frames_to_send=[LLMFullResponseEndFrame()]
    )
    assert events == [StageHintEvent(side="board")]
    assert "".join(f.text for f in frames if isinstance(f, LLMTextFrame)) == (
        "[[diagram d]]Here. It's on the board."
    )
    assert await coordinator.result() is None  # no duplicate hint on repeated delivery
    await coordinator.close()


@pytest.mark.asyncio
async def test_bot_honors_client_pin_and_logs_stage_before_drawing(tmp_path):
    import json

    from test_bot_pipeline import context, message, running, say, until

    from tassel.voice.fakes.scenario import load_scenario
    from tassel.voice.messages import OfferRequestData
    from tassel.voice.settings import VoiceSettings

    ctx = context(
        request=OfferRequestData(scenario="dfa-board"),
        settings=VoiceSettings(providers="fake", fake_tts="tone", transcript_dir=tmp_path),
    )
    async with running(ctx) as (bot, out):
        await until(lambda: load_scenario("dfa-board").langs["en"].greeting in out.text())
        await message(
            bot, "client-message", {"t": "tassel", "d": state("paper", "paper").model_dump()}
        )
        await say(bot, "Can you show me the answer?")
        await until(lambda: "It's on the board." in out.text())
        assert not [e for e in out.events() if e["kind"] == "stage"]
        events = out.events()
        hints = [e for e in events if e["kind"] == "stage-hint"]
        assert hints == [{"kind": "stage-hint", "side": "board"}]
        drawing = next(
            i for i, e in enumerate(events) if e["kind"] == "beat" and e["beat"]["markers"]
        )
        assert events.index(hints[0]) < drawing
    records = [
        json.loads(line) for line in (tmp_path / f"{ctx.session_id}.jsonl").read_text().splitlines()
    ]
    assert any(r["event"] == "stage" and r["reason"] == "hidden-board" for r in records)


def test_idle_is_checked_on_next_turn_and_ink_prevents_hiding_paper():
    manager = StageManager()
    manager.on_state(state("board"), 0)
    assert manager.on_turn(decision(needs_vision=True), 1) == "paper"
    manager.on_state(state("paper", revision=1), 25)
    assert manager.on_turn(decision(), 26) == "split"


def test_brief_correction_precedes_drawing_even_inside_provisional_debounce():
    manager = StageManager()
    assert manager.on_turn(decision(action="draw_board"), 0) == "board"
    assert manager.on_brief(brief(paper=["mark"], board=["draw"]), decision(), 1) == "split"


def test_focus_without_visual_need_does_not_switch():
    assert StageManager().on_turn(decision(focus="board"), 0) is None


def test_pinning_preserves_adas_last_request_and_unpin_restores_student_preference():
    manager = StageManager()
    manager.on_state(state("paper"), 0)
    manager.on_brief(brief(board=["draw"]), decision(), 10)
    manager.on_state(state("split", "split"), 11)
    assert manager.last_requested_view == "board"
    # The existing renderer's unpin follows Ada's remembered request.
    manager.on_state(state("board"), 12)
    assert manager.on_idle(35) == "split"


def test_unchanged_revision_does_not_extend_writing_window():
    manager = StageManager()
    manager.on_state(state(revision=1), 10)
    manager.on_state(state(revision=1), 15)
    assert manager.on_turn(decision(action="draw_board"), 16) == "board"


def test_later_drawing_restarts_idle_clock():
    manager = StageManager()
    assert manager.on_brief(brief(board=["draw"]), decision(), 0) == "board"
    assert manager.on_brief(brief(board=["draw again"]), decision(), 24) is None
    assert manager.on_idle(25) is None
    assert manager.on_idle(49) == "paper"


def test_in_flight_acknowledgements_do_not_replace_student_choice():
    manager = StageManager()
    manager.on_turn(decision(action="draw_board"), 10)
    manager.on_brief(brief(paper=["mark"], board=["draw"]), decision(), 10.01)
    manager.on_state(state("board"), 10.02)
    assert manager.view == "split"
    manager.on_state(state("board", revision=1), 10.025)
    manager.on_state(state("split", revision=1), 10.03)
    assert manager.on_idle(35.01) == "paper"


@pytest.mark.asyncio
async def test_fast_talker_marks_use_stage_policy_too():
    from pipecat.frames.frames import LLMFullResponseEndFrame, LLMTextFrame
    from pipecat.tests.utils import run_test

    from tassel.beats.markup import BoardContext
    from tassel.beats.models import (
        DetectedElement,
        DetectedElements,
        PaperElements,
        PaperFrame,
        PixelBox,
    )
    from tassel.voice.thinker import ThinkerOutput, TutorCoordinator

    manager = StageManager()
    manager.on_state(state("board", "board"), 0)
    hints = []

    async def on_brief(value, d):
        hints.append(manager.on_brief(value, d, 10))

    coordinator = TutorCoordinator(
        None,
        BoardContext(
            paper_frame=PaperFrame(kind="paper", id="f", captured_at="now"),
            paper_elements=PaperElements(
                states={},
                edges={},
                detected=DetectedElements(
                    width=100,
                    height=100,
                    items=[
                        DetectedElement(id="m1", kind="circle", box=PixelBox(x=0, y=0, w=20, h=20))
                    ],
                ),
            ),
        ),
        on_brief=on_brief,
    )
    coordinator.decision = decision(action="mark_paper", refers_to="paper")
    frames, _ = await run_test(
        ThinkerOutput(coordinator),
        frames_to_send=[LLMTextFrame("[[circle m1]]Look here."), LLMFullResponseEndFrame()],
    )
    assert hints == [StageHintEvent(side="paper")]
    words = "".join(f.text for f in frames if isinstance(f, LLMTextFrame))
    assert "Look at your paper." in words
    assert "[[circle" in words


def test_idle_returns_on_visual_turn_when_student_choice_shows_needed_side():
    manager = StageManager()
    manager.on_brief(brief(board=["draw"]), decision(), 10)
    manager.on_state(state("split", "split"), 11)
    manager.on_state(state("board"), 12)
    assert manager.on_turn(decision(refers_to="board"), 35) == "split"


def test_ink_does_not_switch_when_board_is_already_visible():
    manager = StageManager()
    manager.on_state(state("board", revision=1), 10)
    assert manager.on_turn(decision(action="draw_board"), 11) is None
