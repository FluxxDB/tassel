"""Voice settings: which providers run, their keys, the tutor's voices and the ICE servers.

They come from the environment and from ``services/server/.env``, which holds voice settings only
and is git-ignored. The app reads them in its lifespan (``VoiceSettings.load``), never at import or
in ``create_app``, so exporting the OpenAPI schema and running tests never touch a key.

``TASSEL_PROVIDERS`` picks every provider's mode, and ``TASSEL_<KIND>_PROVIDER`` overrides it for
one kind: ``fake`` (the default), ``live``, or ``auto``, which is live exactly when that provider's
key is set. Empty values count as unset. This module never loads Pipecat.
"""

import os
from pathlib import Path
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from tassel.models import Lang

Mode = Literal["fake", "live", "auto"]
ProviderKind = Literal["stt", "llm", "tts", "titles"]

# src/tassel/voice/settings.py -> services/server is three levels up.
SERVER_DIR = Path(__file__).resolve().parents[3]

# Problems name the file as the developer sees it in the repository.
_ENV_FILE_NAME = "services/server/.env"


class IceServerConfig(BaseModel):
    """A STUN or TURN server, for aiortc and for the app's peer connection."""

    model_config = ConfigDict(hide_input_in_errors=True)

    urls: list[str]
    username: str | None = None
    credential: SecretStr | None = None


class VoiceSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TASSEL_",
        extra="ignore",
        populate_by_name=True,
        env_ignore_empty=True,
        env_file_encoding="utf-8",
        # A malformed setting fails startup without echoing what it held (keys, TURN credentials).
        hide_input_in_errors=True,
    )

    providers: Mode = "fake"
    stt_provider: Mode | None = None
    llm_provider: Mode | None = None
    tts_provider: Mode | None = None
    titles_provider: Mode | None = None

    deepgram_api_key: SecretStr | None = Field(None, validation_alias="DEEPGRAM_API_KEY")
    openrouter_api_key: SecretStr | None = Field(None, validation_alias="OPENROUTER_API_KEY")
    elevenlabs_api_key: SecretStr | None = Field(None, validation_alias="ELEVENLABS_API_KEY")

    # The tutor's ElevenLabs voice per session language (the owner supplies them; P2-R12).
    voice_en: str | None = None
    voice_es: str | None = None
    voice_ko: str | None = None

    llm_model: str = "qwen/qwen3.8-27b"
    llm_max_tokens: int = 400

    fake_tts: Literal["auto", "say", "tone"] = "auto"
    fake_scenario: str = "dfa-opening"

    ice_servers: list[IceServerConfig] = []
    voice_metrics_log: Path | None = None

    @classmethod
    def load(cls) -> "VoiceSettings":
        """The app's settings: the environment, plus the voice .env file.

        ``TASSEL_VOICE_ENV_FILE`` names the file; empty means "read no file". Unset, it is
        ``services/server/.env``.
        """
        told = os.environ.get("TASSEL_VOICE_ENV_FILE")
        if told is None:
            env_file: Path | None = SERVER_DIR / ".env"
        else:
            env_file = Path(told) if told else None
        return cls(_env_file=env_file)


class VoiceConfigError(RuntimeError):
    """A provider resolved live without what it needs. The message has one line per problem."""


# What a live provider needs: its key's field and variable name.
_KEYS: dict[ProviderKind, tuple[str, str]] = {
    "stt": ("deepgram_api_key", "DEEPGRAM_API_KEY"),
    "llm": ("openrouter_api_key", "OPENROUTER_API_KEY"),
    "tts": ("elevenlabs_api_key", "ELEVENLABS_API_KEY"),
    "titles": ("openrouter_api_key", "OPENROUTER_API_KEY"),
}


def _is_set(value: SecretStr | str | None) -> bool:
    if isinstance(value, SecretStr):
        value = value.get_secret_value()
    return bool(value and value.strip())


def _resolve(kind: ProviderKind, s: VoiceSettings) -> tuple[Literal["fake", "live"], list[str]]:
    """The kind's mode, and what it lacks when that mode is live."""
    override: Mode | None = getattr(s, f"{kind}_provider")
    if override is None:
        mode, variable = s.providers, "TASSEL_PROVIDERS"
    else:
        mode, variable = override, f"TASSEL_{kind.upper()}_PROVIDER"
    if mode == "fake":
        return "fake", []
    field, key = _KEYS[kind]
    has_key = _is_set(getattr(s, field))
    if mode == "auto" and not has_key:
        return "fake", []
    needs = [] if has_key else [key]
    if kind == "tts":
        needs += [
            f"TASSEL_VOICE_{lang.upper()}"
            for lang in get_args(Lang)
            if not _is_set(getattr(s, f"voice_{lang}"))
        ]
    return "live", [f"{variable}={mode} needs {need} in {_ENV_FILE_NAME}" for need in needs]


def resolve_mode(kind: ProviderKind, s: VoiceSettings) -> Literal["fake", "live"]:
    """Whether ``kind`` runs fake or live. Raises ``VoiceConfigError`` when live lacks a key."""
    mode, problems = _resolve(kind, s)
    if problems:
        raise VoiceConfigError("\n".join(problems))
    return mode


def check_voice_settings(s: VoiceSettings) -> list[str]:
    """Every problem with the settings, one line each, in provider order."""
    problems: list[str] = []
    for kind in get_args(ProviderKind):
        for problem in _resolve(kind, s)[1]:
            if problem not in problems:
                problems.append(problem)
    return problems
