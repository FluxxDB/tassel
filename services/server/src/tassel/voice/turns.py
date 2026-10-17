"""Turn controls needed by the session pipeline, shared with the Task 5 lane."""

import re
import unicodedata
from dataclasses import dataclass

from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    InterimTranscriptionFrame,
    ProposedUserStartedSpeakingFrame,
    SystemFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.turns.types import ProcessFrameResult
from pipecat.turns.user_start.base_user_turn_start_strategy import BaseUserTurnStartStrategy
from pipecat.turns.user_stop.base_user_turn_stop_strategy import BaseUserTurnStopStrategy
from pipecat.turns.user_stop.external_user_turn_stop_strategy import ExternalUserTurnStopStrategy
from pipecat.turns.user_stop.turn_analyzer_user_turn_stop_strategy import (
    TurnAnalyzerUserTurnStopStrategy,
)
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from tassel.models import Lang
from tassel.voice.messages import Sensitivity, SttKind


@dataclass
class TurnTuning:
    sensitivity: Sensitivity = "normal"
    ptt: bool = False
    ptt_held: bool = False


@dataclass
class PushToTalkFrame(SystemFrame):
    held: bool


BACKCHANNELS = {
    "en": frozenset(
        "uh-huh, uh huh, mhm, mm-hmm, mm hmm, mm, hmm, yeah, yep, yes, ok, okay, "
        "right, sure, uh, um, oh, ah, i see, got it".split(", ")
    ),
    "es": frozenset(
        "ajá, aja, sí, si, mhm, vale, ok, okey, claro, ya, eh, ah, oh, "
        "bueno, entiendo, de acuerdo".split(", ")
    ),
    "ko": frozenset(
        "네, 넵, 예, 응, 어, 음, 아, 오, 아하, 그렇구나, 그래요, 맞아요, 알겠어요".split(", ")
    ),
}
MIN_WORDS = {"normal": {"en": 1, "es": 1, "ko": 1}, "low": {"en": 2, "es": 2, "ko": 1}}


def normalize(text: str) -> str:
    return " ".join(
        re.sub(r"""[.,!?¡¿…~'"“”‘’]""", "", unicodedata.normalize("NFC", text).casefold()).split()
    )


def is_backchannel(text: str, lang: Lang) -> bool:
    text = normalize(text).replace(" ", "")
    return bool(text) and any(
        re.fullmatch(f"(?:{re.escape(word.replace(' ', ''))})+", text)
        for word in BACKCHANNELS[lang]
    )


class BackchannelGuard(BaseUserTurnStartStrategy):
    def __init__(self, *, tuning: TurnTuning, lang: Lang, on_ignored=None):
        super().__init__()
        self.tuning, self.lang, self.on_ignored = tuning, lang, on_ignored
        self._bot_speaking = self._final = False

    @property
    def resolves_proposed_turn_start_frames(self):
        return True

    async def handle_user_turn_started(self):
        self._bot_speaking = False

    async def process_frame(self, frame):
        signal = isinstance(frame, (VADUserStartedSpeakingFrame, ProposedUserStartedSpeakingFrame))
        transcript = isinstance(frame, (InterimTranscriptionFrame, TranscriptionFrame))
        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
        if signal:
            self._final = False
        if isinstance(frame, InterimTranscriptionFrame) and self._final:
            return
        if isinstance(frame, TranscriptionFrame):
            self._final = True
        if self.tuning.ptt:
            start = signal and self.tuning.ptt_held
        else:
            start = (signal or transcript) and (
                not self._bot_speaking or self.tuning.sensitivity == "high"
            )
            if transcript and self._bot_speaking and not start:
                start = (
                    not is_backchannel(frame.text, self.lang)
                    and len(frame.text.split()) >= MIN_WORDS[self.tuning.sensitivity][self.lang]
                )
                if isinstance(frame, TranscriptionFrame) and is_backchannel(frame.text, self.lang):
                    await self.trigger_reset_aggregation()
                    if self.on_ignored:
                        await self.on_ignored(frame.text)
        if start:
            await self.trigger_user_turn_started()
            return ProcessFrameResult.STOP


class PushToTalkStop(BaseUserTurnStopStrategy):
    def __init__(self, *, tuning: TurnTuning):
        super().__init__()
        self.tuning = tuning
        self._speaking = False
        self._starts = 0
        self._final_at = -1
        self._stopped = False

    async def process_frame(self, frame):
        if isinstance(frame, VADUserStartedSpeakingFrame):
            self._starts += 1
            self._speaking, self._stopped = True, False
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            self._speaking = False
        elif isinstance(frame, TranscriptionFrame):
            self._final_at = self._starts
        elif isinstance(frame, PushToTalkFrame):
            self.tuning.ptt_held = frame.held
        if (
            not self.tuning.ptt_held
            and not self._speaking
            and self._final_at == self._starts
            and not self._stopped
        ):
            self._stopped = True
            await self.trigger_user_turn_stopped()


def make_vad():
    return SileroVADAnalyzer(
        params=VADParams(confidence=0.7, start_secs=0.2, stop_secs=0.2, min_volume=0.6)
    )


def make_turn_strategies(stt: SttKind, tuning: TurnTuning, lang: Lang, on_ignored=None):
    if tuning.ptt:
        stop = PushToTalkStop(tuning=tuning)
    elif stt == "flux":
        stop = ExternalUserTurnStopStrategy()
    else:
        stop = TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3())
    return UserTurnStrategies(
        start=[BackchannelGuard(tuning=tuning, lang=lang, on_ignored=on_ignored)], stop=[stop]
    )
