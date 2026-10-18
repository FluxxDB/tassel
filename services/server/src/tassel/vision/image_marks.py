"""Local Set-of-Mark geometry for student attachments, with no OCR/provider calls.

Unlike paper detection, this preserves the complete image and its pixel coordinates.
Text can have either polarity; connected glyphs form lines, closed figures/table
cells remain targets, and exterior diagram strokes and labels get their own marks.
This is geometry, not a semantic reading of an image.
"""

import io
from dataclasses import dataclass, field
from typing import Literal

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

from tassel.beats.models import DetectedElement, PixelBox
from tassel.vision.marks import MAX_MARKS, TAG_RGB, _overlap, _split
from tassel.vision.page import encode_jpeg

DETECTION_LONG_SIDE = 1800
MODEL_LONG_SIDE = 1600
MIN_CONTRAST = 18


@dataclass(frozen=True)
class ImageView:
    """Pass these elements and ``size=(width, height)`` to ``Pointer.resolve``.

    Both JPEGs show the whole decoded image; the model copy may be smaller but
    has the same aspect ratio. No camera/frame identity or paper context is set.
    ``label`` is the existing wire kind for text, figures, boxes and table cells.
    The legend distinguishes those geometries without changing the shared schema.
    """

    marked_jpeg: bytes = field(repr=False)
    page_jpeg: bytes = field(repr=False)
    legend_text: str
    elements: tuple[DetectedElement, ...]
    width: int
    height: int


@dataclass(frozen=True)
class _Region:
    box: tuple[int, int, int, int]
    shape: Literal["text line", "figure", "circle", "table cell", "arrow", "arrow + label", "label"]


def _inside(a, b, slack=0):
    x, y, w, h = a
    bx, by, bw, bh = b
    return (
        bx - slack <= x
        and by - slack <= y
        and x + w <= bx + bw + slack
        and y + h <= by + bh + slack
    )


def _figures(gray: np.ndarray, glyph_height: float) -> list[_Region]:
    h, w = gray.shape
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 40, 100)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    minimum = max(30, glyph_height * 2.1)
    raw = []
    rectangles = set()
    for contour in contours:
        x, y, bw, bh = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        if min(bw, bh) < minimum or bw * bh > 0.65 * w * h or area < 0.25 * bw * bh:
            continue
        perimeter = cv2.arcLength(contour, True)
        circularity = 4 * np.pi * area / max(1, perimeter**2)
        vertices = len(cv2.approxPolyDP(contour, 0.02 * perimeter, True))
        curved = vertices >= 6
        if vertices == 4 and area > 0.8 * bw * bh:
            rectangles.add((x, y, bw, bh))
        shape = (
            "circle"
            if curved and circularity > 0.75 and min(bw, bh) / max(bw, bh) > 0.75
            else "figure"
        )
        raw.append(_Region((x, y, bw, bh), shape))
    unique = []
    for region in sorted(raw, key=lambda r: (-r.box[2] * r.box[3], r.box[1], r.box[0])):
        if not any(_overlap(region.box, r.box) > 0.8 for r in unique):
            unique.append(region)
    # A table's closed cells partition its outer rectangle. Nested objects inside a
    # diagram do not, so they stay part of the figure rather than getting duplicate ids.
    result = []
    consumed = set()
    for region in unique:
        if region in consumed or any(_inside(region.box, r.box) for r in result):
            continue
        children = [r for r in unique if r != region and _inside(r.box, region.box)]
        leaves = [
            r for r in children if not any(r != c and _inside(c.box, r.box) for c in children)
        ]
        circles = [r for r in leaves if r.shape == "circle"]
        if circles and region.shape != "circle" and region.box not in rectangles:
            # A loop attached at both ends closes an extra contour with its
            # state. The combined outline is neither a figure frame nor a table:
            # keep the state rings and let exterior-stroke detection find the loop.
            result.extend(circles)
            consumed.update(children)
        elif (
            len(leaves) >= 2
            and sum(r.box[2] * r.box[3] for r in leaves) > 0.65 * region.box[2] * region.box[3]
        ):
            result.extend(_Region(r.box, "table cell") for r in leaves)
        elif not any(_overlap(region.box, r.box) > 0.8 for r in result):
            result.append(region)
    return result


