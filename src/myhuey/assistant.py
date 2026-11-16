"""Tools an AI assistant uses to read the home, design a scene, and build a room layout.

Plain functions over HueRoomService. Lengths in and out are centimetres in plan coordinates
(x right, y down from the room's origin), heights off the floor. Nothing here returns the
bridge username or the raw document.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import quote

import requests

from .catalog import CATALOG, catalog_item
from .errors import BridgeNotConfigured, HueError, LayoutChanged, LayoutNotFound, RoomNotFound, SceneNotFound
from .layouts import current_layout, using_layout
from .models import DEFAULT_FURNITURE_HEIGHT, FURNITURE_HEIGHTS, FURNITURE_SIZES, new_id
from .room_text import draw_room, layout_problems
from .room_view import room_json
from .scenes import Scene
from .service import PRODUCT_KEYS, HueRoomService
from .skills import TOPICS, skill
from .units import UNIT_SYSTEMS, parse_length


class Refused(ValueError):
    """This tool will not do that."""


@contextmanager
def in_layout(service: HueRoomService, layout: str | None) -> Iterator[None]:
    """Open the named layout (its name or ID) for the block. None or "active" is the active layout."""
    layout_id = None
    if layout and str(layout).strip().casefold() != "active":  # create_sandbox teaches the word "active"
        try:
            layout_id = service.sandbox_id(service.resolve_layout(str(layout)))
        except LayoutNotFound as error:
            known = ", ".join(
                f'{entry["name"]} (id {entry["id"]}{", the active home" if entry["active"] else ""})' for entry in service.layouts()
            )
            error.args = (f'There is no layout "{layout}". Layouts: {known}. Pass a name or an id, or "active" for the active home.',)
            raise
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
    open_id = current_layout.get()
    sandbox_name = next((entry["name"] for entry in service.layouts() if entry["id"] == open_id and not entry["active"]), None)
    where = f"sandbox {sandbox_name}" if sandbox_name else "the active home"
    hint = "" if sandbox_name else " Pass layout to look in a sandbox."
    error = RoomNotFound(room)
    error.args = (f"Room '{room}' not found in {where}. Rooms there: {', '.join(names) or 'none'}.{hint}",)
    raise error


def guide(topic: str | None = None) -> dict[str, Any]:
    """How to use these tools well: call it before designing a scene or a room layout.

    Without a topic, lists the topics. With one ("myhuey-basics", "myhuey-light-theme",
    "myhuey-room-layout"), returns that guide's text."""
    if topic is None:
        return {"topics": [{"topic": name, "description": skill(name)["description"]} for name in TOPICS]}
    if topic not in TOPICS:
        raise ValueError(f'There is no topic "{topic}". Topics: {", ".join(TOPICS)}.')
    return {"topic": topic, "text": skill(topic)["body"]}


def list_rooms(service: HueRoomService, layout: str | None = None) -> list[dict[str, Any]]:
    """Every room with its size in cm, light count, and whether it has a desk and a screen."""
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
    """One room in full: outline, ceiling, doors and windows, furniture, and lights with their roles.

    Each light has its height worked out (`resolved_elevation`) and its role for each kind of
    focus (`resolved_roles`: "desk", "read", "sofa"). The room's depth is called `height` here."""
    with in_layout(service, layout):
        data = room_json(service.get_room(_room_name(service, room)))
    data.pop("photo", None)
    return data


def describe_room(service: HueRoomService, room: str, layout: str | None = None) -> dict[str, Any]:
    """A room as a scaled text drawing with a legend and its doors and windows in words."""
    with in_layout(service, layout):
        return draw_room(service.get_room(_room_name(service, room)))


def check_layout(service: HueRoomService, room: str, layout: str | None = None) -> dict[str, Any]:
    """What is wrong with a room's layout, each problem with its kind, item, and a sentence.

    `ok` is true when nothing is. Kinds: outside, overlap, screen_off_desk, screen_faces_wall,
    no_seat, height_unknown."""
    with in_layout(service, layout):
        problems = layout_problems(service.get_room(_room_name(service, room)))
    return {"ok": not problems, "problems": problems}


