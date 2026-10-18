"""Pure page geometry and pixels, shared by the gate and deep reader's worker threads."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from math import hypot

import cv2
import numpy as np

from tassel.domains.dfa.contract import Pt
from tassel.vision.enhance import enhance_for_llm as enhance_for_llm

Quad = tuple[Pt, Pt, Pt, Pt]

PAGE_LONG_SIDE = 1568  # Deep reader resolution, preserving the quad's aspect ratio.
GATE_LONG_SIDE = 1024  # Resolution of the cheaper decision gate's image.
FIND_LONG_SIDE = 960  # P3's page finder works at this maximum long side.
PAGE_MIN_AREA = 0.2  # A page must cover at least this fraction of the full frame.
PAGE_CLOSE_SIZE = 5  # Close small holes in the Otsu page silhouette.
PAGE_APPROX_FRACTION = 0.02  # Polygon approximation tolerance as a fraction of perimeter.
PAGE_EDGE_MARGIN = 2  # Reject the image's own outline, as P3's finder does.
FALLBACK_FRACTION = 0.8  # Central crop when neither supplied nor detected geometry is usable.
INK_BLUR_SIZE = 61  # Illumination box blur at PAGE_LONG_SIDE, scaled for smaller pages.
# Ink is darker than a fraction of the local illumination: INK_THRESHOLD on a noisy page, up to
# INK_FAINT_THRESHOLD on a clean one, so thin, faint pencil on a quiet Desk View frame (its
# strokes 0.1-0.3 darker than the paper, the paper's noise about 0.006) is whole ink, not dots.
INK_THRESHOLD = 0.78
INK_FAINT_THRESHOLD = 0.94
INK_NOISE_SIGMAS = 6  # A pixel is ink only this many noise deviations below the paper.
INK_SEED = 0.85  # A faint stroke is ink if it's this dark somewhere (a pencil line's middle).
RING_FAINT_THRESHOLD = 0.96  # The faint mask, for checking a state's ring is closed…
RING_NOISE_SIGMAS = 4  # …goes down to this many deviations, up to that fraction.
INK_OPEN_SIZE = 2  # Remove isolated noise after illumination normalization.
# Not paper: a dark region reaching the frame's edge, like the black band Desk View's de-warp
# leaves along the bottom, or the desk around a page. Its own noise is no ink, nor is its edge.
PAPER_CLOSE_SIZE = 15  # Closing that erases pen strokes before judging paper, at PAGE_LONG_SIDE.
PAPER_LEVEL = 0.35  # Paper is at least this fraction of the page's typical paper brightness.
PAPER_PERCENTILE = 90  # The typical paper brightness: this percentile of the stroke-free page.


@dataclass(frozen=True)
class FlatPage:
    rgb: np.ndarray = field(repr=False)
    width: int
    height: int
    quad: Quad
    found: bool


def decode_jpeg(data: bytes) -> np.ndarray:
    """Decode RGB without EXIF rotation: the supplied quad uses full-JPEG pixels."""
    bgr = (
        cv2.imdecode(
            np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION
        )
        if data
        else None
    )
    if bgr is None:
        raise ValueError("invalid JPEG image")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def encode_jpeg(rgb: np.ndarray, quality: int = 88) -> bytes:
    ok, encoded = cv2.imencode(
        ".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, quality]
    )
    if not ok:
        raise ValueError("could not encode JPEG image")
    return encoded.tobytes()


def page_size(quad: Quad, long_side: int = PAGE_LONG_SIDE) -> tuple[int, int]:
    """Size from mean opposite sides, never stretching a portrait page to landscape."""
    tl, tr, br, bl = quad

    def distance(a: Pt, b: Pt) -> float:
        return hypot(a.x - b.x, a.y - b.y)

    width = (distance(tl, tr) + distance(bl, br)) / 2
    height = (distance(tl, bl) + distance(tr, br)) / 2
    if min(width, height, long_side) <= 0:
        raise ValueError("page dimensions must be positive")
    scale = long_side / max(width, height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def usable_quad(q: Sequence[Pt] | None, w: int, h: int) -> Quad | None:
    """Validate a TL/TR/BR/BL quad before giving it to the perspective transform."""
    if q is None or len(q) != 4 or min(w, h) <= 0:
        return None
    points = np.array([(p.x, p.y) for p in q], dtype=np.float64)
    if not np.isfinite(points).all() or (points < 0).any():
        return None
    if (points[:, 0] > w).any() or (points[:, 1] > h).any():
        return None
    contour = points.astype(np.float32)
    if not cv2.isContourConvex(contour):
        return None
    if abs(cv2.contourArea(contour)) < PAGE_MIN_AREA * w * h:
        return None
    return tuple(Pt(x=float(x), y=float(y)) for x, y in points)


def resized(rgb: np.ndarray, long_side: int) -> np.ndarray:
    if long_side <= 0:
        raise ValueError("long_side must be positive")
    h, w = rgb.shape[:2]
    scale = long_side / max(w, h)
    return cv2.resize(
        rgb, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA
    )


def find_page_quad(rgb: np.ndarray) -> Quad | None:
    """P3's Otsu/close/largest-contour finder, returning full-frame pixel coordinates."""
    h, w = rgb.shape[:2]
    small = resized(rgb, FIND_LONG_SIDE) if max(w, h) > FIND_LONG_SIDE else rgb
    sh, sw = small.shape[:2]
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    closed = cv2.morphologyEx(
        binary, cv2.MORPH_CLOSE, np.ones((PAGE_CLOSE_SIZE, PAGE_CLOSE_SIZE), np.uint8)
    )
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(largest, PAGE_APPROX_FRACTION * cv2.arcLength(largest, True), True)
    if len(approx) != 4 or not cv2.isContourConvex(approx):
        return None
    points = approx.reshape(4, 2)
    if (points < PAGE_EDGE_MARGIN).any() or (
        (points[:, 0] > sw - 1 - PAGE_EDGE_MARGIN).any()
        or (points[:, 1] > sh - 1 - PAGE_EDGE_MARGIN).any()
    ):
        return None
    sums, diffs = points.sum(axis=1), points[:, 0] - points[:, 1]
    indices = [sums.argmin(), diffs.argmax(), sums.argmax(), diffs.argmin()]
    if len(set(indices)) != 4:
        return None
    q = [
        Pt(x=(float(points[i, 0]) + 0.5) * w / sw, y=(float(points[i, 1]) + 0.5) * h / sh)
        for i in indices
    ]
    return usable_quad(q, w, h)


