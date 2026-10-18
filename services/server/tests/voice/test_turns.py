from unittest.mock import AsyncMock

import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    InterimTranscriptionFrame,
    ProposedUserStartedSpeakingFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.tests.utils import run_test
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from tassel.voice.turns import (
    BackchannelGuard,
    PushToTalkFrame,
    PushToTalkStop,
    TurnTuning,
    is_backchannel,
)


@pytest.mark.parametrize(
    "lang,text",
    [("en", "Uh-huh."), ("en", "yeah yeah"), ("es", "sí, sí"), ("ko", "네네"), ("ko", "네 네!")],
)
def test_backchannels(lang, text):
    assert is_backchannel(text, lang)


@pytest.mark.parametrize(
    "lang,text",
    [("en", "wait"), ("en", "yeah but"), ("ko", "잠깐만요"), ("ko", "네 근데요"), ("en", "")],
)
def test_not_backchannels(lang, text):
    assert not is_backchannel(text, lang)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "lang,text,sensitivity,starts",
    [
        ("en", "uh huh", "normal", False),
        ("en", "mm-hmm", "normal", False),
        ("en", "yeah", "high", False),
        ("en", "okay", "high", False),
        ("en", "yeah okay", "normal", False),
        ("en", "...", "normal", False),
        ("en", "wait", "high", True),
        ("en", "wait", "normal", True),
        ("en", "wait", "low", False),
        ("en", "wait what is that", "low", True),
        ("ko", "네", "normal", False),
        ("ko", "잠깐만요 다시 설명해 주세요", "low", True),
    ],
)
async def test_guard_in_real_aggregator(lang, text, sensitivity, starts):
    ignored = AsyncMock()
    guard = BackchannelGuard(
        tuning=TurnTuning(sensitivity=sensitivity), lang=lang, on_ignored=ignored
    )
    user, _ = LLMContextAggregatorPair(
        LLMContext(),
        user_params=LLMUserAggregatorParams(user_turn_strategies=UserTurnStrategies(start=[guard])),
    )
    down, _ = await run_test(
        user,
        frames_to_send=[
            BotStartedSpeakingFrame(),
            ProposedUserStartedSpeakingFrame(),
            InterimTranscriptionFrame(text, "", ""),
            TranscriptionFrame(text, "", ""),
        ],
    )
    assert any(isinstance(f, UserStartedSpeakingFrame) for f in down) == starts
    if is_backchannel(text, lang):
        ignored.assert_awaited_once_with(text)


@pytest.mark.asyncio
async def test_ptt_release_waits_for_final_after_vad():
    tuning = TurnTuning(ptt=True, ptt_held=True)
    user, _ = LLMContextAggregatorPair(
        LLMContext(),
        user_params=LLMUserAggregatorParams(
            user_turn_strategies=UserTurnStrategies(
                start=[BackchannelGuard(tuning=tuning, lang="en")],
                stop=[PushToTalkStop(tuning=tuning)],
            )
        ),
    )
    down, _ = await run_test(
        user,
        frames_to_send=[
            VADUserStartedSpeakingFrame(),
            TranscriptionFrame("Can you hear me now?", "", ""),
            VADUserStoppedSpeakingFrame(),
            PushToTalkFrame(held=False),
        ],
    )
    release = next(i for i, f in enumerate(down) if isinstance(f, PushToTalkFrame))
    stop = next(i for i, f in enumerate(down) if isinstance(f, UserStoppedSpeakingFrame))
    assert stop >= release


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ptt,held,high,bot_speaking,starts",
    [
        (True, False, False, False, False),
        (True, True, False, True, True),
        (False, False, True, True, False),
        (False, False, False, False, True),
    ],
)
async def test_vad_starts_respect_ptt_and_sensitivity(ptt, held, high, bot_speaking, starts):
    guard = BackchannelGuard(
        tuning=TurnTuning(ptt=ptt, ptt_held=held, sensitivity="high" if high else "normal"),
        lang="en",
    )
    user, _ = LLMContextAggregatorPair(
        LLMContext(),
        user_params=LLMUserAggregatorParams(user_turn_strategies=UserTurnStrategies(start=[guard])),
    )
    frames = ([BotStartedSpeakingFrame()] if bot_speaking else []) + [VADUserStartedSpeakingFrame()]
    down, _ = await run_test(user, frames_to_send=frames)
    assert any(isinstance(f, UserStartedSpeakingFrame) for f in down) == starts


@pytest.mark.asyncio
async def test_late_interim_after_final_cannot_interrupt():
    guard = BackchannelGuard(tuning=TurnTuning(), lang="en")
    user, _ = LLMContextAggregatorPair(
        LLMContext(),
        user_params=LLMUserAggregatorParams(user_turn_strategies=UserTurnStrategies(start=[guard])),
    )
    down, _ = await run_test(
        user,
        frames_to_send=[
            BotStartedSpeakingFrame(),
            TranscriptionFrame("uh huh", "", ""),
            InterimTranscriptionFrame("wait", "", ""),
        ],
    )
    assert not any(isinstance(f, UserStartedSpeakingFrame) for f in down)


def test_strategy_sets_per_route():
    from tassel.voice.turns import make_turn_strategies

    for stt in ("flux", "nova-3", "fake"):
        strategies = make_turn_strategies(stt, TurnTuning(), "ko" if stt == "nova-3" else "en")
        assert isinstance(strategies.start[0], BackchannelGuard)
        expected = (
            "ExternalUserTurnStopStrategy" if stt == "flux" else "TurnAnalyzerUserTurnStopStrategy"
        )
        assert type(strategies.stop[0]).__name__ == expected
    assert isinstance(
        make_turn_strategies("flux", TurnTuning(ptt=True), "en").stop[0], PushToTalkStop
    )


def test_end_of_turn_wait_is_more_patient():
    from tassel.voice.providers import flux_settings
    from tassel.voice.routes import route_for
    from tassel.voice.turns import make_vad

    assert make_vad().params.stop_secs == 0.35
    assert flux_settings(route_for("en")).eot_threshold == 0.8
