import pytest

from tassel.voice.messages import LANGUAGE_SWITCH_PREFIX
from tassel.voice.prompts import LANGUAGE_NAMES, language_switch_note, system_prompt
from tassel.voice.tools import TOOLS


@pytest.mark.parametrize("lang", ["en", "es", "ko"])
def test_prompt_rules(lang):
    prompt = system_prompt(lang)
    assert f"Reply only in {LANGUAGE_NAMES[lang]}" in prompt
    for phrase in [
        "warm",
        "[[reveal",
        "never spoken",
        "quoted string",
        "m1",
        "patient",
        "Socratic",
        "asks before telling",
        "no filler praise",
        "one or two short sentences",
        "Never give the full solution unless the student asks",
        "failed attempt",
        "speech normalization",
        "q zero",
        "zero one zero one",
        "no markdown",
        "lists",
        "emoji",
        "links",
        "show_stage",
        "set_language",
        "greet briefly when the conversation starts",
        "[language switch]",
    ]:
        assert phrase in prompt
    assert "hint" in prompt and "counterexample" in prompt and "explanation" in prompt
    assert "note from the app, not the student" in prompt
    if lang == "ko":
        assert "polite 해요체" in prompt


def test_language_switch_note():
    note = language_switch_note("ko")
    assert note == (
        f"{LANGUAGE_SWITCH_PREFIX} The student switched the session language to Korean. "
        "Reply only in Korean from now on, starting with one short acknowledgement."
    )


def test_tools():
    tools = TOOLS.standard_tools
    assert [t.name for t in tools] == ["show_stage", "set_language"]
    assert tools[0].properties["view"]["enum"] == ["paper", "board", "split"]
    assert tools[1].properties["language"]["enum"] == ["en", "es", "ko"]
    assert [t.required for t in tools] == [["view"], ["language"]]


def test_custom_tutor_name():
    assert "Mina" in system_prompt("en", tutor_name="Mina")


def test_the_board_examples_are_complete_and_every_tag_in_them_reads_cleanly():
    """Three worked examples (a board DFA built step by step, a highlight, a paper circle on m3)
    and the exact edge syntax: every tag in them parses, with nothing dropped."""
    import re

    from tassel.beats.markup import BoardContext, MarkupStream

    prompt = system_prompt("en")
    assert "[[edge ITEM FROM TO SYMS]]" in prompt
    examples = prompt[prompt.index("Examples:") :]
    assert examples.count("Student:") == 3
    stream = MarkupStream(BoardContext(specs={}))
    sentences = []
    for line in examples.splitlines():
        if line.startswith("Ada:"):
            sentences += stream.feed(line.removeprefix("Ada:") + " ")
            sentences += stream.flush()
    tags = re.findall(r"\[\[([^\]]+)\]\]", examples)
    kinds = [action.kind for s in sentences for _, action in s.anchors]
    assert len(kinds) == len(tags) >= 6
    assert not [p for s in sentences for p in s.problems]
    assert {"board.automaton", "board.reveal", "board.addTransition", "board.highlight"} <= set(
        kinds
    )
    assert "paper.mark" in kinds or any(k.startswith("paper") for k in kinds)


@pytest.mark.parametrize("lang", ["en", "es", "ko"])
def test_freeze_only_for_marks_and_dfa_rules(lang):
    prompt = system_prompt(lang)
    marks = "(circle, number, check, strike, underline)"
    assert f"Freeze only right before marking the paper {marks}" in prompt
    assert "never when only describing" in prompt
    assert "a DFA has exactly one move per state per symbol; always give accept=" in prompt


def test_two_tier_persona_uses_notes_and_follows_director_without_reconfirmation():
    prompt = system_prompt("en", two_tier=True)
    assert "director chooses the route" in prompt
    assert "do not repeatedly reconfirm meaning" in prompt
    assert "tutor notes" in prompt and "do not re-ask" in prompt
    assert "bridge" not in prompt
    assert "[[consult]]" not in system_prompt("en")


def test_thinker_real_case_examples_match_schema_and_diagnose_missing_final_one():
    from tassel.voice.prompts import THINKER_EXAMPLES, thinker_system_prompt
    from tassel.voice.thinker import GuidanceBrief

    prompt = thinker_system_prompt(GuidanceBrief.model_json_schema())
    assert "Language for 0101 ?" in prompt
    assert "my paper" in prompt and "camera" in prompt
    assert "small" in prompt
    for example in THINKER_EXAMPLES:
        brief = GuidanceBrief.model_validate(example["brief"])
        assert "final 1" in brief.diagnosis
        assert len(brief.plan) <= 4
        if "my paper" in example["student"]:
            # Her paper gets marks, never a board diagram, except the playbook's board trace.
            traced = any(t.startswith("[[trace") for t in brief.board)
            assert traced or (brief.paper and not brief.board)
