import json
import ssl
from dataclasses import asdict

import httpx
import pytest
from openai import AsyncOpenAI
from pipecat.frames.frames import ErrorFrame, LLMContextFrame, LLMTextFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openrouter.llm import OpenRouterLLMService
from pipecat.tests.utils import run_test
from pipecat.transcriptions.language import Language

from tassel.voice.fakes.llm import FakeLLMService
from tassel.voice.fakes.scenario import load_scenario
from tassel.voice.fakes.stt import FakeSTTService
from tassel.voice.fakes.tts import FakeTTSService
from tassel.voice.providers import (
    OPENROUTER_PROVIDER,
    elevenlabs_settings,
    flux_settings,
    make_llm,
    make_stt,
    make_tts,
    nova_settings,
    openrouter_settings,
    stt_kind,
)
from tassel.voice.routes import route_for
from tassel.voice.settings import VoiceConfigError, VoiceSettings

SCENARIO = load_scenario("dfa-opening")


def test_flux_settings():
    route = route_for("es")
    s = flux_settings(route)
    assert s.model == "flux-general-multi"
    assert s.language_hints == [Language.ES]
    assert s.keyterm == list(route.keyterms)


def test_nova_settings_for_korean():
    s = nova_settings(route_for("ko"))
    assert s.model == "nova-3-general"
    assert s.language == Language.KO
    assert s.interim_results is True
    assert "수락 상태" in s.keyterm


def test_openrouter_settings_pin_cerebras_and_turn_reasoning_off():
    s = openrouter_settings(VoiceSettings())
    assert s.model == "qwen/qwen3.8-27b" and s.max_tokens == 400
    assert s.extra == {
        "extra_body": {"provider": OPENROUTER_PROVIDER, "reasoning": {"effort": "none"}}
    }
    assert "response_format" not in str(asdict(s))


def test_elevenlabs_settings():
    s = elevenlabs_settings(route_for("ko"), "v-ko")
    assert (s.model, s.voice, s.language) == ("eleven_multilingual_v2", "v-ko", Language.KO)
    assert s.apply_text_normalization == "on"


@pytest.mark.asyncio
async def test_factories_pick_fake_or_live():
    fake = VoiceSettings(providers="fake", fake_tts="tone")
    route = route_for("en")
    assert isinstance(make_stt(route, fake, SCENARIO), FakeSTTService)
    assert isinstance(make_llm(route, fake, SCENARIO), FakeLLMService)
    assert isinstance(make_tts(route, fake), FakeTTSService)
    live = VoiceSettings(
        providers="live", deepgram_api_key="dg", openrouter_api_key="or", elevenlabs_api_key="el"
    )
    flux = make_stt(route, live, None)
    assert isinstance(flux, DeepgramFluxSTTService)
    assert flux._event_handlers["on_update"].handlers
    assert flux._event_handlers["on_start_of_turn"].handlers
    assert isinstance(make_stt(route_for("ko"), live, None), DeepgramSTTService)
    llm = make_llm(route, live, None)
    assert isinstance(llm, OpenRouterLLMService)
    await llm.cleanup()
    assert isinstance(make_tts(route, live), ElevenLabsTTSService)


def test_stt_kind():
    assert stt_kind(route_for("en"), VoiceSettings(providers="fake")) == "fake"
    live = VoiceSettings(deepgram_api_key="dg")
    assert stt_kind(route_for("en"), live) == "flux"
    assert stt_kind(route_for("ko"), live) == "nova-3"


@pytest.mark.parametrize("kind", ["stt", "llm", "tts"])
def test_unconfigured_auto_never_silently_becomes_a_demo(kind):
    with pytest.raises(VoiceConfigError, match="needs"):
        if kind == "tts":
            make_tts(route_for("en"), VoiceSettings())
        else:
            {"stt": make_stt, "llm": make_llm}[kind](route_for("en"), VoiceSettings(), None)


