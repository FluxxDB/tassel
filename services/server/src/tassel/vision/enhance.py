"""Fast, geometry-preserving pencil enhancement for the model's RGB copy only."""

import cv2
import numpy as np


def enhance_for_llm(rgb: np.ndarray) -> np.ndarray:
    """Return neutral black-on-white pixels without mutating the camera image.

    The brightest channel rejects blue/red ruling while retaining neutral graphite.
    A coarse closing estimates paper illumination without following individual strokes.
    Long, faint horizontal residuals are removed conservatively: short diagram arrows
    and dark strokes survive. Soft thresholds retain antialiasing and faint pencil.
    """
    if rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3 or not rgb.size:
        raise ValueError("expected a nonempty uint8 RGB image")
    h, w = rgb.shape[:2]
    red, green, blue = cv2.split(rgb)
    gray = cv2.max(cv2.max(red, green), blue)
    small = cv2.resize(gray, (max(1, w // 8), max(1, h // 8)), interpolation=cv2.INTER_AREA)
    background = cv2.morphologyEx(small, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    background = cv2.GaussianBlur(background, (0, 0), 3)
    background = cv2.resize(background, (w, h), interpolation=cv2.INTER_LINEAR)
    normalized = cv2.divide(gray, np.maximum(background, 1), scale=255)
    darkness = cv2.subtract(255, normalized)
    # A rule must extend much farther than a normal transition arrow. Cap removal
    # rather than erasing a mask, preserving graphite crossing a ruled line.
    # Only the long-axis rule estimate needs fewer samples; keep every row so
    # thin ruling stays localized. This avoids a ~500-pixel full-frame kernel.
    rule_width = max(1, w // 8)
    rule_sample = cv2.resize(darkness, (rule_width, h), interpolation=cv2.INTER_AREA)
    rules = cv2.morphologyEx(
        rule_sample, cv2.MORPH_OPEN, np.ones((1, max(3, rule_width // 3)), np.uint8)
    )
    rules = cv2.resize(rules, (w, h), interpolation=cv2.INTER_LINEAR)
    darkness = cv2.subtract(darkness, np.minimum(rules, 35))
    darkness = cv2.GaussianBlur(darkness, (3, 3), 0.55)
    # White dead band suppresses compression noise and residual colored ruling.
    ink = np.maximum(darkness.astype(np.float32) - 7, 0) * 3.6
    detail = ink - cv2.GaussianBlur(ink, (0, 0), 1.1)
    edge = np.maximum(
        np.linspace(-1, 1, w, dtype=np.float32)[None, :] ** 2,
        np.linspace(-1, 1, h, dtype=np.float32)[:, None] ** 2,
    )
    ink += (0.25 + 0.65 * edge) * np.clip(detail, -25, 25)
    clean = (255 - np.clip(ink, 0, 255)).astype(np.uint8)
    return cv2.cvtColor(clean, cv2.COLOR_GRAY2RGB)
