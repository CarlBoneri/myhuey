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
from urllib.parse import quote

import requests

from .catalog import CATALOG, catalog_item
from .errors import BridgeNotConfigured, HueError, LayoutNotFound, RoomNotFound, SceneNotFound
from .layouts import using_layout
from .models import DEFAULT_FURNITURE_HEIGHT, FURNITURE_HEIGHTS, FURNITURE_SIZES, new_id
from .room_text import draw_room, layout_problems
from .room_view import room_json
from .scenes import Scene
from .service import HueRoomService
from .units import UNIT_SYSTEMS, parse_length


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


# Layout tools. Every one that writes goes through sandbox(), which refuses the active layout, so an
# assistant can only build in a sandbox. Nothing here sends anything to the bridge.

WRITES_LAYOUT = ("add_room", "update_room", "remove_room", "set_openings", "set_furniture", "place_light", "remove_light")

_NEEDS_SANDBOX = "Layouts are built in a sandbox, never in the active home. Call create_sandbox first, then pass its id as layout."


class _Sandbox(str):
    """A sandbox's ID, which can check it is still not the active layout."""

    def __new__(cls, service: HueRoomService, layout_id: str) -> _Sandbox:
        box = super().__new__(cls, layout_id)
        box.service = service
        return box

    def still_a_sandbox(self) -> None:
        """Called right before each write: a sandbox made active since the guard is refused."""
        if self.service.sandbox_id(str(self)) is None:
            raise Refused(_NEEDS_SANDBOX)


@contextmanager
def sandbox(service: HueRoomService, layout: str | None) -> Iterator[_Sandbox]:
    """Like in_layout, but only for a sandbox: a missing, unknown, or active layout is refused."""
    if not layout or not str(layout).strip():
        raise Refused(_NEEDS_SANDBOX)
    try:
        layout_id = service.sandbox_id(service.resolve_layout(str(layout)))
    except LayoutNotFound:
        raise Refused(f'There is no layout "{layout}". {_NEEDS_SANDBOX}') from None
    if layout_id is None:
        raise Refused(_NEEDS_SANDBOX)
    box = _Sandbox(service, layout_id)
    with using_layout(layout_id):
        yield box


def _plan_cm(value: float | int | str, what: str) -> float:
    """A position or offset in cm: like cm(), but 0 is allowed."""
    try:
        if not isinstance(value, bool) and float(value) == 0:
            return 0.0
    except (TypeError, ValueError):
        pass
    return cm(value, what)


def _room_dict(service: HueRoomService, room: str) -> dict[str, Any]:
    data = room_json(service.get_room(_room_name(service, room)))
    data.pop("photo", None)
    return data


def create_sandbox(service: HueRoomService, name: str | None = None, copy_from: str | None = None) -> dict[str, Any]:
    """A new sandbox: empty, or a copy of "active" or of another layout (its name or id)."""
    source = None
    if copy_from is not None:
        if str(copy_from).strip().casefold() == "active":
            source = next(entry["id"] for entry in service.layouts() if entry["active"])
        else:
            try:
                source = service.resolve_layout(str(copy_from))
            except LayoutNotFound:
                known = ", ".join(entry["name"] for entry in service.layouts())
                raise ValueError(f'There is no layout "{copy_from}" to copy. Layouts: {known}. Use "active" for the real home.') from None
    entry = service.new_layout(name, from_layout=source)
    with using_layout(entry["id"]):
        rooms = service.list_rooms()
    return {"id": entry["id"], "name": entry["name"], "rooms": rooms}


def add_room(
    service: HueRoomService, layout: str | None, name: str, width: float | int | str | None = None,
    depth: float | int | str | None = None, outline: list[list[float]] | None = None,
    ceiling: float | int | str | None = None, units: str | None = None,
) -> dict[str, Any]:
    """Add a room to a sandbox: a width by depth rectangle, or an outline of [x, y] corners in cm."""
    with sandbox(service, layout) as box:
        sizes: dict[str, Any] = {}
        if width is not None:
            sizes["width"] = cm(width, "width")
        if depth is not None:
            sizes["height"] = cm(depth, "depth")
        height = cm(ceiling, "ceiling") if ceiling is not None else None
        if units is not None and units not in UNIT_SYSTEMS:
            raise ValueError(f"units must be one of {', '.join(UNIT_SYSTEMS)}.")
        box.still_a_sandbox()
        created = service.add_room(name, outline=outline, **sizes)
        if height is not None or units is not None:
            service.update_room(created.name, ceiling=height, units=units)
        return _room_dict(service, created.name)


def update_room(
    service: HueRoomService, layout: str | None, room: str, width: float | int | str | None = None,
    depth: float | int | str | None = None, outline: list[list[float]] | None = None,
    ceiling: float | int | str | None = None,
) -> dict[str, Any]:
    """Resize a room (the outline stretches to width by depth), replace its outline, or set its ceiling."""
    with sandbox(service, layout) as box:
        name = _room_name(service, room)
        changes: dict[str, Any] = {}
        if width is not None:
            changes["width"] = cm(width, "width")
        if depth is not None:
            changes["height"] = cm(depth, "depth")
        if ceiling is not None:
            changes["ceiling"] = cm(ceiling, "ceiling")
        box.still_a_sandbox()
        service.update_room(name, outline=outline, **changes)
        return _room_dict(service, name)


