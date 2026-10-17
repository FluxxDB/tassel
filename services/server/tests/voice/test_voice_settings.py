"""Voice settings: provider modes, keys and the voice .env file (P2-R10, P2-R16).

Every test here runs under the autouse ``scrub_voice_env`` fixture (tests/conftest.py), so a test
that wants live settings constructs ``VoiceSettings(...)`` with dummy keys itself.
"""

import os
import subprocess
import sys
from fnmatch import fnmatchcase

import pytest
from pydantic import ValidationError

from tassel.config import Settings
from tassel.voice import settings as voice_settings
from tassel.voice.settings import (
    SERVER_DIR,
    IceServerConfig,
    VoiceConfigError,
    VoiceSettings,
    check_voice_settings,
    resolve_mode,
)

KINDS = ("stt", "llm", "tts", "titles")
KEYS = ("DEEPGRAM_API_KEY", "OPENROUTER_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY")
ALL_LIVE = {
    "deepgram_api_key": "dg-dummy",
    "openrouter_api_key": "or-dummy",
    "elevenlabs_api_key": "el-dummy",
    "voice_en": "v-en",
    "voice_es": "v-es",
    "voice_ko": "v-ko",
}


def modes(s: VoiceSettings) -> dict[str, str]:
    return {kind: resolve_mode(kind, s) for kind in KINDS}


def test_defaults_are_fake():
    s = VoiceSettings(_env_file=None)
    assert modes(s) == dict.fromkeys(KINDS, "fake")
    assert check_voice_settings(s) == []


def test_auto_is_live_only_with_its_key():
    s = VoiceSettings(_env_file=None, providers="auto", deepgram_api_key="dg")
    assert modes(s) == {"stt": "live", "llm": "fake", "tts": "fake", "titles": "fake"}


def test_live_without_key_is_reported():
    s = VoiceSettings(_env_file=None, llm_provider="openrouter")
    problem = "TASSEL_LLM_PROVIDER=openrouter needs OPENROUTER_API_KEY in services/server/.env"
    assert check_voice_settings(s) == [problem]
    with pytest.raises(VoiceConfigError) as raised:
        resolve_mode("llm", s)
    assert str(raised.value) == problem


@pytest.mark.parametrize("override", [None, "", "   "])
def test_live_tts_defaults_to_matilda(override):
    s = VoiceSettings(
        _env_file=None,
        providers="auto",
        elevenlabs_api_key="el",
        voice_en=override,
        voice_es=override,
        voice_ko=override,
    )
    assert check_voice_settings(s) == []
    assert resolve_mode("tts", s) == "live"
    assert [s.voice_en, s.voice_es, s.voice_ko] == ["XrExE9yKIg1WjnnlVkGX"] * 3


def test_voice_override_is_preserved():
    s = VoiceSettings(_env_file=None, voice_ko="native-ko")
    assert s.voice_ko == "native-ko"
    assert s.voice_en == "XrExE9yKIg1WjnnlVkGX"


@pytest.mark.parametrize(
    "provider,key",
    [
        ("openai", "openai_api_key"),
        ("openrouter", "openrouter_api_key"),
        ("auto", "openai_api_key"),
        ("auto", "openrouter_api_key"),
    ],
)
def test_llm_provider_accepts_r18_modes(provider, key):
    s = VoiceSettings(_env_file=None, llm_provider=provider, **{key: "dummy"})
    assert resolve_mode("llm", s) == "live"


def test_explicit_openai_needs_its_own_key():
    s = VoiceSettings(_env_file=None, llm_provider="openai", openrouter_api_key="dummy")
    assert check_voice_settings(s) == [
        "TASSEL_LLM_PROVIDER=openai needs OPENAI_API_KEY in services/server/.env"
    ]


def test_configured_providers_are_live_by_default():
    s = VoiceSettings(_env_file=None, deepgram_api_key="dummy")
    assert s.providers == "auto"
    assert resolve_mode("stt", s) == "live"


def test_empty_values_count_as_unset(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "DEEPGRAM_API_KEY=\nTASSEL_STT_PROVIDER=\nTASSEL_PROVIDERS=auto\n", encoding="utf-8"
    )
    s = VoiceSettings(_env_file=env_file)
    assert (s.providers, s.stt_provider, s.deepgram_api_key) == ("auto", None, None)
    assert resolve_mode("stt", s) == "fake"


def test_load_reads_the_env_file_it_is_told(tmp_path, monkeypatch):
    told = tmp_path / "told.env"
    told.write_text("DEEPGRAM_API_KEY=dg1\n", encoding="utf-8")
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", str(told))
    assert VoiceSettings.load().deepgram_api_key.get_secret_value() == "dg1"

    # Unset, load() reads SERVER_DIR/.env. A stand-in directory keeps the real file out of tests.
    stand_in = tmp_path / "server"
    stand_in.mkdir()
    (stand_in / ".env").write_text("DEEPGRAM_API_KEY=dg2\n", encoding="utf-8")
    monkeypatch.setattr(voice_settings, "SERVER_DIR", stand_in)
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", "")
    assert VoiceSettings.load().deepgram_api_key is None
    monkeypatch.delenv("TASSEL_VOICE_ENV_FILE")
    assert VoiceSettings.load().deepgram_api_key.get_secret_value() == "dg2"


