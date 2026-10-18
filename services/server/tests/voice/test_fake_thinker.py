"""The fake scenarios' scripted director decisions and thinker briefs: offline, a fake session
draws through the same approved path as the live tutor (director → thinker → action checker)."""

import pytest

from tassel.voice.director import Decision, Director
from tassel.voice.fakes.scenario import load_scenario, scripted_turn
from tassel.voice.fakes.thinker import FakeThinker, scripted_thinker
from tassel.voice.thinker import GuidanceBrief

DRAW = Decision(
    focus="split", needs_vision=False, route="thinker", action="draw_board", refers_to="board"
)


def test_dfa_board_scripts_a_board_drawing_for_the_thinker():
    scenario = load_scenario("dfa-board")
    for lang, script in scenario.langs.items():
        turn = scripted_turn(scenario, lang, "Can you show me the answer?")
        assert turn is not None and turn.decision == DRAW, lang
        assert turn.brief is not None
        # The talker only bridges: every drawing comes from the brief.
        assert "[[" not in script.turns[0].say
        assert any(tag.startswith("[[dfa fix") for tag in turn.brief.board)


def test_talker_tags_keeps_the_raw_talker_drawing():
    turn = load_scenario("talker-tags").langs["en"].turns[0]
    assert "[[dfa fix" in turn.say
    assert turn.decision is None and turn.brief is None


def test_scripted_turn_matches_only_turns_that_carry_the_field():
    scenario = load_scenario("dfa-opening")
    assert scripted_turn(scenario, "en", "I think that's it. If it starts with a 1…") is not None
    assert scripted_turn(scenario, "en", "Something unscripted") is None
    assert scripted_turn(scenario, "en", "I think that's it", field="brief") is None


@pytest.mark.asyncio
async def test_director_follows_the_script_and_falls_back_to_rules():
    scenario = load_scenario("dfa-board")
    logged = []
    director = Director(
        script=lambda text: (turn := scripted_turn(scenario, "en", text)) and turn.decision,
        log=lambda event, **data: logged.append((event, data)),
    )
    assert await director.decide("Can you show me the answer?", []) == DRAW
    assert logged[-1][1]["source"] == "script"
    unscripted = await director.decide("Hello there", [])
    assert unscripted.route == "talker"
    assert logged[-1][1]["source"] != "script"


@pytest.mark.asyncio
async def test_fake_thinker_returns_the_scripted_brief():
    thinker = FakeThinker(load_scenario("dfa-board"), lambda: "en", delay_s=0)
    brief = await thinker.think(
        [
            {"role": "system", "content": "x"},
            {"role": "user", "content": "Can you show me the answer?"},
        ]
    )
    assert isinstance(brief, GuidanceBrief)
    assert brief.say.endswith("A zero takes us to q one.")
    assert brief.board[0].startswith("[[dfa fix hidden")
    assert brief.language is not None and brief.language.alphabet == ["0", "1"]
    with pytest.raises(LookupError):
        await thinker.think([{"role": "user", "content": "Something unscripted"}])
    await thinker.close()


def test_scripted_thinker_only_for_scenarios_with_briefs():
    assert isinstance(scripted_thinker(load_scenario("dfa-board"), lambda: "en"), FakeThinker)
    assert scripted_thinker(load_scenario("dfa-opening"), lambda: "en") is None
