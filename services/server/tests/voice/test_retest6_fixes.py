"""Regressions from the owner's retest #6 (2026-10-17 23:41)."""

import pytest

from tassel.voice.director import Decision, guard, rules
from tassel.voice.prompts import TALKER_RULES, system_prompt, thinker_system_prompt
from tassel.voice.providers import leading_system_only
from tassel.voice.tools import TALKER_TOOLS


def test_the_talker_has_no_view_tool():
    # A talker show_stage call pushed a second, unplanned reply ("add a 0101 branch…").
    names = [t.name for t in TALKER_TOOLS.standard_tools]
    assert names == ["set_language"]


def test_the_opening_greeting_has_a_user_message():
    # The greeting ran with only the persona, and Cerebras answered HTTP 400.
    out = leading_system_only([{"role": "system", "content": "You are Ada."}])
    assert [m["role"] for m in out] == ["system", "user"]
    assert out[1]["content"].startswith("[session start]")


def test_camera_words_mean_paper_marks():
    # The director said draw_board for "draw on top of my camera", and the paper marks
    # the thinker wrote were rejected, so the student saw nothing.
    model = Decision(
        focus="paper", needs_vision=True, route="thinker", action="draw_board", refers_to="paper"
    )
    fixed = guard("can you draw on top of my camera?", model)
    assert fixed.action == "mark_paper" and fixed.focus == "paper" and fixed.needs_vision


def test_constructions_go_to_the_thinker():
    # The rules sent "show me a modified version with an NFA" to the talker, which improvised.
    assert rules("Can you show me a modified version of this with an NFA?").route == "thinker"
    talker = Decision(
        focus="board", needs_vision=False, route="talker", action="none", refers_to="board"
    )
    assert guard("Show me an NFA for this", talker).route == "thinker"


def test_no_hang_on_bridge_and_no_reacknowledgement():
    # The owner: say it and do it, never "hang on, let me…" (2026-10-18).
    assert "hang on" not in TALKER_RULES.lower() and "bridge" not in TALKER_RULES.lower()
    two_tier = system_prompt("en", two_tier=True)
    assert "show_stage" not in two_tier and "set_language" in two_tier
    brief = thinker_system_prompt({})
    assert "never re-acknowledge" in brief and "never repeat the question" in brief


def test_short_definitions_stay_with_the_talker():
    thinker = Decision(
        focus="none",
        needs_vision=False,
        route="thinker",
        action="explain",
        refers_to="conversation",
    )
    assert guard("What is a DFA?", thinker).route == "talker"
    assert guard("What is wrong with my DFA on my paper?", thinker).route == "thinker"


@pytest.mark.asyncio
async def test_eleven_v3_uses_http_streaming():
    # eleven_v3 is rejected on the streaming WebSocket (HTTP 400); it runs over HTTP streaming.
    from pipecat.services.elevenlabs.tts import ElevenLabsHttpTTSService, ElevenLabsTTSService

    from tassel.voice.providers import make_tts
    from tassel.voice.routes import route_for
    from tassel.voice.settings import VoiceSettings

    v3 = make_tts(
        route_for("en"),
        VoiceSettings(tts_model="eleven_v3", elevenlabs_api_key="el", providers="live"),
    )
    assert isinstance(v3, ElevenLabsHttpTTSService)
    await v3.cleanup()
    flash = make_tts(route_for("en"), VoiceSettings(elevenlabs_api_key="el", providers="live"))
    assert isinstance(flash, ElevenLabsTTSService)


def test_owner_voice_pick_is_the_default():
    from tassel.voice.settings import VoiceSettings

    s = VoiceSettings()
    assert s.tts_model == "eleven_multilingual_v2" and s.tts_speed == 1.15
    assert s.voice_en == "XrExE9yKIg1WjnnlVkGX"  # Matilda
