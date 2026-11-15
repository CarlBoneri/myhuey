"""The palette library that suggested scenes choose from.

Palettes ship in `data/palettes.json`, built once by `scripts/build_palettes.py`. The library
holds colors from The Met's public-domain paintings (CC0, each crediting its painting) and
harmonies generated here. COLOURlovers palettes (CC BY-NC-SA 3.0, credited per entry) are
included only if its API answers the build script, which it currently doesn't. Everything is
judged in OKLab, so "muted" and "vivid" mean what they look like. Nothing here touches the
network.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from importlib import resources
from typing import Any

from .color import hex_to_rgb, rgb_to_hex
from .palette import rgb_to_oklab

Lab = tuple[float, float, float]

NEAR_BLACK_L = 0.25
NEON_CHROMA = 0.30
HARSH_CHROMA = 0.15
HARSH_WINDOW = 25.0  # degrees either side of opposite hues
CHROMATIC = 0.03  # below this a color counts as a neutral for hue judgments
MIN_COLORS = 3


@dataclass(frozen=True)
class Palette:
    id: str
    name: str
    colors: list[str]
    tags: list[str]
    source: str
    credit: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def __hash__(self) -> int:  # lists inside, so hash by id
        return hash(self.id)


# OKLab helpers


def lab(color: str) -> Lab:
    return rgb_to_oklab(hex_to_rgb(color))


def chroma(value: Lab) -> float:
    return math.hypot(value[1], value[2])


def hue(value: Lab) -> float:
    return math.degrees(math.atan2(value[2], value[1])) % 360


def _gamma(value: float) -> float:
    return 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055


def oklab_to_linear(value: Lab) -> tuple[float, float, float]:
    L, a, b = value
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )


def oklab_to_hex(value: Lab) -> str:
    """The sRGB color for an OKLab value, pulling chroma in until it fits the gamut."""
    L, a, b = value
    for _ in range(40):
        linear = oklab_to_linear((L, a, b))
        if all(-1e-4 <= channel <= 1 + 1e-4 for channel in linear):
            break
        a, b = a * 0.92, b * 0.92
    channels = [round(255 * _gamma(min(1.0, max(0.0, channel)))) for channel in oklab_to_linear((L, a, b))]
    return rgb_to_hex(channels)


def mix(color: str, toward: str, share: float) -> str:
    """`share` of `color` and the rest `toward`, mixed in OKLab (share 1 = color, 0 = toward)."""
    start, end = lab(toward), lab(color)
    return oklab_to_hex(tuple(s + (e - s) * share for s, e in zip(start, end)))  # type: ignore[arg-type]


def _hue_gap(first: float, second: float) -> float:
    gap = abs(first - second) % 360
    return min(gap, 360 - gap)


# Judging palettes


def clean(colors: list[str]) -> list[str]:
    """The colors that make usable room light: no near-black, no neon."""
    kept = []
    for color in colors:
        value = lab(color)
        if value[0] >= NEAR_BLACK_L and chroma(value) <= NEON_CHROMA:
            kept.append(color)
    return kept


def usable(colors: list[str]) -> bool:
    """Whether a palette can light a room: at least 3 usable colors and no harsh complements."""
    kept = clean(colors)
    if len(kept) < MIN_COLORS:
        return False
    strong = [hue(lab(color)) for color in kept if chroma(lab(color)) > HARSH_CHROMA]
    for index, first in enumerate(strong):
        for second in strong[index + 1:]:
            if _hue_gap(first, second) >= 180 - HARSH_WINDOW:
                return False
    return True


def _is_warm(angle: float) -> bool:
    return angle < 110 or angle >= 330


def _is_cool(angle: float) -> bool:
    return 140 <= angle < 300


def tag(colors: list[str]) -> list[str]:
    values = [lab(color) for color in colors]
    chromas = [chroma(value) for value in values]
    mean_chroma = sum(chromas) / len(chromas)
    chromatic = [value for value in values if chroma(value) > CHROMATIC]
    tags = []
    if chromatic:
        x = sum(math.cos(math.radians(hue(value))) * chroma(value) for value in chromatic)
        y = sum(math.sin(math.radians(hue(value))) * chroma(value) for value in chromatic)
        mean_hue = math.degrees(math.atan2(y, x)) % 360
        if _is_warm(mean_hue):
            tags.append("warm")
        elif _is_cool(mean_hue):
            tags.append("cool")
        hues = [hue(value) for value in chromatic]
        if max(_hue_gap(first, second) for first in hues for second in hues) < 60:
            tags.append("analogous")
    if mean_chroma < 0.08:
        tags.append("muted")
    if mean_chroma > 0.14:
        tags.append("vivid")
    if sum(1 for c in chromas if c > 0.12) == 1 and all(c < 0.07 for c in chromas if c <= 0.12):
        tags.append("accent")
    blue = sum(1 for value in values if 220 <= hue(value) < 290 and chroma(value) > 0.05)
    if blue / len(values) >= 0.4:
        tags.append("blue_heavy")
    return tags


# Generated harmonies

_HUE_WORDS = [(30, "Ember"), (60, "Amber"), (100, "Honey"), (140, "Olive"), (180, "Sage"), (220, "Lagoon"),
              (260, "Dusk"), (300, "Iris"), (340, "Rosewood"), (360, "Ember")]


def _hue_word(angle: float) -> str:
    return next(word for limit, word in _HUE_WORDS if angle % 360 < limit)


def _lch(L: float, C: float, h: float) -> str:
    return oklab_to_hex((L, C * math.cos(math.radians(h)), C * math.sin(math.radians(h))))


def _analogous(rng: random.Random, base: float) -> list[str]:
    C = rng.uniform(0.06, 0.12)
    return [_lch(0.55 + 0.06 * i, C, base + (i - 2) * 15) for i in range(5)]


def _vivid(rng: random.Random, base: float) -> list[str]:
    C = rng.uniform(0.15, 0.2)
    return [_lch(0.6 + 0.05 * i, C, base + (i - 2) * 12) for i in range(5)]


def _warm_gradient(rng: random.Random, base: float) -> list[str]:
    start = rng.uniform(15, 40)
    return [_lch(0.5 + 0.09 * i, rng.uniform(0.08, 0.13), start + 12 * i) for i in range(5)]


def _accent(rng: random.Random, base: float) -> list[str]:
    neutrals = [_lch(0.45 + 0.1 * i, rng.uniform(0.015, 0.035), base) for i in range(4)]
    return neutrals + [_lch(0.68, rng.uniform(0.16, 0.2), (base + rng.choice([120, 180, 240])) % 360)]


def _split(rng: random.Random, base: float) -> list[str]:
    C = rng.uniform(0.06, 0.09)
    return [_lch(0.62, C, base), _lch(0.7, C, base + 150), _lch(0.7, C, base + 210),
            _lch(0.8, 0.02, base), _lch(0.5, 0.025, base)]


_RULES = [("Analogous", _analogous), ("Glow", _vivid), ("Hearth", _warm_gradient), ("Accent", _accent), ("Split", _split)]


def generate(seed: int, count: int) -> list[Palette]:
    """`count` palettes from myhuey's own harmony rules, the same for the same seed."""
    rng = random.Random(seed)
    palettes: list[Palette] = []
    attempts = 0
    while len(palettes) < count and attempts < count * 20:
        attempts += 1
        label, rule = _RULES[attempts % len(_RULES)]
        base = rng.uniform(0, 360)
        colors = rule(rng, base)
        if not usable(colors):
            continue
        number = len(palettes) + 1
        palettes.append(Palette(
            id=f"gen-{seed}-{number}", name=f"{_hue_word(base)} {label} {number}", colors=colors,
            tags=tag(colors), source="generated",
        ))
    return palettes


# The shipped library


def from_dict(data: dict[str, Any]) -> Palette:
    return Palette(
        id=str(data["id"]), name=str(data["name"]), colors=list(data["colors"]), tags=list(data.get("tags") or []),
        source=str(data.get("source") or "generated"), credit=dict(data.get("credit") or {}),
    )


@lru_cache(maxsize=1)
def _library() -> tuple[Palette, ...]:
    text = resources.files("myhuey.data").joinpath("palettes.json").read_text(encoding="utf-8")
    return tuple(from_dict(item) for item in json.loads(text))


def load() -> list[Palette]:
    return list(_library())


def by_id(palette_id: str) -> Palette:
    for palette in _library():
        if palette.id == palette_id:
            return palette
    raise ValueError(f"No palette with id '{palette_id}'")


def search(tag: str | None = None, q: str | None = None, limit: int = 60) -> list[Palette]:
    found = []
    for palette in _library():
        if tag and tag not in palette.tags:
            continue
        if q and q.lower() not in palette.name.lower():
            continue
        found.append(palette)
        if len(found) >= limit:
            break
    return found