def list_lights(service: HueRoomService) -> dict[str, Any]:
    """Every light on the bridge, or why the bridge cannot say. One read of the bridge; nothing is saved."""
    try:
        found = service.read_lights()
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
    """The saved scenes, all of them or one room's, with each one's id and how many lights it sets."""
    with in_layout(service, layout):
        name = _room_name(service, room) if room else None
        return [
            {"id": scene.id, "name": scene.name, "room": scene.room, "lights": len(scene.overrides)}
            for scene in service.scenes(name)
        ]


def list_layouts(service: HueRoomService) -> list[dict[str, Any]]:
    """The active layout (the real home) and the sandboxes, with their rooms and scene counts."""
    return [{key: entry[key] for key in ("id", "name", "active", "rooms", "scenes")} for entry in service.layouts()]


def catalog() -> dict[str, Any]:
    """What can be placed: furniture with its size and height, and the lights that can be planned."""
    furniture = []
    for kind, (label, width, depth, shape) in FURNITURE_SIZES.items():
        elevation, height = FURNITURE_HEIGHTS.get(kind, DEFAULT_FURNITURE_HEIGHT)
        furniture.append({"kind": kind, "label": label, "width": width, "depth": depth, "shape": shape, "elevation": elevation, "height": height})
    return {"furniture": furniture, "lights": [item.to_dict() for item in CATALOG.values()]}


def suggest(service: HueRoomService, room: str, mode: str, at: str | None = None, layout: str | None = None) -> list[dict[str, Any]]:
    """Suggested scenes for a room, as previews: nothing is saved and no light changes.

    `mode` is "code", "work", "study", "read", or "relax". `at` is the time of day to suggest
    for, as 24-hour "HH:MM" (such as "21:00"); without it, now. Whites get warmer and dimmer
    toward the person's bedtime."""
    if at is not None and not _is_clock(at):
        raise ValueError(f'at must be a 24-hour time as HH:MM, such as "21:00" for 9 pm, not "{at}".')
    with in_layout(service, layout):
        items = service.suggest(_room_name(service, room), mode, at=at)
    return [
        {"name": item["scene"]["name"], "kelvin": item["kelvin"], "roles": item["roles"], "lights": item["scene"]["overrides"]}
        for item in items
    ]


