"""The eval scenarios are data: every shipped file loads, and a malformed one is refused with the
reason, before any provider is called."""

import json

import pytest

from tassel.evals.scenario import (
    SCENARIOS_DIR,
    Scenario,
    ScenarioError,
    estimate_turn,
    load_scenarios,
)

# The owner's three live transcripts, replayed by their student lines.
REPLAYS = {"replay-767b954e": 27, "replay-eb3eeab4": 13, "replay-2de450e6": 21}


def test_every_shipped_scenario_loads_and_the_default_set_skips_replays():
    every = load_scenarios(["all"])
    names = [s.name for s in every]
    assert len(names) == len(set(names))
    assert {path.stem for path in SCENARIOS_DIR.glob("*.json")} == set(names)
    default = {s.name for s in load_scenarios([])}
    assert default and not default & set(REPLAYS)
    assert {"views", "dfa", "network", "clear-one", "paper-marks"} <= default
    for name, turns in REPLAYS.items():
        (replay,) = load_scenarios([name])
        assert len(replay.turns) == turns
        assert not replay.default


def test_view_scenario_covers_every_view_request():
    (views,) = load_scenarios(["views"])
    said = [t.student.lower() for t in views.turns]
    for phrase in (
        "back to camera",
        "switch the board to full screen",
        "desk view, please",
        "go back desk view",
        "side by side",
    ):
        assert any(phrase in s for s in said), phrase
    assert all(t.expect.route == "view" for t in views.turns)
    assert all(estimate_turn(t, i) == 0 for i, t in enumerate(views.turns))


def test_default_set_fits_the_token_budget_estimate():
    total = sum(
        estimate_turn(t, i, page=s.page_at(i))
        for s in load_scenarios([])
        for i, t in enumerate(s.turns)
    )
    assert 20_000 < total <= 150_000


def write(tmp_path, data):
    path = tmp_path / f"{data['name']}.json"
    path.write_text(json.dumps(data))
    return tmp_path


def base(**turn):
    return {"name": "bad", "title": "Bad", "turns": [{"student": "Hi", **turn}]}


@pytest.mark.parametrize(
    "turn,reason",
    [
        ({"page": "no-such-page"}, "unknown page fixture"),
        ({"expect": {"tags": ["board.sketch"]}}, "unknown tag kind"),
        ({"expect": {"board": {"same_as_turn": 1}}}, "earlier turn"),
        ({"expect": {"marks": [{"type": "circle", "truth": "q0"}]}}, "page fixture"),
        ({"page": "dfa-page", "expect": {"marks": [{"type": "circle", "truth": "ip"}]}}, "truth"),
        ({"expect": {"surprise": True}}, "Extra inputs"),
    ],
)
def test_malformed_scenarios_are_refused_with_the_reason(tmp_path, turn, reason):
    directory = write(tmp_path, base(**turn))
    with pytest.raises(ScenarioError, match=reason):
        load_scenarios(["bad"], directory=directory)


def test_a_file_must_carry_its_own_name(tmp_path):
    (tmp_path / "other.json").write_text(json.dumps(base()))
    with pytest.raises(ScenarioError, match="other.json names 'bad'"):
        load_scenarios(["all"], directory=tmp_path)


def test_unknown_scenario_names_are_refused():
    with pytest.raises(ScenarioError, match="unknown scenario 'nope'"):
        load_scenarios(["nope"])


def test_pages_stay_until_changed():
    scenario = Scenario.model_validate(
        {
            "name": "pages",
            "title": "Pages",
            "turns": [
                {"student": "a"},
                {"student": "b", "page": "ip-page"},
                {"student": "c"},
                {"student": "d", "page": "none"},
            ],
        }
    )
    assert [scenario.page_at(i) for i in range(4)] == [None, "ip-page", "ip-page", None]
    assert scenario.has_pages


def test_estimates_follow_the_route():
    scenario = Scenario.model_validate(
        {
            "name": "est",
            "title": "Est",
            "turns": [
                {"student": "Back to camera, please."},
                {"student": "Can you draw a DFA on the board for strings that start with 1?"},
                {"student": "Thanks!", "expect": {"route": "talker"}},
            ],
        }
    )
    view, draw, talk = (estimate_turn(t, i) for i, t in enumerate(scenario.turns))
    assert view == 0 and draw > talk > 0
