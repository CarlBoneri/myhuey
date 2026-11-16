"""Tools an AI assistant uses to read the home, design a scene, and build a room layout.

Plain functions over HueRoomService. Lengths in and out are centimetres in plan coordinates
(x right, y down from the room's origin), heights off the floor. Nothing here returns the
bridge username or the raw document.
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from .catalog import CATALOG
from .errors import BridgeNotConfigured, HueError, RoomNotFound, SceneNotFound
from .layouts import using_layout
from .models import DEFAULT_FURNITURE_HEIGHT, FURNITURE_HEIGHTS, FURNITURE_SIZES, new_id
from .room_text import draw_room, layout_problems
from .room_view import room_json
from .scenes import Scene
from .service import HueRoomService
from .units import parse_length


class Refused(ValueError):
    """This tool will not do that."""


@contextmanager
def in_layout(service: HueRoomService, layout: str | None) -> Iterator[None]:
    """Open the named layout (its name or ID) for the block. None is the active layout."""
    layout_id = service.sandbox_id(service.resolve_layout(layout)) if layout else None
    with using_layout(layout_id):
        yield


def cm(value: float | int | str, what: str) -> float:
    """A length in centimetres. A number is centimetres, as is a string of only digits; a string
    may carry a unit ("12ft", "3.8m", "380cm")."""
    problem = ValueError(f'{what}: cannot read "{value}". Use a number of centimetres, or a length such as 12ft, 3.8m, or 380cm.')
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise problem
    try:
        if isinstance(value, str):
            text = value.strip()
            number = float(text) if text.replace(".", "", 1).isdigit() else parse_length(text)
        else:
            number = float(value)
    except ValueError:
        raise problem from None
    if not math.isfinite(number) or number <= 0:
        raise problem
    return number


def _room_name(service: HueRoomService, room: str) -> str:
    """The saved name of a room, matched ignoring case."""
    names = service.list_rooms()
    for name in names:
        if name.casefold() == str(room).strip().casefold():
            return name
    error = RoomNotFound(room)
    error.args = (f"Room '{room}' not found. Rooms that exist: {', '.join(names) or 'none'}.",)
    raise error


def list_rooms(service: HueRoomService, layout: str | None = None) -> list[dict[str, Any]]:
    with in_layout(service, layout):
        return [
            {
                "name": room.name,
                "width": room.width,
                "depth": room.height,
                "ceiling": room.ceiling,
                "units": room.units,
                "lights": len(room.lights),
                "has_desk": any(item.kind.startswith("desk") for item in room.furniture),
                "has_screen": any(item.kind.startswith("monitor") or item.kind == "tv" for item in room.furniture),
            }
            for room in service.rooms()
        ]


def get_room(service: HueRoomService, room: str, layout: str | None = None) -> dict[str, Any]:
    with in_layout(service, layout):
        data = room_json(service.get_room(_room_name(service, room)))
    data.pop("photo", None)
    return data


def describe_room(service: HueRoomService, room: str, layout: str | None = None) -> dict[str, Any]:
    """A room as a scaled text drawing with a legend and its doors and windows in words."""
    with in_layout(service, layout):
        return draw_room(service.get_room(_room_name(service, room)))


def check_layout(service: HueRoomService, room: str, layout: str | None = None) -> dict[str, Any]:
    """What is wrong with a room's layout. `ok` is true when nothing is."""
    with in_layout(service, layout):
        problems = layout_problems(service.get_room(_room_name(service, room)))
    return {"ok": not problems, "problems": problems}


def list_lights(service: HueRoomService) -> dict[str, Any]:
    """Every light on the bridge, or why the bridge cannot say."""
    try:
        found = service.lights()
    except BridgeNotConfigured as error:
        return {"bridge": "not paired", "detail": str(error), "lights": []}
    except HueError as error:
        return {"bridge": "not answering", "detail": str(error), "lights": []}
    homes: dict[str, list[str]] = {}
    for room in service.rooms():
        for light in room.lights:
            homes.setdefault(light.light_id, []).append(room.name)
    return {
        "bridge": "ok",
        "detail": "",
        "lights": [
            {
                "id": light["id"],
                "name": light["name"],
                "on": light["on"],
                "brightness": None if light["brightness"] is None else round(light["brightness"] / 254 * 100),
                "color": light["color"],
                "kelvin": light["color_temp"],
                "reachable": light["reachable"],
                "product": light["productname"],
                "rooms": homes.get(light["id"], []),
            }
            for light in found
        ],
    }


