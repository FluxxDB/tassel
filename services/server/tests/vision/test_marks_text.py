"""Text-line marks on synthetic handwriting (tassel.vision.synth); truth is used only by assertions.

The owner's live test: a handwritten "10.0.0.0/24", a fifth of the page wide, got no marker at
all, so Ada couldn't underline it. Arrows and printed rules are just as wide and must stay unmarked.
"""

import pytest

from tassel.vision.marks import Candidates, find_candidates
from tassel.vision.synth import IP, SENTENCE, Arrow, Rule, Text, render, scene

# Seeds change the jitter and the lamp's position; the last one is dim and heavily compressed.
VARIANTS = [
    dict(seed=0, lighting=0.3),
    dict(seed=1, lighting=0.55),
    dict(seed=2, lighting=0.1, quality=60),
    dict(seed=3, lighting=0.45, grain=7.0),
]
IDS = ["base", "bright-lamp", "dim-jpeg60", "grainy"]


def box(mark):
    return mark.x, mark.y, mark.w, mark.h


def iou(a, b):
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def covered(inner, outer):
    """The fraction of `inner`'s area inside `outer`."""
    ix = max(0.0, min(inner[0] + inner[2], outer[0] + outer[2]) - max(inner[0], outer[0]))
    iy = max(0.0, min(inner[1] + inner[3], outer[1] + outer[3]) - max(inner[1], outer[1]))
    return ix * iy / (inner[2] * inner[3])


@pytest.mark.parametrize("variant", VARIANTS, ids=IDS)
def test_the_handwritten_ip_gets_one_marker_over_it(variant):
    s = scene("ip", **variant)
    truth = s.find(IP).box
    assert truth[2] > 0.15 * s.page.width  # wider than any old label, as on her page
    labels = find_candidates(s.page).labels
    [mark] = labels
    assert iou(box(mark), truth) >= 0.5
    assert covered(truth, box(mark)) >= 0.97
    # An underline goes just under the box, so its bottom must sit at the ink's bottom.
    assert abs((mark.y + mark.h) - (truth[1] + truth[3])) <= 0.015 * s.page.width


@pytest.mark.parametrize("variant", VARIANTS, ids=IDS)
@pytest.mark.parametrize("name", ["sentence", "note"])
def test_a_sentence_gets_a_few_markers_covering_its_words(name, variant):
    s = scene(name, **variant)
    truth = s.find(SENTENCE)
    labels = find_candidates(s.page).labels
    assert 2 <= len(labels) <= len(truth.words)
    for word in truth.words:
        assert max(covered(word, box(m)) for m in labels) >= 0.9, word
    for mark in labels:
        assert covered(box(mark), truth.box) >= 0.6
        # About TEXT_CHUNK wide; a chunk only grows past it where no gap lets it split.
        assert mark.w <= 0.35 * s.page.width
    marks = sorted(labels, key=lambda m: m.x)
    assert all(a.x + a.w <= b.x + 0.01 * s.page.width for a, b in zip(marks, marks[1:]))


@pytest.mark.parametrize("variant", VARIANTS, ids=IDS)
def test_arrows_and_printed_rules_get_no_markers(variant):
    assert find_candidates(scene("strokes", **variant).page) == Candidates((), ())


@pytest.mark.parametrize("variant", VARIANTS, ids=IDS)
def test_a_network_page_marks_its_writing_and_not_its_strokes(variant):
    s = scene("network", **variant)
    c = find_candidates(s.page)
    assert len(c.circles) == 2
    for text in (IP, "Subnet", "gw", "h1", "h2"):
        truth = s.find(text).box
        assert max(iou(box(m), truth) for m in c.labels) >= 0.5, text
    [ip] = [m for m in c.labels if iou(box(m), s.find(IP).box) >= 0.5]
    assert covered(s.find(IP).box, box(ip)) >= 0.97
    for t in s.truth:
        if t.kind in ("arrow", "rule"):
            assert all(iou(box(m), t.box) < 0.2 for m in c.labels), t.kind


def test_text_lines_are_numbered_after_the_small_labels():
    # Existing numbers stay put (recorded transcriptions name them): wide lines come last.
    s = scene("network")
    c = find_candidates(s.page)
    marks = [m.mark for m in (*c.circles, *c.labels)]
    assert marks == list(range(1, len(marks) + 1))
    wide = [m.mark for m in c.labels if m.w > 0.12 * s.page.width]
    small = [m.mark for m in c.labels if m.w <= 0.12 * s.page.width]
    assert wide and small and max(small) < min(wide)
    assert c == find_candidates(s.page)


def test_a_long_line_splits_at_word_gaps_not_inside_a_word():
    s = render(
        [
            Text(
                "send 10.0.0.0/24 to the gateway now",
                0.05,
                0.5,
                size=0.025,
                space=0.5,
                tracking=0.72,
            )
        ],
        seed=5,
    )
    truth = s.truth[0]
    labels = find_candidates(s.page).labels
    assert len(labels) >= 2
    for word in truth.words:
        # Each word sits inside one marker: no cut runs through it.
        assert max(covered(word, box(m)) for m in labels) >= 0.9, word


def test_a_gently_curved_long_stroke_with_a_label_is_not_text():
    # An arrow with its "0,1" label close enough to join it into one ink group.
    s = render([Arrow((0.2, 0.5), (0.6, 0.5), bend=0.05), Text("0,1", 0.37, 0.47, size=0.025)])
    arrow = next(t for t in s.truth if t.kind == "arrow").box
    labels = find_candidates(s.page).labels
    assert all(m.w <= 0.12 * s.page.width for m in labels)
    assert all(iou(box(m), arrow) < 0.2 for m in labels)


def test_a_printed_rule_under_nothing_and_a_tall_scribble_get_no_text_marker():
    s = render([Rule(0.3), Rule(0.6, 0.2, 0.5), Arrow((0.3, 0.2), (0.35, 0.8), bend=0.3)])
    assert find_candidates(s.page).labels == ()


def test_a_line_of_separate_glyphs_also_gets_one_marker():
    """Real-token eval (2026-10-18): on its IP page each glyph of "10.0.0.0/24" stood apart, so
    the line came out as eight small labels and the Pointer underlined the leading "1" (m1)."""
    from tassel.domains.dfa.contract import Pt
    from tassel.evals.fixtures import render as render_fixture
    from tassel.vision.page import FlatPage
    from tassel.vision.turn_image import decode_jpeg

    fixture = render_fixture("ip-page")
    rgb = decode_jpeg(fixture.jpeg)
    h, w = rgb.shape[:2]
    corners = (Pt(x=0, y=0), Pt(x=w, y=0), Pt(x=w, y=h), Pt(x=0, y=h))
    found = find_candidates(FlatPage(rgb, w, h, corners, False))
    ip = fixture.truths["ip"].box
    lines = [label for label in found.labels if iou(box(label), ip) >= 0.5]
    assert len(lines) == 1
    # Added after the glyph labels, which keep their numbers.
    glyphs = [g for g in found.labels if g is not lines[0] and covered(box(g), ip) > 0.8]
    assert len(glyphs) >= 6
    assert all(glyph.mark < lines[0].mark for glyph in glyphs)
