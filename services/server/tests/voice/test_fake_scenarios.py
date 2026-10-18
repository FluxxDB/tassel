import json
from pathlib import Path

import pytest

from tassel.voice.fakes.scenario import (
    SCENARIOS_DIR,
    ScriptLang,
    ScriptTurn,
    load_scenario,
    next_turn,
)
from tassel.voice.messages import LANGUAGE_SWITCH_PREFIX

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[4] / "packages/shared/src/voice/fixtures.json").read_text()
)


def test_every_scenario_loads():
    assert {p.stem for p in SCENARIOS_DIR.glob("*.json")} == {
        "dfa-opening",
        "dfa-board",
        "barge-in",
        "ptt",
        "talker-tags",
        "image-marks",
    }
    for path in SCENARIOS_DIR.glob("*.json"):
        scenario = load_scenario(path.stem)
        assert scenario.name == path.stem
        assert set(scenario.langs) == {"en", "es", "ko"}
        for script in scenario.langs.values():
            assert script.greeting and script.after_switch and script.fallback


def test_student_lines_match_the_contract():
    for name, langs in FIXTURES["scenario_lines"].items():
        for lang, lines in langs.items():
            assert load_scenario(name).langs[lang].student[: len(lines)] == lines


@pytest.mark.parametrize("name", ["../x", "DFA", "", "missing", "a" * 41, "a\n"])
def test_load_rejects_bad_names(name):
    with pytest.raises(ValueError):
        load_scenario(name)


def test_next_turn_follows_the_demo():
    dfa = load_scenario("dfa-opening")
    assert dfa.title == "Strings that start with 010"
    assert dfa.subject == "Automata · DFA"
    s = dfa.langs["en"]
    assert s.greeting == "Hi, I'm Ada. What are we working on today?"
    assert next_turn(s, None, []).say == s.greeting
    assert next_turn(s, s.student[0], []).say == s.turns[0].say
    turn = next_turn(s, "I think that's it…", [])
    assert (
        turn.say == "Before you move on, try running 1010 through your DFA. Where does it end up?"
    )
    assert turn.tools[0].name == "show_stage"
    assert turn.tools[0].arguments == {"view": "split"}
    assert next_turn(s, s.student[0], [s.turns[0].say]).say == s.fallback


def test_spanish_lines_hit_their_turns():
    s = load_scenario("dfa-opening").langs["es"]
    for i in range(2):
        assert next_turn(s, s.student[i], []).say == s.turns[i].say


def test_language_switch_note_uses_after_switch():
    s = load_scenario("dfa-opening").langs["ko"]
    assert (
        next_turn(s, LANGUAGE_SWITCH_PREFIX + " …", []).say == "좋아요, 이제 한국어로 계속할게요."
    )


def test_next_turn_priorities_and_exhaustion():
    s = ScriptLang(
        greeting="hi",
        after_switch="switched",
        fallback="more",
        turns=[ScriptTurn(say="unconditional"), ScriptTurn(when="STRASSE", say="matched")],
    )
    assert next_turn(s, "Straße", []).say == "matched"
    assert next_turn(s, "else", []).say == "unconditional"
    assert next_turn(s, None, ["hi"]).say == "unconditional"
    assert next_turn(s, "else", ["matched", "unconditional"]).say == "more"


def test_fixed_barge_in_and_ptt_lines():
    barge = load_scenario("barge-in")
    assert barge.langs["en"].greeting == (
        "Hi, I'm Ada. Before we start, here's how this works: "
        "I'll watch your paper while you work, and I'll only step in when something is worth "
        "a closer look. You can interrupt me any time."
    )
    assert next_turn(barge.langs["en"], "Wait, can I ask something?", []).say == (
        "Of course. What's your question?"
    )
    assert next_turn(barge.langs["ko"], "질문이 있어요", []).say == "네, 말씀하세요."
    ptt = load_scenario("ptt").langs["en"]
    assert ptt.greeting == "Hi, I'm Ada. Hold Space when you want to talk."
    assert next_turn(ptt, "Can you hear me now?", []).say == "Yes, I can hear you clearly."
