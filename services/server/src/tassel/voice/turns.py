"""Turn controls needed by the session pipeline, shared with the Task 5 lane."""

import re
import time
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
# Words needed to cut Ada off (or a pending answer). Retest #7: background music at one word
# interrupted her; real interruptions are a stop phrase or a short question.
MIN_WORDS = {"normal": {"en": 3, "es": 3, "ko": 2}, "low": {"en": 4, "es": 4, "ko": 3}}
STOP_PHRASES = {
    "en": ("wait", "stop", "hold on", "hang on", "sorry", "excuse me", "no", "nope", "actually"),
    "es": ("espera", "para", "un momento", "perdón", "perdon", "no", "oye"),
    "ko": ("잠깐", "멈춰", "아니", "아니요", "저기요"),
}
# A finished turn waits this long for Ada's reply before noise may start a new one.
REPLY_WAIT_S = 8.0


def normalize(text: str) -> str:
    return " ".join(
        re.sub(r"""[.,!?¡¿…~'"“”‘’]""", "", unicodedata.normalize("NFC", text).casefold()).split()
    )


def is_stop_phrase(text: str, lang: Lang) -> bool:
    text = normalize(text)
    return any(text == p or text.startswith(p + " ") for p in STOP_PHRASES[lang])


def interrupts(text: str, lang: Lang, sensitivity: Sensitivity) -> bool:
    """Real words, not music or a backchannel: a stop phrase (except at low sensitivity), or
    enough words."""
    if is_backchannel(text, lang):
        return False
    if sensitivity != "low" and is_stop_phrase(text, lang):
        return True
    needed = MIN_WORDS.get(sensitivity, MIN_WORDS["normal"])[lang]
    return len(re.findall(r"[^\W_]+", text)) >= needed


def is_backchannel(text: str, lang: Lang) -> bool:
    text = normalize(text).replace(" ", "")
    alternatives = "|".join(re.escape(word.replace(" ", "")) for word in BACKCHANNELS[lang])
    return bool(text) and re.fullmatch(f"(?:{alternatives})+", text) is not None


class BackchannelGuard(BaseUserTurnStartStrategy):
    """Starts a student turn. While Ada speaks, waits for her reply, or has an answer pending
    (busy), only real words start one; noise or music alone never cuts her off."""

    def __init__(self, *, tuning: TurnTuning, lang: Lang, on_ignored=None, busy=None):
        super().__init__()
        self.tuning, self.lang, self.on_ignored = tuning, lang, on_ignored
        self.busy = busy or (lambda: False)
        self._bot_speaking = self._final = False
        self._awaiting_until = 0.0

    @property
    def resolves_proposed_turn_start_frames(self):
        return True

    async def handle_user_turn_started(self):
        self._bot_speaking = False
        self._awaiting_until = 0.0

    async def handle_user_turn_stopped(self):
        self._awaiting_until = time.monotonic() + REPLY_WAIT_S

    def _guarded(self):
        return self._bot_speaking or time.monotonic() < self._awaiting_until or self.busy()

    async def process_frame(self, frame):
        signal = isinstance(frame, (VADUserStartedSpeakingFrame, ProposedUserStartedSpeakingFrame))
        transcript = isinstance(frame, (InterimTranscriptionFrame, TranscriptionFrame))
        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
            self._awaiting_until = 0.0
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
            guarded = self._guarded()
            start = (signal or transcript) and not guarded
            if transcript and guarded:
                start = interrupts(frame.text, self.lang, self.tuning.sensitivity)
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
        params=VADParams(confidence=0.7, start_secs=0.2, stop_secs=0.35, min_volume=0.6)
    )


def make_turn_strategies(stt: SttKind, tuning: TurnTuning, lang: Lang, on_ignored=None, busy=None):
    if tuning.ptt:
        stop = PushToTalkStop(tuning=tuning)
    elif stt == "flux":
        stop = ExternalUserTurnStopStrategy()
    else:
        stop = TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3())
    return UserTurnStrategies(
        start=[BackchannelGuard(tuning=tuning, lang=lang, on_ignored=on_ignored, busy=busy)],
        stop=[stop],
    )