@pytest.mark.asyncio
async def test_openai_only_uses_image_capable_model_without_router_options():
    s = VoiceSettings(openai_api_key="oa")
    llm = make_llm(route_for("en"), s, None)
    assert isinstance(llm, OpenAILLMService)
    assert llm.active_provider == "openai"
    assert llm._settings.model == "gpt-4.1-mini"
    assert llm._settings.extra == {}
    assert llm._client.max_retries == 0
    await llm.cleanup()


def sse(text="What have you tried?", *, error=None):
    payload = {
        "id": "test",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "test",
        "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
    }
    data = f"data: {json.dumps(payload)}\n\n" if text else ""
    if error:
        data += f"data: {json.dumps({'error': error})}\n\n"
    return httpx.Response(
        200, headers={"content-type": "text/event-stream"}, text=data + "data: [DONE]\n\n"
    )


@pytest.mark.parametrize("status", [402, 403])
@pytest.mark.asyncio
async def test_router_credit_refusal_falls_back_once_preserving_image_tools_and_history(status):
    calls = []

    def respond(request):
        body = json.loads(request.content)
        calls.append((request.url.host, body))
        if request.url.host == "router.test":
            return httpx.Response(status, json={"error": {"message": "Insufficient credits"}})
        return sse()

    llm = make_llm(
        route_for("en"), VoiceSettings(openrouter_api_key="or", openai_api_key="oa"), None
    )
    await llm._client.close()
    await llm._fallback_client.close()
    llm._client = AsyncOpenAI(
        api_key="or",
        base_url="https://router.test",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    llm._fallback_client = AsyncOpenAI(
        api_key="oa",
        base_url="https://openai.test",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    from tassel.voice.tools import TOOLS

    messages = [
        {"role": "system", "content": "Tutor"},
        {"role": "assistant", "content": "Hi"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "What is marked?"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,test"}},
            ],
        },
    ]
    context = LLMContext(messages, tools=TOOLS)
    down, _ = await run_test(
        llm, frames_to_send=[LLMContextFrame(context), LLMContextFrame(context)]
    )
    assert [f.text for f in down if isinstance(f, LLMTextFrame)] == ["What have you tried?"] * 2
    assert not any(isinstance(f, ErrorFrame) for f in down)
    assert [host for host, _ in calls] == ["router.test", "openai.test", "openai.test"]
    assert calls[0][1]["provider"] == OPENROUTER_PROVIDER
    for _, body in calls[1:]:
        # One leading system message: the persona, then the context's own system lines.
        assert body["messages"][1:] == messages[1:]
        assert "Reply only in English" in body["messages"][0]["content"]
        assert body["messages"][0]["content"].endswith("Tutor")
        assert body["model"] == "gpt-4.1-mini"
        assert "provider" not in body and "reasoning" not in body and "response_format" not in body
        assert [t["function"]["name"] for t in body["tools"]] == ["show_stage", "set_language"]
    assert llm.active_provider == "openai"
    assert llm.last_completion["provider"] == "openai"
    assert llm.last_completion["ttfb_ms"] >= 0


@pytest.mark.parametrize(
    "mode,status,partial",
    [
        ("auto", 401, False),
        ("openrouter", 402, False),
        ("auto", 402, True),
    ],
)
@pytest.mark.asyncio
async def test_no_fallback_on_auth_explicit_provider_or_partially_spoken_reply(
    mode, status, partial
):
    calls = []

    def respond(request):
        calls.append(request.url.host)
        if partial:
            return sse("Already spoken", error={"code": 402, "message": "Insufficient credits"})
        return httpx.Response(status, json={"error": {"message": "Provider refused request"}})

    llm = make_llm(
        route_for("en"),
        VoiceSettings(llm_provider=mode, openrouter_api_key="or", openai_api_key="oa"),
        None,
    )
    await llm._client.close()
    llm._client = AsyncOpenAI(
        api_key="or",
        base_url="https://router.test",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    # A fallback attempt would hit this local handler too, never the network.
    if llm._fallback_client:
        await llm._fallback_client.close()
        llm._fallback_client = AsyncOpenAI(
            api_key="oa",
            base_url="https://openai.test",
            max_retries=0,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        )
    down, up = await run_test(
        llm, frames_to_send=[LLMContextFrame(LLMContext([{"role": "user", "content": "Help"}]))]
    )
    assert calls == ["router.test"]
    assert any(isinstance(f, ErrorFrame) for f in [*down, *up])


@pytest.mark.asyncio
async def test_factory_persona_survives_pipecat_tool_sync():
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return sse("어떻게 생각하세요?")

    service = make_llm(route_for("ko"), VoiceSettings(openai_api_key="oa"), None)
    await service._client.close()
    service._client = AsyncOpenAI(
        api_key="oa",
        base_url="https://openai.test",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    await run_test(
        service,
        frames_to_send=[
            LLMContextFrame(LLMContext([{"role": "user", "content": "분수가 뭐예요?"}]))
        ],
    )
    assert requests[0]["messages"][0]["role"] == "system"
    prompt = requests[0]["messages"][0]["content"]
    assert "Reply only in Korean" in prompt
    assert "polite 해요체" in prompt


@pytest.mark.asyncio
async def test_qwen_on_cerebras_is_the_default_and_gets_the_page_image():
    """The owner's model: Qwen 3.8 on Cerebras through OpenRouter takes images (main's live
    check), so a turn with her page goes to it, image and all. OpenAI is only the fallback."""
    calls = []

    def respond(request):
        calls.append((request.url.host, json.loads(request.content)))
        return sse()

    llm = make_llm(
        route_for("en"), VoiceSettings(openrouter_api_key="or", openai_api_key="oa"), None
    )
    await llm._client.close()
    await llm._fallback_client.close()
    for name, host in (("_client", "router.test"), ("_fallback_client", "openai.test")):
        setattr(
            llm,
            name,
            AsyncOpenAI(
                api_key="k",
                base_url=f"https://{host}",
                max_retries=0,
                http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
            ),
        )
    page = {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,cGFnZQ=="}}
    messages = [
        {"role": "system", "content": "Tutor"},
        {"role": "user", "content": [{"type": "text", "text": "What did I draw?"}, page]},
    ]
    await run_test(llm, frames_to_send=[LLMContextFrame(LLMContext(messages))])
    assert [host for host, _ in calls] == ["router.test"]
    body = calls[0][1]
    assert body["model"] == "qwen/qwen3.8-27b"
    assert body["provider"] == OPENROUTER_PROVIDER
    assert page in body["messages"][-1]["content"]
    assert llm.active_provider == "openrouter"


@pytest.mark.asyncio
@pytest.mark.parametrize("failures", [1, 2, 3])
async def test_transport_retry_then_image_free_request(failures):
    from loguru import logger

    calls = []
    logs = []

    def respond(request):
        calls.append(json.loads(request.content))
        if len(calls) <= failures:
            raise httpx.ConnectError("secret body must not be logged", request=request)
        return sse()

    llm = make_llm(route_for("en"), VoiceSettings(llm_provider="openai", openai_api_key="oa"), None)
    await llm._client.close()
    llm._client = AsyncOpenAI(
        api_key="oa",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Read this"},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,test"}},
            ],
        }
    ]
    context = LLMContext(messages)
    sink = logger.add(lambda message: logs.append(message), level="WARNING")
    try:
        down, up = await run_test(llm, frames_to_send=[LLMContextFrame(context)])
    finally:
        logger.remove(sink)
    failures_logged = [line for line in logs if "LLM call failed (" in str(line)]
    assert len(failures_logged) == failures
    assert all(line.record["level"].name == "WARNING" for line in failures_logged)
    assert not any("secret body" in str(line) or "data:image" in str(line) for line in logs)
    assert len(calls) == min(failures + 1, 3)
    assert calls[0] == calls[1]
    if failures >= 2:
        assert "image_url" not in json.dumps(calls[2])
        # The image-failed note reaches the model as an app note: Cerebras accepts no system
        # message after the first.
        assert any(
            m["role"] == "user" and "latest page notes" in str(m["content"])
            for m in calls[2]["messages"]
        )
        assert [m["role"] for m in calls[2]["messages"]].count("system") <= 1
    assert "image_url" in json.dumps(context.get_messages())
    assert any(isinstance(f, ErrorFrame) for f in down + up) == (failures == 3)


