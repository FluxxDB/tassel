"""Transcription schema limits and real geometry snapping, independent of any provider."""

import json
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from tassel.domains.dfa.contract import EPSILON, PREDICATE_SCHEMA, Pt
from tassel.vision.clips import REPO_DIR, frame_at
from tassel.vision.marks import Candidates, CircleMark, LabelMark, find_candidates
from tassel.vision.page import FlatPage, flatten_page
from tassel.vision.transcription import (
    TRANSCRIPTION_SCHEMA,
    DfaTranscription,
    schema_problems,
    snap,
)

FIXTURE = Path(__file__).parent / "fixtures" / "transcription-demo.json"


@pytest.fixture
def data():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def geometry():
    quad = (Pt(x=0, y=0), Pt(x=1000, y=0), Pt(x=1000, y=500), Pt(x=0, y=500))
    page = FlatPage(np.zeros((500, 1000, 3), np.uint8), 1000, 500, quad, True)
    circles = tuple(CircleMark(i + 1, 100 + i * 200, 250, 40, i == 3) for i in range(4))
    labels = tuple(
        LabelMark(mark, 160 + i * 100, 180, 30, 20) for i, mark in enumerate([14, 16, 18, 10, 9])
    )
    return page, Candidates(circles, labels)


def reading(data, geometry):
    return snap(DfaTranscription.model_validate(data), *geometry, frame_id="frame-8")


def test_schema_obeys_the_limits():
    assert schema_problems(TRANSCRIPTION_SCHEMA) == []
    assert schema_problems(PREDICATE_SCHEMA) == []
    for keyword, value in [
        ("maxItems", 4),
        ("minItems", 2),
        ("minimum", 0),
        ("maximum", 1),
        ("exclusiveMinimum", 0),
        ("exclusiveMaximum", 1),
    ]:
        schema = deepcopy(TRANSCRIPTION_SCHEMA)
        schema["properties"]["states"][keyword] = value
        assert schema_problems(schema), keyword
    optional = deepcopy(TRANSCRIPTION_SCHEMA)
    optional["$defs"]["TState"]["required"].remove("label")
    assert schema_problems(optional)
    extra = deepcopy(TRANSCRIPTION_SCHEMA)
    extra["$defs"]["TBox"]["additionalProperties"] = True
    assert schema_problems(extra)
    allowed = deepcopy(TRANSCRIPTION_SCHEMA)
    allowed["properties"]["states"]["minItems"] = 1
    assert schema_problems(allowed) == []


def test_schema_union_budget_includes_nullable_properties():
    for count in [16, 17]:
        properties = {
            f"p{i}": {"anyOf": [{"type": "string"}, {"type": "null"}]} for i in range(count)
        }
        schema = {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        }
        assert bool(schema_problems(schema)) == (count > 16)
    # Problem kind is an enum including null, not an optional property.
    assert TRANSCRIPTION_SCHEMA["properties"]["problem_kind"]["enum"] == ["dfa", "nfa", None]


def test_schema_matches_the_model():
    def objects(schema, node, path="root"):
        if "$ref" in node:
            node = schema["$defs"][node["$ref"].removeprefix("#/$defs/")]
        out = {}
        if "properties" in node:
            out[path] = (set(node["properties"]), set(node["required"]))
            for name, prop in node["properties"].items():
                out.update(objects(schema, prop, f"{path}.{name}"))
        if "items" in node:
            out.update(objects(schema, node["items"], f"{path}[]"))
        for index, branch in enumerate(node.get("anyOf", [])):
            out.update(objects(schema, branch, f"{path}|{index}"))
        return out

    model = DfaTranscription.model_json_schema()
    assert objects(TRANSCRIPTION_SCHEMA, TRANSCRIPTION_SCHEMA) == objects(model, model)


