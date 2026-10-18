"""Synthetic handwritten pages with exact truth boxes, for mark tests and evals; no camera frame.

Text is drawn glyph by glyph in OpenCV's Hershey script font with jittered size, baseline and
spacing, then tilted and wobbled as a whole line. States are wobbly hand-drawn rings, arrows are
gently curved strokes with a head, and rules are straight printed lines. The finished page gets
uneven lighting, grain, a slight blur and a JPEG round trip, like a Desk View frame.

Positions are fractions of the page (x of its width, y of its height); sizes are page widths.
"""

from dataclasses import dataclass, field, replace
from math import cos, pi, radians, sin

import cv2
import numpy as np

from tassel.domains.dfa.contract import Pt
from tassel.vision.page import PAGE_LONG_SIDE, FlatPage, decode_jpeg, encode_jpeg

PAPER_RGB = (242, 238, 228)
PEN_RGB = (38, 44, 72)  # A blue-black ballpoint.
PRINT_RGB = (112, 124, 160)  # A printed rule, lighter than the pen but still ink to the mask.
FONT = cv2.FONT_HERSHEY_SCRIPT_SIMPLEX
FONT_CAP = 21  # Hershey cap height in pixels at fontScale 1.

Box = tuple[float, float, float, float]
"""x, y, w, h in page pixels."""


@dataclass(frozen=True)
class Text:
    text: str
    x: float
    y: float
    """The baseline's left end."""
    size: float = 0.03
    """Cap height in page widths."""
    tilt: float = 0.0
    """Degrees, counter-clockwise."""
    space: float = 0.7
    """A space's advance in cap heights."""
    tracking: float = 1.0
    """Each glyph's advance as a fraction of the font's."""


@dataclass(frozen=True)
class State:
    cx: float
    cy: float
    r: float
    accept: bool = False


@dataclass(frozen=True)
class Arrow:
    start: tuple[float, float]
    end: tuple[float, float]
    bend: float = 0.15
    """The curve's sideways bulge, as a fraction of its length."""


@dataclass(frozen=True)
class Rule:
    y: float
    x0: float = 0.04
    x1: float = 0.96


@dataclass(frozen=True)
class Line:
    """A hand-drawn straight stroke without a head, such as a divider between two problems."""

    start: tuple[float, float]
    end: tuple[float, float]


Item = Text | State | Arrow | Rule | Line


@dataclass(frozen=True)
class Truth:
    kind: str
    """"text", "state", "arrow", "rule" or "line"."""
    box: Box
    text: str | None = None
    words: tuple[Box, ...] = ()


@dataclass(frozen=True)
class SynthPage:
    page: FlatPage = field(repr=False)
    truth: tuple[Truth, ...]

    def find(self, text: str) -> Truth:
        return next(t for t in self.truth if t.text == text)


def _bounds(layer: np.ndarray) -> Box | None:
    ys, xs = np.nonzero(layer > 96)
    if not len(xs):
        return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return float(x0), float(y0), float(x1 - x0), float(y1 - y0)


def _union(boxes: list[Box]) -> Box:
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    return x0, y0, x1 - x0, y1 - y0


def _text_layers(item: Text, w: int, h: int, rng: np.random.Generator) -> list[np.ndarray]:
    """One anti-aliased layer per word, sharing the line's tilt and wobble."""
    cap = item.size * w
    scale = cap / FONT_CAP
    thickness = max(2, round(cap * 0.07))
    x0, y0 = item.x * w, item.y * h
    pen_x = x0
    layers = []
    for word in item.text.split(" "):
        layer = np.zeros((h, w), np.uint8)
        for ch in word:
            s = scale * (1 + rng.normal(0, 0.06))
            dy = rng.normal(0, 0.05) * cap
            cv2.putText(
                layer, ch, (round(pen_x), round(y0 + dy)), FONT, s, 255, thickness, cv2.LINE_AA
            )
            (advance, _), _ = cv2.getTextSize(ch, FONT, s, thickness)
            pen_x += advance * item.tracking * (1 + rng.normal(0, 0.06))
        pen_x += item.space * cap * (1 + rng.normal(0, 0.1))
        layers.append(layer)
    rotation = cv2.getRotationMatrix2D((x0, y0), item.tilt, 1.0)
    amplitude, wavelength, phase = 0.05 * cap, 4.5 * cap, rng.uniform(0, 2 * pi)
    xs, ys = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    wobble = (amplitude * np.sin(2 * pi * (xs - x0) / wavelength + phase)).astype(np.float32)
    return [
        cv2.remap(
            cv2.warpAffine(layer, rotation, (w, h), flags=cv2.INTER_LINEAR),
            xs,
            ys - wobble,
            cv2.INTER_LINEAR,
        )
        for layer in layers
    ]


