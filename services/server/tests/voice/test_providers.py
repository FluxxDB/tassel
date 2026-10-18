import json
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
    assert (s.model, s.voice, s.language) == ("eleven_flash_v2_5", "v-ko", Language.KO)
    assert s.apply_text_normalization == "off"


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
        assert body["messages"][1:] == messages
        assert "Reply only in English" in body["messages"][0]["content"]
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
