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


def iou(a, b):
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    intersection = ix * iy
    return intersection / (a[2] * a[3] + b[2] * b[3] - intersection)


def box_of(element):
    b = element.box
    return b.x, b.y, b.w, b.h
