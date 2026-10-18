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
INK_THRESHOLD = 0.78  # Ink is darker than this fraction of the local illumination.
INK_OPEN_SIZE = 2  # Remove isolated noise after illumination normalization.


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


def ink_mask(page: FlatPage) -> np.ndarray:
    gray = cv2.cvtColor(page.rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    size = max(1, round(INK_BLUR_SIZE * max(page.width, page.height) / PAGE_LONG_SIDE)) | 1
    illumination = cv2.blur(gray, (size, size))
    relative = gray / np.maximum(illumination, 1)
    mask = np.where(relative < INK_THRESHOLD, 255, 0).astype(np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((INK_OPEN_SIZE, INK_OPEN_SIZE), np.uint8))
