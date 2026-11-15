"""What each Hue light physically looks like, so the plan can draw it at its real size.

A profile is resolved from the light's archetype, product name, and model ID, most specific
first. Sizes are in centimeters, as the light's silhouette is drawn on the plan: `length` runs
along the light's rotation axis and `width` across it. Round fixtures use `length` as the
diameter. Vertical lights (Signe, tubes) are drawn as their column, so they can be laid along
the wall they wash and take gradient colors along it.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any

# Shape kinds the UI knows how to draw.
ROUND = "round"  # a round fixture or bulb seen from above
STRIP = "strip"  # a long thin lightstrip, adjustable length
BAR = "bar"  # a short rigid bar (Play, wall washers)
TUBE = "tube"  # a rigid tube with rounded ends
COLUMN = "column"  # a tall thin column (Signe)
STRING = "string"  # a string of small lights, adjustable length

LINEAR_KINDS = frozenset({STRIP, BAR, TUBE, COLUMN, STRING})
ADJUSTABLE_KINDS = frozenset({STRIP, STRING, TUBE})


@dataclass(frozen=True)
class LightProfile:
    kind: str
    length: float
    width: float
    icon: str
    gradient: bool = False
    adjustable: bool = False
    label: str = ""

    @property
    def linear(self) -> bool:
        return self.kind in LINEAR_KINDS

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "linear": self.linear}


def _p(kind: str, length: float, width: float, icon: str, label: str, gradient: bool = False) -> LightProfile:
    return LightProfile(kind, length, width, icon, gradient, kind in ADJUSTABLE_KINDS, label)


DEFAULT_PROFILE = _p(ROUND, 15, 15, "bulb-classic", "Light")

BY_ARCHETYPE: dict[str, LightProfile] = {
    "huelightstrip": _p(STRIP, 200, 1.6, "lightstrip", "Lightstrip"),
    "huelightstriptv": _p(STRIP, 122, 1.6, "lightstrip-tv", "TV lightstrip", gradient=True),
    "huetube": _p(TUBE, 75, 4.5, "gradient-tube-short", "Play tube", gradient=True),
    "hueplay": _p(BAR, 25.3, 3.8, "play-bar", "Play bar"),
    "hueplaywallwasher": _p(BAR, 15.5, 9, "play-bar-v", "Play wall washer", gradient=True),
    "huesigne": _p(COLUMN, 145, 3, "signe", "Signe"),
    "hueiris": _p(ROUND, 14, 14, "iris", "Iris"),
    "huebloom": _p(ROUND, 10, 10, "bloom", "Bloom"),
    "huego": _p(ROUND, 15, 15, "go", "Go"),
    "stringlight": _p(STRING, 500, 2, "festavia", "String lights", gradient=True),
    "wallwasher": _p(BAR, 47, 6, "amarant", "Wall washer"),
    "groundspot": _p(ROUND, 12, 12, "lily-xl", "Ground spot"),
    "pendantround": _p(ROUND, 35, 35, "pendant-round", "Pendant"),
    "pendantlong": _p(BAR, 90, 10, "pendant-long", "Long pendant"),
    "ceilinground": _p(ROUND, 38, 38, "ceiling-round", "Ceiling light"),
    "ceilingsquare": _p(ROUND, 38, 38, "ceiling-square", "Ceiling light"),
    "floorshade": _p(ROUND, 40, 40, "floor-shade", "Floor lamp"),
    "floorlantern": _p(ROUND, 30, 30, "floor-lantern", "Floor lantern"),
    "tableshade": _p(ROUND, 30, 30, "table-shade", "Table lamp"),
    "tablewash": _p(ROUND, 20, 20, "table-wash", "Table lamp"),
    "flexiblelamp": _p(ROUND, 20, 20, "desk-lamp", "Flexible lamp"),
    "recessedceiling": _p(ROUND, 12, 12, "recessed-ceiling", "Recessed light"),
    "recessedfloor": _p(ROUND, 12, 12, "recessed-floor", "Floor spot"),
    "singlespot": _p(ROUND, 10, 10, "single-spot", "Spot"),
    "doublespot": _p(BAR, 25, 10, "double-spot", "Double spot"),
    "sultanbulb": _p(ROUND, 15, 15, "bulb-sultan", "Bulb"),
    "classicbulb": _p(ROUND, 15, 15, "bulb-classic", "Bulb"),
    "candlebulb": _p(ROUND, 10, 10, "bulb-candle", "Candle bulb"),
    "spotbulb": _p(ROUND, 8, 8, "bulb-spot", "Spot bulb"),
    "floodbulb": _p(ROUND, 12, 12, "bulb-flood", "Flood bulb"),
    "vintagebulb": _p(ROUND, 15, 15, "bulb-filament", "Filament bulb"),
}

# Product names that pin down a size the archetype alone cannot.
BY_PRODUCT: dict[str, LightProfile] = {
    "hue gradient lightstrip": _p(STRIP, 200, 1.6, "gradient-lightstrip", "Gradient lightstrip", gradient=True),
    "signe gradient floor": _p(COLUMN, 145, 3, "signe-gradient-floor", "Signe floor", gradient=True),
    "signe gradient table": _p(COLUMN, 55, 3, "signe-gradient-table", "Signe table", gradient=True),
    "hue signe table": _p(COLUMN, 55, 3, "signe", "Signe table"),
    "hue signe floor": _p(COLUMN, 145, 3, "signe", "Signe floor"),
    "festavia string lights": _p(STRING, 500, 2, "festavia", "Festavia", gradient=True),
    "hue amarant wall washer": _p(BAR, 47, 6, "amarant", "Amarant"),
    "hue lily xl outdoor spot": _p(ROUND, 12, 12, "lily-xl", "Lily XL"),
    "go table lamp": _p(ROUND, 18, 18, "go-portable-table", "Go table lamp"),
}

# Model IDs that differ only in size, such as Play gradient lightstrips for 55", 65", and 75" TVs.
BY_MODEL: dict[str, LightProfile] = {
    "LCX001": _p(STRIP, 122, 1.6, "lightstrip-tv", "Play gradient 55\"", gradient=True),
    "LCX002": _p(STRIP, 144, 1.6, "lightstrip-tv", "Play gradient 65\"", gradient=True),
    "LCX003": _p(STRIP, 166, 1.6, "lightstrip-tv", "Play gradient 75\"", gradient=True),
    "LCX004": _p(STRIP, 200, 1.6, "gradient-lightstrip", "Gradient lightstrip", gradient=True),
    "LCX005": _p(STRIP, 200, 1.6, "gradient-lightstrip", "Gradient lightstrip", gradient=True),
    "LCX006": _p(STRIP, 200, 1.6, "gradient-lightstrip", "Gradient lightstrip", gradient=True),
    "915005988501": _p(TUBE, 75, 4.5, "gradient-tube-short", "Play gradient tube", gradient=True),
    "915005988601": _p(TUBE, 145, 4.5, "gradient-tube-long", "Play gradient tube large", gradient=True),
}


def light_profile(archetype: str | None = None, productname: str | None = None, modelid: str | None = None) -> LightProfile:
    """The physical profile of a light, from the most specific clue available."""
    if modelid and str(modelid) in BY_MODEL:
        return BY_MODEL[str(modelid)]
    if productname and str(productname).strip().lower() in BY_PRODUCT:
        return BY_PRODUCT[str(productname).strip().lower()]
    if archetype and str(archetype).lower() in BY_ARCHETYPE:
        return BY_ARCHETYPE[str(archetype).lower()]
    return DEFAULT_PROFILE


def profile_for(raw_light: dict[str, Any], gradient_points: int | None = None) -> LightProfile:
    """Profile for a light as the v1 API reports it. `gradient_points` comes from the v2 API when known."""
    profile = light_profile(
        (raw_light.get("config") or {}).get("archetype"),
        raw_light.get("productname"),
        raw_light.get("modelid"),
    )
    if gradient_points is not None:
        profile = replace(profile, gradient=gradient_points >= 2)
    return profile
