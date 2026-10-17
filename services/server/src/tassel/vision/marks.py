"""Set-of-Mark geometry from arbitrary page pixels; no fixture or problem knowledge."""

from dataclasses import dataclass
from math import hypot, pi

import cv2
import numpy as np

from tassel.vision.page import PAGE_LONG_SIDE, FlatPage, ink_mask

MAX_MARKS = 40  # Bound the numbered geometry sent to the reader.
HOUGH_BLUR_SIZE = 5  # Smooth JPEG noise before the gradient-based circle finder.
HOUGH_DP = 1.5  # Ratio of image resolution to accumulator resolution.
HOUGH_MIN_DISTANCE = 0.05  # Minimum circle-center separation in page widths.
HOUGH_EDGE_THRESHOLD = 300  # ALT's Scharr-gradient threshold.
HOUGH_PERFECTNESS = 0.75  # ALT circle perfectness, strictly below one.
MIN_RADIUS = 0.025  # Smallest state radius in page widths.
MAX_RADIUS = 0.09  # Largest state radius in page widths.
MIN_CIRCULARITY = 0.55  # Reject elongated ink contours by 4πA/P².
MIN_AXIS_RATIO = 0.6  # Fitted ellipse's short/long axis ratio.
MERGE_DISTANCE = 0.5  # Drop centers within this fraction of a kept circle's radius.
RING_ANGLES = 72  # Uniform angular support for fitting closed state rings.
RING_SEARCH_WIDTH = 0.15  # Radius tolerance for Hough jitter and hand-drawn wobble.
RING_MIN_COVERAGE = 0.85  # Reject open transition arcs and combined loop/state ellipses.
RING_FIT_PASSES = 2  # Bound least-squares refinement work per candidate.
INNER_ANGLES = 72  # Angular samples used to distinguish accept rings from text.
INNER_MIN_RADIUS = 0.6  # Start the inner-ring scan at this fraction of the outer radius.
INNER_MAX_RADIUS = 0.9  # Stop before sampling the outer ring itself.
INNER_COVERAGE = 0.5  # At least half the sampled angles must contain ink.
RING_ERASE_WIDTH = 0.012  # Width of the erased ring in page widths.
LABEL_DILATION = 0.01  # Join glyphs into labels using this kernel size in page widths.
LABEL_MIN_SIDE = 0.008  # Smallest retained label bounding-box side in page widths.
LABEL_MAX_SIDE = 0.12  # Largest retained side, rejecting arrows and printed lines.
LABEL_MIN_AREA = 12  # Ignore components with fewer than this many pixels.
ROW_HEIGHT = 0.15  # Number marks in rows of this fraction of page height.
TAG_RGB = (29, 78, 216)  # Model-only blue tags (#1d4ed8), distinct from page ink.
TAG_FONT_SCALE = 0.55  # Hershey font scale at the full deep-reader resolution.
TAG_THICKNESS = 2  # Font stroke width in pixels.
TAG_PADDING = 4  # Tag padding at the full deep-reader resolution.
TAG_CORNER_RADIUS = 3  # Rounded tag corners at the full deep-reader resolution.
TAG_CIRCLE_X = 0.75  # Circle tag anchor's horizontal offset in radii.
TAG_CIRCLE_Y = -0.95  # Circle tag anchor's vertical offset in radii.
PROTECTED_RADIUS = 0.9  # No annotation may change a circle's inner disk.


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


def find_candidates(page: FlatPage, mask: np.ndarray | None = None) -> Candidates:
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
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        area, perimeter = cv2.contourArea(contour), cv2.arcLength(contour, True)
        if len(contour) < 5 or area < pi * (MIN_RADIUS * w) ** 2 or perimeter <= 0:
            continue
        if 4 * pi * area / perimeter**2 < MIN_CIRCULARITY:
            continue
        (cx, cy), (a, b), _ = cv2.fitEllipse(contour)
        if min(a, b) / max(a, b) < MIN_AXIS_RATIO:
            continue
        radius = (a + b) / 4
        if MIN_RADIUS * w <= radius <= MAX_RADIUS * w:
            raw.append((cx, cy, radius))
    raw = [ring for candidate in raw if (ring := _refine_ring(mask, *candidate)) is not None]
    # Prefer outer rings over inner rings and break ties geometrically, not by OpenCV order.
    kept = []
    for cx, cy, r in sorted(raw, key=lambda c: (-c[2], c[1], c[0])):
        if not any(hypot(cx - x, cy - y) < MERGE_DISTANCE * radius for x, y, radius in kept):
            kept.append((cx, cy, r))
    kept.sort(key=lambda c: (int(c[1] / (ROW_HEIGHT * h)), c[0], c[1]))
    circles = []
    labels_mask = mask.copy()
    for cx, cy, r in kept[:MAX_MARKS]:
        inner_r = _inner_radius(mask, cx, cy, r)
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
    _, _, stats, _ = cv2.connectedComponentsWithStats(joined)
    groups = [
        tuple(map(int, s))
        for s in stats[1:]
        if LABEL_MIN_SIDE * w <= s[2] <= LABEL_MAX_SIDE * w
        and LABEL_MIN_SIDE * w <= s[3] <= LABEL_MAX_SIDE * w
        and s[4] >= LABEL_MIN_AREA
    ]
    groups.sort(key=lambda s: (-s[4], s[1], s[0]))
    groups = groups[: MAX_MARKS - len(circles)]
    groups.sort(key=lambda s: (int(s[1] / (ROW_HEIGHT * h)), s[0], s[1]))
    labels = tuple(
        LabelMark(len(circles) + i + 1, float(x), float(y), float(bw), float(bh))
        for i, (x, y, bw, bh, _) in enumerate(groups)
    )
    return Candidates(tuple(circles), labels)


def draw_marks(page: FlatPage, c: Candidates) -> np.ndarray:
    """Draw on a copy, keeping tags clear of circle interiors and other tags."""
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
    occupied = protected.copy()
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
        columns = [x, *range(0, max(1, page.width - bw), bw + padding)]
        rows = [
            y,
            *range(y - bh - padding, -1, -bh - padding),
            *range(y + bh + padding, page.height - bh, bh + padding),
        ]
        position = next(
            (
                (tx, ty)
                for tx in columns
                for ty in rows
                if not occupied[ty : ty + bh + 1, tx : tx + bw + 1].any()
            ),
            None,
        )
        if position is not None:
            x, y = position
        occupied[
            max(0, y - padding) : y + bh + padding + 1, max(0, x - padding) : x + bw + padding + 1
        ] = True
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
