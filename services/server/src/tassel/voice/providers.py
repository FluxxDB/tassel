"""Live voice adapters and explicit fakes. Construction makes no network calls."""

import ssl
import time
from copy import deepcopy

import aiohttp
import httpx
from loguru import logger
from openai import (
    NOT_GIVEN,
    APIConnectionError,
    APIError,
    AsyncOpenAI,
    InternalServerError,
    RateLimitError,
)
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsHttpTTSService, ElevenLabsTTSService
from pipecat.services.llm_service import LLMService
from pipecat.services.openrouter.llm import OpenRouterLLMService
from pipecat.services.stt_service import STTService
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language

from tassel.vision.turn_image import NO_VIEW
from tassel.voice.director import QWEN_BACKUP_PROVIDER
from tassel.voice.fakes.llm import FakeLLMService
from tassel.voice.fakes.scenario import FakeScenario, load_scenario
from tassel.voice.fakes.stt import FakeSTTService
from tassel.voice.fakes.tts import FakeTTSService, pick_engine
from tassel.voice.flux import attach_flux_interims
from tassel.voice.history import windowed
from tassel.voice.messages import SttKind
from tassel.voice.prompts import system_prompt
from tassel.voice.routes import VoiceRoute
from tassel.voice.settings import ProviderKind, VoiceConfigError, VoiceSettings, resolve_mode

# The talker sees the last 8 exchanges plus the tutor notes; older turns live in the notes.
TALKER_WINDOW = 16
OPENROUTER_PROVIDER = {"only": ["cerebras"], "allow_fallbacks": False, "require_parameters": True}
REASONING_OFF = {"effort": "none"}

IMAGE_FAILED = NO_VIEW


def _without_images(context: LLMContext) -> LLMContext:
    messages = deepcopy(context.get_messages())
    for message in messages:
        if isinstance(message, dict) and isinstance(message.get("content"), list):
            message["content"] = [
                part
                for part in message["content"]
                if part.get("type") not in ("image_url", "image")
            ]
    messages.append({"role": "system", "content": IMAGE_FAILED})
    tools = context.tools
    choice = context.tool_choice
    if isinstance(tools, ToolsSchema) and any(
        t.name == "draw_screen" for t in tools.standard_tools
    ):
        tools = ToolsSchema(
            standard_tools=[t for t in tools.standard_tools if t.name != "draw_screen"],
            custom_tools=tools.custom_tools,
        )
        if isinstance(choice, dict) and choice.get("function", {}).get("name") == "draw_screen":
            choice = "auto"
    return LLMContext(messages, tools=tools, tool_choice=choice)


def leading_system_only(messages: list) -> list:
    """Cerebras (via OpenRouter) accepts one system message, first ("System message must be at
    the beginning"); anything else was refused, which silenced Ada. The opening run of system
    messages merges into one; later system notes (director, tutor notes, bridge, image-failed)
    become bracketed user notes, which the persona reads as app notes."""
    out: list = []
    lead: list[str] = []
    i = 0
    while (
        i < len(messages) and isinstance(messages[i], dict) and messages[i].get("role") == "system"
    ):
        lead.append(str(messages[i].get("content", "")))
        i += 1
    if lead:
        out.append({"role": "system", "content": "\n\n".join(lead)})
    for message in messages[i:]:
        if isinstance(message, dict) and message.get("role") == "system":
            content = message.get("content", "")
            if isinstance(content, str) and not content.startswith("["):
                content = "[app note] " + content
            out.append({**message, "role": "user", "content": content})
        else:
            out.append(message)
    if not any(m.get("role") in ("user", "assistant") for m in out if isinstance(m, dict)):
        # The opening greeting runs with no student turn yet; Cerebras needs a user message.
        out.append({"role": "user", "content": "[session start] Greet the student briefly."})
    return out


def _transport_error(error: Exception) -> bool:
    return isinstance(
        error,
        (APIConnectionError, httpx.TransportError, ssl.SSLError, ConnectionError, TimeoutError),
    )


