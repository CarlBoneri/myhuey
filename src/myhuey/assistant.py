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
from .errors import BridgeNotConfigured, HueError, RoomNotFound
from .layouts import using_layout
from .models import DEFAULT_FURNITURE_HEIGHT, FURNITURE_HEIGHTS, FURNITURE_SIZES
from .room_text import draw_room, layout_problems
from .room_view import room_json
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