def _state_layer(item: State, w: int, h: int, rng: np.random.Generator) -> np.ndarray:
    layer = np.zeros((h, w), np.uint8)
    cx, cy = item.cx * w, item.cy * h
    for ring in [1.0, *([0.8] if item.accept else [])]:
        r = item.r * w * ring
        phase = rng.uniform(0, 2 * pi)
        overshoot = rng.uniform(0.05, 0.25)
        angles = np.linspace(phase, phase + 2 * pi + overshoot, 160)
        radii = r * (1 + 0.025 * np.sin(3 * angles + rng.uniform(0, 2 * pi)))
        points = np.column_stack((cx + radii * np.cos(angles), cy + radii * np.sin(angles)))
        cv2.polylines(layer, [np.rint(points).astype(np.int32)], False, 255, 3, cv2.LINE_AA)
    return layer


def _arrow_layer(item: Arrow, w: int, h: int, rng: np.random.Generator) -> np.ndarray:
    layer = np.zeros((h, w), np.uint8)
    (ax, ay), (bx, by) = (item.start[0] * w, item.start[1] * h), (item.end[0] * w, item.end[1] * h)
    dx, dy = bx - ax, by - ay
    control = ((ax + bx) / 2 - dy * item.bend, (ay + by) / 2 + dx * item.bend)
    t = np.linspace(0, 1, 120)[:, None]
    curve = (1 - t) ** 2 * np.array([ax, ay]) + 2 * (1 - t) * t * np.array(control)
    curve += t**2 * np.array([bx, by])
    curve += rng.normal(0, 0.4, curve.shape)
    cv2.polylines(layer, [np.rint(curve).astype(np.int32)], False, 255, 3, cv2.LINE_AA)
    tx, ty = curve[-1] - curve[-8]
    heading = np.arctan2(ty, tx)
    head = 0.022 * w
    for side in (-1, 1):
        angle = heading + pi - side * radians(28)
        tip = (round(bx), round(by))
        cv2.line(
            layer,
            tip,
            (round(bx + head * cos(angle)), round(by + head * sin(angle))),
            255,
            3,
            cv2.LINE_AA,
        )
    return layer


def _line_layer(item: Line, w: int, h: int, rng: np.random.Generator) -> np.ndarray:
    layer = np.zeros((h, w), np.uint8)
    t = np.linspace(0, 1, 80)[:, None]
    a = np.array([item.start[0] * w, item.start[1] * h])
    b = np.array([item.end[0] * w, item.end[1] * h])
    points = a + t * (b - a) + rng.normal(0, 0.5, (len(t), 2))
    cv2.polylines(layer, [np.rint(points).astype(np.int32)], False, 255, 3, cv2.LINE_AA)
    return layer


