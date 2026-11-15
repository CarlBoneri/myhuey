"""Color themes from images, in the style of a theme extractor with moods.

Each swatch is a real pixel from the image, returned with where it was found (fractions of
the image's width and height), so a UI can show a draggable picker on that spot.

How it works: the image is shrunk, every pixel is scored for the chosen mood in OKLab
(a perceptual space, so "bright" and "muted" mean what they look like), the best-scoring
share of pixels is clustered with k-means, and each cluster is represented by the actual
pixel closest to its center.
"""

from __future__ import annotations

import math
import random
from pathlib import Path
from typing import Callable

from PIL import Image

MOODS = ("colorful", "bright", "muted", "deep", "dark")
DEFAULT_MOOD = "colorful"
_SIDE = 100
_KEEP_SHARE = 0.35  # the share of pixels, by mood score, that the clusters are built from

Lab = tuple[float, float, float]


def _linear(channel: int) -> float:
    value = channel / 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rgb_to_oklab(rgb: tuple[int, int, int]) -> Lab:
    r, g, b = (_linear(c) for c in rgb)
    l = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    )


def _chroma(lab: Lab) -> float:
    return math.hypot(lab[1], lab[2])


# Each mood scores a pixel by lightness L (0-1) and chroma C (0 to about 0.37).
_SCORES: dict[str, Callable[[float, float], float]] = {
    "colorful": lambda L, C: C * 3 - abs(L - 0.65) * 0.6,
    "bright": lambda L, C: L * 1.2 + C * 2 - (0.4 if L < 0.55 else 0),
    "muted": lambda L, C: -abs(C - 0.05) * 6 - abs(L - 0.6) * 1.2,
    "deep": lambda L, C: C * 3 - abs(L - 0.42) * 2.5,
    "dark": lambda L, C: -L * 2 + C * 0.8 - (1 if L > 0.45 else 0),
}


def _distance(a: Lab, b: Lab) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


def _kmeans(points: list[Lab], k: int, rng: random.Random, rounds: int = 12) -> list[list[int]]:
    """Cluster point indexes with k-means++ seeding. Returns the members of each cluster."""
    centers = [points[rng.randrange(len(points))]]
    while len(centers) < k:
        weights = [min(_distance(p, c) for c in centers) for p in points]
        total = sum(weights)
        if total == 0:
            break
        pick, running = rng.random() * total, 0.0
        for index, weight in enumerate(weights):
            running += weight
            if running >= pick:
                centers.append(points[index])
                break
    members: list[list[int]] = []
    for _ in range(rounds):
        members = [[] for _ in centers]
        for index, point in enumerate(points):
            nearest = min(range(len(centers)), key=lambda c: _distance(point, centers[c]))
            members[nearest].append(index)
        moved = []
        for c, group in enumerate(members):
            if not group:
                moved.append(centers[c])
                continue
            moved.append(tuple(sum(points[i][axis] for i in group) / len(group) for axis in range(3)))  # type: ignore[misc]
        if moved == centers:
            break
        centers = moved
    return [group for group in members if group]


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#" + "".join(f"{c:02x}" for c in rgb)


def extract_theme(path: Path, count: int = 5, mood: str = DEFAULT_MOOD) -> list[dict[str, float | str]]:
    """`count` swatches for a mood: [{"color": "#rrggbb", "x": 0-1, "y": 0-1}, ...]."""
    if mood not in _SCORES:
        raise ValueError(f"mood must be one of {', '.join(MOODS)}")
    count = max(1, min(10, int(count)))
    with Image.open(path) as source:
        full = source.convert("RGB")
    image = full.copy()
    image.thumbnail((_SIDE, _SIDE), Image.Resampling.BOX)
    width, height = image.size

    pixels: list[tuple[int, int, tuple[int, int, int], Lab]] = []
    for y in range(height):
        for x in range(width):
            rgb = image.getpixel((x, y))
            pixels.append((x, y, rgb, rgb_to_oklab(rgb)))  # type: ignore[arg-type]

    score = _SCORES[mood]
    ranked = sorted(pixels, key=lambda p: score(p[3][0], _chroma(p[3])), reverse=True)
    # Build clusters from the best-scoring pixels for the mood. If too few distinct colors
    # fit, widen step by step, so the mood still steers the pick but the theme stays full.
    for share in (_KEEP_SHARE, 0.6, 1.0):
        keep = ranked[: max(count * 8, int(len(ranked) * share))]
        labs = [p[3] for p in keep]
        groups = _kmeans(labs, min(count, len(keep)), random.Random(7))
        if len(groups) >= count:
            break
    groups.sort(key=len, reverse=True)

    swatches = []
    for group in groups[:count]:
        center = tuple(sum(labs[i][axis] for i in group) / len(group) for axis in range(3))
        best = min(group, key=lambda i: _distance(labs[i], center))  # type: ignore[arg-type]
        x, y, _, _ = keep[best]
        u, v = (x + 0.5) / width, (y + 0.5) / height
        # The swatch is the full-size pixel under the picker, as a picker on the image shows it.
        rgb = full.getpixel((min(full.width - 1, int(u * full.width)), min(full.height - 1, int(v * full.height))))
        swatches.append({"color": _hex(rgb), "x": round(u, 4), "y": round(v, 4)})  # type: ignore[arg-type]
    # Present them dark to light, like a theme strip.
    swatches.sort(key=lambda s: rgb_to_oklab(_rgb(str(s["color"])))[0])
    return swatches


def _rgb(value: str) -> tuple[int, int, int]:
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)
