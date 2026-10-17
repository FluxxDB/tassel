"""Vision settings: which decision gate and deep check run, their keys, models and fakes.

They come from the environment and from ``services/server/.env``, the git-ignored file that holds
every provider key. The app reads them in its lifespan (``VisionSettings.load``), never at import
or in ``create_app``, so exporting the OpenAPI schema and running tests never touch a key.

``TASSEL_PROVIDERS`` picks the default mode (``auto``); ``TASSEL_GATE_PROVIDER`` overrides it
with ``fake``, ``live``, or ``auto``. ``TASSEL_GATE_LIVE`` picks ``openai`` or ``clef``.
``TASSEL_DEEPCHECK_PROVIDER`` selects ``auto``, ``anthropic``, ``openai``, or ``fake`` for both
the deep check and the independent membership call. Auto prefers Anthropic when its key is
set, then OpenAI, and stays fake without either key. Explicit providers require their own key.
Empty values count as unset. This module never loads a provider SDK.
"""

import os
from pathlib import Path
from typing import Literal, get_args

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from tassel.vision.ports import STALL_MS

Mode = Literal["fake", "live", "auto"]
DeepcheckProvider = Literal["auto", "anthropic", "openai", "fake"]
ResolvedDeepcheckProvider = Literal["anthropic", "openai", "fake"]
VisionKind = Literal["gate", "deepcheck"]

# src/tassel/vision/settings.py -> services/server is three levels up.
SERVER_DIR = Path(__file__).resolve().parents[3]

# Problems name the file as the developer sees it in the repository.
_ENV_FILE_NAME = "services/server/.env"


class VisionSettings(BaseSettings):
    # No env_file here: only load() reads one, so a VisionSettings(...) in a test reads no file.
    model_config = SettingsConfigDict(
        env_prefix="TASSEL_",
        env_ignore_empty=True,
        extra="ignore",
        populate_by_name=True,
        env_file_encoding="utf-8",
        # A malformed setting fails startup without echoing what it held.
        hide_input_in_errors=True,
    )

    providers: Mode = "auto"
    gate_provider: Mode | None = None
    gate_live: Literal["openai", "clef"] = "openai"
    deepcheck_provider: DeepcheckProvider | None = None

    openai_api_key: SecretStr | None = Field(None, validation_alias="OPENAI_API_KEY")
    anthropic_api_key: SecretStr | None = Field(None, validation_alias="ANTHROPIC_API_KEY")
    vultr_inference_api_key: SecretStr | None = Field(
        None, validation_alias="VULTR_INFERENCE_API_KEY"
    )

    gate_model: str = "gpt-6-luna"
    clef_model: str = "clef-flash"
    deepcheck_model: str = "claude-opus-5-5"  # Anthropic; OpenAI's model is verified later.
    deepcheck_effort: Literal["low", "medium"] = "low"
    gate_timeout_s: float = 4.0
    deepcheck_timeout_s: float = 45.0

    # The fakes: a clip's truth for the fixture deep check, else a named fixture reading.
    fake_truth: Path | None = None  # TASSEL_FAKE_TRUTH
    fake_reading: str = "none"  # TASSEL_FAKE_READING

    vision_stall_ms: int = STALL_MS  # TASSEL_VISION_STALL_MS
    vision_log: Path | None = None  # TASSEL_VISION_LOG
    thresholds_path: Path = Path(__file__).with_name("gate_thresholds.json")

    @classmethod
    def load(cls) -> "VisionSettings":
        """The app's settings: the environment, plus the .env file.

        ``TASSEL_VOICE_ENV_FILE`` (P2's) names the file; empty means "read no file". Unset, it is
        ``services/server/.env``.
        """
        told = os.environ.get("TASSEL_VOICE_ENV_FILE")
        if told is None:
            env_file: Path | None = SERVER_DIR / ".env"
        else:
            env_file = Path(told) if told else None
        return cls(_env_file=env_file)


class VisionConfigError(RuntimeError):
    """A kind resolved live without its key. The message has one line per problem."""


def _gate_key(s: VisionSettings) -> tuple[SecretStr | None, str]:
    """The key the live gate needs: its value and its variable's name."""
    if s.gate_live == "clef":
        return s.vultr_inference_api_key, "VULTR_INFERENCE_API_KEY"
    return s.openai_api_key, "OPENAI_API_KEY"


def _is_set(value: SecretStr | None) -> bool:
    return value is not None and bool(value.get_secret_value().strip())


def _resolve_deepcheck(s: VisionSettings) -> tuple[ResolvedDeepcheckProvider, list[str]]:
    mode = s.deepcheck_provider if s.deepcheck_provider is not None else s.providers
    variable = (
        "TASSEL_DEEPCHECK_PROVIDER" if s.deepcheck_provider is not None else "TASSEL_PROVIDERS"
    )
    if mode == "fake":
        return "fake", []
    if mode in ("anthropic", "openai"):
        value, key = (
            (s.anthropic_api_key, "ANTHROPIC_API_KEY")
            if mode == "anthropic"
            else (s.openai_api_key, "OPENAI_API_KEY")
        )
        problems = [] if _is_set(value) else [f"{variable}={mode} needs {key} in {_ENV_FILE_NAME}"]
        return mode, problems
    if _is_set(s.anthropic_api_key):
        return "anthropic", []
    if _is_set(s.openai_api_key):
        return "openai", []
    if mode == "auto":
        return "fake", []
    return "fake", [
        f"{variable}={mode} needs ANTHROPIC_API_KEY or OPENAI_API_KEY in {_ENV_FILE_NAME}"
    ]


def resolve_deepcheck_provider(s: VisionSettings) -> ResolvedDeepcheckProvider:
    """Shared provider selection for the deep-check and membership adapters (P4-R26).

    Both readers must use this identity, not infer a provider from the fake/live mode.
    The Anthropic reader uses deepcheck_model/effort; OpenAI model selection and evaluation
    belong to the later reader task. No client is constructed and no credential is returned.
    """
    provider, problems = _resolve_deepcheck(s)
    if problems:
        raise VisionConfigError("\n".join(problems))
    return provider


def _resolve(kind: VisionKind, s: VisionSettings) -> tuple[Literal["fake", "live"], list[str]]:
    """The kind's mode, and what it lacks when that mode is live."""
    if kind == "deepcheck":
        provider, problems = _resolve_deepcheck(s)
        return ("fake" if provider == "fake" else "live"), problems
    override = s.gate_provider
    if override is None:
        mode, variable = s.providers, "TASSEL_PROVIDERS"
    else:
        mode, variable = override, f"TASSEL_{kind.upper()}_PROVIDER"
    if mode == "fake":
        return "fake", []
    value, key = _gate_key(s)
    if _is_set(value):
        return "live", []
    if mode == "auto":
        return "fake", []
    return "live", [f"{variable}={mode} needs {key} in {_ENV_FILE_NAME}"]


def resolve_vision_mode(kind: VisionKind, s: VisionSettings) -> Literal["fake", "live"]:
    """Whether ``kind`` runs fake or live. Raises ``VisionConfigError`` when live lacks its key."""
    mode, problems = _resolve(kind, s)
    if problems:
        raise VisionConfigError("\n".join(problems))
    return mode


def check_vision_settings(s: VisionSettings) -> list[str]:
    """Every problem with the settings, one line each: the gate's, then the deep check's."""
    return [problem for kind in get_args(VisionKind) for problem in _resolve(kind, s)[1]]
