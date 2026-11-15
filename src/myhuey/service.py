"""The paired bridge, rooms drawn to scale, scenes, and uploaded images.

Storage is read on every call, so a running server sees what the CLI saved without a restart.
The CLI and the web API both go through this class; neither talks to the bridge directly.
"""

from __future__ import annotations

import functools
import threading
import time
from pathlib import Path
from typing import Any, Callable

from .color import hex_to_rgb, light_state_to_hex, mired_to_color_temperature, rgb_to_xy, xy_to_hex
from .discovery import discover
from .errors import BridgeNotConfigured, BridgeUnreachable, HueError, RoomNotFound, SceneNotFound
from .geometry import rectangle
from .hue import HueBridgeClient
from .images import ImageSampler, extract_palette, image_path, prune_unreferenced, store_image
from .models import Furniture, HomePlan, LayoutLight, Opening, Room, RoomPhoto, opening_fits, reanchor_openings, validate_outline
from .preferences import chosen as chosen_preferences, merged as merged_preferences, validate as validate_preferences
from .scenes import Scene, evaluate
from .shapes import profile_for
from .storage import DEFAULT_STORAGE_PATH, load_config, save_config, uploads_dir
from .tls import pin_certificate, pinned_bridge_id
from .units import UNIT_SYSTEMS

_GRID_COLUMNS = 3
_GRID_CELL_CM = (500.0, 350.0)
_V2_CACHE_SECONDS = 4.0  # gradient state is shown live, so refresh about once per poll
_RELOCATE_EVERY_SECONDS = 60.0  # how often to look for a bridge whose address stopped answering
PRODUCT_KEYS = ("archetype", "productname", "modelid")


def _product(raw: dict[str, Any]) -> dict[str, str]:
    return {
        "archetype": str((raw.get("config") or {}).get("archetype") or ""),
        "productname": str(raw.get("productname") or ""),
        "modelid": str(raw.get("modelid") or ""),
    }


def _gradient_state(v2_light: dict[str, Any]) -> dict[str, Any] | None:
    """A gradient light's live points (hex), mode, and limits from its v2 resource."""
    gradient = v2_light.get("gradient")
    if not isinstance(gradient, dict):
        return None
    points = []
    for point in gradient.get("points") or []:
        xy = ((point.get("color") or {}).get("xy")) or {}
        try:
            points.append(xy_to_hex((float(xy["x"]), float(xy["y"]))))
        except (KeyError, TypeError, ValueError):
            continue
    return {
        "points": points,
        "mode": gradient.get("mode") or "interpolated_palette",
        "modes": list(gradient.get("mode_values") or ["interpolated_palette"]),
        "points_capable": int(gradient.get("points_capable") or 0),
        "pixel_count": int(gradient.get("pixel_count") or 0),
    }


def _effect_state(v2_light: dict[str, Any]) -> dict[str, Any] | None:
    effects = v2_light.get("effects")
    if not isinstance(effects, dict) or not effects.get("effect_values"):
        return None
    return {"current": effects.get("status") or "no_effect", "values": list(effects["effect_values"])}


def light_snapshot(light_id: str, raw: dict[str, Any], v2_info: dict[str, Any] | None = None) -> dict[str, Any]:
    """Flatten one light from the bridge into what the UI and CLI show.

    `v2_info` is this light's entry from HueRoomService.v2_index(), when the v2 API answered.
    """
    v2_info = v2_info or {}
    gradient_points = v2_info.get("gradient_points") if v2_info else None
    state = raw.get("state") or {}
    return {
        "id": str(light_id),
        "name": raw.get("name") or f"Light {light_id}",
        "type": raw.get("type", ""),
        "on": bool(state.get("on")),
        "reachable": bool(state.get("reachable", True)),
        "brightness": state.get("bri"),
        "color": light_state_to_hex(state),
        "color_temp": mired_to_color_temperature(state["ct"]) if state.get("ct") else None,
        "supports_color": "xy" in state,
        "supports_color_temp": "ct" in state,
        **_product(raw),
        "gradient_points": gradient_points or 0,
        "profile": profile_for(raw, gradient_points).to_dict(),
        "gradient": v2_info.get("gradient"),
        "effect": v2_info.get("effect"),
    }


def _light_order(light_id: str) -> tuple[int, str]:
    return (int(light_id), "") if str(light_id).isdigit() else (10**9, str(light_id))