def _lighting(w: int, h: int, strength: float, rng: np.random.Generator) -> np.ndarray:
    """A smooth multiplicative field: a desk lamp off to one side plus a soft vignette."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    lx, ly = rng.uniform(-0.3, 1.3) * w, rng.uniform(-0.3, 1.3) * h
    distance = np.hypot(xs - lx, ys - ly) / max(w, h)
    field_ = 1 - strength * np.clip(distance, 0, 1.2) / 1.2
    vignette = 1 - 0.08 * strength * (((xs / w - 0.5) ** 2 + (ys / h - 0.5) ** 2) * 4)
    return (field_ * vignette).astype(np.float32)


def render(
    items: list[Item],
    *,
    width: int = PAGE_LONG_SIDE,
    height: int = 1200,
    seed: int = 0,
    lighting: float = 0.3,
    grain: float = 4.0,
    quality: int = 80,
    paper_rgb: tuple[int, int, int] = PAPER_RGB,
    pen_rgb: tuple[int, int, int] = PEN_RGB,
    pen_alpha: float = 0.92,
    cast: tuple[float, float, float] = (1.0, 1.0, 1.0),
    gradient: float = 0.0,
    band: float = 0.0,
    blur: float = 0.7,
) -> SynthPage:
    """The page and each item's truth box (from its own ink, before lighting and JPEG).

    The camera options make a raw Desk View frame rather than a flattened page: `cast` scales
    each channel (a blue cast), `gradient` darkens the left edge by this fraction, `band` blacks
    out this fraction of the height at the bottom (the desk the de-warp has no pixels for), and a
    low `pen_alpha` with a wider `blur` gives thin, faint pencil."""
    rng = np.random.default_rng(seed)
    w, h = width, height
    ink = np.zeros((h, w), np.float32)
    printed = np.zeros((h, w), np.float32)
    truth = []
    for item in items:
        if isinstance(item, Text):
            layers = _text_layers(item, w, h, rng)
            words = tuple(b for b in map(_bounds, layers) if b is not None)
            truth.append(Truth("text", _union(list(words)), item.text, words))
            for layer in layers:
                ink = np.maximum(ink, layer / 255)
            continue
        if isinstance(item, Rule):
            layer = np.zeros((h, w), np.uint8)
            y = round(item.y * h)
            cv2.line(layer, (round(item.x0 * w), y), (round(item.x1 * w), y), 255, 2, cv2.LINE_AA)
            printed = np.maximum(printed, layer / 255)
            truth.append(Truth("rule", _bounds(layer)))
            continue
        if isinstance(item, Line):
            layer = _line_layer(item, w, h, rng)
            truth.append(Truth("line", _bounds(layer)))
            ink = np.maximum(ink, layer / 255)
            continue
        layer = (
            _state_layer(item, w, h, rng)
            if isinstance(item, State)
            else _arrow_layer(item, w, h, rng)
        )
        truth.append(Truth("state" if isinstance(item, State) else "arrow", _bounds(layer)))
        ink = np.maximum(ink, layer / 255)
    rgb = np.empty((h, w, 3), np.float32)
    rgb[:] = paper_rgb
    for color, alpha in ((PRINT_RGB, printed), (pen_rgb, pen_alpha * ink)):
        rgb = rgb * (1 - alpha[..., None]) + np.array(color, np.float32) * alpha[..., None]
    rgb *= _lighting(w, h, lighting, rng)[..., None]
    rgb *= np.array(cast, np.float32)
    if gradient:
        rgb *= (1 - gradient * np.linspace(1, 0, w, dtype=np.float32))[None, :, None]
    if band:
        # The de-warp's empty desk: nearly black, with a soft edge a few pixels deep.
        ramp = np.clip((np.arange(h, dtype=np.float32) - (1 - band) * h) / 6, 0, 1)
        rgb = rgb * (1 - ramp[:, None, None]) + 6 * ramp[:, None, None]
    rgb += rng.normal(0, grain, rgb.shape)
    size = 2 * max(1, round(2 * blur)) + 1
    rgb = cv2.GaussianBlur(np.clip(rgb, 0, 255).astype(np.uint8), (size, size), blur)
    rgb = decode_jpeg(encode_jpeg(rgb, quality=quality))
    quad = (Pt(x=0, y=0), Pt(x=w, y=0), Pt(x=w, y=h), Pt(x=0, y=h))
    return SynthPage(FlatPage(rgb, w, h, quad, True), tuple(truth))


IP = "10.0.0.0/24"
SENTENCE = "the router forwards every packet"

# Named pages for the tests and the live eval harness. Each is a plain list of items, so a
# caller can render it with any seed, lighting or JPEG quality.
SCENES: dict[str, list[Item]] = {
    # The owner's live test: a handwritten subnet, about a fifth of the page wide.
    "ip": [Text(IP, 0.36, 0.42, size=0.03, tilt=2.0, tracking=0.72)],
    # A sentence written with tight word gaps, so its words join into one ink group.
    "sentence": [Text(SENTENCE, 0.08, 0.5, size=0.03, tilt=-1.5, space=0.33)],
    # The same sentence with ordinary word gaps: each word is its own ink group.
    "note": [Text(SENTENCE, 0.1, 0.3, size=0.03, tilt=1.0, space=0.8)],
    # Long strokes that aren't writing.
    "strokes": [
        Arrow((0.12, 0.25), (0.48, 0.3), bend=0.12),
        Arrow((0.6, 0.75), (0.9, 0.55), bend=-0.2),
        Arrow((0.15, 0.7), (0.42, 0.72), bend=0.0),
        Rule(0.12),
        Rule(0.9, 0.1, 0.7),
    ],
    # A small network: two hosts as states, the subnet beside them, an arrow, a rule.
    "network": [
        Text("Subnet", 0.08, 0.1, size=0.03),
        Rule(0.16),
        State(0.2, 0.45, 0.05),
        State(0.75, 0.45, 0.05, accept=True),
        Text("h1", 0.185, 0.46, size=0.022),
        Text("h2", 0.735, 0.46, size=0.022),
        Arrow((0.27, 0.45), (0.68, 0.46), bend=0.08),
        Text(IP, 0.36, 0.75, size=0.03, tilt=-2.5, tracking=0.72),
        Text("gw", 0.62, 0.3, size=0.025),
    ],
}


LANGUAGE = "Language A = {e, 101}"
MASK = "Subnet Mask 255.255.255.128"
USABLE = "64 usable addresses"
SUBNET = "192.168.1.0/24"

# The owner's live page (2026-10-18), redrawn: two problems side by side in thin pencil, a
# divider between them, and three small states, on a whole unflattened Desk View frame.
SCENES["desk"] = [
    Text("Problem 1", 0.07, 0.09, size=0.016),
    Text(LANGUAGE, 0.07, 0.155, size=0.016, tracking=0.8),
    Arrow((0.11, 0.30), (0.153, 0.30), bend=0.0),
    State(0.178, 0.30, 0.022, accept=True),
    Arrow((0.202, 0.295), (0.27, 0.29), bend=0.0),
    Text("1", 0.232, 0.27, size=0.014),
    State(0.294, 0.285, 0.022),
    Arrow((0.318, 0.285), (0.389, 0.28), bend=0.0),
    Text("0", 0.35, 0.265, size=0.014),
    State(0.413, 0.28, 0.022, accept=True),
    Line((0.465, 0.07), (0.468, 0.38)),
    Text("Problem 2", 0.49, 0.09, size=0.016),
    Text(SUBNET, 0.495, 0.13, size=0.016, tracking=0.75),
    Text(MASK, 0.495, 0.172, size=0.016, tracking=0.8),
    Text(USABLE, 0.495, 0.207, size=0.016, tracking=0.8),
]

# How the owner's Desk View frames look by the numbers: a blue cast (red about half of blue on
# the paper), brighter to the right, faint thin pencil, and the bottom of the frame black.
DESK_VIEW = dict(
    width=1920,
    height=1440,
    lighting=0.1,
    grain=1.5,
    quality=85,
    paper_rgb=(236, 236, 232),
    pen_rgb=(120, 120, 128),
    pen_alpha=0.55,
    cast=(0.45, 0.62, 0.92),
    gradient=0.18,
    band=0.17,
    blur=1.0,
)


def scene(name: str, **options) -> SynthPage:
    return render(SCENES[name], **options)


def desk_view(name: str = "desk", **options) -> SynthPage:
    """A scene as a raw Desk View frame: the whole frame is the page, nothing is flattened."""
    page = render(SCENES[name], **(DESK_VIEW | options))
    return SynthPage(replace(page.page, found=False), page.truth)
