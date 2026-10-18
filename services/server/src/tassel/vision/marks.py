"""Set-of-Mark geometry from arbitrary page pixels; no fixture or problem knowledge."""

from dataclasses import dataclass
from math import hypot, pi

import cv2
import numpy as np

from tassel.vision.page import PAGE_LONG_SIDE, FlatPage, ink_mask, relative_brightness

MAX_MARKS = 40  # Bound the numbered geometry sent to the deep reader.
HOUGH_BLUR_SIZE = 5  # Smooth JPEG noise before the gradient-based circle finder.
HOUGH_DP = 1.5  # Ratio of image resolution to accumulator resolution.
HOUGH_MIN_DISTANCE = 0.05  # Minimum circle-center separation in page widths.
HOUGH_EDGE_THRESHOLD = 300  # ALT's Scharr-gradient threshold.
HOUGH_PERFECTNESS = 0.75  # ALT circle perfectness, strictly below one.
HOUGH_STRETCH = 3  # Darkness gain for the second look, on the normalized page.
MIN_RADIUS = 0.018  # Smallest state radius in page widths (a whole Desk View frame's: 0.022).
MAX_RADIUS = 0.09  # Largest state radius in page widths.
MIN_CIRCULARITY = 0.55  # Reject elongated ink contours by 4πA/P².
MIN_AXIS_RATIO = 0.6  # Fitted ellipse's short/long axis ratio.
MERGE_DISTANCE = 0.5  # Drop centers within this fraction of a kept circle's radius.
CROSSING = 0.1  # Drop a ring overlapping a bigger kept ring by more than this of its radius.
RING_ANGLES = 72  # Uniform angular support for fitting closed state rings.
RING_SEARCH_WIDTH = 0.15  # Radius tolerance for Hough jitter and hand-drawn wobble.
RING_MIN_COVERAGE = 0.85  # Reject open transition arcs and combined loop/state ellipses.
RING_FIT_PASSES = 2  # Bound least-squares refinement work per candidate.
INNER_ANGLES = 72  # Angular samples used to distinguish accept rings from text.
INNER_MIN_RADIUS = 0.6  # Start the inner-ring scan at this fraction of the outer radius.
INNER_MAX_RADIUS = 0.9  # Stop before sampling the outer ring itself.
INNER_COVERAGE = 0.5  # At least half the sampled angles must contain ink.
INNER_RING_RATIO = 0.78  # A hand-drawn accept state's inner ring, as a fraction of its outer.
RING_ERASE_WIDTH = 0.012  # Width of the erased ring in page widths.
LABEL_DILATION = 0.01  # Join glyphs into labels using this kernel size in page widths.
LABEL_JOIN_HEIGHT = 0.0005  # Rejoin a wide group along lines only, with this kernel height…
LINE_ASPECT = 2  # …and keep the pieces at least this many times wider than tall as its lines.
LABEL_MIN_SIDE = 0.008  # Smallest retained label bounding-box side in page widths.
LABEL_MAX_SIDE = 0.12  # Largest retained side, rejecting arrows and printed lines.
LABEL_MIN_AREA = 12  # Ignore components with fewer than this many pixels.
# Handwritten lines wider than LABEL_MAX_SIDE but no taller ("10.0.0.0/24", a sentence). They're
# told from arrows and printed rules by how writing looks: several separate strokes, many columns
# that cross ink twice (o, a, 0, 4…), and column centers that don't follow one smooth curve.
TEXT_MIN_STROKES = 3  # Separate raw ink strokes in the group; an arrow or a rule has one or two.
TEXT_STROKE_AREA = 0.002  # A stroke's smallest area is this side squared, in page widths.
TEXT_MIN_MULTIRUN = 0.25  # Fraction of inked columns crossing ink at least twice.
TEXT_MIN_DENSITY = 0.04  # Ink over the group's tight box: a long diagonal stroke is sparser.
TEXT_MAX_DENSITY = 0.5  # A filled blob or a thick bar is denser than writing.
TEXT_MAX_FIT = 0.85  # Fraction of columns whose ink center lies on one quadratic: a stroke.
TEXT_CURSIVE_FIT = 0.7  # A joined-up word has fewer strokes, so it must stray further from one.
TEXT_FIT_TOLERANCE = 0.12  # A center "lies on" the curve within this fraction of line height.
TEXT_CHUNK = 0.25  # Split longer lines into markers of at most about this many page widths…
TEXT_MIN_GAP = 0.08  # …only at empty column runs at least this fraction of the line height.
ROW_HEIGHT = 0.15  # Number marks in rows of this fraction of page height.
TAG_RGB = (29, 78, 216)  # Model-only blue tags (#1d4ed8), distinct from page ink.
TAG_FONT_SCALE = 0.45  # Hershey font scale at the full deep-reader resolution.
TAG_THICKNESS = 1  # Font stroke width in pixels.
TAG_PADDING = 3  # Tag padding at the full deep-reader resolution.
TAG_CORNER_RADIUS = 3  # Rounded tag corners at the full deep-reader resolution.
TAG_CIRCLE_X = 0.75  # Circle tag anchor's horizontal offset in radii.
TAG_CIRCLE_Y = -0.95  # Circle tag anchor's vertical offset in radii.
PROTECTED_RADIUS = 0.9  # No annotation may change a circle's inner disk.
SOLID_DARK = (
    0.73  # Solid dark is below this fraction of the paper's darkest channel (180 on white).
)
SOLID_PERCENTILE = 90  # The paper's level: this percentile of each pixel's darkest channel.


