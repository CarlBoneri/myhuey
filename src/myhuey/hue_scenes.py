"""The Hue app's scene gallery (2023): its looks as palettes, and recreated in any room.

The data is `data/hue_scenes.json`, converted by `scripts/import_hue_scenes.py` from a
clean-room record of the gallery (see the credit in that file). A Defaults scene (Rest, Relax,
Read, Concentrate, Energize...) is one white: every light gets that white at the scene's
brightness. A color scene has five colors: they go around the room light by light, and a
gradient light gets all five along its length.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from importlib import resources
from typing import Any

from .color import xy_to_kelvin
from .models import Room, new_id
from .scenes import Scene, placed_profile


@lru_cache(maxsize=1)
def _data() -> dict[str, Any]:
    return json.loads(resources.files("myhuey.data").joinpath("hue_scenes.json").read_text(encoding="utf-8"))


def gallery() -> list[dict[str, Any]]:
    """The sets in gallery order, each {name, scenes: [{name, bri, xy, colors}]}."""
    return _data()["sets"]


def credit() -> dict[str, str]:
    return dict(_data()["credit"])


def find(set_name: str, name: str) -> dict[str, Any]:
    for group in gallery():
        if group["name"].lower() == set_name.lower():
            for scene in group["scenes"]:
                if scene["name"].lower() == name.lower():
                    return scene
            raise ValueError(f"No scene '{name}' in the Hue set '{group['name']}'")
    raise ValueError(f"No Hue scene set '{set_name}'. Sets: {', '.join(g['name'] for g in gallery())}")


def _percent(bri: int) -> float:
    return round(min(100.0, max(1.0, bri / 254 * 100)), 1)


def hue_scene(room: Room, set_name: str, name: str) -> Scene:
    """An unsaved scene for the room that looks like the Hue gallery scene."""
    source = find(set_name, name)
    brightness = _percent(source["bri"])
    overrides: dict[str, dict[str, Any]] = {}
    if len(source["colors"]) == 1:  # a Defaults white
        kelvin = xy_to_kelvin(source["xy"][0])
        overrides = {light.light_id: {"white": kelvin, "brightness": brightness} for light in room.lights}
    else:
        colors = source["colors"]
        cx = sum(p[0] for p in room.outline) / max(1, len(room.outline))
        cy = sum(p[1] for p in room.outline) / max(1, len(room.outline))
        around = sorted(room.lights, key=lambda light: (math.atan2(light.y - cy, light.x - cx), light.light_id))
        single = 0
        for light in around:
            if placed_profile(light).gradient:
                overrides[light.light_id] = {"colors": list(colors), "mode": "interpolated_palette", "brightness": brightness}
            else:
                overrides[light.light_id] = {"colors": [colors[single % len(colors)]], "brightness": brightness}
                single += 1
    return Scene(id=new_id(), name=f"{source['name']} (Hue)", room=room.name, overrides=overrides)


def as_palettes() -> list[dict[str, Any]]:
    """The color scenes as palette-library entries (the Defaults whites are left out)."""
    base = credit()
    entries = []
    for group in gallery():
        for scene in group["scenes"]:
            if len(scene["colors"]) < 3:
                continue
            slug = "".join(ch if ch.isalnum() else "-" for ch in scene["name"].lower()).strip("-")
            entries.append({"id": f"hue-{slug}", "name": scene["name"], "colors": scene["colors"], "source": "hue",
                            "credit": {"set": group["name"], **base}})
    return entries
