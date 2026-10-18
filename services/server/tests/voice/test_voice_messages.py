"""The voice event contract, against packages/shared/src/voice/fixtures.json: the same examples
the desktop app's contract tests read, so the server and the app can't drift apart."""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from tassel.voice.messages import (
    CLIENT_EVENTS,
    ICE_SERVERS_ROUTE,
    LANGUAGE_SWITCH_PREFIX,
    OFFER_ROUTE,
    SERVER_EVENTS,
    VOICE_BUDGETS,
    OfferRequestData,
    StageEvent,
    TurnMetrics,
    envelope,
    is_note,
)

REPO = Path(__file__).resolve().parents[4]
FIXTURES = json.loads(
    (REPO / "packages/shared/src/voice/fixtures.json").read_text(encoding="utf-8")
)

METRICS = {
    "turn": 1,
    "lang": "en",
    "input": "voice",
    "stt_ms": 250,
    "llm_ttfb_ms": 240,
    "tts_ttfb_ms": 150,
    "server_ttfa_ms": 700,
    "interrupted": False,
    "budget_ms": 1200,
}
CLIENT_METRICS = {
    "kind": "client-metrics",
    "ttfa_ms": 900,
    "barge_in_ms": 420,
    "yield_ms": 250,
    "sensitivity": "normal",
}


@pytest.mark.parametrize("event", FIXTURES["server"], ids=lambda e: e["kind"])
def test_server_events_round_trip(event):
    assert SERVER_EVENTS.dump_python(SERVER_EVENTS.validate_python(event), mode="json") == event


@pytest.mark.parametrize("event", FIXTURES["client"], ids=lambda e: e["kind"])
def test_client_events_round_trip(event):
    assert CLIENT_EVENTS.dump_python(CLIENT_EVENTS.validate_python(event), mode="json") == event


def test_budgets_and_routes_match_the_fixture():
    assert VOICE_BUDGETS == FIXTURES["budgets"]
    assert "/v1" + OFFER_ROUTE == FIXTURES["endpoints"]["offer"]
    assert "/v1" + ICE_SERVERS_ROUTE == FIXTURES["endpoints"]["ice_servers"]


def test_offer_request_data_defaults():
    d = OfferRequestData.model_validate({})
    assert (d.scenario, d.sensitivity, d.ptt) == (None, "normal", False)


def test_notes():
    assert is_note(LANGUAGE_SWITCH_PREFIX + " The student switched…")
    assert is_note("[vision] DFA attempt complete.")
    assert not is_note("Hi Ada, I'm working on a DFA")


def test_envelope():
    assert envelope(StageEvent(kind="stage", view="split")) == {
        "tassel": {"kind": "stage", "view": "split"}
    }


# Beyond the brief's examples: what the models refuse, and the fixture's other sections.


@pytest.mark.parametrize(
    "event",
    [
        pytest.param({"kind": "nope"}, id="unknown kind"),
        pytest.param({"kind": "board-snapshot", "image": "x"}, id="snapshot has no payload"),
        pytest.param({"kind": "actions"}, id="actions missing"),
        pytest.param({"kind": "actions", "actions": [{"kind": "unknown"}]}, id="invalid action"),
        pytest.param({"kind": "beat", "beat": None}, id="null beat"),
        pytest.param({"kind": "beat", "beat": {"version": 1}}, id="invalid beat"),
        pytest.param({"view": "split"}, id="no kind"),
        pytest.param({"kind": "title"}, id="title missing"),
        pytest.param({"kind": "title", "title": "Strings"}, id="subject missing, not null"),
        pytest.param({"kind": "vad", "speaking": "yes"}, id="string for a bool"),
        pytest.param({"kind": "vad", "speaking": 1}, id="number for a bool"),
        pytest.param({"kind": "stage", "view": "split", "extra": 1}, id="undeclared field"),
        pytest.param({"kind": "language", "lang": "fr"}, id="unsupported language"),
        pytest.param(
            {"kind": "route", "lang": "en", "stt": "whisper", "llm": "fake", "tts": "fake"},
            id="unknown STT",
        ),
        pytest.param(
            {"kind": "turn-metrics", "metrics": {**METRICS, "turn": "1"}}, id="string for an int"
        ),
        pytest.param(
            {"kind": "turn-metrics", "metrics": {**METRICS, "extra": 1}},
            id="undeclared metric",
        ),
    ],
)
def test_server_events_refuse_what_the_contract_does_not_say(event):
    with pytest.raises(ValidationError):
        SERVER_EVENTS.validate_python(event)


@pytest.mark.parametrize(
    "event",
    [
        pytest.param({"kind": "ptt", "enabled": "yes", "held": True}, id="string for a bool"),
        pytest.param({"kind": "ptt", "enabled": True}, id="held missing"),
        pytest.param({"kind": "sensitivity", "level": "max"}, id="unknown sensitivity"),
        pytest.param({**CLIENT_METRICS, "ttfa_ms": "900"}, id="string for a time"),
        pytest.param({**CLIENT_METRICS, "ttfa_ms": True}, id="bool for a time"),
        pytest.param({**CLIENT_METRICS, "ttfa_ms": float("inf")}, id="infinite time"),
        pytest.param({**CLIENT_METRICS, "ttfa_ms": float("nan")}, id="NaN time"),
        pytest.param({**CLIENT_METRICS, "extra": 1}, id="undeclared field"),
    ],
)
def test_client_events_refuse_what_the_contract_does_not_say(event):
    with pytest.raises(ValidationError):
        CLIENT_EVENTS.validate_python(event)


def test_fractional_times_round_to_whole_milliseconds():
    # The app times with performance.now(), and the server with nanosecond clocks.
    client = CLIENT_EVENTS.validate_python({**CLIENT_METRICS, "ttfa_ms": 812.4, "yield_ms": 249.6})
    assert (client.ttfa_ms, client.barge_in_ms, client.yield_ms) == (812, 420, 250)
    turn = TurnMetrics(**{**METRICS, "stt_ms": 250.00000000000003, "llm_ttfb_ms": None})
    assert (turn.stt_ms, turn.llm_ttfb_ms) == (250, None)


def test_the_offer_request_data_example_round_trips():
    example = FIXTURES["offer_request_data"]
    assert OfferRequestData.model_validate(example).model_dump(mode="json") == example


def test_scenario_lines_give_every_language_its_lines():
    lines = FIXTURES["scenario_lines"]
    assert set(lines) == {"dfa-opening", "barge-in", "ptt"}
    for by_lang in lines.values():
        assert set(by_lang) == {"en", "es", "ko"}
        for said in by_lang.values():
            assert said and all(isinstance(line, str) and line.strip() for line in said)


def test_the_contract_never_loads_pipecat():
    # The OpenAPI export and the app's routes import the contract; Pipecat stays out of them.
    probe = "import sys, tassel.voice.messages; print([m for m in sys.modules if 'pipecat' in m])"
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    assert (result.returncode, result.stdout.strip()) == (0, "[]"), result.stderr
