"""Beat documents from Ada's sentences: her words, untimed, and her actions as their markers."""

import json
from pathlib import Path

import pytest

from tassel.beats.assemble import build_beat
from tassel.beats.markup import BoardContext, MarkupStream, Sentence
from tassel.beats.models import BEAT_ACTION, dump_beat

REPO = Path(__file__).resolve().parents[4]
FIXTURES = json.loads(
    (REPO / "packages" / "shared" / "src" / "beats" / "fixtures.json").read_text(encoding="utf-8")
)
FIXTURE_BEATS = {doc["id"]: doc for doc in FIXTURES["beats"]}

REVEAL = BEAT_ACTION.validate_python(
    {"kind": "board.reveal", "item": "fix", "els": ["start", "state:q0"]}
)
SPLIT = BEAT_ACTION.validate_python({"kind": "stage", "view": "split"})


def sentence(clean: str, *anchors) -> Sentence:
    return Sentence(clean=clean, tagged=clean, anchors=list(anchors), problems=[])


def one_sentence(text: str) -> Sentence:
    stream = MarkupStream(BoardContext(specs={}))
    [only] = stream.feed(text) + stream.flush()
    return only


def test_build_beat_lays_out_words_with_null_times_and_markers_at_their_word_indexes():
    doc = build_beat(
        sentence("We start at q zero.", (3, REVEAL), (5, SPLIT)),
        beat_id="beat-7",
        turn="turn-3",
        segment="seg-3-1",
        lang="en",
    )

    assert dump_beat(doc) == {
        "version": 1,
        "id": "beat-7",
        "turn": "turn-3",
        "segment": "seg-3-1",
        "lang": "en",
        "text": "We start at q zero.",
        "durationSec": None,
        "shapeSet": "rhubarb9",
        "mouthCues": [],
        "words": [
            {"text": word, "start": None, "end": None}
            for word in ["We", "start", "at", "q", "zero."]
        ],
        "markers": [
            {
                "id": "beat-7.1",
                "word": 3,
                "action": {"kind": "board.reveal", "item": "fix", "els": ["start", "state:q0"]},
            },
            {"id": "beat-7.2", "word": 5, "action": {"kind": "stage", "view": "split"}},
        ],
    }


def test_a_tags_only_sentence_gives_a_wordless_beat():
    doc = build_beat(
        sentence("", (0, SPLIT), (0, REVEAL)), beat_id="b", turn="t", segment="s", lang="ko"
    )

    assert (doc.text, doc.words) == ("", [])
    assert [(m.id, m.word) for m in doc.markers] == [("b.1", 0), ("b.2", 0)]


def test_an_anchor_past_the_end_clamps_to_the_trailing_position():
    doc = build_beat(
        sentence("Try this one.", (9, SPLIT)), beat_id="b", turn="t", segment="s", lang="en"
    )

    assert [m.word for m in doc.markers] == [3]


@pytest.mark.parametrize(
    ("text", "beat_id", "turn", "segment", "lang"),
    [
        ("Empezamos en [[reveal fix start q0]]q cero.", "beat-3f9a", "turn-12", "seg-12-0", "es"),
        ("이 [[wash q0>q0]]루프 때문에 1010이 통과해요.", "beat-3f9c", "turn-13", "seg-13-0", "ko"),
        (
            '[[stage split]][[dfa fix hidden title="A DFA that works" start=q0 accept=q3 '
            "q0-0-q1 q1-1-q2 q2-0-q3 q3-0,1-q3 q0-1-qd q1-0-qd q2-1-qd qd-0,1-qd]]",
            "beat-3f9b",
            "turn-12",
            "seg-12-1",
            "en",
        ),
    ],
    ids=["es", "ko", "wordless"],
)
def test_markup_builds_the_shared_fixture_beat_the_app_accepts(text, beat_id, turn, segment, lang):
    beat = build_beat(one_sentence(text), beat_id=beat_id, turn=turn, segment=segment, lang=lang)

    assert dump_beat(beat) == FIXTURE_BEATS[beat_id]