def flux_settings(route: VoiceRoute) -> DeepgramFluxSTTService.Settings:
    return DeepgramFluxSTTService.Settings(
        model=route.stt_model,
        language_hints=[Language(lang) for lang in route.language_hints],
        eot_threshold=0.8,
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


def elevenlabs_settings(
    route: VoiceRoute, voice_id: str, s: VoiceSettings | None = None
) -> ElevenLabsTTSService.Settings:
    s = s or VoiceSettings()
    return ElevenLabsTTSService.Settings(
        model=s.tts_model,
        stability=s.tts_stability,
        similarity_boost=s.tts_similarity,
        speed=s.tts_speed,
        style=s.tts_style,
        use_speaker_boost=s.tts_speaker_boost,
        voice=voice_id,
        language=Language(route.tts_language),
        apply_text_normalization="on",
    )


class _HttpTTS(ElevenLabsHttpTTSService):
    """ElevenLabs over HTTP streaming (eleven_v3 has no WebSocket), with its own session."""

    def __init__(self, **kwargs):
        self._own_session = aiohttp.ClientSession()
        super().__init__(aiohttp_session=self._own_session, **kwargs)

    async def cleanup(self):
        await super().cleanup()
        await self._own_session.close()


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


def _use_openai(settings, model: str, extra: dict) -> None:
    """Point the settings at OpenAI. Its reasoning models (gpt-6-*, o-series) reject max_tokens
    and any non-default temperature, so the cap goes in max_completion_tokens, which every
    current OpenAI chat model accepts."""
    cap = settings.max_tokens
    settings.model = model
    settings.extra = dict(extra)
    if isinstance(cap, int):
        settings.max_completion_tokens = cap
    settings.max_tokens = NOT_GIVEN
    settings.temperature = NOT_GIVEN


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
        self._openai_model = s.openai_model
        self._openai_extra = (
            {"reasoning_effort": s.openai_reasoning_effort}
            if s.openai_reasoning_effort is not None
            else {}
        )
        settings = openrouter_settings(s)
        settings.system_instruction = system_instruction
        if not use_router:
            _use_openai(settings, self._openai_model, self._openai_extra)
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
        # Bound latency and spend; the stream wrapper owns retries.
        return AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=0, timeout=20.0)

    async def get_chat_completions(self, context: LLMContext):
        return self._completion_stream(context)

    async def _completion_stream(self, context: LLMContext):
        started = time.monotonic()
        self.last_completion = None
        emitted = False
        retries = 0
        backup = False
        while True:
            stream = None
            try:
                # Build the same Pipecat request without its context/body debug logging.
                params = self.get_llm_adapter().get_llm_invocation_params(
                    context,
                    system_instruction=self._settings.system_instruction,
                    convert_developer_to_user=not self.supports_developer_role,
                )
                request = self.build_chat_completion_params(params)
                request["messages"] = leading_system_only(
                    windowed(list(request["messages"]), TALKER_WINDOW)
                )
                if backup:
                    request["extra_body"] = {
                        **(request.get("extra_body") or {}),
                        "provider": {**QWEN_BACKUP_PROVIDER, "require_parameters": True},
                    }
                stream = await self._client.chat.completions.create(**request)
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
            except Exception as error:
                kind = type(error).__name__
                if (
                    not emitted
                    and not backup
                    and self.active_provider == "openrouter"
                    and isinstance(error, (RateLimitError, InternalServerError))
                ):
                    # A busy Cerebras: the same model on other hosts, at once.
                    backup = True
                    logger.warning("LLM call failed ({}), retrying on backup providers", kind)
                    continue
                if not emitted and _transport_error(error) and retries < 2:
                    retries += 1
                    if retries == 2:
                        context = _without_images(context)
                    logger.warning(
                        "LLM call failed ({}), retrying {}",
                        kind,
                        "without image" if retries == 2 else "same request",
                    )
                    continue
                if (
                    isinstance(error, APIError)
                    and not emitted
                    and self._fallback_client is not None
                    and _credit_refusal(error)
                ):
                    logger.warning("LLM call failed (credit refusal), retrying with OpenAI")
                    old_client = self._client
                    self._client, self._fallback_client = self._fallback_client, None
                    self.active_provider = "openai"
                    _use_openai(self._settings, self._openai_model, self._openai_extra)
                    self._sync_model_name_to_metrics()
                    await old_client.close()
                    continue
                logger.warning("LLM call failed ({}), retrying stopped", kind)
                # Do not put provider response bodies or credentials in app errors/logs.
                raise RuntimeError(
                    f"{self.active_provider} could not serve the reply; "
                    "check provider access, credits and connection"
                ) from None
            finally:
                if stream is not None:
                    try:
                        await stream.close()
                    except Exception as error:
                        logger.warning(
                            "LLM call failed ({}), retrying stopped during close",
                            type(error).__name__,
                        )

    async def cleanup(self):
        await super().cleanup()
        await self._client.close()
        if self._fallback_client is not None:
            await self._fallback_client.close()


def llm_tools_supported(s: VoiceSettings) -> bool:
    """gpt-6-astra refuses function tools on /v1/chat/completions at every reasoning effort."""
    requested = s.llm_provider or s.providers
    return not (requested == "openai" and s.openai_model.startswith("gpt-6-astra"))


def make_llm(route: VoiceRoute, s: VoiceSettings, scenario: FakeScenario | None) -> LLMService:
    if _mode("llm", s) == "fake":
        return FakeLLMService(scenario=scenario or load_scenario(s.fake_scenario), lang=route.lang)
    return LiveLLMService(
        s,
        system_instruction=system_prompt(
            route.lang, tools=llm_tools_supported(s), two_tier=s.two_tier_enabled
        ),
    )


def make_tts(route: VoiceRoute, s: VoiceSettings) -> TTSService:
    if _mode("tts", s) == "fake":
        return FakeTTSService(lang=route.lang, engine=pick_engine(s.fake_tts))
    voice = getattr(s, f"voice_{route.lang}")
    if s.tts_model == "eleven_v3":
        ws = elevenlabs_settings(route, voice, s)
        return _HttpTTS(
            api_key=s.elevenlabs_api_key.get_secret_value(),
            settings=ElevenLabsHttpTTSService.Settings(
                model=s.tts_model,
                voice=voice,
                language=ws.language,
                stability=s.tts_stability,
                similarity_boost=s.tts_similarity,
                style=s.tts_style,
                use_speaker_boost=s.tts_speaker_boost,
                speed=s.tts_speed,
                apply_text_normalization="on",
            ),
        )
    return ElevenLabsTTSService(
        api_key=s.elevenlabs_api_key.get_secret_value(),
        settings=elevenlabs_settings(route, voice, s),
    )