def _clean_name(name: str) -> str:
    normalized = str(name or "").strip()
    if not normalized:
        raise ValueError("Room name cannot be empty")
    if "/" in normalized:
        raise ValueError("Room names cannot contain '/'")
    return normalized[:80]


def _one_bridge_write(method: Callable[..., Any]) -> Callable[..., Any]:
    """Run batches of light commands one at a time. Each batch paces itself, but two at
    once (two rooms dimmed together, a scene during a dim) would double the rate the
    bridge sees; Signify advises about 10 commands a second."""

    @functools.wraps(method)
    def serialized(self: "HueRoomService", *args: Any, **kwargs: Any) -> Any:
        with self._bridge_writes:
            return method(self, *args, **kwargs)

    return serialized


class HueRoomService:
    def __init__(self, storage_path: str | Path | None = None) -> None:
        self.storage_path = str(storage_path or DEFAULT_STORAGE_PATH)
        self.cert_dir = Path(self.storage_path).parent / "certs"
        self.uploads = uploads_dir(self.storage_path)
        self._client: HueBridgeClient | None = None
        self._client_key: tuple[str, str] | None = None
        self._v2_index: dict[str, dict[str, Any]] = {}
        self._v2_loaded = 0.0
        self.sleep: Callable[[float], None] = time.sleep
        self._relocate_after = 0.0
        self._bridge_writes = threading.Lock()

    def _load(self) -> dict[str, Any]:
        return load_config(self.storage_path)

    def _save(self, config: dict[str, Any]) -> None:
        save_config(config, self.storage_path)

    @staticmethod
    def _room_data(config: dict[str, Any], name: str) -> dict[str, Any]:
        for room_data in config["rooms"]:
            if room_data.get("name") == name:
                return room_data
        raise RoomNotFound(name)

    # Bridge

    def get_bridge(self) -> dict[str, str]:
        """The saved bridge as {"ip", "username", and "bridge_id" when known}, or {} if none is paired."""
        bridge = self._load()["bridge"]
        return dict(bridge) if bridge.get("ip") and bridge.get("username") else {}

    def set_bridge(self, ip: str, username: str, bridge_id: str | None = None) -> None:
        config = self._load()
        config["bridge"] = {"ip": ip, "username": username, **({"bridge_id": bridge_id.lower()} if bridge_id else {})}
        self._save(config)

    def relocate_bridge(self) -> str | None:
        """Find the paired bridge again by its ID after its address changed (a router
        handed it a new one). Checks at most once a minute. Returns the new address.

        As Signify's discovery guide advises, discovery runs only when the saved address
        stops answering, and the new address must present a verified certificate for the
        same bridge ID before it is saved.
        """
        bridge = self.get_bridge()
        if not bridge:
            return None
        wanted = str(bridge.get("bridge_id") or "").lower()
        if not wanted:
            # Paired by an older version: the verified pin for the old address knows the ID.
            host, port = HueBridgeClient.normalize_bridge_endpoint(bridge["ip"])
            wanted = pinned_bridge_id(host, port, self.cert_dir) or ""
            if wanted:
                self.set_bridge(bridge["ip"], bridge["username"], wanted)
        now = time.monotonic()
        if not wanted or now < self._relocate_after:
            return None
        self._relocate_after = now + _RELOCATE_EVERY_SECONDS
        for found in discover(mdns_timeout=1.0):
            address = str(found.get("internalipaddress") or "")
            if str(found.get("id") or "").lower() != wanted or not address or address == bridge["ip"]:
                continue
            host, port = HueBridgeClient.normalize_bridge_endpoint(address)
            try:
                pin_certificate(host, port, cert_dir=self.cert_dir, replace=True, expected_id=wanted)
            except HueError:
                continue  # not that bridge after all (or a spoofed answer); try the next
            self.set_bridge(address, bridge["username"], wanted)
            return address
        return None

    def client(self) -> HueBridgeClient:
        """A client for the saved bridge. Rebuilt when the saved bridge changes."""
        bridge = self.get_bridge()
        if not bridge:
            raise BridgeNotConfigured()
        key = (bridge["ip"], bridge["username"])
        if self._client is None or self._client_key != key:
            self._client = HueBridgeClient(*key, cert_dir=self.cert_dir)
            self._client_key = key
            self._v2_index, self._v2_loaded = {}, 0.0
        return self._client

    def v2_index(self, *, refresh: bool = False) -> dict[str, dict[str, Any]]:
        """v1 light ID -> {"rid": v2 ID, "gradient_points": n}. Cached for a few minutes.

        The v2 API is used for gradients only, so if it fails the app keeps working
        without them.
        """
        client = self.client()
        if not refresh and self._v2_index and time.monotonic() - self._v2_loaded < _V2_CACHE_SECONDS:
            return self._v2_index
        index: dict[str, dict[str, Any]] = {}
        try:
            for light in client.get_v2_lights():
                v1 = str(light.get("id_v1") or "")
                if v1.startswith("/lights/"):
                    gradient = light.get("gradient") or {}
                    index[v1.rsplit("/", 1)[1]] = {
                        "rid": str(light.get("id")),
                        "gradient_points": int(gradient.get("points_capable") or 0),
                        "gradient": _gradient_state(light),
                        "effect": _effect_state(light),
                    }
        except HueError:
            return self._v2_index
        self._v2_index, self._v2_loaded = index, time.monotonic()
        return index

    # Preferences

    def preferences(self) -> dict[str, Any]:
        return merged_preferences(self._load().get("preferences"))

    def update_preferences(self, changes: dict[str, Any]) -> dict[str, Any]:
        validate_preferences(changes)
        config = self._load()
        config["preferences"] = {**chosen_preferences(config.get("preferences")), **changes}
        self._save(config)
        return self.preferences()

    def _command_gap(self) -> float:
        """Seconds between light commands, from the preferences (Signify advises ~100 ms)."""
        return self.preferences()["command_gap_ms"] / 1000

    # Lights on the bridge

    def lights(self) -> list[dict[str, Any]]:
        """Every light on the bridge with its live state and physical profile."""
        try:
            index = self.v2_index()
            raw = self.client().get_lights()
        except BridgeUnreachable:
            if not self.relocate_bridge():
                raise
            index = self.v2_index(refresh=True)
            raw = self.client().get_lights()
        self._remember_products(raw)
        return [light_snapshot(light_id, raw[light_id], index.get(light_id)) for light_id in sorted(raw, key=_light_order)]

    def _remember_products(self, raw: dict[str, Any]) -> None:
        """Copy archetype, product name, and model ID into placements that lack them, so
        scenes can draw and compute lights without asking the bridge."""
        config = self._load()
        changed = False
        for room in config["rooms"]:
            for placed in room.get("lights", []):
                bridge_light = raw.get(str(placed.get("light_id")))
                if bridge_light and placed.get("product") != _product(bridge_light):
                    placed["product"] = _product(bridge_light)
                    changed = True
        if changed:
            self._save(config)

    def set_light(self, light_id: str, **changes: Any) -> None:
        """Change a light. Takes on, brightness, color, xy, and color_temp."""
        self.client().set_light_color(light_id, **changes)

    def _v2_light(self, light_id: str) -> dict[str, Any]:
        info = self.v2_index(refresh=True).get(str(light_id))
        if info is None:
            raise ValueError(f"Light {light_id} is not on the bridge's v2 API")
        return info

    def set_gradient(self, light_id: str, colors: list[str], mode: str | None = None) -> None:
        """Set a gradient light's colors, start to end, and optionally its mode.

        Hue spaces the points evenly along the light; only their colors and order can be set.
        """
        info = self._v2_light(light_id)
        gradient = info.get("gradient")
        if not gradient:
            raise ValueError(f"Light {light_id} does not support gradients")
        capable = max(2, gradient["points_capable"] or 5)
        if not 2 <= len(colors) <= capable:
            raise ValueError(f"A gradient on light {light_id} takes between 2 and {capable} colors")
        if mode is not None and mode not in gradient["modes"]:
            raise ValueError(f"Light {light_id} does not support the mode '{mode}' (it supports: {', '.join(gradient['modes'])})")
        body = gradient_body([hex_to_rgb(color) for color in colors], mode)
        self.client().set_v2_light(info["rid"], body)
        self._v2_loaded = 0.0  # the cache now holds the state from before this change

    def set_effect(self, light_id: str, effect: str) -> None:
        """Start a built-in effect such as candle or fire; "no_effect" stops it.

        The bridge clears a light's gradient points when an effect is set (even "no_effect").
        To stop an effect and keep colors, send set_gradient instead: it cancels the effect.
        """
        info = self._v2_light(light_id)
        effects = info.get("effect")
        if not effects:
            raise ValueError(f"Light {light_id} has no effects")
        if effect not in effects["values"]:
            raise ValueError(f"Light {light_id} does not support the effect '{effect}' (it supports: {', '.join(effects['values'])})")
        self.client().set_v2_light(info["rid"], {"effects": {"effect": effect}})
        self._v2_loaded = 0.0

    # Rooms

    def add_room(
        self,
        name: str,
        width: float = 450,
        height: float = 300,
        outline: list | None = None,
        x: float | None = None,
        y: float | None = None,
    ) -> Room:
        normalized = _clean_name(name)
        config = self._load()
        if any(room.get("name") == normalized for room in config["rooms"]):
            raise ValueError(f"Room '{normalized}' already exists")

        index = len(config["rooms"])
        room = Room(
            name=normalized,
            units=self.preferences()["default_units"],
            outline=validate_outline(outline or [list(p) for p in rectangle(width, height)]),
            x=round(float(x), 2) if x is not None else (index % _GRID_COLUMNS) * _GRID_CELL_CM[0],
            y=round(float(y), 2) if y is not None else (index // _GRID_COLUMNS) * _GRID_CELL_CM[1],
        )
        config["rooms"].append(room.to_dict())
        self._save(config)
        return room

    def get_room(self, name: str) -> Room:
        return Room.from_dict(self._room_data(self._load(), name))

    def list_rooms(self) -> list[str]:
        return [room["name"] for room in self._load()["rooms"]]

    def rooms(self) -> list[Room]:
        return [Room.from_dict(room) for room in self._load()["rooms"]]

    def update_room(
        self,
        name: str,
        *,
        x: float | None = None,
        y: float | None = None,
        width: float | None = None,
        height: float | None = None,
        outline: list | None = None,
        units: str | None = None,
        furniture: list[dict[str, Any]] | None = None,
        new_name: str | None = None,
        openings: list[dict[str, Any]] | None = None,
        ceiling: float | None = None,
    ) -> Room:
        """Move, reshape, or rename a room, or replace its furniture or openings.

        `width` and `height` stretch the outline to that bounding box (in cm), so a drawn
        shape keeps its proportions. `outline` replaces it outright. A new shape keeps the
        doors and windows that still fit on their edge and drops the rest; openings sent
        with it must all fit.
        """
        config = self._load()
        room_data = self._room_data(config, name)
        room = Room.from_dict(room_data)
        old_outline = room.outline
        if x is not None:
            room.x = round(float(x), 2)
        if y is not None:
            room.y = round(float(y), 2)
        if outline is not None:
            room.outline = validate_outline(outline)
        if width is not None or height is not None:
            room.outline = _stretch(room.outline, width, height)
        if openings is not None:
            room.openings = [Opening.from_dict(item) for item in openings][:100]
            for opening in room.openings:
                if not opening_fits(room.outline, opening):
                    raise ValueError(f"The {opening.kind} on edge {opening.edge} does not fit on that wall")
        elif outline is not None:
            # A new shape may start at another corner or wind the other way: follow the walls.
            room.openings = reanchor_openings(old_outline, room.outline, room.openings)
        else:
            room.openings = [opening for opening in room.openings if opening_fits(room.outline, opening)]
        if ceiling is not None:
            room.ceiling = float(ceiling)
        if units is not None:
            if units not in UNIT_SYSTEMS:
                raise ValueError(f"units must be one of {', '.join(UNIT_SYSTEMS)}")
            room.units = units
        if furniture is not None:
            room.furniture = [Furniture.from_dict(item) for item in furniture][:300]
        if new_name is not None and _clean_name(new_name) != room.name:
            renamed = _clean_name(new_name)
            if renamed in self.list_rooms():
                raise ValueError(f"Room '{renamed}' already exists")
            for scene in config["scenes"]:
                if scene.get("room") == room.name:
                    scene["room"] = renamed
            room.name = renamed
        room = Room.from_dict(room.to_dict())  # validates the ceiling and everything together
        room_data.clear()
        room_data.update(room.to_dict())
        self._save(config)
        return room

    def remove_room(self, name: str) -> None:
        config = self._load()
        config["rooms"].remove(self._room_data(config, name))
        config["scenes"] = [scene for scene in config["scenes"] if scene.get("room") != name]
        self._save(config)
        self.prune_uploads()

    def add_furniture(self, room_name: str, item: dict[str, Any]) -> Furniture:
        room = self.get_room(room_name)
        piece = Furniture.from_dict(item)
        self.update_room(room_name, furniture=[f.to_dict() for f in room.furniture] + [piece.to_dict()])
        return piece

    def remove_furniture(self, room_name: str, furniture_id: str) -> None:
        room = self.get_room(room_name)
        kept = [f.to_dict() for f in room.furniture if f.id != furniture_id]
        if len(kept) == len(room.furniture):
            raise ValueError(f"No furniture '{furniture_id}' in '{room_name}'")
        self.update_room(room_name, furniture=kept)

    def assign_light(
        self,
        room_name: str,
        light_id: str,
        x: float = 0,
        y: float = 0,
        label: str | None = None,
        brightness: int = 255,
        on: bool = True,
        metadata: dict[str, Any] | None = None,
        rotation: float | None = None,
        length: float | None = None,
        product: dict[str, Any] | None = None,
        elevation: float | str | None = None,
        role: str | None = None,
    ) -> LayoutLight:
        """Place a light in a room, or move it if it is already there.

        `elevation` and `role` are kept when left out; elevation "auto" clears a set height.
        """
        light_id = str(light_id).strip()
        if not light_id:
            raise ValueError("light_id is required")
        if length is not None and not (5 <= float(length) <= 5000):
            raise ValueError("A light's length must be between 5 cm and 50 m")

        config = self._load()
        lights = self._room_data(config, room_name).setdefault("lights", [])
        existing = next((item for item in lights if str(item.get("light_id")) == light_id), None) or {}
        light = LayoutLight.from_dict(
            {
                **existing,
                "light_id": light_id,
                "label": label or existing.get("label"),
                "x": x,
                "y": y,
                "rotation": rotation if rotation is not None else existing.get("rotation", 0),
                "length": length if length is not None else existing.get("length"),
                "brightness": brightness,
                "on": on,
                "metadata": metadata if metadata is not None else existing.get("metadata") or {},
                "product": product or existing.get("product") or {},
                "elevation": existing.get("elevation") if elevation is None else elevation,
                "role": role or existing.get("role") or "auto",
            }
        )
        if not existing:
            lights.append(light.to_dict())
        else:
            existing.update(light.to_dict())
        self._save(config)
        return light

    @_one_bridge_write
    def set_room_brightness(self, room_name: str, percent: float, *, pause: float | None = None) -> list[dict[str, Any]]:
        """Set every light in a room that is on to `percent` (1 to 100) brightness.

        Lights that are off stay off: this is the room's dimmer, not its switch. Only the
        brightness is sent (one ZigBee message per light), paced like other commands.
        """
        if not 1 <= float(percent) <= 100:
            raise ValueError("Room brightness must be between 1 and 100 percent")
        pause = self._command_gap() if pause is None else pause
        lights = self.get_room(room_name).lights
        if not lights:
            return []
        client = self.client()
        current = client.get_lights()
        bri = max(1, min(254, round(float(percent) * 2.54)))
        results = []
        for light in lights:
            state = ((current.get(light.light_id) or {}).get("state")) or {}
            if not state.get("on"):
                continue
            result: dict[str, Any] = {"light_id": light.light_id, "label": light.label, "ok": True}
            try:
                client.set_light_state(light.light_id, {"bri": bri})
            except HueError as exc:
                result.update(ok=False, error=str(exc))
            results.append(result)
            if pause:
                self.sleep(pause)
        return results

    @_one_bridge_write
    def set_room_power(self, room_name: str, on: bool, *, pause: float | None = None) -> list[dict[str, Any]]:
        """Turn every light placed in a room on or off. A light that fails does not stop
        the rest; each result says whether it took the change."""
        pause = self._command_gap() if pause is None else pause
        lights = self.get_room(room_name).lights
        if not lights:
            return []
        client = self.client()
        results = []
        for light in lights:
            result: dict[str, Any] = {"light_id": light.light_id, "label": light.label, "ok": True, "retried": False}
            try:
                client.set_light_state(light.light_id, {"on": bool(on)})
            except HueError as exc:
                result.update(ok=False, error=str(exc))
            results.append(result)
            if pause:
                self.sleep(pause)  # the bridge handles about ten light commands a second

        # Under a burst of commands the bridge can answer success and still drop one.
        # Read the lights back once and resend to any that did not change.
        if pause:
            self.sleep(max(pause * 5, 0.5))
        try:
            current = client.get_lights()
        except HueError:
            return results
        if not isinstance(current, dict):
            return results
        for result in results:
            state = (current.get(result["light_id"]) or {}).get("state") or {}
            if result["ok"] and "on" in state and bool(state["on"]) != bool(on):
                result["retried"] = True
                try:
                    client.set_light_state(result["light_id"], {"on": bool(on)})
                except HueError as exc:
                    result.update(ok=False, error=str(exc))
                if pause:
                    self.sleep(pause)
        return results

    def remove_light(self, room_name: str, light_id: str) -> None:
        config = self._load()
        room_data = self._room_data(config, room_name)
        room_data["lights"] = [
            item for item in room_data.get("lights", []) if str(item.get("light_id")) != str(light_id)
        ]
        photo = room_data.get("photo") or {}
        (photo.get("placements") or {}).pop(str(light_id), None)
        self._save(config)

    def import_rooms(self) -> list[str]:
        """Create a room for every Hue room on the bridge that is not here yet, with its
        lights laid out in a grid. Returns the names that were added."""
        client = self.client()
        lights = client.get_lights()
        added: list[str] = []
        for group in client.get_groups().values():
            name = str(group.get("name") or "").strip().replace("/", "-")
            if group.get("type") != "Room" or not name or name in self.list_rooms():
                continue
            self.add_room(name)
            for index, light_id in enumerate(group.get("lights", [])):
                raw = lights.get(str(light_id)) or {}
                self.assign_light(
                    name,
                    str(light_id),
                    x=75 + (index % 4) * 100,
                    y=75 + (index // 4) * 75,
                    label=raw.get("name"),
                    product=_product(raw) if raw else None,
                )
            added.append(name)
        return added

    def room_summary(self, room_name: str) -> dict[str, Any]:
        room = self.get_room(room_name)
        return {
            "name": room.name,
            "width": room.width,
            "height": room.height,
            "units": room.units,
            "light_count": len(room.lights),
            "furniture_count": len(room.furniture),
            "lights": [
                {"light_id": light.light_id, "label": light.label, "x": light.x, "y": light.y, "rotation": light.rotation}
                for light in room.lights
            ],
        }

    # Room photos

    def set_room_photo(self, room_name: str, data: bytes) -> Room:
        """Store a photo of the room. Light positions on an earlier photo are kept."""
        stored = store_image(data, self.uploads)
        config = self._load()
        room_data = self._room_data(config, room_name)
        placements = (room_data.get("photo") or {}).get("placements") or {}
        room_data["photo"] = {**stored, "placements": placements}
        self._save(config)
        self.prune_uploads(min_age_seconds=0)
        return Room.from_dict(room_data)

    def remove_room_photo(self, room_name: str) -> None:
        config = self._load()
        self._room_data(config, room_name)["photo"] = None
        self._save(config)
        self.prune_uploads(min_age_seconds=0)

    def set_photo_placements(self, room_name: str, placements: dict[str, dict[str, float]]) -> Room:
        config = self._load()
        room_data = self._room_data(config, room_name)
        if not room_data.get("photo"):
            raise ValueError(f"Room '{room_name}' has no photo yet")
        placed_ids = {str(light.get("light_id")) for light in room_data.get("lights", [])}
        unknown = set(placements) - placed_ids
        if unknown:
            raise ValueError(f"Place lights on the plan before the photo: {', '.join(sorted(unknown))}")
        photo = RoomPhoto.from_dict({**room_data["photo"], "placements": placements})
        room_data["photo"] = photo.to_dict() if photo else None
        self._save(config)
        return Room.from_dict(room_data)

    # Home plan image

    def get_plan(self) -> dict[str, Any] | None:
        plan = HomePlan.from_dict((self._load().get("home") or {}).get("plan"))
        return plan.to_dict() if plan else None

    def set_plan_image(self, data: bytes) -> dict[str, Any]:
        """Store a floor-plan image under the home. Its scale and placement are kept if a
        plan was already there, so a cleaner scan of the same plan drops in place."""
        stored = store_image(data, self.uploads)
        config = self._load()
        home = config.setdefault("home", {})
        previous = dict(home.get("plan") or {})
        if previous.get("width") and stored.get("width"):
            # A rescan of the same plan at another resolution keeps its real-world size.
            previous["cm_per_px"] = float(previous.get("cm_per_px", 1.0)) * previous["width"] / float(stored["width"])
        plan = HomePlan.from_dict({**previous, **stored})
        home["plan"] = plan.to_dict()
        self._save(config)
        self.prune_uploads(min_age_seconds=0)
        return home["plan"]

    def update_plan(self, **changes: Any) -> dict[str, Any]:
        """Change the plan's scale (cm_per_px), offset, rotation, or opacity."""
        config = self._load()
        home = config.setdefault("home", {})
        if not home.get("plan"):
            raise ValueError("Upload a floor-plan image first")
        allowed = {key: value for key, value in changes.items() if key in ("cm_per_px", "offset", "rotation", "opacity")}
        home["plan"] = HomePlan.from_dict({**home["plan"], **allowed}).to_dict()
        self._save(config)
        return home["plan"]

    def remove_plan(self) -> None:
        config = self._load()
        config.setdefault("home", {})["plan"] = None
        self._save(config)
        self.prune_uploads(min_age_seconds=0)

    # Images

    def upload_image(self, data: bytes, count: int = 5, mood: str = "colorful") -> dict[str, Any]:
        """Store an image for a scene. Returns its file name, size, and a color theme
        (swatches with where in the image each was picked)."""
        stored = store_image(data, self.uploads)
        return {**stored, "mood": mood, "theme": extract_palette(self.uploads / str(stored["file"]), count, mood)}

    def image_file(self, name: str) -> Path:
        return image_path(self.uploads, name)

    def palette(self, name: str, count: int = 5, mood: str = "colorful") -> list[dict[str, Any]]:
        return extract_palette(self.image_file(name), count, mood)

    def referenced_images(self) -> set[str]:
        config = self._load()
        names = {(room.get("photo") or {}).get("file") for room in config["rooms"]}
        names |= {(scene.get("image") or {}).get("file") for scene in config["scenes"]}
        names.add(((config.get("home") or {}).get("plan") or {}).get("file"))
        return {name for name in names if name}

    def prune_uploads(self, min_age_seconds: float = 3600) -> list[str]:
        return prune_unreferenced(self.uploads, self.referenced_images(), min_age_seconds)

    # Scenes

    def scenes(self, room: str | None = None) -> list[Scene]:
        found = [Scene.from_dict(data) for data in self._load()["scenes"]]
        return [scene for scene in found if room is None or scene.room == room]

    def get_scene(self, key: str) -> Scene:
        """A scene by ID, or by name if no ID matches."""
        scenes = self.scenes()
        for scene in scenes:
            if scene.id == key:
                return scene
        named = [scene for scene in scenes if scene.name.lower() == str(key).lower()]
        if len(named) == 1:
            return named[0]
        if len(named) > 1:
            raise ValueError(f"More than one scene is named '{key}'. Use its ID.")
        raise SceneNotFound(key)

    def save_scene(self, data: dict[str, Any]) -> Scene:
        """Create a scene, or replace the one with the same ID."""
        scene = Scene.from_dict(data)
        self.get_room(scene.room)
        if scene.image:
            self.image_file(scene.image.file)
        scene.touch()
        config = self._load()
        others = [item for item in config["scenes"] if item.get("id") != scene.id]
        position = next((i for i, item in enumerate(config["scenes"]) if item.get("id") == scene.id), len(others))
        others.insert(position, scene.to_dict())
        config["scenes"] = others
        self._save(config)
        self.prune_uploads()
        return scene

    def delete_scene(self, key: str) -> None:
        scene = self.get_scene(key)
        config = self._load()
        config["scenes"] = [item for item in config["scenes"] if item.get("id") != scene.id]
        self._save(config)
        self.prune_uploads(min_age_seconds=0)

    def _image_lookup(self, scene: Scene):
        if not scene.image:
            return None
        try:
            return ImageSampler(self.image_file(scene.image.file)).color_at
        except ValueError:
            return None

    def preview_scene(self, scene: Scene | dict[str, Any], gradient_points: dict[str, int] | None = None) -> list[dict[str, Any]]:
        """What each light would show, without changing any light."""
        if isinstance(scene, dict):
            scene = Scene.from_dict(scene)
        room = self.get_room(scene.room)
        return evaluate(scene, room, image_lookup=self._image_lookup(scene), gradient_points=gradient_points)

    @_one_bridge_write
    def apply_scene(self, key: str, *, pause: float | None = None) -> list[dict[str, Any]]:
        """Send a saved scene to the lights."""
        return self._apply(self.get_scene(key), pause)

    @_one_bridge_write
    def apply_scene_object(self, scene: Scene, *, pause: float | None = None) -> list[dict[str, Any]]:
        """Send a scene that may not be saved (a suggestion being previewed) to the lights."""
        self.get_room(scene.room)
        return self._apply(scene, pause)

    def _apply(self, scene: Scene, pause: float | None) -> list[dict[str, Any]]:
        """Send a scene to the lights. Gradient lights get their colors along their length
        through the v2 API; everything else uses v1. Returns what each light was sent,
        with an `error` for lights that refused."""
        pause = self._command_gap() if pause is None else pause
        client = self.client()
        raw = client.get_lights()
        index = self.v2_index()
        points = {light_id: max(1, info["gradient_points"]) for light_id, info in index.items()}
        results = self.preview_scene(scene, points)

        for result in results:
            light_id = result["light_id"]
            result["applied"] = False
            if result["keep"]:
                continue
            state = (raw.get(light_id) or {}).get("state") or {}
            v2 = index.get(light_id) or {}
            # Drop a mode or effect this light does not have, so the rest of the scene still lands.
            skipped = []
            if result.get("mode") and v2.get("gradient") and result["mode"] not in v2["gradient"]["modes"]:
                skipped.append(f"mode {result['mode']}")
                result["mode"] = None
            effect = result.get("effect")
            if effect and effect != "no_effect" and not (v2.get("effect") and effect in v2["effect"]["values"]):
                skipped.append(f"effect {effect}")
                result["effect"] = None
            if skipped:
                result["warning"] = f"{result['label']} does not support the {' or '.join(skipped)}"
            try:
                if not result["on"]:
                    client.set_light_state(light_id, {"on": False})
                elif result["gradient"] and v2.get("gradient"):
                    client.set_v2_light(v2["rid"], _gradient_body(result))
                else:
                    # Each field is one ZigBee message: leave out "on" for a light that already is.
                    changes: dict[str, Any] = {"brightness": max(1, round(result["brightness"] * 2.54))}
                    if not state.get("on"):
                        changes["on"] = True
                    if result.get("color_temp") and "ct" in state:
                        changes["color_temp"] = _mirek_for(result["color_temp"], raw.get(light_id) or {})
                    elif "xy" in state:
                        changes["xy"] = result["xy"]
                    client.set_light_color(light_id, **changes)
                # On the bridge an effect clears the gradient and a gradient cancels the effect,
                # so a real effect goes last and "no_effect" is never sent: the light command
                # above already stopped any effect.
                effect = result.get("effect")
                if result["on"] and effect and effect != "no_effect" and v2.get("effect"):
                    client.set_v2_light(v2["rid"], {"effects": {"effect": effect}})
                result["applied"] = True
            except HueError as exc:
                result["error"] = str(exc)
            if pause:
                self.sleep(pause)  # the bridge handles about ten light commands a second
        self._v2_loaded = 0.0  # gradients and effects just changed
        return results


def _mirek_for(kelvin: int, raw_light: dict[str, Any]) -> int:
    """Mirek for a white temperature, clamped to what this light reports it can do."""
    ct = ((raw_light.get("capabilities") or {}).get("control") or {}).get("ct") or {}
    low, high = int(ct.get("min") or 153), int(ct.get("max") or 500)
    return max(low, min(high, round(1_000_000 / kelvin)))


def gradient_body(rgbs: list[tuple[int, int, int]], mode: str | None = None, brightness: float | None = None) -> dict[str, Any]:
    """A v2 light update that turns the light on with these gradient colors, start to end."""
    points = []
    for rgb in rgbs:
        x, y = rgb_to_xy(rgb)
        points.append({"color": {"xy": {"x": x, "y": y}}})
    body: dict[str, Any] = {"on": {"on": True}, "gradient": {"points": points}}
    if mode:
        body["gradient"]["mode"] = mode
    if brightness is not None:
        body["dimming"] = {"brightness": max(1.0, float(brightness))}
    return body


def _gradient_body(result: dict[str, Any]) -> dict[str, Any]:
    return gradient_body([hex_to_rgb(value) for value in result["gradient"]], result.get("mode"), result["brightness"])


def _stretch(outline: list[list[float]], width: float | None, height: float | None) -> list[list[float]]:
    xs = [p[0] for p in outline]
    ys = [p[1] for p in outline]
    min_x, min_y = min(xs), min(ys)
    old_w, old_h = (max(xs) - min_x) or 1, (max(ys) - min_y) or 1
    sx = float(width) / old_w if width is not None else 1.0
    sy = float(height) / old_h if height is not None else 1.0
    return validate_outline([[min_x + (x - min_x) * sx, min_y + (y - min_y) * sy] for x, y in outline])
