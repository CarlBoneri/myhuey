"""Upgrades for the saved document. Each step is a pure function from one version to the next.

Version 1 (no `schema_version`) measured rooms in abstract units, 900 x 600 by default, with
lights as center points. Version 2 measures everything in centimeters, gives rooms an outline
polygon, and adds furniture, rotation, room photos, and scenes.
"""

from __future__ import annotations

import copy
from typing import Any

CURRENT_VERSION = 2

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


_STEPS = {1: _v1_to_v2}


def migrate(config: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Bring a document to CURRENT_VERSION. Returns (document, the version it started at)."""
    start = version = schema_version(config)
    while version < CURRENT_VERSION:
        config = _STEPS[version](config)
        version = schema_version(config)
    return config, start