def list_scenes(service: HueRoomService, room: str | None = None, layout: str | None = None) -> list[dict[str, Any]]:
    with in_layout(service, layout):
        name = _room_name(service, room) if room else None
        return [
            {"id": scene.id, "name": scene.name, "room": scene.room, "lights": len(scene.overrides)}
            for scene in service.scenes(name)
        ]


def list_layouts(service: HueRoomService) -> list[dict[str, Any]]:
    return [{key: entry[key] for key in ("id", "name", "active", "rooms", "scenes")} for entry in service.layouts()]


def catalog() -> dict[str, Any]:
    """What can be placed: furniture with its size and height, and the lights that can be planned."""
    furniture = []
    for kind, (label, width, depth, shape) in FURNITURE_SIZES.items():
        elevation, height = FURNITURE_HEIGHTS.get(kind, DEFAULT_FURNITURE_HEIGHT)
        furniture.append({"kind": kind, "label": label, "width": width, "depth": depth, "shape": shape, "elevation": elevation, "height": height})
    return {"furniture": furniture, "lights": [item.to_dict() for item in CATALOG.values()]}


def suggest(service: HueRoomService, room: str, mode: str, at: str | None = None, layout: str | None = None) -> list[dict[str, Any]]:
    """Suggested scenes for a room, as previews: nothing is saved and no light changes."""
    with in_layout(service, layout):
        items = service.suggest(_room_name(service, room), mode, at=at)
    return [
        {"name": item["scene"]["name"], "kelvin": item["kelvin"], "roles": item["roles"], "lights": item["scene"]["overrides"]}
        for item in items
    ]


# Scenes. preview_scene and save_scene send nothing to the bridge; the three tools named in
# CHANGES_LIGHTS are the only ones that change real lights, so a server can gate them.

CHANGES_LIGHTS = ("apply_scene", "room_power", "room_dim")

_SETTINGS = ("colors", "white", "brightness", "on", "mode", "effect")


def _scene(
    service: HueRoomService, room: str, name: str, lights: dict[str, dict[str, Any]], others: str, scene_id: str | None = None,
) -> Scene:
    """A scene from per-light settings, or a ValueError that names the light and the value."""
    room_name = _room_name(service, room)
    if others not in ("keep", "off"):
        raise ValueError(f'others must be "keep" or "off", not {others!r}.')
    if not isinstance(lights, dict):
        raise ValueError("lights must map each light ID to its settings.")
    if not lights and others == "keep":
        raise ValueError("This scene has no lights. Give at least one light a colour or a white.")
    in_room = [light.light_id for light in service.get_room(room_name).lights]
    overrides: dict[str, dict[str, Any]] = {}
    for light_id, settings in lights.items():
        light_id = str(light_id)
        if light_id not in in_room:
            raise ValueError(f'light "{light_id}" is not in {room_name}. Lights in {room_name}: {", ".join(in_room) or "none"}.')
        problem = None
        if not isinstance(settings, dict):
            problem = "give its settings as an object, such as {\"white\": 2700, \"brightness\": 30}"
        elif unknown := sorted(set(settings) - set(_SETTINGS)):
            problem = f"{', '.join(unknown)} is not a setting (use {', '.join(_SETTINGS)})"
        elif (level := settings.get("brightness")) is not None and (
            isinstance(level, bool) or not isinstance(level, (int, float)) or not 0 <= level <= 100
        ):
            problem = f"brightness {level!r} must be a number from 0 to 100"
        if problem is None:
            try:
                overrides[light_id] = Scene.from_dict({"name": name, "room": room_name, "overrides": {light_id: settings}}).overrides[light_id]
            except ValueError as error:
                problem = f"{error} (you gave {settings!r})"
        if problem:
            raise ValueError(f'light "{light_id}": {problem}')
    return Scene.from_dict(
        {"id": scene_id or new_id(), "name": name, "room": room_name, "base_mode": others, "overrides": overrides}
    )


