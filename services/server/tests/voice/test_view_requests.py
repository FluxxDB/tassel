"""Views (owner, 2026-10-18): the student makes her paper or the board full screen; Ada only
ever opens the split view. In the live test, "Back to camera, please" went to the model, which
said "Back on your paper" and never switched. Her spoken view requests now act like the dock's
Board control: they pin the view."""

import pytest
from test_bot_pipeline import context, running, say, until

from tassel.voice.director import view_request
from tassel.voice.fakes.scenario import load_scenario
from tassel.voice.messages import OfferRequestData, StageEvent


@pytest.mark.parametrize(
    "text,view",
    [
        # Her words from the live test.
        ("Can we go back to desk view?", "paper"),
        ("Switch back to desk view.", "paper"),
        ("Okay. Can we go back to the camera view, please?", "paper"),
        ("Back to camera, please.", "paper"),
        ("Can you switch back to the board, please?", "board"),
        ("Okay. Can you go back to the the board with the camera view?", "board"),
        ("No. I want the board full screen and then the picture view in a mini window.", "board"),
        ("No. I want the board with the paper view and picture and picture.", "board"),
        ("Put my paper and the board side by side.", "split"),
        ("Show me the split view.", "split"),
        # Missed in live test 2de450e6.
        ("Can you switch the board to full screen, please?", "board"),
        ("Can you switch the board to full screen?", "board"),
        ("Go back desk view.", "paper"),
        ("Desk view, please.", "paper"),
        ("desk view full screen.", "paper"),
        ("back to board.", "board"),
        ("I'll go back to camera view or desk view.", "paper"),
        ("Make the camera full screen.", "paper"),
        ("The whiteboard, please.", "board"),
        ("Split view.", "split"),
    ],
)
def test_her_view_requests_name_the_view(text, view):
    assert view_request(text) == view


@pytest.mark.parametrize(
    "text",
    [
        "Can you draw a line underneath the IP and the subnet that I just wrote down?",
        "Do you see my paper?",
        "Let's do some VLSM on this in the the drawing board.",
        "Can you show me the answer on the board?",
        "Where's the camera view at the bottom?",
        "I just want you to create a diagram with all these subnets.",
        "Draw it on the board, please.",
        "Okay. Whatever. Can you make a fake network and put it on the board, please?",
        "Can you add more PCs?",
        "No. The whiteboard is still open.",
        "What's on the board?",
    ],
)
def test_other_requests_are_not_view_changes(text):
    assert view_request(text) is None


def test_a_pinned_stage_event_says_so_and_adas_does_not():
    assert StageEvent(view="paper", pinned=True).model_dump()["pinned"] is True
    # Ada's requests read as they always have: no pinned field.
    assert "pinned" not in StageEvent(view="split").model_dump()


@pytest.mark.asyncio
async def test_her_spoken_request_pins_the_view_at_once():
    ctx = context(request=OfferRequestData(scenario="dfa-opening"))
    async with running(ctx) as (bot, out):
        await until(lambda: load_scenario("dfa-opening").langs["en"].greeting in out.text())
        await say(bot, "Back to camera, please.")
        await until(lambda: any(e["kind"] == "stage" for e in out.events()))
        stages = [e for e in out.events() if e["kind"] == "stage"]
        assert stages == [{"kind": "stage", "view": "paper", "pinned": True}]


@pytest.mark.asyncio
async def test_a_view_request_is_answered_with_a_set_line_and_no_model_call(monkeypatch):
    """Live test 2de450e6: after "back to board" switched, the talker said "I'll remove the
    three PCs I just added". A view request now has a fixed reply; the model never runs."""
    import tassel.voice.bot as bot_module
    from tassel.voice.fakes.llm import FakeLLMService

    calls = []

    class Talker(FakeLLMService):
        async def process_frame(self, frame, direction):
            from pipecat.frames.frames import LLMContextFrame

            if isinstance(frame, LLMContextFrame) and any(
                m.get("role") == "user" for m in frame.context.get_messages()
            ):
                calls.append(frame)
            await super().process_frame(frame, direction)

    monkeypatch.setattr(
        bot_module,
        "make_llm",
        lambda route, settings, scenario: Talker(scenario=scenario, lang=route.lang),
    )
    ctx = context(request=OfferRequestData(scenario="dfa-opening"))
    async with running(ctx) as (bot, out):
        await until(lambda: load_scenario("dfa-opening").langs["en"].greeting in out.text())
        await say(bot, "Desk view, please.")
        await until(lambda: "Here's your paper." in out.text())
        await say(bot, "Can you switch the board to full screen?")
        await until(lambda: "Here's the board." in out.text())
        assert calls == []
        stages = [e for e in out.events() if e["kind"] == "stage"]
        assert stages == [
            {"kind": "stage", "view": "paper", "pinned": True},
            {"kind": "stage", "view": "board", "pinned": True},
        ]


@pytest.mark.asyncio
async def test_ada_only_ever_opens_the_split_view():
    ctx = context(request=OfferRequestData(scenario="dfa-opening"))
    async with running(ctx) as (bot, out):
        await until(lambda: load_scenario("dfa-opening").langs["en"].greeting in out.text())
        # The director's rules focus the board for a board drawing; Ada opens split, not board.
        await say(bot, "Can you draw a DFA for 010 on the board?")
        await until(lambda: any(e["kind"] == "stage" for e in out.events()))
        views = {e["view"] for e in out.events() if e["kind"] == "stage"}
        assert views == {"split"}
        assert not any(e.get("pinned") for e in out.events() if e["kind"] == "stage")


@pytest.mark.asyncio
async def test_view_acknowledgement_opens_the_current_screen_audio_epoch():
    from tassel.screen.session import ScreenSession

    screen = ScreenSession()
    ctx = context(screen=screen, request=OfferRequestData(scenario="dfa-opening"))
    async with running(ctx) as (bot, out):
        await until(lambda: load_scenario("dfa-opening").langs["en"].greeting in out.text())
        await screen.reset(source="display", epoch=42, active=True)
        await say(bot, "Back to board, please.")
        await until(lambda: "Here's the board." in out.text())
        assert {"kind": "screen-turn", "epoch": 42} in out.events()
