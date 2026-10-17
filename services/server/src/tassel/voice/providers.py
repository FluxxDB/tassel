"""Live voice adapters and explicit fakes. Construction makes no network calls."""

import time

from loguru import logger
from openai import APIError, AsyncOpenAI
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.llm_service import LLMService
from pipecat.services.openrouter.llm import OpenRouterLLMService
from pipecat.services.stt_service import STTService
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language

from tassel.voice.fakes.llm import FakeLLMService
from tassel.voice.fakes.scenario import FakeScenario, load_scenario
from tassel.voice.fakes.stt import FakeSTTService
from tassel.voice.fakes.tts import FakeTTSService, pick_engine
from tassel.voice.flux import attach_flux_interims
from tassel.voice.messages import SttKind
from tassel.voice.prompts import system_prompt
from tassel.voice.routes import VoiceRoute
from tassel.voice.settings import ProviderKind, VoiceConfigError, VoiceSettings, resolve_mode

OPENROUTER_PROVIDER = {"only": ["cerebras"], "allow_fallbacks": False, "require_parameters": True}
REASONING_OFF = {"effort": "none"}
OPENAI_MODEL = "gpt-4.1-mini"


def flux_settings(route: VoiceRoute) -> DeepgramFluxSTTService.Settings:
    return DeepgramFluxSTTService.Settings(
        model=route.stt_model,
        language_hints=[Language(lang) for lang in route.language_hints],
        keyterm=list(route.keyterms),
    )


def nova_settings(route: VoiceRoute) -> DeepgramSTTService.Settings:
    return DeepgramSTTService.Settings(
        model=route.stt_model,
        language=Language(route.lang),
        interim_results=True,
        keyterm=list(route.keyterms),
        smart_format=True,
        punctuate=True,
    )


def openrouter_settings(s: VoiceSettings) -> OpenRouterLLMService.Settings:
    return OpenRouterLLMService.Settings(
        model=s.llm_model,
        max_tokens=s.llm_max_tokens,
        extra={
            "extra_body": {"provider": dict(OPENROUTER_PROVIDER), "reasoning": dict(REASONING_OFF)}
        },
    )


def elevenlabs_settings(route: VoiceRoute, voice_id: str) -> ElevenLabsTTSService.Settings:
    return ElevenLabsTTSService.Settings(
        model="eleven_flash_v2_5",
        voice=voice_id,
        language=Language(route.tts_language),
        apply_text_normalization="off",
    )


def _mode(kind: ProviderKind, s: VoiceSettings) -> str:
    mode = resolve_mode(kind, s)
    configured = getattr(s, f"{kind}_provider") or s.providers
    if mode == "fake" and configured != "fake":
        key = {
            "stt": "DEEPGRAM_API_KEY",
            "tts": "ELEVENLABS_API_KEY",
            "llm": "OPENROUTER_API_KEY or OPENAI_API_KEY",
        }[kind]
        variable = (
            f"TASSEL_{kind.upper()}_PROVIDER"
            if getattr(s, f"{kind}_provider")
            else "TASSEL_PROVIDERS"
        )
        raise VoiceConfigError(
            f"{variable}={configured} needs {key} in services/server/.env; "
            "select fake explicitly to use a scripted tutor"
        )
    return mode


def require_session_providers(s: VoiceSettings) -> None:
    """Refuse unconfigured live/auto voice before accepting an SDP offer. No I/O."""
    for kind in ("stt", "llm", "tts"):
        _mode(kind, s)


def stt_kind(route: VoiceRoute, s: VoiceSettings) -> SttKind:
    return "fake" if _mode("stt", s) == "fake" else route.stt


def make_stt(route: VoiceRoute, s: VoiceSettings, scenario: FakeScenario | None) -> STTService:
    if _mode("stt", s) == "fake":
        script = scenario or load_scenario(s.fake_scenario)
        return FakeSTTService(lines=script.langs[route.lang].student, lang=route.lang)
    key = s.deepgram_api_key.get_secret_value()
    if route.stt == "flux":
        stt = DeepgramFluxSTTService(
            api_key=key, should_interrupt=True, settings=flux_settings(route)
        )
        attach_flux_interims(stt)
        return stt
    return DeepgramSTTService(api_key=key, settings=nova_settings(route))


