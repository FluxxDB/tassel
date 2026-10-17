"""Vision settings: the gate's and the deep check's modes, their keys and the voice .env file.

Every test here runs under the root conftest's autouse ``scrub_vision_env``, so a test that wants
live settings constructs ``VisionSettings(...)`` with dummy keys itself.
"""

import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from tassel.vision import settings as vision_settings
from tassel.vision.ports import STALL_MS
from tassel.vision.settings import (
    SERVER_DIR,
    VisionConfigError,
    VisionSettings,
    check_vision_settings,
    resolve_vision_mode,
)

KINDS = ("gate", "deepcheck")


def modes(s: VisionSettings) -> dict[str, str]:
    return {kind: resolve_vision_mode(kind, s) for kind in KINDS}


def test_defaults_are_fake():
    s = VisionSettings(_env_file=None)
    assert modes(s) == {"gate": "fake", "deepcheck": "fake"}
    assert check_vision_settings(s) == []


def test_auto_is_live_only_with_its_key():
    assert modes(VisionSettings(_env_file=None, providers="auto")) == {
        "gate": "fake",
        "deepcheck": "fake",
    }
    openai = VisionSettings(_env_file=None, providers="auto", openai_api_key="sk-dummy")
    assert modes(openai) == {"gate": "live", "deepcheck": "fake"}
    anthropic = VisionSettings(_env_file=None, providers="auto", anthropic_api_key="ak-dummy")
    assert modes(anthropic) == {"gate": "fake", "deepcheck": "live"}
    for s in (openai, anthropic):
        assert check_vision_settings(s) == []


def test_clef_needs_the_vultr_key():
    s = VisionSettings(_env_file=None, gate_live="clef", gate_provider="live")
    problem = "TASSEL_GATE_PROVIDER=live needs VULTR_INFERENCE_API_KEY in services/server/.env"
    assert check_vision_settings(s) == [problem]
    with pytest.raises(VisionConfigError) as raised:
        resolve_vision_mode("gate", s)
    assert str(raised.value) == problem
    # The OpenAI key doesn't serve Clef, and the Vultr key does.
    with_openai = VisionSettings(
        _env_file=None, gate_live="clef", providers="auto", openai_api_key="sk-dummy"
    )
    assert resolve_vision_mode("gate", with_openai) == "fake"
    with_vultr = VisionSettings(
        _env_file=None, gate_live="clef", providers="auto", vultr_inference_api_key="vu-dummy"
    )
    assert resolve_vision_mode("gate", with_vultr) == "live"


def test_deepcheck_live_needs_anthropic():
    s = VisionSettings(_env_file=None, deepcheck_provider="live")
    problem = "TASSEL_DEEPCHECK_PROVIDER=live needs ANTHROPIC_API_KEY in services/server/.env"
    assert check_vision_settings(s) == [problem]
    with pytest.raises(VisionConfigError) as raised:
        resolve_vision_mode("deepcheck", s)
    assert str(raised.value) == problem
    keyed = VisionSettings(_env_file=None, deepcheck_provider="live", anthropic_api_key="ak-dummy")
    assert resolve_vision_mode("deepcheck", keyed) == "live"
    assert check_vision_settings(keyed) == []


def test_reads_the_env_file_named_by_TASSEL_VOICE_ENV_FILE(tmp_path, monkeypatch):
    told = tmp_path / "told.env"
    told.write_text(
        "ANTHROPIC_API_KEY=ak-from-told\nTASSEL_DEEPCHECK_PROVIDER=auto\nDEEPGRAM_API_KEY=dg\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", str(told))
    s = VisionSettings.load()
    assert s.anthropic_api_key is not None
    assert s.anthropic_api_key.get_secret_value() == "ak-from-told"
    assert modes(s) == {"gate": "fake", "deepcheck": "live"}

    # Empty, load() reads no file; unset, it reads SERVER_DIR/.env. A stand-in directory keeps
    # the real file out of tests.
    stand_in = tmp_path / "server"
    stand_in.mkdir()
    (stand_in / ".env").write_text("OPENAI_API_KEY=sk-from-server-dir\n", encoding="utf-8")
    monkeypatch.setattr(vision_settings, "SERVER_DIR", stand_in)
    monkeypatch.setenv("TASSEL_VOICE_ENV_FILE", "")
    assert VisionSettings.load().openai_api_key is None
    monkeypatch.delenv("TASSEL_VOICE_ENV_FILE")
    loaded = VisionSettings.load().openai_api_key
    assert loaded is not None
    assert loaded.get_secret_value() == "sk-from-server-dir"


def test_empty_values_are_unset(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "OPENAI_API_KEY=\nTASSEL_GATE_PROVIDER=\nTASSEL_PROVIDERS=auto\n", encoding="utf-8"
    )
    s = VisionSettings(_env_file=env_file)
    assert (s.providers, s.gate_provider, s.openai_api_key) == ("auto", None, None)
    assert resolve_vision_mode("gate", s) == "fake"
    # The same from the environment.
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("TASSEL_GATE_PROVIDER", "")
    monkeypatch.setenv("TASSEL_PROVIDERS", "auto")
    s = VisionSettings(_env_file=None)
    assert (s.providers, s.gate_provider, s.openai_api_key) == ("auto", None, None)
    assert resolve_vision_mode("gate", s) == "fake"


