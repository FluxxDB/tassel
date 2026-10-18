"""Synthetic student attachments and renderer-owned truth; never camera/device pixels."""

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


@dataclass(frozen=True)
class Truth:
    name: str
    kind: str
    box: tuple[float, float, float, float]


@dataclass
class Scene:
    rgb: np.ndarray
    truth: list[Truth]

    def png(self) -> bytes:
        ok, data = cv2.imencode(".png", cv2.cvtColor(self.rgb, cv2.COLOR_RGB2BGR))
        assert ok
        return data.tobytes()


def text(draw, truth, name, xy, value, size=24, fill="#20242a"):
    font = ImageFont.load_default(size=size)
    x0, y0, x1, y1 = draw.textbbox(xy, value, font=font)
    draw.text(xy, value, font=font, fill=fill)
    truth.append(Truth(name, "text", (x0, y0, x1 - x0, y1 - y0)))


def textbook() -> Scene:
    image = Image.new("RGB", (1000, 850), "#faf9f5")
    draw, truth = ImageDraw.Draw(image), []
    text(draw, truth, "title", (65, 40), "Forces and motion", 36)
    lines = [
        "A force changes the motion of an object.",
        "Mass measures how much matter it contains.",
        "The acceleration points along the net force.",
        "Double the force to double the acceleration.",
        "Keep the mass constant in this experiment.",
        "Use the diagram below to explain your answer.",
    ]
    for i, line in enumerate(lines):
        text(draw, truth, f"line {i + 1}", (65, 115 + 46 * i), line)
    text(draw, truth, "formula", (65, 425), "F = m a     12 N = 3 kg x 4 m/s^2", 29)
    box = (130, 535, 440, 230)
    draw.rectangle((130, 535, 570, 765), outline="#304050", width=3)
    draw.rectangle((250, 620, 355, 700), outline="#304050", width=3)
    draw.line((355, 660, 485, 660), fill="#b64f32", width=4)
    draw.polygon(((485, 660), (468, 651), (468, 669)), fill="#b64f32")
    draw.ellipse((240, 700, 265, 725), outline="#304050", width=3)
    draw.ellipse((340, 700, 365, 725), outline="#304050", width=3)
    truth.append(Truth("diagram", "figure", box))
    return Scene(np.array(image), truth)


def slide() -> Scene:
    image = Image.new("RGB", (1100, 720), "#182536")
    draw, truth = ImageDraw.Draw(image), []
    text(draw, truth, "title", (70, 45), "Growth over time", 38, "#ffffff")
    for i, line in enumerate(
        [
            "Measure at the same time each day.",
            "Record every observation.",
            "Compare the two groups.",
        ]
    ):
        text(draw, truth, f"line {i + 1}", (70, 125 + 48 * i), line, 26, "#edf3fa")
    draw.line((180, 330, 180, 620, 860, 620), fill="#ecf3fa", width=3)
    for x, top in [(260, 520), (410, 460), (560, 410), (710, 350)]:
        draw.rectangle((x, top, x + 80, 620), fill="#63c9dd")
    truth.append(Truth("diagram", "figure", (180, 330, 680, 290)))
    return Scene(np.array(image), truth)


def photograph() -> Scene:
    scene = textbook()
    h, w = scene.rgb.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[42, 18], [w - 45, 35], [w - 10, h - 40], [25, h - 12]])
    perspective = cv2.getPerspectiveTransform(src, dst)
    rotation = np.vstack((cv2.getRotationMatrix2D((w / 2, h / 2), 3, 0.96), [0, 0, 1]))
    transform = rotation @ perspective
    rgb = cv2.warpPerspective(scene.rgb, transform, (w, h), borderValue=(190, 183, 173))
    yy, xx = np.mgrid[:h, :w]
    shade = 0.62 + 0.35 * xx / w - 0.13 * np.exp(-(((xx - 350) / 200) ** 2))
    noise = np.random.default_rng(71).normal(0, 2.0, rgb.shape)
    rgb = np.clip(rgb * shade[:, :, None] + noise, 0, 255).astype(np.uint8)
    truth = []
    for item in scene.truth:
        x, y, bw, bh = item.box
        corners = np.float32([[[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]]])
        warped = cv2.perspectiveTransform(corners, transform)[0]
        lo, hi = warped.min(axis=0), warped.max(axis=0)
        truth.append(Truth(item.name, item.kind, (*map(float, lo), *map(float, hi - lo))))
    return Scene(rgb, truth)


def screenshot() -> Scene:
    scene = textbook()
    image = Image.new("RGB", (1180, 980), "#dce1e8")
    image.paste(Image.fromarray(scene.rgb), (90, 100))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1180, 74), fill="#263143")
    draw.rounded_rectangle((145, 24, 1000, 52), radius=8, fill="#536174")
    for x in (25, 50, 75):
        draw.ellipse((x, 29, x + 12, 41), fill="#cbd3de")
    for y in range(130, 840, 55):
        draw.rectangle((25, y, 43, y + 18), outline="#667384", width=2)
    return Scene(
        np.array(image),
        [Truth(t.name, t.kind, (t.box[0] + 90, t.box[1] + 100, *t.box[2:])) for t in scene.truth],
    )


