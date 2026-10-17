"""The vision contract (P4 Task 1): the Python models against the fixtures both sides' tests read.

``packages/shared/src/vision/fixtures.json`` holds the readings, the verdict fields Task 4 must
reproduce, and one example of each vision event. ``packages/shared/tests/vision-contract.test.ts``
checks the same file against the TypeScript guards.
"""

import json
from pathlib import Path
from typing import Annotated, Any, get_args

import pytest
from pydantic import Field, TypeAdapter, ValidationError

from tassel.domains.base import ClaimKind, Verifier
from tassel.domains.dfa.contract import (
    DEAD,
    EPSILON,
    PREDICATE_SCHEMA,
    Blame,
    DfaReading,
    DfaVerdict,
    MembershipPredicate,
    ReadState,
    ReadTransition,
)
from tassel.vision.messages import (
    CheckDebug,
    GateDebug,
    PenEvent,
    PolicyDebug,
    ReadbackEvent,
    VisionDebugEvent,
)
from tassel.vision.ports import PREDICATE_QUESTIONS, PREDICATES

REPO = Path(__file__).resolve().parents[4]
FIXTURES = json.loads(
    (REPO / "packages" / "shared" / "src" / "vision" / "fixtures.json").read_text(encoding="utf-8")
)
READINGS: dict[str, dict] = FIXTURES["readings"]
EVENTS: list[dict] = FIXTURES["events"]

Event = TypeAdapter(
    Annotated[ReadbackEvent | VisionDebugEvent | PenEvent, Field(discriminator="kind")]
)


@pytest.mark.parametrize("name", sorted(READINGS))
def test_fixture_readings_round_trip(name):
    reading = READINGS[name]
    assert DfaReading.model_validate(reading).model_dump(mode="json") == reading


@pytest.mark.parametrize(
    "event", EVENTS, ids=lambda e: e["kind"] + "/" + e.get("debug", {}).get("stage", "")
)
def test_fixture_events_round_trip(event):
    assert Event.validate_python(event).model_dump(mode="json") == event


def test_read_state_refuses_an_extra_field_and_a_string_confidence():
    state = READINGS["demo-wrong"]["states"][0]
    ReadState.model_validate(state)
    with pytest.raises(ValidationError, match="extra_forbidden"):
        ReadState.model_validate({**state, "color": "ink"})
    with pytest.raises(ValidationError, match="float_type"):
        ReadState.model_validate({**state, "confidence": "0.95"})


def _resolve(schema: dict, node: dict) -> tuple[str | None, dict]:
    ref = node.get("$ref")
    if ref is None:
        return None, node
    assert ref.startswith("#/$defs/"), ref
    name = ref.removeprefix("#/$defs/")
    return name, schema["$defs"][name]


