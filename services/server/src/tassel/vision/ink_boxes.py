"""A paper mark's box, moved onto her ink. No provider calls.

A model's box is roughly where her writing is: live (2026-10-18) the pointer's box for her
"192.168.1.0/24" sat half a line low, and the underline under it ran through "Subnet Mask" on
the line below. So a box target is refined on the page's ink mask: the written line the box
overlaps best, searched a little around it, tightened to that line's ink; an underline then goes
just under the ink, in the gap above whatever ink is below.

Boxes are fractions of the page (x and w of its width, y and h of its height), as `box=` targets.
"""

from math import ceil

import cv2
import numpy as np

from tassel.beats.markup import BOX_MAX_SIDE, BOX_MIN_SIDE

LINE_JOIN = 0.01  # Glyphs along a line join across this many page widths…
LINE_JOIN_HEIGHT = 3  # …but lines only across this many pixels, so two lines stay two.
SEARCH_X = 0.15  # Her ink may run this fraction of the box's width beyond each side…
SEE_X = 1.0  # …and lines are seen this many box widths beyond it, to judge their width.
SEARCH_Y = 1.0  # …and this many box heights above and below it.
MIN_IOU = 0.05  # The line must overlap the box at least this much (intersection over union).
SAME_LINE = 0.5  # Pieces overlapping each other's rows by this much are on one line…
WORD_GAP = 2.0  # …when they're at most this many of their heights apart.
UNDERLINE_ROOM = 0.25  # An underline sits at most this many line heights under the ink…
NEXT_LINE = 2.0  # …looking this many line heights down for the ink below.


def _iou(a, b) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union else 0.0


def _same_line(a, b) -> bool:
    """Two pieces side by side on one written line: their rows overlap by SAME_LINE of the
    shorter, neither is over twice the other's height (a divider or arrow down the page), and
    they're at most WORD_GAP of the taller apart (not two problems side by side)."""
    ha, hb = a[3] - a[1], b[3] - b[1]
    overlap = min(a[3], b[3]) - max(a[1], b[1])
    gap = max(a[0], b[0]) - min(a[2], b[2])
    return (
        overlap >= SAME_LINE * min(ha, hb)
        and max(ha, hb) <= 2 * min(ha, hb)
        and gap <= WORD_GAP * max(ha, hb)
    )


def _lines(pieces: list) -> list:
    """The pieces grouped into written lines: a spaced hand's glyphs and words are separate
    pieces of one line."""
    parent = list(range(len(pieces)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, a in enumerate(pieces):
        for j in range(i + 1, len(pieces)):
            if _same_line(a, pieces[j]):
                parent[find(j)] = find(i)
    groups: dict[int, list] = {}
    for i, piece in enumerate(pieces):
        groups.setdefault(find(i), []).append(piece)
    return list(groups.values())


def ink_line(mask: np.ndarray, box: dict[str, float]) -> tuple[int, int, int, int] | None:
    """The written line `box` points at, as its ink's (x0, y0, x1, y1) in page pixels within the
    box's columns (plus SEARCH_X), or None when no ink near the box overlaps it enough. Lines are
    scored on their whole width (to SEE_X): a line much wider than the box isn't the one boxed."""
    height, width = mask.shape
    bx, by = box["x"] * width, box["y"] * height
    bw, bh = box["w"] * width, box["h"] * height
    join = max(1, round(LINE_JOIN * width))
    left, right = bx - SEARCH_X * bw, bx + bw + SEARCH_X * bw
    sx0, sx1 = max(0, int(bx - SEE_X * bw)), min(width, ceil(bx + bw + SEE_X * bw))
    sy0, sy1 = max(0, int(by - SEARCH_Y * bh)), min(height, ceil(by + bh + SEARCH_Y * bh))
    if sx1 <= sx0 or sy1 <= sy0:
        return None
    region = mask[sy0:sy1, sx0:sx1] != 0
    if not region.any():
        return None
    joined = cv2.dilate(region.astype(np.uint8), np.ones((LINE_JOIN_HEIGHT, join), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        joined & region.astype(np.uint8), connectivity=8
    )
    columns = slice(max(0, int(left) - sx0), max(0, ceil(right) - sx0))
    pieces = [
        (int(x), int(y), int(x + w), int(y + h), i)
        for i, (x, y, w, h, _) in enumerate(stats[1:], start=1)
    ]
    if not pieces:
        return None
    model = (bx - sx0, by - sy0, bw, bh)
    scored = []
    for members in _lines(pieces):
        x0, y0 = min(p[0] for p in members), min(p[1] for p in members)
        x1, y1 = max(p[2] for p in members), max(p[3] for p in members)
        scored.append((_iou((x0, y0, x1 - x0, y1 - y0), model), members))
    score, members = max(scored, key=lambda s: s[0])
    if score < MIN_IOU:
        return None
    # Her ink on that line, in the box's own columns.
    ink = np.isin(labels[:, columns], [p[4] for p in members])
    if not ink.any():
        return None
    rows, cols = np.flatnonzero(ink.any(axis=1)), np.flatnonzero(ink.any(axis=0))
    x0, x1 = cols[0] + columns.start + sx0, cols[-1] + columns.start + sx0 + 1
    return int(x0), int(rows[0] + sy0), int(x1), int(rows[-1] + sy0 + 1)


def refine_box(mask: np.ndarray, verb: str, box: dict[str, float]) -> dict[str, float] | None:
    """`box` moved onto the ink it points at, for a mark `verb`: an underline's box ends where
    the underline goes (in the gap under the ink), any other's is the ink's own box (a strike
    crosses it corner to corner, a circle rings it). None leaves the box as the model gave it."""
    found = ink_line(mask, box)
    if found is None:
        return None
    height, width = mask.shape
    x0, y0, x1, y1 = found
    bottom = float(y1)
    if verb == "underline":
        tall = y1 - y0
        below = mask[y1 : min(height, y1 + ceil(NEXT_LINE * tall)), x0:x1] != 0
        rows = np.flatnonzero(below.any(axis=1))
        room = UNDERLINE_ROOM * tall
        # Halfway down the gap to the next ink, never further than the room an underline needs.
        bottom = y1 + (min(room, rows[0] / 2) if len(rows) else room)
    x, y = x0 / width, y0 / height
    w, h = (x1 - x0) / width, (bottom - y0) / height
    # Keep it a valid box= target: a single glyph can be narrower than the smallest side.
    if w < BOX_MIN_SIDE:
        x, w = max(0.0, x - (BOX_MIN_SIDE - w) / 2), BOX_MIN_SIDE
    if h < BOX_MIN_SIDE:
        grow = BOX_MIN_SIDE - h
        y, h = max(0.0, y - (grow if verb == "underline" else grow / 2)), BOX_MIN_SIDE
    if w > BOX_MAX_SIDE or h > BOX_MAX_SIDE:
        return None
    x, y = min(x, 1 - w), min(y, 1 - h)
    return {k: round(float(v), 4) for k, v in (("x", x), ("y", y), ("w", w), ("h", h))}