def test_secrets_never_print():
    s = VisionSettings(
        _env_file=None,
        openai_api_key="sk-secret-1",
        anthropic_api_key="ak-secret-2",
        vultr_inference_api_key="vu-secret-3",
    )
    for text in (repr(s), str(s), s.model_dump_json()):
        for secret in ("sk-secret-1", "ak-secret-2", "vu-secret-3"):
            assert secret not in text


# Beyond the brief's examples.


def test_the_brief_defaults():
    s = VisionSettings(_env_file=None)
    assert s.gate_live == "openai"
    assert (s.gate_model, s.clef_model) == ("gpt-6-luna", "clef-flash")
    assert (s.deepcheck_model, s.deepcheck_effort) == ("claude-opus-5-5", "low")
    assert (s.gate_timeout_s, s.deepcheck_timeout_s) == (4.0, 45.0)
    assert (s.fake_truth, s.fake_reading) == (None, "none")
    assert (s.vision_stall_ms, s.vision_log) == (6000, None)
    assert s.vision_stall_ms == STALL_MS == 6000
    assert s.thresholds_path == Path(vision_settings.__file__).with_name("gate_thresholds.json")


def test_the_environment_names(monkeypatch, tmp_path):
    truth = tmp_path / "dfa-demo-960x720-1a2b3c4d.truth.json"
    log = tmp_path / "vision-log.jsonl"
    for name, value in {
        "TASSEL_GATE_LIVE": "clef",
        "TASSEL_GATE_MODEL": "gpt-test",
        "TASSEL_DEEPCHECK_EFFORT": "medium",
        "TASSEL_DEEPCHECK_TIMEOUT_S": "30",
        "TASSEL_FAKE_TRUTH": str(truth),
        "TASSEL_FAKE_READING": "demo-wrong",
        "TASSEL_VISION_STALL_MS": "2500",
        "TASSEL_VISION_LOG": str(log),
        "VULTR_INFERENCE_API_KEY": "vu-dummy",
    }.items():
        monkeypatch.setenv(name, value)
    s = VisionSettings(_env_file=None)
    assert (s.gate_live, s.gate_model) == ("clef", "gpt-test")
    assert (s.deepcheck_effort, s.deepcheck_timeout_s) == ("medium", 30.0)
    assert (s.fake_truth, s.fake_reading) == (truth, "demo-wrong")
    assert (s.vision_stall_ms, s.vision_log) == (2500, log)
    assert s.vultr_inference_api_key is not None


def test_an_override_beats_the_global_mode():
    s = VisionSettings(
        _env_file=None, providers="live", gate_provider="fake", anthropic_api_key="a"
    )
    assert modes(s) == {"gate": "fake", "deepcheck": "live"}
    assert check_vision_settings(s) == []


def test_global_live_names_tassel_providers_once_per_kind():
    s = VisionSettings(_env_file=None, providers="live")
    assert check_vision_settings(s) == [
        "TASSEL_PROVIDERS=live needs OPENAI_API_KEY in services/server/.env",
        "TASSEL_PROVIDERS=live needs ANTHROPIC_API_KEY in services/server/.env",
    ]


def test_blank_keys_count_as_missing():
    s = VisionSettings(_env_file=None, providers="auto", openai_api_key=" ", anthropic_api_key="")
    assert modes(s) == {"gate": "fake", "deepcheck": "fake"}
    live = VisionSettings(_env_file=None, gate_provider="live", openai_api_key="  ")
    assert check_vision_settings(live) == [
        "TASSEL_GATE_PROVIDER=live needs OPENAI_API_KEY in services/server/.env"
    ]


def test_effort_is_low_or_medium():
    with pytest.raises(ValidationError):
        VisionSettings(_env_file=None, deepcheck_effort="high")


def test_validation_errors_never_echo_a_secret():
    with pytest.raises(ValidationError) as raised:
        VisionSettings(_env_file=None, gate_live="sk-s3cret-in-the-wrong-place")
    assert "sk-s3cret" not in str(raised.value)


def test_server_dir_is_services_server():
    assert SERVER_DIR.parts[-2:] == ("services", "server")
    assert (SERVER_DIR / "pyproject.toml").is_file()


def test_the_contract_loads_no_sdk_and_no_opencv():
    # The orchestrator, the gate and the app's lifespan import these; OpenCV, numpy, automata-lib
    # and the provider SDKs load only where they are used.
    probe = (
        "import sys, tassel.vision, tassel.vision.settings, tassel.vision.ports,"
        " tassel.vision.messages, tassel.vision.clips, tassel.domains.base,"
        " tassel.domains.dfa.contract;"
        " heavy = ('cv2', 'numpy', 'automata', 'anthropic', 'openai', 'httpx2');"
        " print(sorted({m.split('.')[0] for m in sys.modules} & set(heavy)))"
    )
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True)
    assert (result.returncode, result.stdout.strip()) == (0, "[]"), result.stderr