@pytest.mark.asyncio
async def test_openai_model_and_reasoning_from_environment(monkeypatch):
    monkeypatch.setenv("TASSEL_LLM_PROVIDER", "openai")
    monkeypatch.setenv("TASSEL_OPENAI_MODEL", "gpt-6-astra")
    monkeypatch.setenv("TASSEL_OPENAI_REASONING_EFFORT", "low")
    calls = []

    def respond(request):
        calls.append(json.loads(request.content))
        return sse()

    llm = make_llm(route_for("en"), VoiceSettings(openai_api_key="oa"), None)
    await llm._client.close()
    llm._client = AsyncOpenAI(
        api_key="oa", http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond))
    )
    await run_test(
        llm, frames_to_send=[LLMContextFrame(LLMContext([{"role": "user", "content": "Hi"}]))]
    )
    assert calls[0]["model"] == "gpt-6-astra"
    assert calls[0]["reasoning_effort"] == "low"
    # OpenAI's reasoning models reject max_tokens and any non-default temperature (HTTP 400),
    # which left Ada silent in the owner's live test.
    assert "max_tokens" not in calls[0]
    assert calls[0]["max_completion_tokens"] == VoiceSettings().llm_max_tokens
    assert "temperature" not in calls[0]


@pytest.mark.parametrize("effort", ["minimal", "bogus"])
def test_astra_rejects_invalid_effort(effort):
    with pytest.raises(ValueError):
        VoiceSettings(openai_model="gpt-6-astra", openai_reasoning_effort=effort)