@dataclass(frozen=True)
class CircleMark:
    mark: int
    cx: float
    cy: float
    r: float
    inner: bool


@dataclass(frozen=True)
class LabelMark:
    mark: int
    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True)
class Candidates:
    circles: tuple[CircleMark, ...]
    labels: tuple[LabelMark, ...]


def _refine_ring(
    mask: np.ndarray, cx: float, cy: float, radius: float
) -> tuple[float, float, float] | None:
    """Require a closed ink ring and fit its center, rather than trusting an arc's Hough vote."""
    angles = np.arange(RING_ANGLES) * (2 * pi / RING_ANGLES)
    h, w = mask.shape
    for _ in range(RING_FIT_PASSES):
        radii = np.arange(radius * (1 - RING_SEARCH_WIDTH), radius * (1 + RING_SEARCH_WIDTH) + 1)
        xs = cx + radii[:, None] * np.cos(angles)
        ys = cy + radii[:, None] * np.sin(angles)
        ix, iy = np.rint(xs).astype(int), np.rint(ys).astype(int)
        valid = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
        ink = valid & (mask[iy.clip(0, h - 1), ix.clip(0, w - 1)] != 0)
        supported = ink.any(axis=0)
        if supported.mean() < RING_MIN_COVERAGE:
            return None
        # One vote per angle avoids overweighting thick strokes and attached arrows.
        distance = np.where(ink, np.abs(radii[:, None] - radius), np.inf)
        nearest = distance.argmin(axis=0)
        columns = np.flatnonzero(supported)
        # Fit stroke midlines, not whichever stroke edge was nearest the initial guess.
        # That removes Hough-center bias across slightly different perspective warps.
        mid_radii = []
        for column in columns:
            lo = hi = nearest[column]
            while lo > 0 and ink[lo - 1, column]:
                lo -= 1
            while hi + 1 < len(radii) and ink[hi + 1, column]:
                hi += 1
            mid_radii.append((radii[lo] + radii[hi]) / 2)
        x = cx + np.array(mid_radii) * np.cos(angles[columns])
        y = cy + np.array(mid_radii) * np.sin(angles[columns])
        # Fit in local coordinates to avoid squaring large page coordinates.
        x, y = x - cx, y - cy
        matrix = np.column_stack((2 * x, 2 * y, np.ones(len(x))))
        (dx, dy, constant), _, _, _ = np.linalg.lstsq(matrix, x * x + y * y, rcond=None)
        cx, cy = float(cx + dx), float(cy + dy)
        radius = float(np.sqrt(constant + dx * dx + dy * dy))
    return cx, cy, radius


