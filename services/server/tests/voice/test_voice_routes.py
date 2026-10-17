"""The voice route per session language (P2-R2): which STT, which turn end, which budget."""

from tassel.voice.messages import VOICE_BUDGETS
from tassel.voice.routes import KEYTERMS, route_for


def test_english_and_spanish_ride_flux_multilingual():
    for lang in ("en", "es"):
        r = route_for(lang)
        assert (
            r.stt,
            r.stt_model,
            r.language_hints,
            r.smart_turn,
            r.tts_language,
            r.ttfa_budget_ms,
        ) == ("flux", "flux-general-multi", (lang,), False, lang, 1200)


def test_korean_rides_nova3_with_smart_turn():
    r = route_for("ko")
    assert (
        r.stt,
        r.stt_model,
        r.language_hints,
        r.smart_turn,
        r.tts_language,
        r.ttfa_budget_ms,
    ) == ("nova-3", "nova-3-general", (), True, "ko", 1400)
    assert {"DFA", "상태", "전이", "수락 상태"} <= set(r.keyterms)


def test_budgets_come_from_the_contract():
    assert {lang: route_for(lang).ttfa_budget_ms for lang in ("en", "es", "ko")} == VOICE_BUDGETS[
        "ttfa_ms"
    ]


# Beyond the brief's examples.


def test_keyterms_are_exact():
    assert KEYTERMS == {
        "en": ("DFA", "NFA", "automaton", "accept state", "dead state", "transition", "q zero"),
        "es": ("DFA", "AFD", "autómata", "estado de aceptación", "estado muerto", "transición"),
        "ko": ("DFA", "상태", "전이", "수락 상태", "죽은 상태", "오토마타"),
    }
    for lang in ("en", "es", "ko"):
        r = route_for(lang)
        assert (r.lang, r.keyterms) == (lang, KEYTERMS[lang])