def _is_clock(at: Any) -> bool:
    """Whether `at` is a 24-hour "HH:MM" time."""
    return isinstance(at, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", at) is not None


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
    """What each light in the room would show for these settings, without saving or sending anything.

    `lights` maps light IDs to settings: `colors` (1 to 5 hex colours) or `white` (2000 to 6500
    kelvin), with `brightness` (0 to 100) and optionally `on`. Lights left out keep their state
    unless `others` is "off"."""
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
    """Save a scene, or replace the saved scene with `scene_id`, without sending anything to any light."""
    with in_layout(service, layout):
        if scene_id is not None and all(item.id != scene_id for item in service.scenes()):
            raise SceneNotFound(scene_id)
        saved = service.save_scene(_scene(service, room, name, lights, others, scene_id).to_dict())
    return {"id": saved.id, "name": saved.name, "room": saved.room, "saved": True, "sent": False}


def apply_scene(
    service: HueRoomService, scene: str | None = None, room: str | None = None, name: str | None = None,
    lights: dict[str, dict[str, Any]] | None = None, others: str | None = None, layout: str | None = None,
) -> dict[str, Any]:
    """Changes the real lights. Sends a scene to a room's lights and reports what each took.

    Give a saved scene (`scene`, by ID or name), or one not saved (`room`, `name`, `lights`, and
    optionally `others`, "keep" or "off"). Planned lights are not installed, so they are reported,
    not sent. A light that lacks an effect or mode in the scene gets the rest, with a `warning`."""
    if scene is not None and (room is not None or name is not None or lights is not None or others is not None) or (
        scene is None and (room is None or lights is None)
    ):
        raise ValueError(
            "Give either scene (a saved scene's ID or name), or room, name, and lights (and optionally others) "
            "for one that is not saved. Not both: a saved scene already says what happens to the other lights."
        )
    with in_layout(service, layout):
        target = (
            service.get_scene(scene) if scene is not None
            else _scene(service, room, name or "Assistant scene", lights, others or "keep")
        )
        results = service.apply_scene_object(target)
    shown = []
    for item in results:
        light = {"id": item["light_id"], "name": item["label"], "applied": item["applied"], "planned": bool(item.get("planned"))}
        for key in ("warning", "error"):
            if item.get(key):
                light[key] = item[key]
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
    """Changes the real lights. Turns every installed light in a room on or off."""
    if not isinstance(on, bool):
        raise ValueError("on must be true or false.")
    with in_layout(service, layout):
        name = _room_name(service, room)
        return _sent(name, service.set_room_power(name, on))


def room_dim(service: HueRoomService, room: str, percent: float, layout: str | None = None) -> dict[str, Any]:
    """Changes the real lights. Sets the brightness of the lights that are on in a room, 1 to 100 percent."""
    if isinstance(percent, bool) or not isinstance(percent, (int, float)):
        raise ValueError("Room brightness must be a number from 1 to 100 percent.")
    with in_layout(service, layout):
        name = _room_name(service, room)
        return _sent(name, service.set_room_brightness(name, percent))


# Layout tools. Every one that writes goes through sandbox(), which refuses the active layout, so an
# assistant can only build in a sandbox. Nothing here sends anything to the bridge.

WRITES_LAYOUT = ("add_room", "update_room", "remove_room", "set_openings", "set_furniture", "place_light", "remove_light")

_NEEDS_SANDBOX = "Layouts are built in a sandbox, never in the active home. Call create_sandbox first, then pass its id as layout."


@contextmanager
def sandbox(service: HueRoomService, layout: str | None) -> Iterator[str]:
    """Like in_layout, but only for a sandbox: a missing, unknown, or active layout is refused.

    Inside, the service runs strict: if the sandbox is made active before a load or save, that raises
    LayoutChanged instead of quietly reading or writing the active home."""
    if not layout or not str(layout).strip():
        raise Refused(_NEEDS_SANDBOX)
    try:
        named = service.resolve_layout(str(layout))
        title = next(entry["name"] for entry in service.layouts() if entry["id"] == named)
        layout_id = service.sandbox_id(named)
    except LayoutNotFound:
        raise Refused(f'There is no layout "{layout}". {_NEEDS_SANDBOX}') from None
    # Making the sandbox active is how the person ends a layout job, so the next request often
    # names it. Say what happened and where to carry on, not just "use a sandbox".
    now_active = Refused(f'"{title}" is now the active home, so it cannot be edited here. '
                         'Call create_sandbox with copy_from "active" and carry on in the copy.')
    if layout_id is None:
        raise now_active
    try:
        with using_layout(layout_id, strict=True):
            yield layout_id
    except LayoutChanged:
        raise now_active from None


def _plan_cm(value: float | int | str, what: str) -> float:
    """An offset or height in cm: like cm(), but 0 is allowed."""
    try:
        if not isinstance(value, bool) and float(value) == 0:
            return 0.0
    except (TypeError, ValueError):
        pass
    return cm(value, what)


def _position(value: float | int | str, what: str) -> float:
    """An x or y in cm: any finite number, below zero too. A position is not a length: an item can
    sit outside the room, and check_layout reports it."""
    if isinstance(value, str) and value.strip().startswith("-"):
        try:
            return -_plan_cm(value.strip()[1:], what)
        except ValueError:
            return cm(value, what)  # refused, naming the value as it was given
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value < 0:
        return float(value)
    return _plan_cm(value, what)


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
    """Add a room to a sandbox: a width by depth rectangle, or an outline of [x, y] corners in cm.

    Lengths may be cm or strings with a unit, such as "12ft" or "3.8m"."""
    with sandbox(service, layout) as layout_id:
        if outline is None and (width is None or depth is None):  # no silent default size
            raise ValueError("Give the room's width and depth (along x and y), or an outline of [x, y] corners in cm.")
        sizes: dict[str, Any] = {}
        if width is not None:
            sizes["width"] = cm(width, "width")
        if depth is not None:
            sizes["height"] = cm(depth, "depth")
        height = cm(ceiling, "ceiling") if ceiling is not None else None
        if units is not None and units not in UNIT_SYSTEMS:
            raise ValueError(f"units must be one of {', '.join(UNIT_SYSTEMS)}.")
        created = service.add_room(name, outline=outline, **sizes)
        if height is not None or units is not None:
            try:
                service.update_room(created.name, ceiling=height, units=units)
            except Exception:
                service.remove_room(created.name)  # one call, one outcome: no half-made room
                raise
        return _room_dict(service, created.name)


def update_room(
    service: HueRoomService, layout: str | None, room: str, width: float | int | str | None = None,
    depth: float | int | str | None = None, outline: list[list[float]] | None = None,
    ceiling: float | int | str | None = None,
) -> dict[str, Any]:
    """Resize a room (the outline stretches to width by depth), replace its outline, or set its ceiling."""
    with sandbox(service, layout) as layout_id:
        name = _room_name(service, room)
        changes: dict[str, Any] = {}
        if width is not None:
            changes["width"] = cm(width, "width")
        if depth is not None:
            changes["height"] = cm(depth, "depth")
        if ceiling is not None:
            changes["ceiling"] = cm(ceiling, "ceiling")
        service.update_room(name, outline=outline, **changes)
        return _room_dict(service, name)


def remove_room(service: HueRoomService, layout: str | None, room: str) -> dict[str, Any]:
    """Take a room out of a sandbox, with its furniture, light placements, and scenes."""
    with sandbox(service, layout) as layout_id:
        name = _room_name(service, room)
        service.remove_room(name)
        return {"removed": name}


def set_openings(service: HueRoomService, layout: str | None, room: str, openings: list[dict]) -> dict[str, Any]:
    """Replace a sandbox room's doors and windows with the list given.

    `wall` counts the outline's edges from 0; `offset` is cm from that edge's starting corner."""
    with sandbox(service, layout) as layout_id:
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
        service.update_room(name, openings=built)
        return _room_dict(service, name)


def set_furniture(service: HueRoomService, layout: str | None, room: str, furniture: list[dict]) -> dict[str, Any]:
    """Replace a sandbox room's furniture with the list given.

    Missing width, depth, shape, and label come from the catalog's size for the kind."""
    with sandbox(service, layout) as layout_id:
        name = _room_name(service, room)
        shape = 'Give a list of objects such as [{"kind": "desk", "x": 120, "y": 60}], one per piece, with kind a catalog name.'
        if not isinstance(furniture, list):
            raise ValueError(f"furniture must be a list. {shape}")
        built = []
        for item in furniture:
            if not isinstance(item, dict):
                raise ValueError(f"Each piece of furniture is an object, not {item!r}. {shape}")
            kind = item.get("kind")
            if not isinstance(kind, str):
                raise ValueError(f"kind must be one catalog name as a string, not {kind!r}. {shape}")
            if kind not in FURNITURE_SIZES:
                raise ValueError(f"Unknown furniture kind '{kind}'. See catalog.")
            label, width, depth, shape = FURNITURE_SIZES[kind]
            data: dict[str, Any] = {"kind": kind, "label": item.get("label") or label, "shape": shape, "width": width, "depth": depth,
                                    "x": _position(item.get("x"), "x"), "y": _position(item.get("y"), "y")}
            for key in ("width", "depth"):
                if item.get(key) is not None:
                    data[key] = cm(item[key], key)
            for key in ("elevation", "height"):
                if item.get(key) is not None:
                    data[key] = _plan_cm(item[key], key)
            if item.get("rotation") is not None:
                data["rotation"] = item["rotation"]
            built.append(data)
        service.update_room(name, furniture=built)
        return _room_dict(service, name)


def place_light(
    service: HueRoomService, layout: str | None, room: str, x: float | int | str, y: float | int | str,
    light_id: str | None = None, catalog: str | None = None, rotation: float | None = None,
    height: float | int | str | None = None, length: float | int | str | None = None,
    role: str | None = None, label: str | None = None,
) -> dict[str, Any]:
    """Place a paired light (by `light_id`) or a planned `catalog` light; a light already in the room moves.

    A new `light_id` is checked against one read of the bridge's light list and placed with the
    bridge's name (unless `label` is given) and product, so its height and roles can be worked
    out. An id the bridge does not have is refused. With no bridge paired or answering, only a
    light already placed in a room of this sandbox or the active home can be placed; its label
    and product are copied. Anything else is planned with `catalog`."""
    with sandbox(service, layout) as layout_id:
        name = _room_name(service, room)
        if (light_id is None) == (catalog is None):
            raise ValueError("Give exactly one of light_id or catalog.")
        spot = {"x": _position(x, "x"), "y": _position(y, "y")}
        elevation = _plan_cm(height, "height") if height is not None else None
        size = cm(length, "length") if length is not None else None
        if catalog is not None:
            catalog_item(catalog)
        if catalog is not None:
            placed = service.add_planned_light(name, catalog, label=label, rotation=rotation, elevation=elevation, role=role, **spot)
            if size is not None:
                try:
                    placed = service.assign_light(name, placed.light_id, length=size, **spot)
                except Exception:
                    service.remove_light(name, placed.light_id)  # no half-placed light
                    raise
        else:
            light_id = str(light_id).strip()
            here = [light.light_id for light in service.get_room(name).lights]
            product = None
            if light_id not in here:  # a light already in the room just moves, with no bridge call
                known_label, product = _light_to_place(service, name, light_id, here)
                label = label or known_label
            placed = service.assign_light(name, light_id, label=label, rotation=rotation, length=size, elevation=elevation,
                                          role=role, product=product, **spot)
        return placed.to_dict()


def _light_to_place(service: HueRoomService, room: str, light_id: str, here: list[str]) -> tuple[str, dict[str, Any]]:
    """The label and product for a light new to this room, or Refused when it cannot be checked."""
    if light_id.startswith("planned-"):
        raise Refused(f"There is no planned light {light_id} in {room}. Lights here: {', '.join(here) or 'none'}. "
                      "To plan a new one, pass catalog.")
    try:
        paired = service.read_lights()  # one plain read: no relocation, no discovery, no v2 call, no save
    except BridgeNotConfigured:
        why = "No bridge is paired"
    except (HueError, requests.RequestException):
        why = "The bridge is not answering"
    else:
        for light in paired:
            if light["id"] == light_id:
                return light["name"], {key: light[key] for key in PRODUCT_KEYS}
        listed = ", ".join(f"{light['id']} ({light['name']})" for light in paired) or "none"
        raise Refused(f"Light {light_id} is not on the bridge. Paired lights: {listed}. "
                      "To plan a light that is not paired, pass catalog instead.")
    # The bridge cannot say, so trust only a light already placed somewhere: this sandbox first, then the home.
    rooms = service.rooms()
    with using_layout(None):
        rooms += service.rooms()
    for other in rooms:
        for light in other.lights:
            if light.light_id == light_id and not light.planned:
                return light.label, dict(light.product)
    raise Refused(f"{why}, so light {light_id} cannot be checked. Plan it with catalog instead.")


def remove_light(service: HueRoomService, layout: str | None, room: str, light_id: str) -> dict[str, Any]:
    """Take a light's placement out of a room in a sandbox; the light itself stays on the bridge."""
    with sandbox(service, layout) as layout_id:
        name = _room_name(service, room)
        placed = [light.light_id for light in service.get_room(name).lights]
        if str(light_id) not in placed:
            raise ValueError(f'Light "{light_id}" is not in {name}. Lights in {name}: {", ".join(placed) or "none"}.')
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
    with sandbox(service, layout) as layout_id:
        name = _room_name(service, room)
    base = str(app_url).rstrip("/")
    answering = _app_answers(base)
    note = (
        "Open the link to see the room in 3D." if answering
        else f"The app is not answering at {base}. Start it with `myhuey serve`, or give the address it runs at with --app-url."
    )
    return {"url": f"{base}/?layout={layout_id}#/studio/room/{quote(name, safe='')}/3d", "answering": answering, "note": note}


# Every tool by name, in the order the design lists them, `guide` first. A server registers these.
TOOLS: dict[str, Callable[..., Any]] = {
    tool.__name__: tool
    for tool in (
        guide, list_rooms, get_room, describe_room, list_lights, list_scenes, list_layouts, catalog, suggest,
        preview_scene, save_scene, apply_scene, room_power, room_dim,
        create_sandbox, add_room, update_room, remove_room, remove_light, set_openings, set_furniture, place_light,
        check_layout, open_in_app,
    )
}
