"""Upgrades for the saved document. Each step is a pure function from one version to the next.

Version 1 (no `schema_version`) measured rooms in abstract units, 900 x 600 by default, with
lights as center points. Version 2 measures everything in centimeters, gives rooms an outline
polygon, and adds furniture, rotation, room photos, and scenes. Version 3 adds doors and windows
as openings on a room's edges, a ceiling height, furniture heights, and a home plan image.
Version 4 gives placed lights a height (None = automatic from the product) and a role.
Version 5 turns a room photo's light placements into tags that can also pin furniture and
openings, and reserves a photo-to-floor transform.
"""

from __future__ import annotations

import copy
import math
from typing import Any

CURRENT_VERSION = 5

# A default v1 room (900 x 600 units) becomes 4.5 m x 3 m, about 14'9" x 9'10".
V1_CM_PER_UNIT = 0.5


def schema_version(config: dict[str, Any]) -> int:
    return int(config.get("schema_version") or 1)


def _scaled(value: Any, factor: float) -> float:
    try:
        return round(float(value) * factor, 2)
    except (TypeError, ValueError):
        return 0.0


def _v1_to_v2(config: dict[str, Any]) -> dict[str, Any]:
    upgraded = copy.deepcopy(config)
    factor = V1_CM_PER_UNIT
    rooms = []
    for room in upgraded.get("rooms", []):
        width = _scaled(room.get("width", 900), factor)
        height = _scaled(room.get("height", 600), factor)
        lights = []
        for light in room.get("lights", []):
            moved = {key: value for key, value in light.items() if key not in ("width", "height")}
            moved["x"] = _scaled(light.get("x", 0), factor)
            moved["y"] = _scaled(light.get("y", 0), factor)
            moved.setdefault("rotation", 0.0)
            moved.setdefault("length", None)
            moved.setdefault("product", {})
            lights.append(moved)
        rooms.append(
            {
                **{key: value for key, value in room.items() if key not in ("width", "height", "lights")},
                "x": _scaled(room.get("x", 0), factor),
                "y": _scaled(room.get("y", 0), factor),
                "units": "imperial",
                "outline": [[0.0, 0.0], [width, 0.0], [width, height], [0.0, height]],
                "lights": lights,
                "furniture": [],
                "photo": None,
            }
        )
    upgraded["rooms"] = rooms
    upgraded.setdefault("scenes", [])
    upgraded["schema_version"] = 2
    upgraded["migrated_from_v1"] = {"cm_per_unit": factor}
    return upgraded


OPENING_SNAP_CM = 15.0  # a door or window this close to a wall becomes an opening in it
_OPENING_DEFAULTS = {"door": {"sill": None, "top": 203.0}, "window": {"sill": 90.0, "top": 210.0}}


def _as_opening(item: dict[str, Any], outline: list[list[float]]) -> dict[str, Any] | None:
    """The opening a door or window furniture item stands for, if it sits on an edge."""
    from .geometry import distance_to_segment  # local: migrations stay free of model imports

    try:
        center = (float(item["x"]), float(item["y"]))
    except (KeyError, TypeError, ValueError):
        return None  # no usable position: leave it as furniture
    width = _scaled(item.get("width", 80), 1)
    best = None
    for index, a in enumerate(outline):
        b = outline[(index + 1) % len(outline)]
        distance = distance_to_segment(center, (a[0], a[1]), (b[0], b[1]))
        if distance <= OPENING_SNAP_CM and (best is None or distance < best[0]):
            best = (distance, index, a, b)
    if best is None:
        return None
    _, index, a, b = best
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    if length < 1:
        return None
    width = min(width, length)
    along = ((center[0] - a[0]) * (b[0] - a[0]) + (center[1] - a[1]) * (b[1] - a[1])) / length
    offset = min(max(along - width / 2, 0.0), length - width)
    from .models import new_id

    return {"id": str(item.get("id") or new_id()), "kind": item["kind"], "edge": index,
            "offset": round(offset, 2), "width": round(width, 2), **_OPENING_DEFAULTS[item["kind"]]}


def _v2_to_v3(config: dict[str, Any]) -> dict[str, Any]:
    from .models import DEFAULT_FURNITURE_HEIGHT, FURNITURE_HEIGHTS

    upgraded = copy.deepcopy(config)
    for room in upgraded.get("rooms", []):
        outline = room.get("outline") or []
        openings, furniture = list(room.get("openings") or []), []
        for item in room.get("furniture", []):
            opening = _as_opening(item, outline) if item.get("kind") in _OPENING_DEFAULTS and len(outline) >= 3 else None
            if opening:
                openings.append(opening)
                continue
            elevation, height = FURNITURE_HEIGHTS.get(str(item.get("kind")), DEFAULT_FURNITURE_HEIGHT)
            item.setdefault("elevation", elevation)
            item.setdefault("height", height)
            furniture.append(item)
        room["furniture"] = furniture
        room["openings"] = openings
        room.setdefault("ceiling", 244.0)
    upgraded.setdefault("home", {"plan": None})
    upgraded["schema_version"] = 3
    return upgraded


def _v3_to_v4(config: dict[str, Any]) -> dict[str, Any]:
    upgraded = copy.deepcopy(config)
    for room in upgraded.get("rooms", []):
        for light in room.get("lights", []):
            light.setdefault("elevation", None)
            light.setdefault("role", "auto")
    upgraded["schema_version"] = 4
    return upgraded


def _v4_to_v5(config: dict[str, Any]) -> dict[str, Any]:
    upgraded = copy.deepcopy(config)
    for room in upgraded.get("rooms", []):
        photo = room.get("photo")
        if photo:
            placements = photo.pop("placements", None) or {}
            photo.setdefault("tags", {f"light:{light_id}": spot for light_id, spot in placements.items()})
            photo.setdefault("floor_transform", None)
    upgraded["schema_version"] = 5
    return upgraded


_STEPS = {1: _v1_to_v2, 2: _v2_to_v3, 3: _v3_to_v4, 4: _v4_to_v5}


def migrate(config: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Bring a document to CURRENT_VERSION. Returns (document, the version it started at)."""
    start = version = schema_version(config)
    while version < CURRENT_VERSION:
        config = _STEPS[version](config)
        version = schema_version(config)
    return config, start
