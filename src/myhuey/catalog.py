"""Hue products you can plan with before you own them.

Each entry names the archetype and product name a real one reports, so the plan draws it at
its real size and the suggester treats it like the real thing. `color` is what it can show:
"gradient" (several colors along it), "color", or "white" (white ambiance only). `kind` is
what it is good for at a desk: a bias light, a task light, a side lamp, or ambient light.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class CatalogItem:
    id: str
    label: str
    archetype: str
    productname: str
    color: str
    kind: str

    def product(self) -> dict[str, str]:
        return {"archetype": self.archetype, "productname": self.productname, "catalog": self.id}

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_ITEMS = [
    CatalogItem("gradient-strip", "Gradient lightstrip", "huelightstrip", "Hue gradient lightstrip", "gradient", "bias"),
    CatalogItem("play-gradient-tv", "Play gradient strip (TV)", "huelightstriptv", "Hue play gradient lightstrip", "gradient", "bias"),
    CatalogItem("play-bar", "Play light bar", "hueplay", "Hue play", "color", "bias"),
    CatalogItem("floor-lamp", "Signe gradient floor lamp", "huesigne", "Signe gradient floor", "gradient", "side"),
    CatalogItem("floor-shade", "Floor lamp with a shade (color bulb)", "floorshade", "Hue color lamp", "color", "side"),
    CatalogItem("table-lamp", "Table lamp (color bulb)", "tableshade", "Hue color lamp", "color", "side"),
    CatalogItem("desk-lamp", "Desk lamp (white ambiance)", "flexiblelamp", "Hue white ambiance lamp", "white", "task"),
    CatalogItem("go", "Go portable lamp", "huego", "Hue go", "color", "side"),
    CatalogItem("ceiling", "Ceiling light (white ambiance)", "ceilinground", "Hue white ambiance ceiling", "white", "ambient"),
    CatalogItem("wall-washer", "Play wall washer", "hueplaywallwasher", "Hue play wall washer", "gradient", "ambient"),
    CatalogItem("spot", "Floor spot", "groundspot", "Hue color spot", "color", "ambient"),
]
CATALOG: dict[str, CatalogItem] = {item.id: item for item in _ITEMS}


def catalog_item(item_id: str) -> CatalogItem:
    if item_id not in CATALOG:
        raise ValueError(f"Unknown catalog item '{item_id}'. Known: {', '.join(CATALOG)}")
    return CATALOG[item_id]


def color_of(product: dict[str, Any] | None) -> str | None:
    """The catalog color ability of a planned light's product, or None for real lights."""
    item = CATALOG.get(str((product or {}).get("catalog") or ""))
    return item.color if item else None