def test_snap_takes_candidate_geometry(clip, data):
    files = clip("dfa-demo")
    page = flatten_page(frame_at(files.mjpeg, 47100), None)
    candidates = find_candidates(page)
    result = reading(data, (page, candidates))
    expected = json.loads((REPO_DIR / "packages/shared/src/vision/fixtures.json").read_text())[
        "readings"
    ]["demo-wrong"]
    assert result.kind == expected["kind"]
    assert result.alphabet == expected["alphabet"]
    assert [(s.id, s.label, s.start, s.accept) for s in result.states] == [
        (s["id"], s["label"], s["start"], s["accept"]) for s in expected["states"]
    ]
    assert [(e.id, e.source, e.symbols, e.target) for e in result.transitions] == [
        (e["id"], e["source"], e["symbols"], e["target"]) for e in expected["transitions"]
    ]
    truth = json.loads(files.truth.read_text())
    for state, actual in zip(result.states, truth["dfa"]["states"], strict=True):
        assert abs(state.center.x - actual["center"]["x"]) < 0.01
        assert abs(state.center.y - actual["center"]["y"]) < 0.01
        assert state.r == pytest.approx(actual["radius"], rel=0.1)
        assert state.snapped
    labels = {label.mark: label for label in candidates.labels}
    for edge, actual in zip(result.transitions, truth["dfa"]["transitions"], strict=True):
        label = labels[edge.mark]
        assert edge.snapped
        assert edge.label_box.model_dump() == pytest.approx(
            {
                "x": label.x / page.width,
                "y": label.y / page.height,
                "w": label.w / page.width,
                "h": label.h / page.height,
            }
        )
        # The checked fixture's mark still contains its real transition label.
        assert label.x <= actual["labelAt"]["x"] * page.width <= label.x + label.w
        assert label.y <= actual["labelAt"]["y"] * page.height <= label.y + label.h
    assert result.uncertain == []
    assert result.problem == expected["problem"]
    assert result.problem_kind == "dfa"
    assert result.language.model_dump() == expected["language"]
    assert result.source == "paper" and result.frame_id == "frame-8"
    assert result.page.width == page.width and result.page.height == page.height
    assert result.page.quad == list(page.quad)


def test_unsnapped_and_low_confidence_are_uncertain(data, geometry):
    data["states"][0].update(circle_mark=99, box={"x1": 20, "y1": 40, "x2": 100, "y2": 80})
    data["states"][1]["confidence"] = 0.5
    data["states"][2].update(accept=True, confidence=1.0)
    data["transitions"][0].update(label_mark=99, label_box={"x1": 50, "y1": 60, "x2": 70, "y2": 70})
    data["transitions"][1]["confidence"] = 0.5
    result = reading(data, geometry)
    a, b, conflict, _ = result.states
    assert not a.snapped and a.mark is None
    assert a.center.model_dump() == pytest.approx({"x": 0.06, "y": 0.12})
    assert a.box.model_dump() == pytest.approx({"x": 0.02, "y": 0.08, "w": 0.08, "h": 0.08})
    assert a.r == 0.02  # inscribed radius from the fallback box, in page widths
    assert b.snapped and b.confidence == 0.5
    assert conflict.accept and conflict.confidence == pytest.approx(0.7)
    assert conflict.id in result.uncertain  # disagreement stays uncertain even above 0.6
    edge = result.transitions[0]
    assert not edge.snapped and edge.mark is None
    assert edge.label_box.model_dump() == pytest.approx(
        {"x": 0.05, "y": 0.12, "w": 0.02, "h": 0.02}
    )
    assert result.uncertain == ["q0", "q1", "q2", "q0-0-q1", "q1-1-q2"]


def test_missing_and_wrong_kind_marks_fall_back(data, geometry):
    data["states"][0]["circle_mark"] = 14  # label mark cannot snap a state
    data["transitions"][0].update(label_mark=1, label_box=None)
    data["transitions"][1].update(label_mark=None, label_box=None)
    result = reading(data, geometry)
    assert not result.states[0].snapped
    for edge in result.transitions[:2]:
        assert edge.mark is None and not edge.snapped and edge.label_box is None
        assert edge.id in result.uncertain


def test_duplicate_labels_get_ids(data, geometry):
    data["states"][0]["label"] = "same"
    data["states"][1]["label"] = "same"
    data["states"][2].update(label="", circle_mark=None)
    data["transitions"][0].update(source="same", target="outside")
    result = reading(data, geometry)
    assert [s.id for s in result.states] == ["s1", "s2", "s2_2", "q3"]
    assert result.transitions[0].source == "same"  # ambiguous labels must not pick a state
    assert result.transitions[0].target == "outside"  # kept dangling for the verifier
    assert result.transitions[0].id in result.uncertain


