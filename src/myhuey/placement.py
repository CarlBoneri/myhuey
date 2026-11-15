"""How high a placed light sits, worked out from its product when the user has not said.

The automatic height is computed each time it is read, never stored, so a lamp moved onto a
desk picks up the desk's height and a better default later reaches everyone.
"""

from __future__ import annotations

import math

from .models import Furniture, LayoutLight, Room

UNKNOWN_CM = 150.0
FLOOR_LAMP_CM = 150.0
TABLE_LAMP_ABOVE_CM = 40.0
TABLE_LAMP_ALONE_CM = 115.0
PENDANT_DROP_CM = 60.0

_CEILING = {"ceilinground", "ceilingsquare", "recessedceiling", "singlespot", "doublespot"}
_PENDANT = {"pendantround", "pendantlong"}
_FLOOR = {"floorshade", "floorlantern", "huesigne"}
_TABLE = {"tableshade", "tablewash", "flexiblelamp", "huego", "hueiris", "huebloom"}
_STRIP = {"huelightstrip", "huelightstriptv", "hueplay", "huetube", "hueplaywallwasher"}


def covers(item: Furniture, x: float, y: float) -> bool:
    """Whether the point (cm) sits on the furniture's footprint, honoring rotation and shape."""
    angle = math.radians(-item.rotation)
    dx, dy = x - item.x, y - item.y
    local_x = dx * math.cos(angle) - dy * math.sin(angle)
    local_y = dx * math.sin(angle) + dy * math.cos(angle)
    half_w, half_d = item.width / 2, item.depth / 2
    if item.shape == "ellipse":
        return (local_x / half_w) ** 2 + (local_y / half_d) ** 2 <= 1
    return abs(local_x) <= half_w and abs(local_y) <= half_d


def furniture_top_under(light: LayoutLight, room: Room) -> float | None:
    """The top (cm from the floor) of the highest piece under the light, if any."""
    tops = [item.elevation + item.height for item in room.furniture if item.kind != "rug" and covers(item, light.x, light.y)]
    return max(tops) if tops else None


def resolved_elevation(light: LayoutLight, room: Room) -> float:
    """The light's height in cm: what the user set, or a guess from the product."""
    if light.elevation is not None:
        return float(light.elevation)
    archetype = str((light.product or {}).get("archetype") or "").lower()
    if archetype in _CEILING:
        return float(room.ceiling)
    if archetype in _PENDANT:
        return float(room.ceiling) - PENDANT_DROP_CM
    if archetype in _FLOOR:
        return FLOOR_LAMP_CM
    if archetype in _TABLE:
        top = furniture_top_under(light, room)
        return top + TABLE_LAMP_ABOVE_CM if top is not None else TABLE_LAMP_ALONE_CM
    if archetype in _STRIP:
        top = furniture_top_under(light, room)
        return top if top is not None else 0.0
    return UNKNOWN_CM