@pytest.mark.asyncio
@pytest.mark.parametrize("partial", [False, True])
@pytest.mark.parametrize(
    "failure", [httpx.ReadTimeout, ConnectionResetError, BrokenPipeError, ssl.SSLError]
)
async def test_stream_transport_failure_retries_only_before_output(partial, failure):
    calls = []

    class BrokenStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            if partial:
                yield sse("Already spoken").content.split(b"data: [DONE]")[0]
            raise failure("private transport details")

    def respond(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, stream=BrokenStream()
            )
        return sse("Recovered")

    service = make_llm(
        route_for("en"), VoiceSettings(llm_provider="openai", openai_api_key="oa"), None
    )
    await service._client.close()
    service._client = AsyncOpenAI(
        api_key="oa",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    context = LLMContext([{"role": "user", "content": "Help"}])
    down, up = await run_test(service, frames_to_send=[LLMContextFrame(context)])
    assert len(calls) == (1 if partial else 2)
    assert [f.text for f in down if isinstance(f, LLMTextFrame)] == [
        "Already spoken" if partial else "Recovered"
    ]
    assert any(isinstance(f, ErrorFrame) for f in down + up) == partial


def test_astra_on_openai_gets_no_tools():
    # gpt-6-astra refuses function tools on /v1/chat/completions at every reasoning effort
    # (HTTP 400: "use /v1/responses or set reasoning_effort to 'none'", and 'none' is refused).
    from tassel.voice.providers import llm_tools_supported

    astra = VoiceSettings(llm_provider="openai", openai_model="gpt-6-astra", openai_api_key="oa")
    assert llm_tools_supported(astra) is False
    assert llm_tools_supported(VoiceSettings(llm_provider="openai", openai_api_key="oa")) is True
    assert (
        llm_tools_supported(VoiceSettings(llm_provider="openrouter", openrouter_api_key="or"))
        is True
    )


def test_persona_without_tools_uses_tags_and_the_language_menu():
    from tassel.voice.prompts import system_prompt

    with_tools = system_prompt("en")
    without = system_prompt("en", tools=False)
    assert "Call show_stage" in with_tools and "Call show_stage" not in without
    assert "Call set_language" not in without
    assert "[[stage paper|board|split]]" in without
    assert "language menu" in without


def test_speech_settings_are_configurable(monkeypatch):
    monkeypatch.setenv("TASSEL_TTS_MODEL", "eleven_turbo_v2_5")
    config = VoiceSettings(tts_stability=0.45, tts_similarity=0.8, tts_speed=1.05)
    settings = elevenlabs_settings(route_for("en"), "voice", config)
    assert settings.model == "eleven_turbo_v2_5"
    assert settings.stability == 0.45
    assert settings.similarity_boost == 0.8
    assert settings.speed == 1.05


def test_only_the_leading_system_message_reaches_cerebras():
    # Owner's retest #5: the director note was a system message after the student's words,
    # and Cerebras refuses that ("System message must be at the beginning"), so Ada was silent.
    from tassel.voice.providers import leading_system_only

    messages = [
        {"role": "system", "content": "You are Ada."},
        {"role": "user", "content": "Hello?"},
        {"role": "system", "content": "[director] {} Follow this decision."},
        {"role": "system", "content": "Tutor notes: x"},
    ]
    out = leading_system_only([{"role": "system", "content": "Persona"}, *messages])
    assert out[0] == {"role": "system", "content": "Persona\n\nYou are Ada."}
    assert all(m["role"] != "system" for m in out[1:])
    assert out[2] == {"role": "user", "content": "[director] {} Follow this decision."}
    assert out[3] == {"role": "user", "content": "[app note] Tutor notes: x"}
    assert messages[2]["role"] == "system"  # the context itself is left alone


@pytest.mark.parametrize("status", [429, 503])
@pytest.mark.asyncio
async def test_busy_cerebras_retries_the_same_model_on_backup_hosts(status):
    # Retest #7: two 429s from Cerebras left Ada silent for whole turns.
    calls = []

    def respond(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            return httpx.Response(status, json={"error": {"message": "Rate limited"}})
        return sse()

    llm = make_llm(
        route_for("en"), VoiceSettings(openrouter_api_key="or", openai_api_key="oa"), None
    )
    await llm._client.close()
    llm._client = AsyncOpenAI(
        api_key="or",
        base_url="https://router.test",
        max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    context = LLMContext([{"role": "user", "content": "Help"}])
    down, _ = await run_test(llm, frames_to_send=[LLMContextFrame(context)])
    assert [f.text for f in down if isinstance(f, LLMTextFrame)] == ["What have you tried?"]
    assert not any(isinstance(f, ErrorFrame) for f in down)
    assert [c["model"] for c in calls] == ["qwen/qwen3.8-27b"] * 2
    assert calls[0]["provider"] == OPENROUTER_PROVIDER
    assert "cerebras" in calls[1]["provider"]["ignore"]
    assert llm.active_provider == "openrouter"


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["openrouter", "openai"])
async def test_screen_drawing_has_room_for_complete_tool_arguments(provider):
    from tassel.voice.tools import SCREEN_TOOLS, TOOLS

    calls = []

    def respond(request):
        calls.append(json.loads(request.content))
        return sse()

    settings = VoiceSettings(llm_provider=provider, openrouter_api_key="or", openai_api_key="oa")
    llm = make_llm(route_for("en"), settings, None)
    await llm._client.close()
    llm._client = AsyncOpenAI(
        api_key="synthetic",
        base_url="https://synthetic.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
    )
    try:
        for tools in (SCREEN_TOOLS, TOOLS):
            context = LLMContext([{"role": "user", "content": "Draw the DFA"}], tools=tools)
            async for _chunk in await llm.get_chat_completions(context):
                pass
        cap = "max_completion_tokens" if provider == "openai" else "max_tokens"
        assert calls[0][cap] >= 4096
        assert calls[1][cap] == settings.llm_max_tokens
    finally:
        await llm._client.close()
        if llm._fallback_client:
            await llm._fallback_client.close()