def flatten_page(full_jpeg: bytes, quad: Sequence[Pt] | None) -> FlatPage:
    rgb = decode_jpeg(full_jpeg)
    h, w = rgb.shape[:2]
    chosen = usable_quad(quad, w, h) or find_page_quad(rgb)
    found = chosen is not None
    if chosen is None:
        mx, my = w * (1 - FALLBACK_FRACTION) / 2, h * (1 - FALLBACK_FRACTION) / 2
        # Rounding avoids imprecise 0.1 * frame coordinates in serialized geometry.
        mx, my = round(mx, 8), round(my, 8)
        chosen = (Pt(x=mx, y=my), Pt(x=w - mx, y=my), Pt(x=w - mx, y=h - my), Pt(x=mx, y=h - my))
    out_w, out_h = page_size(chosen)
    # Like P3, corners describe pixel edges; OpenCV uses integer pixel centers.
    src = np.array([(p.x - 0.5, p.y - 0.5) for p in chosen], np.float32)
    dst = np.array(
        [(-0.5, -0.5), (out_w - 0.5, -0.5), (out_w - 0.5, out_h - 0.5), (-0.5, out_h - 0.5)],
        np.float32,
    )
    matrix = cv2.getPerspectiveTransform(src, dst)
    flat = cv2.warpPerspective(rgb, matrix, (out_w, out_h), flags=cv2.INTER_AREA)
    return FlatPage(flat, out_w, out_h, chosen, found)


