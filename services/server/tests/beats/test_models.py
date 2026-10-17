"""The Pydantic mirror of the shared beats contract, against the app's own fixtures.json."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from tassel.beats.models import BEAT_ACTION, AutomatonSpec, BeatDoc, dump_beat

REPO = Path(__file__).resolve().parents[4]
FIXTURES = json.loads(
    (REPO / "packages" / "shared" / "src" / "beats" / "fixtures.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("action", FIXTURES["actions"], ids=lambda action: action["kind"])
def test_every_fixture_action_validates_and_round_trips(action):
    parsed = BEAT_ACTION.validate_python(action)

    assert BEAT_ACTION.dump_python(parsed, mode="json") == action
    # As P2's envelope dumps a server event: no by_alias, still camelCase (review C2).
    assert parsed.model_dump(mode="json") == action


@pytest.mark.parametrize("case", FIXTURES["invalidActions"], ids=lambda case: case["why"])
def test_every_invalid_action_raises(case):
    with pytest.raises(ValidationError):
        BEAT_ACTION.validate_python(case["data"])


@pytest.mark.parametrize("doc", FIXTURES["beats"], ids=lambda doc: doc["id"])
def test_every_fixture_beat_validates_and_round_trips(doc):
    beat = BeatDoc.model_validate(doc)

    assert dump_beat(beat) == doc
    assert beat.model_dump(mode="json") == doc
    assert json.loads(beat.model_dump_json()) == doc


@pytest.mark.parametrize("case", FIXTURES["invalidBeats"], ids=lambda case: case["problem"])
def test_every_invalid_beat_raises(case):
    # The app's parser drops a bad marker and keeps the rest of the beat; the server never sends
    # one, so here it rejects the whole document.
    with pytest.raises(ValidationError):
        BeatDoc.model_validate(case["data"])


def test_dumps_camel_case_and_keeps_required_nulls():
    beat = BeatDoc.model_validate(FIXTURES["beats"][1])
    dumped = dump_beat(beat)

    assert {"durationSec", "shapeSet", "mouthCues"} <= dumped.keys()
    assert dumped["durationSec"] is None
    assert dumped["words"][0] == {"text": "Empezamos", "start": None, "end": None}


def test_a_null_optional_field_counts_as_absent_and_is_never_dumped():
    action = BEAT_ACTION.validate_python(
        {
            "kind": "board.automaton",
            "item": "fix",
            "spec": FIXTURES["actions"][0]["spec"],
            "title": None,
            "reveal": None,
        }
    )

    assert action.title is None
    assert set(action.model_dump(mode="json")) == {"kind", "item", "spec"}


def test_whole_numbers_may_be_written_as_floats_as_in_javascript():
    action = BEAT_ACTION.validate_python({"kind": "board.traceStep", "item": "run", "step": 2.0})

    assert action.model_dump(mode="json") == {"kind": "board.traceStep", "item": "run", "step": 2}


@pytest.mark.parametrize(
    "data",
    [
        {"kind": "board.highlight", "item": "wrong", "el": "state:q0", "on": 1},
        {"kind": "board.traceStep", "item": "run", "step": "2"},
        {"kind": "board.traceStep", "item": "run", "step": True},
        {"kind": "board.addState", "item": "fix", "id": "q1\n"},
        {"kind": "board.clear", "item": "fix\n"},
        {"kind": "board.clear", "item": 7},
        {
            "kind": "paper.mark",
            "mark": {"type": "step", "id": "s1", "n": 100, "target": {"el": "start"}},
        },
        {
            "kind": "paper.mark",
            "mark": {"type": "check", "id": "m", "target": {"at": {"x": "0.8", "y": 0.4}}},
        },
        {
            "kind": "paper.mark",
            "mark": {"type": "check", "id": "m", "target": {"at": {"x": float("inf"), "y": 0}}},
        },
        {
            "kind": "paper.mark",
            "mark": {"type": "check", "id": "m", "target": {"at": {"x": True, "y": 0}}},
        },
        {
            "kind": "paper.mark",
            "mark": {"type": "check", "id": "m", "target": {"el": "start", "at": None}},
        },
        {"kind": "board.addTransition", "item": "fix", "from": "q0", "to": "q1", "symbols": ["0 "]},
        {"kind": "board.addTransition", "item": "fix", "from": "q0", "to": "q1", "symbols": [" "]},
        {
            "kind": "board.addTransition",
            "item": "fix",
            "from": "q0",
            "to": "q1",
            "symbols": ["01234"],
        },
        {"kind": "board.addTransition", "item": "fix", "from": "q0", "to": "q1", "symbols": []},
        {"kind": "board.note", "item": "why", "text": "x" * 281},
        {"kind": "stage", "view": "split", "extra": None},
    ],
    ids=[
        "1 for true",
        "a string for a number",
        "true for a number",
        "a newline after a state id",
        "a newline after an item id",
        "a number for an id",
        "a step mark past 99",
        "a string coordinate",
        "an infinite coordinate",
        "true for a coordinate",
        "a target with a null second anchor",
        "a symbol with a space",
        "a symbol that is a no-break space",
        "a symbol of five characters",
        "no symbols",
        "a 281-character note",
        "an unknown field, even when null",
    ],
)
def test_rejects_what_the_app_parser_rejects(data):
    with pytest.raises(ValidationError):
        BEAT_ACTION.validate_python(data)


def test_counts_text_in_code_points():
    emoji_note = "🙂" * 280
    action = BEAT_ACTION.validate_python({"kind": "board.note", "item": "why", "text": emoji_note})

    assert action.text == emoji_note
    with pytest.raises(ValidationError):
        BEAT_ACTION.validate_python(
            {"kind": "board.note", "item": "why", "text": emoji_note + "🙂"}
        )


def wrong(**changes):
    spec = {
        "kind": "dfa",
        "states": [{"id": "q0"}, {"id": "q1"}, {"id": "q3", "accept": True}],
        "start": "q0",
        "transitions": [
            {"from": "q0", "to": "q1", "symbols": ["0"]},
            {"from": "q0", "to": "q0", "symbols": ["1"]},
        ],
    }
    return {**spec, **changes}


@pytest.mark.parametrize(
    ("spec", "problem"),
    [
        (wrong(start="q9"), "unknown start q9"),
        (wrong(states=[{"id": "q0"}, {"id": "q1"}, {"id": "q1"}]), "duplicate state q1"),
        (wrong(states=[{"id": "q0"}, {"id": "q 1"}]), 'bad state id "q 1"'),
        (
            wrong(transitions=[{"from": "q0", "to": "q9", "symbols": ["0"]}]),
            "unknown state q9 in q0>q9",
        ),
        (wrong(transitions=[{"from": "q0", "to": "q1", "symbols": []}]), "no symbols in q0>q1"),
        (wrong(transitions=[{"from": "q0", "to": "q1", "symbols": ["ε"]}]), "ε in a DFA"),
        (
            wrong(
                transitions=[
                    {"from": "q0", "to": "q1", "symbols": ["1"]},
                    {"from": "q0", "to": "q0", "symbols": ["1"]},
                ]
            ),
            "two moves from q0 on 1",
        ),
    ],
    ids=["unknown start", "duplicate", "bad id", "unknown state", "no symbols", "ε", "two moves"],
)
def test_names_each_problem_with_a_spec_as_the_app_does(spec, problem):
    with pytest.raises(ValidationError, match=problem):
        AutomatonSpec.model_validate(spec)


def test_takes_digit_led_state_ids_and_an_nfa_with_epsilon():
    AutomatonSpec.model_validate(
        {
            "kind": "nfa",
            "states": [{"id": "0", "accept": True}, {"id": "10"}],
            "start": "0",
            "transitions": [{"from": "0", "to": "10", "symbols": ["ε", "a"]}],
        }
    )
    with pytest.raises(ValidationError):
        AutomatonSpec.model_validate(wrong(states=[{"id": "_0"}], start="_0", transitions=[]))
