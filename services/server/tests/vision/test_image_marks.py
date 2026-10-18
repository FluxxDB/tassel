"""Line/figure recall against renderer truth, independent of the detector's geometry."""

import io

import cv2
import numpy as np
import pytest
from image_marks_fixtures import FIXTURES, Scene, Truth, box_of, iou, text
from PIL import Image, ImageDraw

from tassel.vision.image_marks import image_view
from tassel.vision.marks import MAX_MARKS


@pytest.mark.parametrize("name", FIXTURES)
def test_attachment_metrics(name):
    scene = FIXTURES[name]()
    view = image_view(scene.png())
    matched = set()
    hits = 0
    for truth in scene.truth:
        direct = [e for e in view.elements if iou(box_of(e), truth.box) >= 0.5]
        if direct:
            assert len(direct) == 1, (name, truth.name, direct)
            matched.add(direct[0].id)
            hits += 1
            continue
        # Very long lines may have disjoint word groups. They must jointly cover the line,
        # with no duplicate group and no marker spanning into a neighboring line.
        x, y, w, h = truth.box
        groups = [
            e
            for e in view.elements
            if x - 4 <= e.box.x
            and e.box.x + e.box.w <= x + w + 4
            and y - 4 <= e.box.y
            and e.box.y + e.box.h <= y + h + 4
        ]
        if truth.kind == "text" and len(groups) > 1:
            spans = sorted((e.box.x, e.box.x + e.box.w) for e in groups)
            assert all(a[1] <= b[0] for a, b in zip(spans, spans[1:]))
            cover = sum(e.box.w * e.box.h for e in groups) / (w * h)
            if cover >= 0.65:
                hits += 1
                matched.update(e.id for e in groups)
    recall = hits / len(scene.truth)
    precision = len(matched) / max(1, len(view.elements))
    print(
        f"\n{name:12} truth={len(scene.truth):2} marks={len(view.elements):2} "
        f"recall={recall:.3f} precision={precision:.3f}"
    )
    assert recall == 1.0, (name, scene.truth, view.elements)
    assert precision >= 0.8
    assert (view.width, view.height) == scene.rgb.shape[1::-1]
    assert len(view.elements) <= MAX_MARKS
    assert [e.id for e in view.elements] == [f"m{i + 1}" for i in range(len(view.elements))]
    assert all(e.id in view.legend_text for e in view.elements)
    assert view == image_view(scene.png()), "identical pixels must keep their ids and JPEG"
    marked = cv2.imdecode(np.frombuffer(view.marked_jpeg, np.uint8), 1)
    blue, green, red = cv2.split(marked)
    tags = (blue > 160) & (green < 140) & (red < 80) & (blue.astype(int) > 2 * green.astype(int))
    # Digits such as 8 enclose blue islands: count the outer badge contours.
    contours, _ = cv2.findContours(
        tags.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    assert sum(cv2.contourArea(c) > 20 for c in contours) == len(view.elements)
    for truth in scene.truth:
        if truth.kind == "text":
            x, y, w, h = map(round, truth.box)
            assert not tags[y : y + h, x : x + w].any(), "badges must leave text unobscured"


@pytest.mark.parametrize("color", [0, 127, 255])
def test_blank_images_have_no_marks(color):
    view = image_view(Scene(np.full((200, 400, 3), color, np.uint8), []).png())
    assert not view.elements
    assert cv2.imdecode(np.frombuffer(view.marked_jpeg, np.uint8), 1) is not None


@pytest.mark.parametrize("data", [b"", b"this is not an image"])
def test_invalid_image_is_rejected(data):
    with pytest.raises(ValueError, match="image"):
        image_view(data)


def test_very_long_lines_split_at_word_spaces_and_keep_reading_order():
    image = Image.new("RGB", (1800, 400), "white")
    truth = []
    draw = ImageDraw.Draw(image)
    for y in (70, 170, 270):
        text(draw, truth, str(y), (30, y), "A longer exercise line with many words. " * 3, 24)
    view = image_view(Scene(np.array(image), truth).png())
    assert len(view.elements) > 3
    for t in truth:
        row = [e for e in view.elements if abs(e.box.y - t.box[1]) < 4]
        assert len(row) >= 2
        assert sum(e.box.w for e in row) >= t.box[2] * 0.85
        assert all(e.box.w < t.box[2] * 0.8 for e in row)
    positions = [(round(e.box.y / 30), e.box.x) for e in view.elements]
    assert positions == sorted(positions)


def test_table_cells_and_circles_are_individual_targets():
    image = Image.new("RGB", (800, 700), "white")
    draw, truth = ImageDraw.Draw(image), []
    for y in (80, 180):
        for x in (60, 280):
            draw.rectangle((x, y, x + 220, y + 100), outline="black", width=2)
            truth.append(Truth("cell", "figure", (x, y, 220, 100)))
    draw.ellipse((180, 390, 350, 560), outline="black", width=3)
    truth.append(Truth("circle", "figure", (180, 390, 170, 170)))
    view = image_view(Scene(np.array(image), truth).png())
    for t in truth:
        [element] = [e for e in view.elements if iou(box_of(e), t.box) >= 0.5]
        if t.name == "circle":
            assert element.kind == "circle"
    assert len(view.elements) == len(truth)


@pytest.mark.parametrize("rows", [3, 4, 5])
def test_tables_keep_every_cell_and_place_tags_in_empty_cell_space(rows):
    image = Image.new("RGB", (800, 800), "white")
    draw, truth = ImageDraw.Draw(image), []
    for y in range(rows):
        for x in range(rows):
            left, top = 80 + 110 * x, 80 + 110 * y
            draw.rectangle((left, top, left + 110, top + 110), outline="black", width=2)
            truth.append(Truth("cell", "figure", (left, top, 110, 110)))
    view = image_view(Scene(np.array(image), truth).png())
    assert len(view.elements) == rows * rows
    for t in truth:
        [element] = [e for e in view.elements if iou(box_of(e), t.box) >= 0.5]
        assert element.kind == "label", "square boxes are not circles"


def test_a_cell_badge_never_lands_inside_a_neighbor(monkeypatch):
    image = Image.new("RGB", (700, 700), "white")
    draw = ImageDraw.Draw(image)
    for y in range(4):
        for x in range(4):
            left, top = 80 + 120 * x, 80 + 120 * y
            draw.rectangle((left, top, left + 120, top + 120), outline="black", width=2)
    positions = {}
    put_text = cv2.putText

    def record_position(image, label, origin, *args):
        positions[f"m{label}"] = origin
        return put_text(image, label, origin, *args)

    monkeypatch.setattr(cv2, "putText", record_position)
    view = image_view(Scene(np.array(image), []).png())
    for mark_id, (x, y) in positions.items():
        for e in view.elements:
            if e.box.x <= x <= e.box.x + e.box.w and e.box.y <= y <= e.box.y + e.box.h:
                assert e.id == mark_id, "a badge inside a cell must identify that cell"


def test_dense_pages_are_capped_in_reading_order():
    image = Image.new("RGB", (1000, 2200), "white")
    draw, truth = ImageDraw.Draw(image), []
    for i in range(55):
        text(draw, truth, str(i), (65, 25 + 38 * i), f"Exercise {i + 1}: explain the result.", 22)
    view = image_view(Scene(np.array(image), truth).png())
    assert len(view.elements) == MAX_MARKS
    assert iou(box_of(view.elements[0]), truth[0].box) >= 0.5
    assert iou(box_of(view.elements[-1]), truth[MAX_MARKS - 1].box) >= 0.5


@pytest.mark.parametrize("height,font_size", [(100, 24), (200, 36)])
def test_cropped_text_keeps_capitals_and_ascenders(height, font_size):
    image = Image.new("RGB", (800, height), "white")
    draw, truth = ImageDraw.Draw(image), []
    text(draw, truth, "line", (40, 30), "A force changes the motion of an object.", font_size)
    view = image_view(Scene(np.array(image), truth).png())
    assert len(view.elements) == 1
    assert iou(box_of(view.elements[0]), truth[0].box) >= 0.8


def test_square_figure_is_not_a_circle():
    image = Image.new("RGB", (800, 600), "white")
    ImageDraw.Draw(image).rectangle((100, 100, 300, 300), outline="black", width=3)
    [element] = image_view(Scene(np.array(image), []).png()).elements
    assert element.kind == "label"


def test_transparent_png_uses_visible_text_not_hidden_rgb():
    # The attachment uploader keeps transparency. Black glyphs on transparent
    # black pixels must not turn into an all-black image when converted to JPEG.
    image = Image.new("RGBA", (800, 180), (0, 0, 0, 0))
    truth = []
    text(ImageDraw.Draw(image), truth, "line", (60, 50), "Find the area of the triangle.", 28)
    encoded = io.BytesIO()
    image.save(encoded, "PNG")
    view = image_view(encoded.getvalue())
    [element] = view.elements
    assert iou(box_of(element), truth[0].box) >= 0.8
    decoded = cv2.imdecode(np.frombuffer(view.page_jpeg, np.uint8), 1)
    assert decoded[0, 0].min() >= 250