def remove_room(service: HueRoomService, layout: str | None, room: str) -> dict[str, Any]:
    with sandbox(service, layout) as box:
        name = _room_name(service, room)
        box.still_a_sandbox()
        service.remove_room(name)
        return {"removed": name}


def set_openings(service: HueRoomService, layout: str | None, room: str, openings: list[dict]) -> dict[str, Any]:
    """Replace a room's doors and windows. `wall` counts the outline's edges from 0."""
    with sandbox(service, layout) as box:
        name = _room_name(service, room)
        if not isinstance(openings, list):
            raise ValueError("openings must be a list of {kind, wall, offset, width} objects.")
        built = []
        for item in openings:
            if not isinstance(item, dict):
                raise ValueError('Each opening is an object such as {"kind": "window", "wall": 0, "offset": 100, "width": 90}.')
            data: dict[str, Any] = {"kind": item.get("kind"), "edge": item.get("wall"), "offset": _plan_cm(item.get("offset", 0), "offset"),
                                    "width": cm(item.get("width"), "width")}
            for key in ("sill", "top"):
                if item.get(key) is not None:
                    data[key] = _plan_cm(item[key], key)
            built.append(data)
        box.still_a_sandbox()
        service.update_room(name, openings=built)
        return _room_dict(service, name)


def set_furniture(service: HueRoomService, layout: str | None, room: str, furniture: list[dict]) -> dict[str, Any]:
    """Replace a room's furniture. Missing width, depth, shape, and label come from the catalog's size for the kind."""
    with sandbox(service, layout) as box:
        name = _room_name(service, room)
        if not isinstance(furniture, list):
            raise ValueError("furniture must be a list of {kind, x, y} objects.")
        built = []
        for item in furniture:
            kind = item.get("kind") if isinstance(item, dict) else None
            if kind not in FURNITURE_SIZES:
                raise ValueError(f"Unknown furniture kind '{kind}'. See catalog.")
            label, width, depth, shape = FURNITURE_SIZES[kind]
            data: dict[str, Any] = {"kind": kind, "label": item.get("label") or label, "shape": shape, "width": width, "depth": depth,
                                    "x": _plan_cm(item.get("x"), "x"), "y": _plan_cm(item.get("y"), "y")}
            for key in ("width", "depth"):
                if item.get(key) is not None:
                    data[key] = cm(item[key], key)
            for key in ("elevation", "height"):
                if item.get(key) is not None:
                    data[key] = _plan_cm(item[key], key)
            if item.get("rotation") is not None:
                data["rotation"] = item["rotation"]
            built.append(data)
        box.still_a_sandbox()
        service.update_room(name, furniture=built)
        return _room_dict(service, name)


def place_light(
    service: HueRoomService, layout: str | None, room: str, x: float | int | str, y: float | int | str,
    light_id: str | None = None, catalog: str | None = None, rotation: float | None = None,
    height: float | int | str | None = None, length: float | int | str | None = None,
    role: str | None = None, label: str | None = None,
) -> dict[str, Any]:
    """Place a paired light (by `light_id`; one already placed moves) or a planned `catalog` light."""
    with sandbox(service, layout) as box:
        name = _room_name(service, room)
        if (light_id is None) == (catalog is None):
            raise ValueError("Give exactly one of light_id or catalog.")
        spot = {"x": _plan_cm(x, "x"), "y": _plan_cm(y, "y")}
        elevation = _plan_cm(height, "height") if height is not None else None
        size = cm(length, "length") if length is not None else None
        if catalog is not None:
            catalog_item(catalog)
        box.still_a_sandbox()
        if catalog is not None:
            placed = service.add_planned_light(name, catalog, label=label, rotation=rotation, elevation=elevation, role=role, **spot)
            if size is not None:
                placed = service.assign_light(name, placed.light_id, length=size, **spot)
        else:
            placed = service.assign_light(name, str(light_id), label=label, rotation=rotation, length=size, elevation=elevation, role=role, **spot)
        return placed.to_dict()


def remove_light(service: HueRoomService, layout: str | None, room: str, light_id: str) -> dict[str, Any]:
    with sandbox(service, layout) as box:
        name = _room_name(service, room)
        placed = [light.light_id for light in service.get_room(name).lights]
        if str(light_id) not in placed:
            raise ValueError(f'Light "{light_id}" is not in {name}. Lights in {name}: {", ".join(placed) or "none"}.')
        box.still_a_sandbox()
        service.remove_light(name, str(light_id))
        return {"removed": str(light_id)}


def _app_answers(app_url: str) -> bool:
    """Whether the MyHuey app answers at this address. Never raises."""
    try:
        return requests.get(f"{app_url}/api/health", timeout=2).ok
    except Exception:
        return False


def open_in_app(service: HueRoomService, layout: str | None, room: str, app_url: str = "http://127.0.0.1:8000") -> dict[str, Any]:
    """A link that opens a sandbox's room in the 3D view, and whether the app is running to answer it."""
    with sandbox(service, layout) as box:
        name = _room_name(service, room)
    base = str(app_url).rstrip("/")
    answering = _app_answers(base)
    note = (
        "Open the link to see the room in 3D." if answering
        else f"The app is not answering at {base}. Start it with `myhuey serve`, or give the address it runs at with --app-url."
    )
    return {"url": f"{base}/?layout={box}#/studio/room/{quote(name, safe='')}/3d", "answering": answering, "note": note}
