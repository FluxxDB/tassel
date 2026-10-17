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
        {"kind": "nope"},
        {"view": "split"},
        {"kind": "title"},
        {"kind": "title", "title": "Strings that start with 010"},
        {"kind": "vad", "speaking": "yes"},
        {"kind": "vad", "speaking": 1},
        {"kind": "stage", "view": "split", "extra": 1},
        {"kind": "language", "lang": "fr"},
        {"kind": "route", "lang": "en", "stt": "whisper", "llm": "fake", "tts": "fake"},
        {"kind": "turn-metrics", "metrics": {**METRICS, "turn": "1"}},
        {"kind": "turn-metrics", "metrics": {**METRICS, "extra": 1}},
    ],
    ids=repr,
)
def test_server_events_refuse_what_the_contract_does_not_say(event):
    with pytest.raises(ValidationError):
        SERVER_EVENTS.validate_python(event)


@pytest.mark.parametrize(
    "event",
    [
        {"kind": "ptt", "enabled": "yes", "held": True},
        {"kind": "ptt", "enabled": True},
        {"kind": "sensitivity", "level": "max"},
        {**CLIENT_METRICS, "ttfa_ms": "900"},
        {**CLIENT_METRICS, "ttfa_ms": True},
        {**CLIENT_METRICS, "ttfa_ms": float("inf")},
        {**CLIENT_METRICS, "ttfa_ms": float("nan")},
        {**CLIENT_METRICS, "extra": 1},
    ],
    ids=repr,
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
