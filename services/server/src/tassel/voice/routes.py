"""The voice route per session language (P2-R2): its STT, how turns end, and its budget.

English and Spanish ride Deepgram Flux Multilingual, hinted to their language, and Flux ends their
turns. Flux has no Korean, so Korean rides Nova-3, where Silero VAD and Smart Turn end the turn.
Silero VAD runs on every route either way. This module never loads Pipecat.
"""

from dataclasses import dataclass
from typing import Literal

from tassel.models import Lang
from tassel.voice.messages import VOICE_BUDGETS


@dataclass(frozen=True)
class VoiceRoute:
    lang: Lang
    stt: Literal["flux", "nova-3"]
    stt_model: str
    language_hints: tuple[str, ...]
    keyterms: tuple[str, ...]
    smart_turn: bool
    tts_language: str
    ttfa_budget_ms: int


# Words the STT should expect in an automata lesson, in the session language.
KEYTERMS: dict[Lang, tuple[str, ...]] = {
    "en": ("DFA", "NFA", "automaton", "accept state", "dead state", "transition", "q zero"),
    "es": ("DFA", "AFD", "autómata", "estado de aceptación", "estado muerto", "transición"),
    "ko": ("DFA", "상태", "전이", "수락 상태", "죽은 상태", "오토마타"),
}


def route_for(lang: Lang) -> VoiceRoute:
    budget = VOICE_BUDGETS["ttfa_ms"][lang]
    if lang == "ko":
        return VoiceRoute(
            lang=lang,
            stt="nova-3",
            stt_model="nova-3-general",
            language_hints=(),
            keyterms=KEYTERMS[lang],
            smart_turn=True,
            tts_language=lang,
            ttfa_budget_ms=budget,
        )
    return VoiceRoute(
        lang=lang,
        stt="flux",
        stt_model="flux-general-multi",
        language_hints=(lang,),
        keyterms=KEYTERMS[lang],
        smart_turn=False,
        tts_language=lang,
        ttfa_budget_ms=budget,
    )