def _credit_refusal(error: APIError) -> bool:
    body = error.body if isinstance(error.body, dict) else {}
    body = body.get("error", body)
    if not isinstance(body, dict):
        body = {}
    code = getattr(error, "status_code", None) or body.get("code")
    message = str(body.get("message", "")).casefold()
    return code == 402 or any(
        phrase in message for phrase in ("insufficient credits", "no credits", "out of credits")
    )


class LiveLLMService(OpenRouterLLMService):
    """One OpenAI-compatible service preserves context, tools and metrics across fallback.

    Auto prefers OpenRouter. A credit refusal before output switches this session
    permanently to OpenAI; auth failures and mid-response failures remain errors.
    """

    def __init__(self, s: VoiceSettings, *, system_instruction: str):
        requested = s.llm_provider or s.providers
        router_key = s.openrouter_api_key
        use_router = requested == "openrouter" or (
            requested != "openai" and router_key and router_key.get_secret_value().strip()
        )
        self.active_provider = "openrouter" if use_router else "openai"
        settings = openrouter_settings(s)
        settings.system_instruction = system_instruction
        if not use_router:
            settings.model = OPENAI_MODEL
            settings.extra = {}
        key = router_key if use_router else s.openai_api_key
        super().__init__(
            api_key=key.get_secret_value(),
            base_url="https://openrouter.ai/api/v1" if use_router else "https://api.openai.com/v1",
            settings=settings,
            retry_on_timeout=False,
        )
        self._fallback_client = (
            self.create_client(
                api_key=s.openai_api_key.get_secret_value(), base_url="https://api.openai.com/v1"
            )
            if use_router
            and requested in ("auto", "live")
            and s.openai_api_key
            and s.openai_api_key.get_secret_value().strip()
            else None
        )
        self.last_completion: dict | None = None

    def create_client(self, api_key=None, base_url=None, **kwargs):
        # Bound latency and spend; retries belong to the session/reconnect policy.
        return AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=20.0)

    async def get_chat_completions(self, context: LLMContext):
        return self._completion_stream(context)

    async def _completion_stream(self, context: LLMContext):
        started = time.monotonic()
        self.last_completion = None
        emitted = False
        while True:
            stream = None
            try:
                stream = await super().get_chat_completions(context)
                async for chunk in stream:
                    substantive = any(
                        choice.delta.content or choice.delta.tool_calls for choice in chunk.choices
                    )
                    if substantive and not emitted:
                        self.last_completion = {
                            "provider": self.active_provider,
                            "model": self._settings.model,
                            "response_model": chunk.model,
                            "ttfb_ms": round((time.monotonic() - started) * 1000, 1),
                        }
                        logger.info("Voice LLM served: {}", self.last_completion)
                        emitted = True
                    # Empty role headers must not stop Pipecat's first-token timer.
                    if substantive or chunk.usage or any(c.finish_reason for c in chunk.choices):
                        yield chunk
                return
            except APIError as error:
                if not emitted and self._fallback_client is not None and _credit_refusal(error):
                    logger.warning("OpenRouter credit refusal; this session is switching to OpenAI")
                    old_client = self._client
                    self._client, self._fallback_client = self._fallback_client, None
                    self.active_provider = "openai"
                    self._settings.model = OPENAI_MODEL
                    self._settings.extra = {}
                    self._sync_model_name_to_metrics()
                    await old_client.close()
                    continue
                # Do not put provider response bodies or credentials in app errors/logs.
                raise RuntimeError(
                    f"{self.active_provider} could not serve the reply; "
                    "check provider access, credits and connection"
                ) from None
            finally:
                if stream is not None:
                    await stream.close()

    async def cleanup(self):
        await super().cleanup()
        await self._client.close()
        if self._fallback_client is not None:
            await self._fallback_client.close()


def make_llm(route: VoiceRoute, s: VoiceSettings, scenario: FakeScenario | None) -> LLMService:
    if _mode("llm", s) == "fake":
        return FakeLLMService(scenario=scenario or load_scenario(s.fake_scenario), lang=route.lang)
    return LiveLLMService(s, system_instruction=system_prompt(route.lang))


def make_tts(route: VoiceRoute, s: VoiceSettings) -> TTSService:
    if _mode("tts", s) == "fake":
        return FakeTTSService(lang=route.lang, engine=pick_engine(s.fake_tts))
    return ElevenLabsTTSService(
        api_key=s.elevenlabs_api_key.get_secret_value(),
        settings=elevenlabs_settings(route, getattr(s, f"voice_{route.lang}")),
    )