def _scaled(size: int, page: FlatPage) -> int:
    return max(1, round(size * max(page.width, page.height) / PAGE_LONG_SIDE)) | 1


def paper_mask(page: FlatPage) -> np.ndarray:
    """True on the paper: everything but dark regions that reach the frame's edge, shrunk by
    the illumination blur so their soft edge isn't paper either."""
    gray = cv2.cvtColor(page.rgb, cv2.COLOR_RGB2GRAY)
    close = _scaled(PAPER_CLOSE_SIZE, page)
    paperish = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, np.ones((close, close), np.uint8))
    level = float(np.percentile(paperish[::4, ::4], PAPER_PERCENTILE))
    dark = (paperish < PAPER_LEVEL * level).astype(np.uint8)
    if not dark.any():
        return np.ones(gray.shape, bool)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(dark)
    h, w = gray.shape
    x, y, bw, bh = stats[:, 0], stats[:, 1], stats[:, 2], stats[:, 3]
    edge = (x == 0) | (y == 0) | (x + bw == w) | (y + bh == h)
    edge[0] = False
    outside = edge[labels]
    if not outside.any():
        return np.ones(gray.shape, bool)
    grow = _scaled(INK_BLUR_SIZE, page) // 2 + close
    return cv2.dilate(outside.astype(np.uint8), np.ones((grow, grow), np.uint8)) == 0


def ink_threshold(
    relative: np.ndarray,
    paper: np.ndarray,
    sigmas: float = INK_NOISE_SIGMAS,
    faintest: float = INK_FAINT_THRESHOLD,
) -> float:
    """`sigmas` of the paper's own noise below it, from INK_THRESHOLD (a noisy page) to
    `faintest` (a clean one). The noise is the robust spread of the paper's brightness
    relative to its illumination; ink is too little of the page to move a median."""
    sample = relative[::2, ::2][paper[::2, ::2]]
    if sample.size < 100:
        return INK_THRESHOLD
    center = float(np.median(sample))
    sigma = 1.4826 * float(np.median(np.abs(sample - center)))
    return float(np.clip(center - sigmas * sigma, INK_THRESHOLD, faintest))


def relative_brightness(page: FlatPage) -> np.ndarray:
    """Each pixel's gray over its local illumination: paper is about 1, ink is darker."""
    gray = cv2.cvtColor(page.rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    size = _scaled(INK_BLUR_SIZE, page)
    return gray / np.maximum(cv2.blur(gray, (size, size)), 1)


def _seeded(relative: np.ndarray, faint: np.ndarray) -> np.ndarray:
    """The faint strokes that are ink: those reaching INK_SEED somewhere. A pencil stroke
    does along its middle; a printed margin or rule, or paper grain, stays lighter."""
    count, labels = cv2.connectedComponents(faint.astype(np.uint8), connectivity=8)
    keep = np.zeros(count, bool)
    keep[np.unique(labels[faint & (relative < INK_SEED)])] = True
    keep[0] = False
    return keep[labels]


def ink_mask(page: FlatPage, *, faint: bool = False) -> np.ndarray:
    """Her ink, 255 on 0. `faint` also takes the faintest strokes (RING_* limits): a closed
    ring is checked on that, as a hand-drawn pencil state's ring fades in places."""
    relative = relative_brightness(page)
    paper = paper_mask(page)
    threshold = (
        ink_threshold(relative, paper, RING_NOISE_SIGMAS, RING_FAINT_THRESHOLD)
        if faint
        else ink_threshold(relative, paper)
    )
    ink = relative < INK_THRESHOLD
    if threshold > INK_THRESHOLD:
        ink |= _seeded(relative, (relative < threshold) & paper)
    mask = np.where(ink & paper, 255, 0).astype(np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((INK_OPEN_SIZE, INK_OPEN_SIZE), np.uint8))
