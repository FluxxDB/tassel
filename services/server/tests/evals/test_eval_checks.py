"""Outcome checks, fed recorded events: what reached the stage and the board, which tags reached
beats, where paper marks landed, and what Ada must never say."""

import pytest

from tassel.evals.checks import (
    Observation,
    action_kinds,
    check_turn,
    forbidden_phrases,
    stale_repeats,
)
from tassel.evals.fixtures import render
from tassel.evals.scenario import Turn

DFA = {"kind": "dfa", "states": [{"id": "q0"}], "start": "q0", "alphabet": ["0"]}


def obs(**kwargs):
    defaults = dict(
        student="Hi",
        spoken="Okay.",
        stage=[],
        actions=[],
        decision={"route": "talker", "action": "none"},
        view_request=None,
        board_before={"automata": {}, "diagrams": {}},
        board_after={"automata": {}, "diagrams": {}},
        prompt_tokens=100,
    )
    return Observation(**{**defaults, **kwargs})


def turn(**expect):
    return Turn.model_validate({"student": "Hi", "expect": expect})


def failed(results):
    return {r.name for r in results if not r.ok}


@pytest.mark.parametrize(
    "spoken,found",
    [
        ("Hang on, let me look at that.", ["hang on", "let me"]),
        ("I’ll look again in a second.", ["i'll look again"]),
        ("Sure [assistant turn omitted] here.", ["[assistant turn omitted]"]),
        ("Here's the board.", []),
        ("Let's trace it.", []),
        # The ladder's step 1 opens with it, and draws in the same turn (owner, 2026-10-18).
        ("Okay, let me help you out. Here's your machine.", []),
        ("Let me help you out. Let me check the rest.", ["let me"]),
    ],
)
def test_forbidden_phrases(spoken, found):
    assert forbidden_phrases(spoken) == found


def test_extra_forbidden_phrases_are_case_insensitive():
    assert forbidden_phrases("Removing the PCs now.", ["removing the pcs"]) == ["removing the pcs"]


def test_stale_repeats_catch_an_earlier_line_on_a_later_turn():
    earlier = ["Sure. I'll remove the three PCs from the Sales zone. Anything else?"]
    assert stale_repeats(
        "A hub repeats. I'll remove the three PCs from the Sales zone!", earlier
    ) == ["i'll remove the three pcs from the sales zone"]
    # Short lines and the fixed view acknowledgements repeat by design.
    assert (
        stale_repeats(
            "Anything else? Here they are side by side.",
            ["Anything else? Here they are side by side."],
        )
        == []
    )


def test_action_kinds_name_paper_mark_types():
    actions = [
        {"kind": "board.automaton", "item": "a"},
        {"kind": "paper.mark", "mark": {"type": "underline", "id": "k1", "target": {"el": "m1"}}},
    ]
    assert action_kinds(actions) == ["board.automaton", "paper.mark", "paper.mark:underline"]


def test_default_checks_pass_a_clean_turn():
    results = check_turn(turn(), obs(), earlier=[])
    assert {r.name for r in results} >= {"spoke", "forbidden phrases", "no stale repeats"}
    assert failed(results) == set()


def test_silence_and_forbidden_words_fail():
    assert failed(check_turn(turn(), obs(spoken=""), earlier=[])) == {"spoke"}
    assert failed(check_turn(turn(), obs(spoken="Hang on."), earlier=[])) == {"forbidden phrases"}
    line = "Removing the three PCs from the board now."
    stale = check_turn(turn(), obs(spoken=line), earlier=[obs(spoken=line)])
    assert failed(stale) == {"no stale repeats"}
    allowed = check_turn(turn(allow_repeat=True), obs(spoken=line), earlier=[obs(spoken=line)])
    assert failed(allowed) == set()


def test_view_route_means_a_set_line_and_no_model_call():
    expect = turn(route="view", stage=[{"view": "paper", "pinned": True}], tags=[])
    good = obs(
        view_request="paper",
        decision=None,
        prompt_tokens=0,
        stage=[{"view": "paper", "pinned": True}],
    )
    assert failed(check_turn(expect, good, earlier=[])) == set()
    model = obs(stage=[{"view": "split", "pinned": False}], prompt_tokens=900)
    assert failed(check_turn(expect, model, earlier=[])) == {"route", "stage"}


def test_stage_none_means_no_stage_event():
    assert failed(check_turn(turn(stage=[]), obs(stage=[{"view": "split"}]), earlier=[])) == {
        "stage"
    }


def test_route_and_action_come_from_the_director():
    expect = turn(route="thinker", action="draw_board")
    good = obs(decision={"route": "thinker", "action": "draw_board"})
    assert failed(check_turn(expect, good, earlier=[])) == set()
    bad = obs(decision={"route": "talker", "action": "explain"})
    assert failed(check_turn(expect, bad, earlier=[])) == {"route", "action"}