def test_tests_never_see_developer_keys():
    for key in KEYS:
        assert key not in os.environ
    leftovers = [
        name
        for name in os.environ
        if fnmatchcase(name, "TASSEL_*PROVIDER*")
        or (fnmatchcase(name, "TASSEL_VOICE_*") and name != "TASSEL_VOICE_ENV_FILE")
    ]
    assert leftovers == []
    assert os.environ["TASSEL_VOICE_ENV_FILE"] == ""
    assert modes(VoiceSettings.load()) == dict.fromkeys(KINDS, "fake")


def test_secrets_never_print():
    turn = IceServerConfig(
        urls=["turn:turn.example:443?transport=tcp"], username="u", credential="turn-secret-4"
    )
    s = VoiceSettings(
        _env_file=None,
        deepgram_api_key="dg-secret-1",
        openrouter_api_key="or-secret-2",
        openai_api_key="oa-secret-5",
        elevenlabs_api_key="el-secret-3",
        ice_servers=[turn],
    )
    for text in (repr(s), str(s), s.model_dump_json(), repr(turn)):
        for secret in ("dg-secret-1", "or-secret-2", "el-secret-3", "turn-secret-4", "oa-secret-5"):
            assert secret not in text


# Beyond the brief's examples.


def test_validation_errors_never_echo_a_secret():
    # A malformed TASSEL_ICE_SERVERS fails startup; its TURN credential stays out of the message.
    with pytest.raises(ValidationError) as raised:
        VoiceSettings(_env_file=None, ice_servers={"urls": ["turn:x"], "credential": "turn-s3cret"})
    assert "turn-s3cret" not in str(raised.value)
    with pytest.raises(ValidationError) as raised:
        IceServerConfig.model_validate({"urls": {"turn:x": "turn-s3cret"}})
    assert "turn-s3cret" not in str(raised.value)


def test_an_override_beats_the_global_mode():
    s = VoiceSettings(_env_file=None, providers="live", stt_provider="fake", **ALL_LIVE)
    assert modes(s) == {"stt": "fake", "llm": "live", "tts": "live", "titles": "live"}
    assert check_voice_settings(s) == []


def test_global_live_names_tassel_providers_once_per_missing_key():
    # llm and titles share the OpenRouter key: one line, not two.
    s = VoiceSettings(_env_file=None, providers="live")
    assert check_voice_settings(s) == [
        "TASSEL_PROVIDERS=live needs DEEPGRAM_API_KEY in services/server/.env",
        "TASSEL_PROVIDERS=live needs OPENROUTER_API_KEY in services/server/.env",
        "TASSEL_PROVIDERS=live needs ELEVENLABS_API_KEY in services/server/.env",
    ]


def test_titles_use_the_openrouter_key():
    s = VoiceSettings(_env_file=None, titles_provider="live")
    assert check_voice_settings(s) == [
        "TASSEL_TITLES_PROVIDER=live needs OPENROUTER_API_KEY in services/server/.env"
    ]
    keyed = VoiceSettings(
        _env_file=None, providers="fake", titles_provider="auto", openrouter_api_key="or"
    )
    assert modes(keyed) == {"stt": "fake", "llm": "fake", "tts": "fake", "titles": "live"}


def test_blank_keys_and_voices_count_as_missing():
    s = VoiceSettings(_env_file=None, providers="auto", **{**ALL_LIVE, "deepgram_api_key": " "})
    assert resolve_mode("stt", s) == "fake"
    s = VoiceSettings(_env_file=None, tts_provider="live", **{**ALL_LIVE, "voice_es": ""})
    assert check_voice_settings(s) == []
    assert s.voice_es == "XrExE9yKIg1WjnnlVkGX"


def test_the_example_file_loads_as_all_fake():
    s = VoiceSettings(_env_file=SERVER_DIR / ".env.example")
    assert s.providers == "auto"
    assert modes(s) == dict.fromkeys(KINDS, "fake")
    assert check_voice_settings(s) == []


def test_server_dir_is_services_server():
    assert SERVER_DIR.parts[-2:] == ("services", "server")
    assert (SERVER_DIR / "pyproject.toml").is_file()


def test_providers_moved_out_of_the_server_settings():
    # P2-R10: the provider mode lives in VoiceSettings, read in the app's lifespan.
    assert "providers" not in Settings.model_fields


def test_settings_and_routes_never_load_pipecat():
    # The app's lifespan and the OpenAPI export import them; Pipecat loads only with a bot.
    probe = (
        "import sys, tassel.voice.settings, tassel.voice.routes;"
        " print([m for m in sys.modules if 'pipecat' in m])"
    )
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    assert (result.returncode, result.stdout.strip()) == (0, "[]"), result.stderr
