"""Voice settings: which providers run, their keys, the tutor's voices and the ICE servers.

They come from the environment and from ``services/server/.env``, which holds voice settings only
and is git-ignored. The app reads them in its lifespan (``VoiceSettings.load``), never at import or
in ``create_app``, so exporting the OpenAPI schema and running tests never touch a key.

``TASSEL_PROVIDERS`` picks every provider's mode, and ``TASSEL_<KIND>_PROVIDER`` overrides it for
one kind: ``fake``, ``live``, or ``auto`` (the default), which is live exactly when that provider's
key is set. Empty values count as unset. This module never loads Pipecat.
"""

import os
from pathlib import Path
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Mode = Literal["fake", "live", "auto"]
LLMProvider = Literal["auto", "openrouter", "openai", "fake"]
DEFAULT_VOICE_ID = "XrExE9yKIg1WjnnlVkGX"
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

    providers: Mode = "auto"
    stt_provider: Mode | None = None
    llm_provider: LLMProvider | None = None
    tts_provider: Mode | None = None
    titles_provider: Mode | None = None

    deepgram_api_key: SecretStr | None = Field(None, validation_alias="DEEPGRAM_API_KEY")
    openrouter_api_key: SecretStr | None = Field(None, validation_alias="OPENROUTER_API_KEY")
    openai_api_key: SecretStr | None = Field(None, validation_alias="OPENAI_API_KEY")
    elevenlabs_api_key: SecretStr | None = Field(None, validation_alias="ELEVENLABS_API_KEY")

    # Optional overrides resolve to ElevenLabs' premade Matilda voice (P2-R17).
    voice_en: str = DEFAULT_VOICE_ID
    voice_es: str = DEFAULT_VOICE_ID
    voice_ko: str = DEFAULT_VOICE_ID

    llm_model: str = "qwen/qwen3.8-27b"
    llm_max_tokens: int = 400
    openai_model: str = "gpt-4.1-mini"
    openai_reasoning_effort: (
        Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"] | None
    ) = None

    @model_validator(mode="after")
    def validate_openai_reasoning(self):
        if self.openai_model.startswith("gpt-6-astra") and self.openai_reasoning_effort in (
            "none",
            "minimal",
        ):
            raise ValueError("gpt-6-astra reasoning effort must be low, medium, high, xhigh or max")
        return self

    # USD per million tokens by model, for the dev transcript's cost estimate, as JSON in
    # TASSEL_PRICES, e.g. {"gpt-6-luna": {"prompt": 1.0, "cached": 0.1, "completion": 4.0}}.
    # Unset: the meter logs usage only (owner: speed first, meter and log).
    prices: dict[str, dict[str, float]] = Field(default_factory=dict)

    two_tier: bool | None = None
    # Measured live on the owner's page: luna 4.6 s, astra 7.4 s, same diagnosis and mark.
    thinker_model: str = "gpt-6-luna"
    # Retest #7: luna at "low" took 6–8.6 s per brief; "none" read the owner's page correctly in
    # 2.6–2.9 s. Board constructions still think at "low" (thinker_draw_effort).
    thinker_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = "none"
    thinker_draw_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = "low"

    @property
    def two_tier_enabled(self) -> bool:
        return (
            self.two_tier is not False
            and self.providers != "fake"
            and self.llm_provider != "fake"
            and _is_set(self.openai_api_key)
            and _is_set(self.openrouter_api_key)
        )

    # eleven_v3 (most expressive) has no streaming WebSocket; it runs over HTTP streaming.
    # The owner's pick (2026-10-17 by ear): Matilda on Multilingual v2, faster. Over the
    # streaming WebSocket it starts in ~0.5–0.7 s (HTTP was ~1.9 s).
    tts_model: Literal[
        "eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2", "eleven_v3"
    ] = "eleven_multilingual_v2"
    tts_style: float = Field(0.15, ge=0, le=1)
    tts_speaker_boost: bool = True
    tts_stability: float = Field(0.5, ge=0, le=1)
    tts_similarity: float = Field(0.75, ge=0, le=1)
    tts_speed: float = Field(1.15, ge=0.7, le=1.2)

    fake_tts: Literal["auto", "say", "tone"] = "auto"
    fake_scenario: str = "dfa-opening"

    ice_servers: list[IceServerConfig] = []
    voice_metrics_log: Path | None = None
    transcript_dir: Path | None = None

    @field_validator("voice_en", "voice_es", "voice_ko", mode="before")
    @classmethod
    def default_blank_voice(cls, value: str | None) -> str:
        return value if value and value.strip() else DEFAULT_VOICE_ID

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
    override: Mode | LLMProvider | None = getattr(s, f"{kind}_provider")
    if override is None:
        mode, variable = s.providers, "TASSEL_PROVIDERS"
    else:
        mode, variable = override, f"TASSEL_{kind.upper()}_PROVIDER"
    if mode == "fake":
        return "fake", []
    field, key = _KEYS[kind]
    if kind == "llm":
        # Runtime OpenRouter credit/refusal fallback belongs to Task 6. Settings select
        # an available credential without making network calls.
        if mode == "openai" or (
            mode in ("auto", "live")
            and not _is_set(s.openrouter_api_key)
            and _is_set(s.openai_api_key)
        ):
            field, key = "openai_api_key", "OPENAI_API_KEY"
    has_key = _is_set(getattr(s, field))
    if mode == "auto" and not has_key:
        return "fake", []
    needs = [] if has_key else [key]
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