def test_tags_must_reach_beats_or_none_at_all():
    drew = obs(actions=[{"kind": "board.automaton", "item": "a"}])
    assert failed(check_turn(turn(tags=["board.automaton"]), drew, earlier=[])) == set()
    assert failed(check_turn(turn(tags=["board.trace"]), drew, earlier=[])) == {"tags"}
    assert failed(check_turn(turn(tags=[]), drew, earlier=[])) == {"tags"}
    assert failed(check_turn(turn(no_tags=["board.automaton"]), drew, earlier=[])) == {"no tags"}


def diagram(*icons):
    return {
        "direction": "LR",
        "groups": [{"id": "g1", "label": "Sales"}],
        "nodes": [{"id": f"n{i}", "label": icon, "icon": icon} for i, icon in enumerate(icons)],
        "edges": [],
    }


def test_board_counts_and_items():
    after = {"automata": {"dfa1": DFA}, "diagrams": {"office": diagram("router", "pc", "pc")}}
    good = turn(
        board={
            "automata": 1,
            "diagrams": {"min": 1},
            "has": ["office"],
            "lacks": ["net"],
            "nodes": {"min": 3, "max": 3},
            "groups": 1,
            "icons": {"pc": {"min": 2}, "router": 1},
        }
    )
    assert failed(check_turn(good, obs(board_after=after), earlier=[])) == set()
    bad = turn(board={"automata": 0, "icons": {"pc": {"min": 6}}, "has": ["net"]})
    results = check_turn(bad, obs(board_after=after), earlier=[])
    assert failed(results) == {"board"}
    detail = next(r.detail for r in results if r.name == "board")
    assert "automata" in detail and "pc" in detail and "net" in detail


def test_board_same_as_an_earlier_turn_and_unchanged():
    one = {"automata": {}, "diagrams": {"office": diagram("router")}}
    two = {"automata": {}, "diagrams": {"office": diagram("router", "pc")}}
    history = [obs(board_after=one), obs(board_after=two)]
    undo = turn(board={"same_as_turn": 1})
    assert failed(check_turn(undo, obs(board_after=one), earlier=history)) == set()
    assert failed(check_turn(undo, obs(board_after=two), earlier=history)) == {"board"}
    still = turn(board={"unchanged": True})
    assert failed(check_turn(still, obs(board_before=two, board_after=two), earlier=[])) == set()
    assert failed(check_turn(still, obs(board_before=one, board_after=two), earlier=[])) == {
        "board"
    }


def mark(kind, el):
    return {"kind": "paper.mark", "mark": {"type": kind, "id": "k1", "target": {"el": el}}}


def test_marks_must_land_on_the_fixture_truth():
    q2 = render("dfa-page").truths["q2"].box
    ip = render("ip-page").truths["ip"].box
    elements = {
        # The state's own label, inside its ring: counts as the state.
        "m3": {"x": q2[0] + 50, "y": q2[1] + 50, "w": 60, "h": 60},
        # Somewhere else on the page.
        "m4": {"x": 5, "y": 5, "w": 40, "h": 40},
    }
    expect = turn(marks=[{"type": "circle", "truth": "q2"}])
    hit = obs(actions=[mark("circle", "m3")], elements=elements, page="dfa-page")
    assert failed(check_turn(expect, hit, earlier=[])) == set()
    miss = obs(actions=[mark("circle", "m4")], elements=elements, page="dfa-page")
    assert failed(check_turn(expect, miss, earlier=[])) == {"marks"}
    wrong_type = obs(actions=[mark("underline", "m3")], elements=elements, page="dfa-page")
    assert failed(check_turn(expect, wrong_type, earlier=[])) == {"marks"}
    # A text line must be mostly covered: the "1" of "10.0.0.0/24" alone is not the IP.
    one = {"m1": {"x": ip[0], "y": ip[1], "w": 30, "h": ip[3]}}
    whole = {"m1": {"x": ip[0] - 4, "y": ip[1] - 4, "w": ip[2] + 8, "h": ip[3] + 8}}
    underline = turn(marks=[{"type": "underline", "truth": "ip"}])
    act = [mark("underline", "m1")]
    short = obs(actions=act, elements=one, page="ip-page")
    assert failed(check_turn(underline, short, earlier=[])) == {"marks"}
    full = obs(actions=act, elements=whole, page="ip-page")
    assert failed(check_turn(underline, full, earlier=[])) == set()


def test_box_targets_are_normalized_page_coordinates():
    page = render("ip-page")
    x, y, w, h = page.truths["ip"].box
    box = {"x": x / page.width, "y": y / page.height, "w": w / page.width, "h": h / page.height}
    action = {
        "kind": "paper.mark",
        "mark": {"type": "underline", "id": "k", "target": {"box": box}},
    }
    expect = turn(marks=[{"type": "underline", "truth": "ip"}])
    assert failed(check_turn(expect, obs(actions=[action], page="ip-page"), earlier=[])) == set()


def test_timing_limits():
    expect = turn(max_ms={"first_audio": 3000})
    assert failed(check_turn(expect, obs(timings={"first_audio": 2000.0}), earlier=[])) == set()
    assert failed(check_turn(expect, obs(timings={"first_audio": 4000.0}), earlier=[])) == {
        "timing first_audio"
    }
    assert failed(check_turn(expect, obs(timings={}), earlier=[])) == {"timing first_audio"}