def preview_scene(
    service: HueRoomService, room: str, name: str, lights: dict[str, dict[str, Any]], others: str = "keep", layout: str | None = None,
) -> dict[str, Any]:
    """What each light in the room would show. Nothing is saved and nothing is sent."""
    with in_layout(service, layout):
        scene = _scene(service, room, name, lights, others)
        planned = {light.light_id for light in service.get_room(scene.room).lights if light.planned}
        shown = service.preview_scene(scene)
    return {
        "scene": {"name": scene.name, "room": scene.room},
        "lights": [
            {
                "id": item["light_id"],
                "name": item["label"],
                "on": item["on"],
                "color": item["color"],
                "kelvin": item["color_temp"],
                "brightness": item["brightness"],
                "gradient": item["gradient"],
                "planned": item["light_id"] in planned,
                "changed": not item["keep"],
            }
            for item in shown
        ],
        "saved": False,
        "sent": False,
    }


def save_scene(
    service: HueRoomService, room: str, name: str, lights: dict[str, dict[str, Any]], others: str = "keep",
    scene_id: str | None = None, layout: str | None = None,
) -> dict[str, Any]:
    """Save a scene, or replace the saved scene with `scene_id`. Nothing is sent to any light."""
    with in_layout(service, layout):
        if scene_id is not None and all(item.id != scene_id for item in service.scenes()):
            raise SceneNotFound(scene_id)
        saved = service.save_scene(_scene(service, room, name, lights, others, scene_id).to_dict())
    return {"id": saved.id, "name": saved.name, "room": saved.room, "saved": True, "sent": False}


def apply_scene(
    service: HueRoomService, scene: str | None = None, room: str | None = None, name: str | None = None,
    lights: dict[str, dict[str, Any]] | None = None, others: str = "keep", layout: str | None = None,
) -> dict[str, Any]:
    """Send a scene to the real lights: a saved one (`scene`, by ID or name), or one not saved
    (`room`, `name`, `lights`). Planned lights are not installed, so they are reported, not sent."""
    if scene is not None and (room is not None or name is not None or lights is not None) or (
        scene is None and (room is None or lights is None)
    ):
        raise ValueError("Give either scene (a saved scene's ID or name), or room, name, and lights for one that is not saved. Not both.")
    with in_layout(service, layout):
        target = service.get_scene(scene) if scene is not None else _scene(service, room, name or "Assistant scene", lights, others)
        results = service.apply_scene_object(target)
    shown = []
    for item in results:
        light = {"id": item["light_id"], "name": item["label"], "applied": item["applied"], "planned": bool(item.get("planned"))}
        if item.get("error"):
            light["error"] = item["error"]
        shown.append(light)
    return {"scene": target.name, "room": target.room, "sent": True, "lights": shown, "failed": sum("error" in light for light in shown)}


def _sent(room: str, results: list[dict[str, Any]]) -> dict[str, Any]:
    shown = []
    for item in results:
        light = {"id": item["light_id"], "name": item["label"], "ok": item["ok"]}
        if item.get("error"):
            light["error"] = item["error"]
        shown.append(light)
    return {"room": room, "lights": shown, "failed": sum(not light["ok"] for light in shown)}


def room_power(service: HueRoomService, room: str, on: bool, layout: str | None = None) -> dict[str, Any]:
    """Turn every installed light in a room on or off."""
    if not isinstance(on, bool):
        raise ValueError("on must be true or false.")
    with in_layout(service, layout):
        name = _room_name(service, room)
        return _sent(name, service.set_room_power(name, on))


def room_dim(service: HueRoomService, room: str, percent: float, layout: str | None = None) -> dict[str, Any]:
    """Set the brightness of the lights that are on in a room, 1 to 100 percent."""
    if isinstance(percent, bool) or not isinstance(percent, (int, float)):
        raise ValueError("Room brightness must be a number from 1 to 100 percent.")
    with in_layout(service, layout):
        name = _room_name(service, room)
        return _sent(name, service.set_room_brightness(name, percent))