def _inner_radius(mask: np.ndarray, cx: float, cy: float, radius: float) -> float | None:
    angles = np.arange(INNER_ANGLES) * (2 * pi / INNER_ANGLES)
    radii = np.arange(INNER_MIN_RADIUS * radius, INNER_MAX_RADIUS * radius + 1)
    xs = np.rint(cx + radii[:, None] * np.cos(angles)).astype(int)
    ys = np.rint(cy + radii[:, None] * np.sin(angles)).astype(int)
    h, w = mask.shape
    valid = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
    samples = valid & (mask[ys.clip(0, h - 1), xs.clip(0, w - 1)] != 0)
    coverage = samples.mean(axis=1)
    best = int(coverage.argmax())
    return float(radii[best]) if coverage[best] >= INNER_COVERAGE else None


def find_candidates(
    page: FlatPage, mask: np.ndarray | None = None, ring_mask: np.ndarray | None = None
) -> Candidates:
    # Rings are checked on the faint mask, labels on the ink mask (a given mask is both).
    if ring_mask is None:
        ring_mask = ink_mask(page, faint=True) if mask is None else mask
    mask = ink_mask(page) if mask is None else mask
    w, h = page.width, page.height
    gray = cv2.cvtColor(page.rgb, cv2.COLOR_RGB2GRAY)
    hough = cv2.HoughCircles(
        cv2.GaussianBlur(gray, (HOUGH_BLUR_SIZE, HOUGH_BLUR_SIZE), 0),
        cv2.HOUGH_GRADIENT_ALT,
        dp=HOUGH_DP,
        minDist=HOUGH_MIN_DISTANCE * w,
        param1=HOUGH_EDGE_THRESHOLD,
        param2=HOUGH_PERFECTNESS,
        minRadius=max(1, round(MIN_RADIUS * w)),
        maxRadius=max(1, round(MAX_RADIUS * w)),
    )
    raw = [] if hough is None else [tuple(map(float, c)) for c in hough[0]]
    # Faint pencil has too little gradient for that threshold (the owner's Desk View states):
    # look again on the illumination-normalized page, its darkness stretched.
    darkness = np.clip(1 - relative_brightness(page), 0, 1)
    stretched = (255 * (1 - np.clip(HOUGH_STRETCH * darkness, 0, 1))).astype(np.uint8)
    hough = cv2.HoughCircles(
        cv2.GaussianBlur(stretched, (HOUGH_BLUR_SIZE, HOUGH_BLUR_SIZE), 0),
        cv2.HOUGH_GRADIENT_ALT,
        dp=HOUGH_DP,
        minDist=HOUGH_MIN_DISTANCE * w,
        param1=HOUGH_EDGE_THRESHOLD,
        param2=HOUGH_PERFECTNESS,
        minRadius=max(1, round(MIN_RADIUS * w)),
        maxRadius=max(1, round(MAX_RADIUS * w)),
    )
    raw += [] if hough is None else [tuple(map(float, c)) for c in hough[0]]
    # Holes too: a small state's ring touches its arrows, so its outline is the whole chain's,
    # but the paper inside the ring is still a round hole (the owner's Desk View page).
    # An accept state's rings can run together into one thick ring, whose hole is the inner
    # ring's: a hole that small also seeds the outer ring it would be inside.
    contours, _ = cv2.findContours(ring_mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    holes = []
    for contour in contours:
        area, perimeter = cv2.contourArea(contour), cv2.arcLength(contour, True)
        if len(contour) < 5 or area < pi * (INNER_MIN_RADIUS * MIN_RADIUS * w) ** 2:
            continue
        if perimeter <= 0 or 4 * pi * area / perimeter**2 < MIN_CIRCULARITY:
            continue
        (cx, cy), (a, b), _ = cv2.fitEllipse(contour)
        if min(a, b) / max(a, b) < MIN_AXIS_RATIO:
            continue
        radius = (a + b) / 4
        if MIN_RADIUS * w <= radius <= MAX_RADIUS * w:
            raw.append((cx, cy, radius))
        if MIN_RADIUS * w <= radius / INNER_RING_RATIO <= MAX_RADIUS * w:
            holes.append((cx, cy, radius / INNER_RING_RATIO))
    raw = [ring for candidate in raw if (ring := _refine_ring(ring_mask, *candidate)) is not None]
    smallest = MIN_RADIUS * w * (1 - RING_SEARCH_WIDTH)
    raw += [
        ring
        for candidate in holes
        if (ring := _refine_ring(ring_mask, *candidate)) is not None and ring[2] >= smallest
    ]
    # Prefer outer rings over inner rings and break ties geometrically, not by OpenCV order.
    # States never cross each other's rings: a ring crossing a bigger one's is a self-loop's
    # hole closed by its state's ring.
    kept = []
    for cx, cy, r in sorted(raw, key=lambda c: (-c[2], c[1], c[0])):
        if not any(
            (d := hypot(cx - x, cy - y)) < MERGE_DISTANCE * radius
            or radius - r < d < radius + r - CROSSING * r
            for x, y, radius in kept
        ):
            kept.append((cx, cy, r))
    kept.sort(key=lambda c: (int(c[1] / (ROW_HEIGHT * h)), c[0], c[1]))
    circles = []
    labels_mask = mask.copy()
    for cx, cy, r in kept[:MAX_MARKS]:
        inner_r = _inner_radius(ring_mask, cx, cy, r)
        circles.append(CircleMark(len(circles) + 1, cx, cy, r, inner_r is not None))
        for ring in [r, *([] if inner_r is None else [inner_r])]:
            cv2.circle(
                labels_mask,
                (round(cx), round(cy)),
                round(ring),
                0,
                max(1, round(RING_ERASE_WIDTH * w)),
            )
    size = max(1, round(LABEL_DILATION * w))
    joined = cv2.dilate(labels_mask, np.ones((size, size), np.uint8))
    _, components, stats, _ = cv2.connectedComponentsWithStats(joined)
    # (x, y, w, h, area, line): small labels as before, then handwritten lines' chunks. A group
    # of stacked written lines is taken apart into its lines first.
    groups = []
    for index, s in enumerate(stats[1:], start=1):
        if not LABEL_MIN_SIDE * w <= s[3] <= LABEL_MAX_SIDE * w:
            continue
        wide = s[2] > LABEL_MAX_SIDE * w
        small = LABEL_MIN_SIDE * w <= s[2] <= LABEL_MAX_SIDE * w and s[4] >= LABEL_MIN_AREA
        if not (wide or small):
            continue
        x, y, bw, bh = map(int, s[:4])
        lines = [None]
        if wide or bh >= 2 * LABEL_MIN_SIDE * w:
            group = components[y : y + bh, x : x + bw] == index
            ink = labels_mask[y : y + bh, x : x + bw] != 0
            lines = _stacked_lines(group, ink, size, w)
        if len(lines) == 1 and not wide:
            groups.append((*map(int, s), False))
            continue
        for line in lines:
            groups += _text_chunks(line, ink, x, y, page, size // 2)
    groups.sort(key=lambda s: (-s[4], s[1], s[0]))
    groups = groups[: MAX_MARKS - len(circles)]
    # A line whose glyphs stand apart ("10.0.0.0/24" in a spaced hand) is several small labels:
    # it gets one more marker for the whole line, so Ada can underline it, not just its "1".
    groups += _glyph_lines(groups, w, circles)[: max(0, MAX_MARKS - len(circles) - len(groups))]
    # Lines number after the small labels, and glyph lines after those, so adding them never
    # renumbers existing marks.
    groups.sort(key=lambda s: (int(s[5]), int(s[1] / (ROW_HEIGHT * h)), s[0], s[1]))
    labels = tuple(
        LabelMark(len(circles) + i + 1, float(x), float(y), float(bw), float(bh))
        for i, (x, y, bw, bh, _, _) in enumerate(groups)
    )
    return Candidates(tuple(circles), labels)


def _glyph_lines(groups: list, page_width: int, circles: list) -> list:
    """Rows of small labels that sit side by side on one line, each as one more group (kind 2):
    boxes overlapping vertically by half the shorter one, at most one glyph height apart, and
    together wider than any single label can be. Rows a handwritten-line chunk already covers
    are left out, and so are a state's name inside its circle and any row through a state: on
    a DFA those chained the arrows' labels into one marker across every state."""

    def in_circle(g) -> bool:
        cx, cy = g[0] + g[2] / 2, g[1] + g[3] / 2
        return any(hypot(cx - c.cx, cy - c.cy) <= c.r for c in circles)

    def through_state(x0, y0, x1, y1) -> bool:
        return any(x0 <= c.cx <= x1 and y0 <= c.cy <= y1 for c in circles)

    small = sorted((g for g in groups if g[5] is False and not in_circle(g)), key=lambda g: g[0])
    chunks = [g for g in groups if g[5] is True]
    parent = list(range(len(small)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, a in enumerate(small):
        for j in range(i + 1, len(small)):
            b = small[j]
            overlap = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            gap = max(0, b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]))
            if overlap >= 0.5 * min(a[3], b[3]) and gap <= max(a[3], b[3]):
                parent[find(j)] = find(i)
    rows: dict[int, list] = {}
    for i, g in enumerate(small):
        rows.setdefault(find(i), []).append(g)
    out = []
    for members in rows.values():
        if len(members) < 2:
            continue
        x0 = min(g[0] for g in members)
        y0 = min(g[1] for g in members)
        x1 = max(g[0] + g[2] for g in members)
        y1 = max(g[1] + g[3] for g in members)
        if x1 - x0 <= LABEL_MAX_SIDE * page_width or through_state(x0, y0, x1, y1):
            continue
        line = (x0, y0, x1 - x0, y1 - y0)
        if any(_overlap(line, c[:4]) > 0.5 for c in chunks):
            continue
        out.append((*line, sum(g[4] for g in members), 2))
    return out


def _overlap(a, b) -> float:
    """Intersection over union of two (x, y, w, h) boxes."""
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union else 0.0


def _runs(ink: np.ndarray) -> np.ndarray:
    """Per column, how many separate vertical ink runs it crosses."""
    return ink[0].astype(int) + (ink[1:] & ~ink[:-1]).sum(axis=0)


def _looks_written(ink: np.ndarray, page_width: int) -> bool:
    """Writing, not an arrow, a rule or a curve: see the TEXT_* constants."""
    inked = ink.any(axis=0)
    if not inked.any():
        return False
    if (_runs(ink)[inked] >= 2).mean() < TEXT_MIN_MULTIRUN:
        return False
    min_area = max(4, round((TEXT_STROKE_AREA * page_width) ** 2))
    _, _, strokes, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    cursive = int((strokes[1:, 4] >= min_area).sum()) < TEXT_MIN_STROKES
    rows = np.flatnonzero(ink.any(axis=1))
    columns = np.flatnonzero(inked)
    tight = (rows[-1] - rows[0] + 1) * (columns[-1] - columns[0] + 1)
    if not TEXT_MIN_DENSITY <= ink.sum() / tight <= TEXT_MAX_DENSITY:
        return False
    ys = np.arange(ink.shape[0])[:, None]
    centers = (ink * ys).sum(axis=0)[inked] / ink.sum(axis=0)[inked]
    fit = np.polyval(np.polyfit(columns, centers, 2), columns)
    tolerance = max(2.0, TEXT_FIT_TOLERANCE * _line_height(ink))
    on_curve = (np.abs(centers - fit) <= tolerance).mean()
    return on_curve <= (TEXT_CURSIVE_FIT if cursive else TEXT_MAX_FIT)


def _line_height(ink: np.ndarray) -> float:
    """The writing's height, robust to a tilted line: tall columns' ink spans, not the box."""
    inked = ink.any(axis=0)
    top = ink.argmax(axis=0)
    bottom = ink.shape[0] - ink[::-1].argmax(axis=0)
    return float(np.percentile((bottom - top)[inked], 90))


def _split(inked: np.ndarray, lo: int, hi: int, longest: float, min_gap: float) -> list:
    """Column spans of at most `longest`, cut at the widest gaps first so words stay whole."""
    columns = lo + np.flatnonzero(inked[lo:hi])
    lo, hi = int(columns[0]), int(columns[-1]) + 1
    if hi - lo <= longest:
        return [(lo, hi)]
    empty = ~inked[lo:hi]
    edges = np.flatnonzero(np.diff(np.concatenate(([0], empty.astype(int), [0]))))
    gaps = [(b - a, lo + a, lo + b) for a, b in zip(edges[::2], edges[1::2]) if b - a >= min_gap]
    if not gaps:
        return [(lo, hi)]
    middle = (lo + hi) / 2
    _, start, end = max(gaps, key=lambda g: (g[0], -abs((g[1] + g[2]) / 2 - middle)))
    return _split(inked, lo, start, longest, min_gap) + _split(inked, end, hi, longest, min_gap)


def _stacked_lines(group: np.ndarray, ink: np.ndarray, size: int, page_width: int) -> list:
    """A wide ink group as its written lines: lines a few pixels apart join into one group
    ("192.168.1.0/24" over "Subnet Mask 255.255.255.128" on the owner's page), so glyphs are
    joined again along lines only, and each piece shaped like a line (LABEL_MIN_SIDE tall or
    more, LINE_ASPECT times as wide) is its own group, when there are two or more. The other
    pieces (an i's dot, an = sign's bar, a margin's dashes) go with the nearest line."""
    tall = max(1, round(LABEL_JOIN_HEIGHT * page_width))
    rows = cv2.dilate((ink & group).astype(np.uint8), np.ones((tall, size), np.uint8))
    count, pieces, stats, _ = cv2.connectedComponentsWithStats(rows & group.astype(np.uint8))
    lines = [
        i
        for i in range(1, count)
        if stats[i, 3] >= LABEL_MIN_SIDE * page_width and stats[i, 2] >= LINE_ASPECT * stats[i, 3]
    ]
    if len(lines) < 2:
        return [group]
    owner = np.zeros(count, int)
    for i in range(1, count):
        if i in lines:
            owner[i] = i
            continue
        middle = stats[i, 1] + stats[i, 3] / 2
        owner[i] = min(lines, key=lambda j: abs(stats[j, 1] + stats[j, 3] / 2 - middle))
    owned = owner[pieces]
    return [(owned == j) & group for j in lines]


def _text_chunks(group: np.ndarray, mask: np.ndarray, x: int, y: int, page: FlatPage, pad: int):
    """A wide, short ink group's word-sized chunks if it's handwriting, else none. `group` and
    `mask` are the group's box, whose top left is (x, y) on the page."""
    rows_, columns_ = np.flatnonzero(group.any(axis=1)), np.flatnonzero(group.any(axis=0))
    if not len(rows_) or columns_[-1] - columns_[0] + 1 <= LABEL_MAX_SIDE * page.width:
        # A line split from a taller group can be short: it's a small label then.
        if not len(rows_):
            return []
        y0, y1, x0, x1 = rows_[0], rows_[-1] + 1, columns_[0], columns_[-1] + 1
        bw, bh = x1 - x0, y1 - y0
        if min(bw, bh) < LABEL_MIN_SIDE * page.width or bh > LABEL_MAX_SIDE * page.width:
            return []
        return [(x + int(x0), y + int(y0), int(bw), int(bh), int(group.sum()), False)]
    top, left = int(rows_[0]), int(columns_[0])
    group = group[top : rows_[-1] + 1, left : columns_[-1] + 1]
    mask = mask[top : rows_[-1] + 1, left : columns_[-1] + 1]
    x, y = x + left, y + top
    bh, bw = group.shape
    ink = group & mask
    if not _looks_written(ink, page.width):
        return []
    inked = ink.any(axis=0)
    min_gap = TEXT_MIN_GAP * _line_height(ink)
    chunks = []
    for lo, hi in _split(inked, 0, bw, TEXT_CHUNK * page.width, min_gap):
        part = ink[:, lo:hi]
        if (_runs(part)[part.any(axis=0)] >= 2).mean() < TEXT_MIN_MULTIRUN:
            continue
        rows = np.flatnonzero(part.any(axis=1))
        x0, x1 = max(0, x + lo - pad), min(page.width, x + hi + pad)
        y0, y1 = max(0, y + int(rows[0]) - pad), min(page.height, y + int(rows[-1]) + 1 + pad)
        chunks.append((x0, y0, x1 - x0, y1 - y0, int(group[:, lo:hi].sum()), True))
    return chunks


def draw_marks(
    page: FlatPage,
    c: Candidates,
    *,
    drawn: set[int] | None = None,
    ink_page: FlatPage | None = None,
    mask: np.ndarray | None = None,
) -> np.ndarray:
    """Draw on a copy, keeping tags clear of circle interiors and other tags. `mask` is the ink
    page's ink mask, when the caller has it."""
    result = page.rgb.copy()
    scale = page.width / PAGE_LONG_SIDE
    padding = max(1, round(TAG_PADDING * scale))
    corner = max(1, round(TAG_CORNER_RADIUS * scale))
    protected = np.zeros((page.height, page.width), dtype=bool)
    yy, xx = np.ogrid[: page.height, : page.width]
    for circle in c.circles:
        protected |= (xx - circle.cx) ** 2 + (yy - circle.cy) ** 2 <= (
            PROTECTED_RADIUS * circle.r
        ) ** 2
    # Include solid dark regions as well as locally contrasted strokes. Dilate to
    # protect anti-aliased edges around handwriting too. "Dark" is against this page's own
    # paper: the owner's blue-cast Desk View paper is darker in red than any fixed level.
    source = ink_page if ink_page is not None else page
    darkest = source.rgb.min(axis=2)
    paper = float(np.percentile(darkest[::4, ::4], SOLID_PERCENTILE))
    strokes = ink_mask(source) if mask is None else mask
    ink = (strokes != 0) | (darkest < SOLID_DARK * paper)
    ink = cv2.dilate(ink.astype(np.uint8), np.ones((5, 5), np.uint8)) != 0
    occupied = protected | ink
    tags = np.zeros_like(occupied)
    anchors = [(m.mark, m.cx + TAG_CIRCLE_X * m.r, m.cy + TAG_CIRCLE_Y * m.r) for m in c.circles]
    anchors += [(m.mark, m.x + m.w, m.y) for m in c.labels]
    for mark, ax, ay in anchors:
        text = str(mark)
        (tw, th), baseline = cv2.getTextSize(
            text, cv2.FONT_HERSHEY_SIMPLEX, TAG_FONT_SCALE * scale, TAG_THICKNESS
        )
        bw, bh = tw + 2 * padding, th + baseline + 2 * padding
        x = max(0, min(page.width - bw - 1, round(ax)))
        y = max(0, min(page.height - bh - 1, round(ay) - bh))
        # Keep the requested anchor if free, then search above and below it. Other
        # columns are a bounded fallback for tags at the page edge or crowded states.
        dx, dy = bw + 2 * padding + 2, bh + 2 * padding + 2
        columns = [tx for tx in (x, x - dx, x + dx) if 0 <= tx < page.width - bw]
        rows = [ty for ty in (y, y - dy, y + dy) if 0 <= ty < page.height - bh]
        position = next(
            (
                (tx, ty)
                for tx in columns
                for ty in rows
                if not occupied[ty : ty + bh + 1, tx : tx + bw + 1].any()
            ),
            None,
        )
        plate = position is None
        if plate:
            # No empty paper near it: a mark never vanishes for that (the owner's live page lost
            # every mark). It goes where it covers fewest other tags, then fewest pixels of a
            # state's inside, then least ink, on an opaque white plate so it stays legible.
            spots = [
                (tx, ty)
                for tx in (x, x - dx, x + dx, x - 2 * dx, x + 2 * dx)
                for ty in (y, y - dy, y + dy, y - 2 * dy, y + 2 * dy)
                if 0 <= tx < page.width - bw and 0 <= ty < page.height - bh
            ] or [(x, y)]

            def cost(spot):
                tx, ty = spot
                window = (slice(ty, ty + bh + 1), slice(tx, tx + bw + 1))
                return (
                    int(tags[window].sum()),
                    int(protected[window].sum()),
                    int(ink[window].sum()),
                )

            position = min(spots, key=cost)
        x, y = position
        if drawn is not None:
            drawn.add(mark)
        around = (
            slice(max(0, y - padding), y + bh + padding + 1),
            slice(max(0, x - padding), x + bw + padding + 1),
        )
        occupied[around] = True
        tags[around] = True
        if plate:
            result[around] = 255
        cv2.rectangle(result, (x + corner, y), (x + bw - corner, y + bh), TAG_RGB, -1)
        cv2.rectangle(result, (x, y + corner), (x + bw, y + bh - corner), TAG_RGB, -1)
        for dx in [corner, bw - corner]:
            for dy in [corner, bh - corner]:
                cv2.circle(result, (x + dx, y + dy), corner, TAG_RGB, -1)
        cv2.putText(
            result,
            text,
            (x + padding, y + padding + th),
            cv2.FONT_HERSHEY_SIMPLEX,
            TAG_FONT_SCALE * scale,
            (255, 255, 255),
            TAG_THICKNESS,
            cv2.LINE_AA,
        )
    # Edge-clamped tags must also leave the protected pixels untouched.
    result[protected] = page.rgb[protected]
    return result