def test_an_unfinished_turn_fails():
    assert "finished" in failed(check_turn(turn(), obs(finished=False), earlier=[]))


def test_counts_of_kinds_and_a_closing_question():
    steps = [{"kind": "board.traceStep", "item": "t"}] * 2
    results = check_turn(
        turn(counts={"board.traceStep": {"min": 3}}, asks=True),
        obs(actions=steps, spoken="Zero. One. Can you fix it"),
        earlier=[],
    )
    assert failed(results) == {"counts", "asks"}
    results = check_turn(
        turn(counts={"board.traceStep": {"min": 3}, "board.automaton": 0}, asks=True),
        obs(actions=steps * 2, spoken="Zero. One. Zero. One. Can you fix it?"),
        earlier=[],
    )
    assert not failed(results)


def test_unknown_count_kinds_are_refused():
    from tassel.evals.scenario import Scenario

    with pytest.raises(ValueError, match="unknown tag kind"):
        Scenario.model_validate(
            {
                "name": "x",
                "title": "X",
                "turns": [{"student": "a", "expect": {"counts": {"no": 1}}}],
            }
        )


OFFICE = {
    "direction": "LR",
    "groups": [
        {"id": "s", "label": "Sales", "sublabel": "10.0.0.0/26"},
        {"id": "g", "label": "Guest Wi-Fi", "sublabel": "10.0.0.64/28"},
    ],
    "nodes": [
        {"id": "core", "label": "Core switch", "icon": "switch"},
        {"id": "s1", "label": "Sales switch", "icon": "switch", "group": "s"},
        {"id": "p1", "label": "PC 1", "icon": "pc", "group": "s"},
        {"id": "p2", "label": "PC 2", "icon": "pc", "group": "s"},
        {"id": "g1", "label": "Guest AP", "icon": "box", "group": "g"},
        {"id": "p3", "label": "PC 3", "icon": "pc", "group": "g"},
    ],
    "edges": [{"from": "core", "to": "s1", "directed": False, "style": "solid"}],
}


def test_board_details_labels_group_icons_edges_and_hosts():
    after = {"automata": {}, "diagrams": {"net": OFFICE}}
    good = turn(
        board={
            "labels": ["guest wifi", "Sales"],
            "lacks_labels": ["Engineering"],
            "group_icons": {"Sales": {"pc": 2}, "*": {"pc": {"min": 1}}},
            "edges": [{"from": "Sales switch", "to": "Core"}],
            "group_hosts": {"Sales": 60, "Guest": 14},
        }
    )
    assert failed(check_turn(good, obs(board_after=after), earlier=[])) == set()
    bad = turn(
        board={
            "labels": ["Engineering"],
            "lacks_labels": ["Sales"],
            "group_icons": {"*": {"pc": 2}, "Lab": {"pc": 1}},
            "edges": [{"from": "Guest AP", "to": "Core"}],
            "group_hosts": {"Guest": 20},
        }
    )
    results = check_turn(bad, obs(board_after=after), earlier=[])
    detail = next(r.detail for r in results if r.name == "board")
    for problem in (
        "no label 'Engineering'",
        "label 'Sales' still there",
        "Guest Wi-Fi: 1 pc, wanted 2",
        "no group 'Lab'",
        "no edge Guest AP - Core",
        "Guest: 14 usable hosts, wanted 20",
    ):
        assert problem in detail


def image_mark(kind, target):
    return {
        "kind": "image.mark",
        "attachment_id": "a",
        "mark": {"type": kind, "id": "k", "target": target},
    }


def test_image_marks_land_on_the_image_fixture_truth():
    image = render("dfa-page")
    q3, arrow = image.truths["q3"].box, image.truths["q2>q3"].box
    expect = Turn.model_validate(
        {
            "student": "Circle it",
            "expect": {
                "image_marks": [
                    {"type": "circle", "truth": "q3"},
                    {"type": "underline", "truth": "q2>q3"},
                ]
            },
        }
    )
    under = {
        "x": (arrow[0] + 20) / image.width,
        "y": (arrow[1] + 60) / image.height,
        "w": 100 / image.width,
        "h": 20 / image.height,
    }
    marks = [image_mark("circle", {"el": "m2"}), image_mark("underline", {"box": under})]
    on_q3 = {"m2": {"x": q3[0] + 40, "y": q3[1] + 40, "w": 80, "h": 80}}
    hit = obs(actions=marks, image="dfa-page", image_elements=on_q3)
    assert failed(check_turn(expect, hit, earlier=[])) == set()
    away = {"m2": {"x": 5, "y": 5, "w": 9, "h": 9}}
    results = check_turn(
        expect, obs(actions=marks, image="dfa-page", image_elements=away), earlier=[]
    )
    assert failed(results) == {"image marks"}
    assert "no circle on q3" in next(r.detail for r in results if r.name == "image marks")