def test_ids_do_not_alias_real_labels_or_dangling_endpoints(data, geometry):
    data["states"][0].update(label="", circle_mark=1)
    data["states"][1]["label"] = "s1"
    data["states"][2].update(label="", circle_mark=1)
    data["transitions"][0].update(source="s1_2", target="s1")
    result = reading(data, geometry)
    ids = [s.id for s in result.states]
    assert len(set(ids)) == 4
    assert ids[1] == "s1"
    assert "s1_2" not in ids
    assert result.transitions[0].source == "s1_2"
    assert result.transitions[0].target == "s1"


@pytest.mark.parametrize(
    "symbols,alphabet,expected",
    [
        (["ε", "λ", "e"], ["0", "1"], [EPSILON]),
        (["e", "λ", "ε"], ["e", "0"], ["e", EPSILON]),
        (["0", "1"], ["0", "1"], ["0", "1"]),
    ],
)
def test_epsilon_spellings(data, geometry, symbols, alphabet, expected):
    data["alphabet"] = alphabet
    data["transitions"][0]["symbols"] = symbols
    result = reading(data, geometry)
    edge = result.transitions[0]
    assert edge.symbols == expected
    assert edge.id == f"q0-{','.join(expected)}-q1"


def test_none_is_empty(data, geometry):
    data["machine_kind"] = "none"
    result = reading(data, geometry)
    assert result.states == [] and result.transitions == [] and result.alphabet == []
    assert result.uncertain == [] and result.kind == "dfa"
    assert result.problem == data["problem_statement"]
    assert result.problem_kind == data["problem_kind"]
    assert result.language.regex == data["language"]["regex"]


@pytest.mark.parametrize(
    "case,expected",
    [("epsilon", "nfa"), ("branch", "nfa"), ("duplicate", "dfa"), ("declared-only", "dfa")],
)
def test_nfa_kind(data, geometry, case, expected):
    data["machine_kind"] = "nfa"  # actual moves, not the model's declaration, decide
    if case == "epsilon":
        data["transitions"][0]["symbols"] = ["λ"]
    elif case in ("branch", "duplicate"):
        edge = deepcopy(data["transitions"][0])
        if case == "branch":
            edge["target"] = "q2"
        data["transitions"].append(edge)
    result = reading(data, geometry)
    assert result.kind == expected
    assert len({e.id for e in result.transitions}) == len(result.transitions)


def test_confidence_clamping_and_floor(data, geometry):
    data["states"][0]["confidence"] = -4
    data["states"][1]["confidence"] = 4
    data["states"][2]["confidence"] = 0.6
    data["transitions"][0]["confidence"] = 2
    data["transitions"][1]["confidence"] = -2
    data["language"]["confidence"] = 9
    result = reading(data, geometry)
    assert [s.confidence for s in result.states[:3]] == [0, 1, 0.6]
    assert [e.confidence for e in result.transitions[:2]] == [1, 0]
    assert result.language.confidence == 1
    assert result.uncertain == ["q0", "q1-1-q2"]


@pytest.mark.parametrize(
    "bad", ["extra", "nested-extra", "missing", "string-confidence", "nan-confidence", "inf-box"]
)
def test_model_rejects_malformed_output(data, bad):
    if bad == "extra":
        data["unknown"] = True
    elif bad == "nested-extra":
        data["states"][0]["box"]["extra"] = 1
    elif bad == "missing":
        del data["intent"]
    elif bad == "string-confidence":
        data["states"][0]["confidence"] = "0.9"
    elif bad == "nan-confidence":
        data["states"][0]["confidence"] = float("nan")
    else:
        data["states"][0]["box"]["x1"] = float("inf")
    with pytest.raises(ValidationError):
        DfaTranscription.model_validate(data)


def test_snap_is_pure_and_repeatable(data, geometry):
    transcription = DfaTranscription.model_validate(data)
    before = transcription.model_dump()
    first = snap(transcription, *geometry, frame_id=None)
    second = snap(transcription, *geometry, frame_id=None)
    assert first == second
    first.alphabet.append("mutated")
    first.transitions[0].symbols.append("mutated")
    first.page.quad[0].x = 12
    assert transcription.model_dump() == before
    assert geometry[0].quad[0].x == 0
    assert second.alphabet == ["0", "1"]


@pytest.mark.parametrize(
    "schema",
    [
        {"type": ["object", "null"], "additionalProperties": True},
        {"additionalProperties": True},
        {"type": ["object", "null"]},
    ],
)
def test_schema_rejects_open_objects_in_every_spelling(schema):
    assert schema_problems(schema)