FIXTURES = {
    "textbook": textbook,
    "dark slide": slide,
    "photograph": photograph,
    "screenshot": screenshot,
}


def dfa_page() -> Scene:
    from tassel.evals.fixtures import render

    page = render("dfa-page")
    rgb = cv2.cvtColor(cv2.imdecode(np.frombuffer(page.jpeg, np.uint8), 1), cv2.COLOR_BGR2RGB)
    truth = [
        Truth(name, "text" if name == "title" else "circle", item.box)
        for name, item in page.truths.items()
    ]
    # Independent renderer coordinates, including the stroke thickness and arrow tips.
    truth.append(Truth("start", "arrow", (107, 682, 111, 37)))
    for index, x in enumerate((384, 704, 1024)):
        truth.append(Truth(f"q{index}->q{index + 1}", "arrow", (x - 3, 680, 159, 41)))
        label_box = (776, 649, 13, 34) if index == 1 else (x + 67, 648, 27, 36)
        truth.append(Truth(f"label {index}", "label", label_box))
    return Scene(rgb, truth)


def arrow_diagram() -> Scene:
    image = Image.new("RGB", (1000, 740), "white")
    draw, truth = ImageDraw.Draw(image), []
    text(draw, truth, "title", (60, 40), "Transitions and loops", 28)
    for name, cx, cy in (("a", 220, 350), ("b", 540, 350), ("c", 780, 570)):
        draw.ellipse((cx - 50, cy - 50, cx + 50, cy + 50), outline="black", width=3)
        draw.text((cx - 8, cy - 14), name, font=ImageFont.load_default(size=24), fill="black")
        truth.append(Truth(name, "circle", (cx - 50, cy - 50, 101, 101)))
    draw.rectangle((170, 520, 270, 620), outline="black", width=3)
    truth.append(Truth("box", "figure", (170, 520, 101, 101)))
    rgb = np.array(image)

    def stroke(name, paint):
        # Truth comes from the renderer's isolated layer, not image_view's segmentation.
        layer = np.zeros(rgb.shape[:2], np.uint8)
        paint(layer)
        ys, xs = np.nonzero(layer)
        truth.append(Truth(name, "arrow", (xs.min(), ys.min(), np.ptp(xs) + 1, np.ptp(ys) + 1)))
        rgb[layer != 0] = 0

    stroke("start", lambda im: cv2.arrowedLine(im, (60, 350), (170, 350), 255, 3, tipLength=0.15))
    stroke("a->b", lambda im: cv2.arrowedLine(im, (270, 350), (490, 350), 255, 3, tipLength=0.1))
    stroke("headless", lambda im: cv2.line(im, (220, 400), (220, 520), 255, 3))
    stroke("b->c", lambda im: cv2.arrowedLine(im, (578, 388), (742, 532), 255, 3, tipLength=0.12))

    def loop(im):
        angles = np.linspace(np.deg2rad(135), np.deg2rad(405), 100)
        pts = np.column_stack((540 + 48 * np.cos(angles), 240 + 70 * np.sin(angles)))
        cv2.polylines(im, [pts.astype(np.int32)], False, 255, 3)
        cv2.arrowedLine(
            im, tuple(pts[-8].astype(int)), tuple(pts[-1].astype(int)), 255, 3, tipLength=0.65
        )

    stroke("loop", loop)
    image = Image.fromarray(rgb)
    draw = ImageDraw.Draw(image)
    for name, xy, value in (
        ("zero", (365, 315), "0"),
        ("one", (534, 135), "1"),
        ("x", (185, 450), "x"),
        ("two symbols", (680, 425), "01"),
    ):
        text(draw, truth, name, xy, value, 24)
        truth[-1] = Truth(name, "label", truth[-1].box)
    return Scene(np.array(image), truth)


DIAGRAM_FIXTURES = {"dfa-page": dfa_page, "arrow diagram": arrow_diagram}


def touching_label() -> Scene:
    image = Image.new("RGB", (700, 400), "white")
    draw = ImageDraw.Draw(image)
    for x in (140, 560):
        draw.ellipse((x - 50, 200, x + 50, 300), outline="black", width=3)
    draw.line((190, 250, 510, 250), fill="black", width=3)
    draw.line((495, 240, 510, 250, 495, 260), fill="black", width=3)
    # The bottom of this glyph touches the shaft, making a single ink component.
    text(draw, [], "label", (340, 226), "0", 28)
    return Scene(np.array(image), [Truth("edge and label", "arrow", (190, 234, 321, 28))])


def iou(a, b):
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    intersection = ix * iy
    return intersection / (a[2] * a[3] + b[2] * b[3] - intersection)


def box_of(element):
    b = element.box
    return b.x, b.y, b.w, b.h