def _gap(a, b):
    """Distance between boxes; overlapping boxes have no gap."""
    x, y, w, h = a
    bx, by, bw, bh = b
    return np.hypot(max(0, x - bx - bw, bx - x - w), max(0, y - by - bh, by - y - h))


def _arrows(
    mask: np.ndarray,
    figures: list[_Region],
    lines: list[_Region],
    glyph_height: float,
    contrast: np.ndarray,
):
    """Long, thin connected ink beside figures, including open curves and start strokes.

    Remove the figures first so a touching edge is not swallowed by its state. Use
    disks for circles: rectangular erasure would cut diagonal edges at empty corners.
    Enclosed illustrations and tables keep their existing single-figure/cell behavior.
    """
    exterior = mask.copy()
    # Canny can select the inner boundary of a ring. Include its stroke width
    # so residual arcs cannot masquerade as additional edges or short labels.
    pad = max(5, round(glyph_height * 0.23))
    for r in figures + lines:
        x, y, w, h = r.box
        if r.shape == "circle":
            cv2.ellipse(
                exterior, (x + w // 2, y + h // 2), (w // 2 + pad, h // 2 + pad), 0, 0, 360, 0, -1
            )
        else:
            exterior[max(0, y - pad) : y + h + pad, max(0, x - pad) : x + w + pad] = 0
    _, components, stats, _ = cv2.connectedComponentsWithStats(exterior)
    arrows = []
    for index, (x, y, w, h, area) in enumerate(stats[1:], 1):
        box = tuple(map(int, (x, y, w, h)))
        if max(w, h) < max(30, 2 * glyph_height) or area < 20:
            continue
        if not any(_gap(box, r.box) <= max(12, glyph_height) for r in figures):
            continue
        ink = (components[y : y + h, x : x + w] == index).astype(np.uint8)
        # At thick junctions the median background can cross the stroke and
        # create opposite-polarity halos. They are not part of the edge's ink.
        local_contrast = contrast[y : y + h, x : x + w]
        dark = np.median(local_contrast[ink != 0]) < 0
        stroke = ink & ((local_contrast < 0) if dark else (local_contrast > 0))
        # Stroke thickness, unlike box aspect ratio, also accepts diagonal edges
        # and curved self-loops. Padding gives the distance transform an exterior.
        distance = cv2.distanceTransform(np.pad(stroke, 1), cv2.DIST_L2, 3)[1:-1, 1:-1]
        if np.percentile(distance[stroke != 0], 90) * 2 > max(6, glyph_height * 0.6):
            continue
        ys, xs = np.nonzero(stroke)
        box = (int(x + xs.min()), int(y + ys.min()), int(np.ptp(xs) + 1), int(np.ptp(ys) + 1))
        shape = "arrow"
        # A glyph touching a straight shaft makes a broad branch in its middle;
        # ordinary arrowheads at the ends do not. Keep that connected ink as one
        # target, explicitly usable as either the edge or its attached label.
        if max(w, h) > 3 * min(w, h):
            horizontal = stroke if w >= h else stroke.T
            middle = horizontal[:, horizontal.shape[1] // 5 : 4 * horizontal.shape[1] // 5]
            spans = middle.shape[0] - middle.argmax(axis=0) - middle[::-1].argmax(axis=0)
            spans = spans[middle.any(axis=0)]
            if np.count_nonzero(spans > max(np.median(spans) * 2, glyph_height * 0.6)) >= 3:
                shape = "arrow + label"
        arrows.append(_Region(box, shape))
        # Erase only this component, not its rectangular box: a diagonal edge
        # or loop can surround a disconnected label that still needs a marker.
        exterior[y : y + h, x : x + w][ink != 0] = 0
    return arrows, exterior


def _text_lines(
    mask: np.ndarray,
    figures: list[_Region],
    arrows: list[_Region] | None = None,
) -> list[_Region]:
    arrows = arrows or []
    _, w = mask.shape
    _, components, stats, _ = cv2.connectedComponentsWithStats(mask)
    glyphs = []
    for index, (x, y, bw, bh, area) in enumerate(stats[1:], start=1):
        box = tuple(map(int, (x, y, bw, bh)))
        if area < 4 or bh < 3 or bh > 100 or bw > max(4 * bh, w * 0.12):
            continue
        if any(_inside(box, r.box, 3) for r in figures):
            continue
        glyphs.append((box, index))
    glyphs.sort(key=lambda g: g[0][0])
    parent = list(range(len(glyphs)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    # Same overlap principle as marks._glyph_lines, but replace individual glyph
    # markers with their line, allow printed word spaces, and keep tilted baselines.
    for i, (a, _) in enumerate(glyphs):
        for j in range(i + 1, len(glyphs)):
            b = glyphs[j][0]
            gap = b[0] - a[0] - a[2]
            if gap > max(100, a[3] * 2):
                break
            vertical = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            if gap <= 1.7 * max(a[3], b[3]) and vertical >= 0.35 * min(a[3], b[3]):
                # Don't join adjacent rows through a tall glyph or a vertical UI rule.
                if abs(a[1] + a[3] / 2 - b[1] - b[3] / 2) < 0.65 * max(a[3], b[3]):
                    parent[root(j)] = root(i)
    rows = {}
    for i, glyph in enumerate(glyphs):
        rows.setdefault(root(i), []).append(glyph)
    lines = []
    for members in rows.values():
        x = min(g[0][0] for g in members)
        y = min(g[0][1] for g in members)
        right = max(g[0][0] + g[0][2] for g in members)
        bottom = max(g[0][1] + g[0][3] for g in members)
        box = (x, y, right - x, bottom - y)
        short_label = len(members) < 3 and any(
            _gap(box, r.box) <= max(12, (bottom - y) * 2) for r in arrows
        )
        if not short_label and (len(members) < 3 or right - x < 2 * (bottom - y)):
            continue
        ink = np.isin(components[y:bottom, x:right], [g[1] for g in members])
        height = float(np.median([g[0][3] for g in members]))
        # Reuse the paper detector's word-space splitting, but keep ordinary printed
        # lines whole. Only lines longer than about 45 glyph heights need word groups.
        for lo, hi in _split(
            ink.any(axis=0), 0, right - x, max(w * 0.65, height * 45), max(2, height * 0.2)
        ):
            ys = np.flatnonzero(ink[:, lo:hi].any(axis=1))
            lines.append(
                _Region(
                    (x + lo, y + int(ys[0]), hi - lo, int(ys[-1] - ys[0] + 1)),
                    "label" if short_label else "text line",
                )
            )
    return lines


def _regions(rgb: np.ndarray) -> tuple[list[_Region], np.ndarray]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    # A median background follows slow illumination changes without making light
    # halos beside dark text (or dark halos beside light text) into extra glyphs.
    background = cv2.medianBlur(gray, 31)
    contrast = gray.astype(np.int16) - background.astype(np.int16)
    mask = (cv2.absdiff(gray, background) >= MIN_CONTRAST).astype(np.uint8) * 255
    _, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    heights = [s[3] for s in stats[1:] if 6 <= s[3] <= 60 and 2 <= s[2] <= 3 * s[3] and s[4] >= 8]
    glyph_height = float(np.median(heights)) if heights else 14
    figures = _figures(gray, glyph_height)
    lines = _text_lines(mask, figures)
    arrows, remaining = _arrows(mask, figures, lines, glyph_height, contrast)
    regions = figures + lines + arrows
    if arrows:
        regions += _text_lines(remaining, figures, arrows)
    # Build reading rows with a narrow tolerance; unlike the paper's coarse bands,
    # text lines don't reorder just because one line starts farther to the left.
    regions.sort(key=lambda r: (r.box[1], r.box[0]))
    ordered = []
    while regions:
        first = regions.pop(0)
        row = [first]
        rest = []
        for region in regions:
            if abs(region.box[1] - first.box[1]) <= min(first.box[3], region.box[3]) * 0.4:
                row.append(region)
            else:
                rest.append(region)
        ordered.extend(sorted(row, key=lambda r: r.box[0]))
        regions = rest
    return ordered[:MAX_MARKS], mask


def _tagged(rgb: np.ndarray, regions: list[_Region], mask: np.ndarray):
    result = rgb.copy()
    h, w = mask.shape
    occupied = cv2.dilate(mask, np.ones((5, 5), np.uint8)) != 0
    # Protect text including spaces. Shapes can use an empty interior corner when
    # all outside edges abut other table cells; their contrasted pixels stay protected.
    for r in regions:
        x, y, bw, bh = r.box
        if r.shape in ("text line", "label"):
            occupied[y : y + bh, x : x + bw] = True
    drawn = []
    for region in regions:
        mark = len(drawn) + 1
        label = str(mark)
        font = max(0.45, min(0.65, w / 1800))
        (tw, th), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font, 1)
        bw, bh = tw + 8, th + baseline + 6
        x, y, rw, rh = region.box
        anchors = [(x - bw - 8, y), (x + rw + 8, y), (x, y - bh - 8), (x, y + rh + 8)]
        anchors += [
            (tx, ty)
            for ty in range(max(0, y - 2 * bh), min(h - bh, y + rh + 2 * bh), bh)
            for tx in (x - bw - 8, x + rw + 8, x)
        ]
        if region.shape not in ("text line", "label"):
            anchors += [(x + 6, y + 6), (x + rw - bw - 6, y + 6), (x + 6, y + rh - bh - 6)]
        position = next(
            (
                (tx, ty)
                for tx, ty in anchors
                if 0 <= tx
                and 0 <= ty
                and tx + bw < w
                and ty + bh < h
                and not occupied[ty : ty + bh + 1, tx : tx + bw + 1].any()
                and not any(
                    other != region
                    and not other.shape.startswith("arrow")
                    and _overlap((tx, ty, bw + 1, bh + 1), other.box) > 0
                    for other in regions
                )
            ),
            None,
        )
        if position is None:
            continue
        tx, ty = position
        cv2.rectangle(result, (tx, ty), (tx + bw, ty + bh), TAG_RGB, -1)
        cv2.putText(
            result,
            label,
            (tx + 4, ty + 3 + th),
            cv2.FONT_HERSHEY_SIMPLEX,
            font,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
        occupied[max(0, ty - 3) : ty + bh + 4, max(0, tx - 3) : tx + bw + 4] = True
        drawn.append(region)
    return result, drawn


def image_view(image_bytes: bytes) -> ImageView:
    """Mark decoded JPEG/PNG image pixels; invalid encoded images raise ``ValueError``.

    Run this CPU work off the async event loop. The caller owns attachment identity,
    authorization, image orientation and upload limits; this function neither reads
    storage nor changes the image's crop/orientation. All returned ids are drawn.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as opened:
            # The upload path preserves PNG alpha. Composite before detection so
            # hidden RGB does not erase black text or create invisible targets.
            rgba = opened.convert("RGBA")
            background = Image.new("RGBA", rgba.size, "white")
            rgb = np.array(Image.alpha_composite(background, rgba).convert("RGB"))
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ValueError("invalid image") from error
    height, width = rgb.shape[:2]
    scale = min(1, DETECTION_LONG_SIDE / max(width, height))
    small = (
        cv2.resize(
            rgb,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
        if scale < 1
        else rgb
    )
    regions, mask = _regions(small)
    marked, drawn = _tagged(small, regions, mask)
    sx, sy = width / small.shape[1], height / small.shape[0]
    elements = tuple(
        DetectedElement(
            id=f"m{i + 1}",
            kind="circle" if r.shape == "circle" else "label",
            box=PixelBox(x=r.box[0] * sx, y=r.box[1] * sy, w=r.box[2] * sx, h=r.box[3] * sy),
        )
        for i, r in enumerate(drawn)
    )
    legend = (
        "Blue numbered badges identify image elements, not student content. "
        "Marks in reading order: "
        + "; ".join(
            f"{e.id} {r.shape} at ({e.box.x / width:.3f}, {e.box.y / height:.3f}, "
            f"{e.box.w / width:.3f}, {e.box.h / height:.3f})"
            for e, r in zip(elements, drawn)
        )
        + ". Boxes are (x, y, width, height) as image fractions."
    )
    if max(marked.shape[:2]) > MODEL_LONG_SIDE:
        factor = MODEL_LONG_SIDE / max(marked.shape[:2])
        marked = cv2.resize(
            marked,
            (round(marked.shape[1] * factor), round(marked.shape[0] * factor)),
            interpolation=cv2.INTER_AREA,
        )
    return ImageView(
        encode_jpeg(marked, quality=90), encode_jpeg(rgb), legend, elements, width, height
    )
