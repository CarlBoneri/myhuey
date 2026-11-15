"""The paired bridge and the room layouts. Storage is read on every call, so a running
server sees what the CLI saved without a restart."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .color import light_state_to_hex, mired_to_color_temperature
from .errors import BridgeNotConfigured, RoomNotFound
from .hue import HueBridgeClient
from .models import LayoutLight, Room
from .storage import DEFAULT_STORAGE_PATH, load_config, save_config

_GRID_COLUMNS = 3
_GRID_CELL = (960, 660)


def light_snapshot(light_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Flatten one light from the bridge into what the UI and CLI show."""
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
    }


def _light_order(light_id: str) -> tuple[int, str]:
    return (int(light_id), "") if str(light_id).isdigit() else (10**9, str(light_id))


class HueRoomService:
    def __init__(self, storage_path: str | Path | None = None) -> None:
        self.storage_path = str(storage_path or DEFAULT_STORAGE_PATH)
        self.cert_dir = Path(self.storage_path).parent / "certs"
        self._client: HueBridgeClient | None = None
        self._client_key: tuple[str, str] | None = None

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
        """The saved bridge as {"ip": ..., "username": ...}, or {} if none is paired."""
        bridge = self._load()["bridge"]
        return dict(bridge) if bridge.get("ip") and bridge.get("username") else {}

    def set_bridge(self, ip: str, username: str) -> None:
        config = self._load()
        config["bridge"] = {"ip": ip, "username": username}
        self._save(config)

    def client(self) -> HueBridgeClient:
        """A client for the saved bridge. Rebuilt when the saved bridge changes."""
        bridge = self.get_bridge()
        if not bridge:
            raise BridgeNotConfigured()
        key = (bridge["ip"], bridge["username"])
        if self._client is None or self._client_key != key:
            self._client = HueBridgeClient(*key, cert_dir=self.cert_dir)
            self._client_key = key
        return self._client

    # Lights on the bridge

    def lights(self) -> list[dict[str, Any]]:
        """Every light on the bridge with its live state."""
        raw = self.client().get_lights()
        return [light_snapshot(light_id, raw[light_id]) for light_id in sorted(raw, key=_light_order)]

    def set_light(self, light_id: str, **changes: Any) -> None:
        """Change a light. Takes on, brightness, color, xy, and color_temp."""
        self.client().set_light_color(light_id, **changes)

    # Rooms

    def add_room(self, name: str, width: int = 900, height: int = 600) -> Room:
        normalized = name.strip()
        if not normalized:
            raise ValueError("Room name cannot be empty")
        if "/" in normalized:
            raise ValueError("Room names cannot contain '/'")
        config = self._load()
        if any(room.get("name") == normalized for room in config["rooms"]):
            raise ValueError(f"Room '{normalized}' already exists")

        index = len(config["rooms"])
        room = Room(
            name=normalized,
            width=width,
            height=height,
            x=(index % _GRID_COLUMNS) * _GRID_CELL[0],
            y=(index // _GRID_COLUMNS) * _GRID_CELL[1],
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
        x: int | None = None,
        y: int | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> Room:
        """Move or resize a room on the floor plan."""
        config = self._load()
        room_data = self._room_data(config, name)
        for key, value in (("x", x), ("y", y), ("width", width), ("height", height)):
            if value is not None:
                room_data[key] = int(value)
        self._save(config)
        return Room.from_dict(room_data)

    def remove_room(self, name: str) -> None:
        config = self._load()
        config["rooms"].remove(self._room_data(config, name))
        self._save(config)

    def assign_light(
        self,
        room_name: str,
        light_id: str,
        x: int = 0,
        y: int = 0,
        label: str | None = None,
        brightness: int = 255,
        on: bool = True,
        metadata: dict[str, Any] | None = None,
    ) -> LayoutLight:
        """Place a light in a room, or move it if it is already there."""
        light_id = str(light_id).strip()
        if not light_id:
            raise ValueError("light_id is required")

        config = self._load()
        lights = self._room_data(config, room_name).setdefault("lights", [])
        existing = next((item for item in lights if str(item.get("light_id")) == light_id), None)
        light = LayoutLight(
            light_id=light_id,
            label=label or (existing or {}).get("label") or f"Light {light_id}",
            x=int(x),
            y=int(y),
            brightness=brightness,
            on=on,
            metadata=metadata if metadata is not None else (existing or {}).get("metadata") or {},
        )
        if existing is None:
            lights.append(light.to_dict())
        else:
            existing.update(light.to_dict())
        self._save(config)
        return light

    def remove_light(self, room_name: str, light_id: str) -> None:
        config = self._load()
        room_data = self._room_data(config, room_name)
        room_data["lights"] = [
            item for item in room_data.get("lights", []) if str(item.get("light_id")) != str(light_id)
        ]
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
                self.assign_light(
                    name,
                    str(light_id),
                    x=150 + (index % 4) * 200,
                    y=150 + (index // 4) * 150,
                    label=(lights.get(str(light_id)) or {}).get("name"),
                )
            added.append(name)
        return added

    def room_summary(self, room_name: str) -> dict[str, Any]:
        room = self.get_room(room_name)
        return {
            "name": room.name,
            "width": room.width,
            "height": room.height,
            "light_count": len(room.lights),
            "lights": [
                {
                    "light_id": light.light_id,
                    "label": light.label,
                    "x": light.x,
                    "y": light.y,
                    "on": light.on,
                    "brightness": light.brightness,
                }
                for light in room.lights
            ],
        }