def _walk(node: Any):
    """Every schema object nested in ``node``, ``node`` included."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


def _references(node: Any) -> set[str]:
    return {n["$ref"].removeprefix("#/$defs/") for n in _walk(node) if "$ref" in n}


def test_predicate_schema_obeys_structured_output_limits():
    schema = PREDICATE_SCHEMA
    nodes = list(_walk(schema))

    # Every object forbids other properties and requires every property it lists.
    objects = [n for n in nodes if n.get("type") == "object" or "properties" in n]
    assert len(objects) == 3  # MembershipPredicate, Clause, Atom
    for obj in objects:
        assert obj.get("additionalProperties") is False, obj.get("title")
        assert sorted(obj.get("required", [])) == sorted(obj["properties"]), obj.get("title")

    # No numeric, string-length or array-size constraints anywhere.
    forbidden = {"minimum", "maximum", "minLength", "maxLength", "maxItems"}
    assert [key for n in nodes for key in n if key in forbidden] == []

    # No recursion: the definitions' references form no cycle.
    defs = schema.get("$defs", {})
    graph = {name: _references(body) for name, body in defs.items()}

    def reaches(start: str, target: str, seen: set[str]) -> bool:
        return any(
            nxt == target or (nxt not in seen and reaches(nxt, target, seen | {nxt}))
            for nxt in graph[start]
        )

    assert [name for name in graph if reaches(name, name, {name})] == []

    # At most 16 union-typed properties in the whole schema.
    unions = [
        (obj.get("title"), prop)
        for obj in objects
        for prop, body in obj["properties"].items()
        if "anyOf" in _resolve(schema, body)[1] or isinstance(body.get("type"), list)
    ]
    assert len(unions) <= 16, unions


# Beyond the brief's examples.


def test_the_brief_constants():
    assert (EPSILON, DEAD) == ("ε", "∅")
    assert PREDICATES == (
        "diagram_attempt_complete",
        "new_work_worth_checking",
        "student_seems_stuck",
        "not_schoolwork",
    )
    assert list(PREDICATE_QUESTIONS) == list(PREDICATES)
    assert PREDICATE_QUESTIONS["student_seems_stuck"] == (
        "Does the student seem stuck? Yes if her automaton looks unfinished and she has stopped"
        " writing and talking for a while."
    )


def test_the_fixtures_hold_every_named_reading():
    assert sorted(READINGS) == sorted(
        [
            "demo-wrong",
            "demo-partial",
            "demo-correct",
            "demo-no-accept",
            "nondeterministic",
            "nfa-ends-with-01",
            "unknown-symbol",
            "uncertain",
        ]
    )
    for reading in READINGS.values():
        assert reading["source"] == "fixture"
        ids = [s["id"] for s in reading["states"]] + [t["id"] for t in reading["transitions"]]
        assert len(ids) == len(set(ids))
        assert set(reading["uncertain"]) <= set(ids)


def test_the_synthetic_page_geometry():
    # P3's dfa-demo page: states at y 0.55 and x 0.18, 0.39, 0.60, 0.81, radius 0.055 of the page
    # width; label boxes 0.04 × 0.04 around P3's label positions.
    for name, reading in READINGS.items():
        for state in reading["states"]:
            assert state["center"]["y"] == 0.55, name
            assert state["center"]["x"] in (0.18, 0.39, 0.6, 0.81), name
            assert state["r"] == 0.055, name
        for transition in reading["transitions"]:
            box = transition["label_box"]
            assert (box["w"], box["h"]) == (0.04, 0.04), name


def test_the_expected_verdict_fields():
    expected = FIXTURES["expected"]
    assert sorted(expected) == ["demo-correct", "demo-no-accept", "demo-partial", "demo-wrong"]
    for name, entry in expected.items():
        assert name in READINGS
        assert entry["reference"] == "starts-with-010"
        counterexample = entry["counterexample"]
        if counterexample is not None:
            Blame.model_validate(counterexample["blame"])
    wrong = expected["demo-wrong"]
    assert wrong["status"] == "wrong"
    assert wrong["counterexample"] == {
        "input": "1010",
        "direction": "false_accept",
        "blame": {
            "step": 1,
            "kind": "transition",
            "state": "q0",
            "symbol": "1",
            "target": "q0",
            "prefix": "",
        },
    }
    assert expected["demo-correct"] == {
        "reference": "starts-with-010",
        "status": "correct",
        "counterexample": None,
    }


def test_the_readback_example_carries_demo_wrong_and_its_verdict():
    readback = next(e for e in EVENTS if e["kind"] == "readback")
    assert readback["reading"] == READINGS["demo-wrong"]
    verdict = DfaVerdict.model_validate(readback["verdict"])
    assert verdict.status == "wrong" and verdict.computed
    assert verdict.counterexample is not None
    assert verdict.counterexample.input == "1010"
    assert verdict.counterexample.student_trace == [["q0"], ["q0"], ["q1"], ["q2"], ["q3"]]
    assert verdict.reference is not None and verdict.reference.id == "starts-with-010"
    assert sorted(e.get("debug", {}).get("stage", e["kind"]) for e in EVENTS) == [
        "check",
        "gate",
        "pen",
        "policy",
        "readback",
    ]


def test_strictness_beyond_read_state():
    transition = READINGS["demo-wrong"]["transitions"][0]
    with pytest.raises(ValidationError):
        ReadTransition.model_validate({**transition, "symbols": "0"})
    with pytest.raises(ValidationError):
        ReadTransition.model_validate({**transition, "mark": 7.0})
    with pytest.raises(ValidationError):
        DfaReading.model_validate({**READINGS["demo-wrong"], "version": 2})
    with pytest.raises(ValidationError):
        PenEvent.model_validate({"kind": "pen", "busy": "yes"})
    with pytest.raises(ValidationError):
        VisionDebugEvent.model_validate({"kind": "vision-debug", "debug": {"stage": "vibes"}})
    with pytest.raises(ValidationError):
        GateDebug.model_validate(
            {"reason": "frame", "probs": {"is_it_lunch": 0.5}, "ms": 1, "provider": "fake"}
        )
    CheckDebug.model_validate({"status": "timeout", "witness": None, "blame": None, "ms": 2000})
    PolicyDebug.model_validate({"action": "holding-line", "rung": None, "why": "check > 2 s"})


def test_membership_predicate_round_trips_through_its_schema():
    predicate = {
        "expressible": True,
        "any_of": [
            {
                "all_of": [
                    {
                        "op": "starts_with",
                        "text": "010",
                        "symbol": None,
                        "n": None,
                        "m": None,
                        "r": None,
                        "negate": False,
                    }
                ]
            }
        ],
    }
    assert MembershipPredicate.model_validate(predicate).model_dump(mode="json") == predicate
    assert PREDICATE_SCHEMA == MembershipPredicate.model_json_schema()


def test_the_domain_protocol():
    class Echo:
        subject = "test.echo"

        def verify(self, reading, reference):
            return reading

    assert isinstance(Echo(), Verifier)
    assert not isinstance(object(), Verifier)
    assert get_args(ClaimKind) == ("computed", "judged")
