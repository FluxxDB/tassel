"""A beat document from one of Ada's sentences: her words, untimed until the voice says when they
were heard (P5-R4), and each tag's action as a marker on its word. A sentence of tags alone gives
a wordless beat, which the app fires as it loads."""

from ..models import Lang
from .markup import Sentence
from .models import BeatDoc, BeatMarker, BeatWord


def build_beat(sentence: Sentence, *, beat_id: str, turn: str, segment: str, lang: Lang) -> BeatDoc:
    """The beat for `sentence`. Marker ids are "<beat_id>.<n>", from 1; a marker past the last
    word moves to len(words), which fires with the last word. No mouth cues yet (P5-R4)."""
    words = [BeatWord(text=word, start=None, end=None) for word in sentence.clean.split()]
    markers = [
        BeatMarker(id=f"{beat_id}.{n}", word=min(word, len(words)), action=action)
        for n, (word, action) in enumerate(sentence.anchors, start=1)
    ]
    return BeatDoc(
        version=1,
        id=beat_id,
        turn=turn,
        segment=segment,
        lang=lang,
        text=sentence.clean,
        duration_sec=None,
        shape_set="rhubarb9",
        mouth_cues=[],
        words=words,
        markers=markers,
    )
