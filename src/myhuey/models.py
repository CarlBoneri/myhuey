from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class LayoutLight:
    """A Hue light placed in a room. x and y are the light's center, in room units."""

    light_id: str
    label: str
    x: int = 0
    y: int = 0
    width: int = 80
    height: int = 80
    on: bool = True
    brightness: int = 255
    color_temp: int | None = None
    xy: tuple[float, float] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LayoutLight:
        light_id = str(data["light_id"])
        return cls(
            light_id=light_id,
            label=data.get("label") or f"Light {light_id}",
            x=int(data.get("x", 0)),
            y=int(data.get("y", 0)),
            width=int(data.get("width", 80)),
            height=int(data.get("height", 80)),
            on=bool(data.get("on", True)),
            brightness=int(data.get("brightness", 255)),
            color_temp=data.get("color_temp"),
            xy=tuple(data["xy"]) if data.get("xy") else None,
            metadata=dict(data.get("metadata") or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "light_id": self.light_id,
            "label": self.label,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "on": self.on,
            "brightness": self.brightness,
            "color_temp": self.color_temp,
            "xy": list(self.xy) if self.xy else None,
            "metadata": self.metadata,
        }


@dataclass
class Room:
    """A room on the home floor plan. x and y are its top-left corner on that plan."""

    name: str
    width: int = 900
    height: int = 600
    x: int = 0
    y: int = 0
    lights: list[LayoutLight] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Room:
        return cls(
            name=data["name"],
            width=int(data.get("width", 900)),
            height=int(data.get("height", 600)),
            x=int(data.get("x", 0)),
            y=int(data.get("y", 0)),
            lights=[LayoutLight.from_dict(light) for light in data.get("lights", [])],
        )

    def add_light(self, light: LayoutLight) -> None:
        if self.get_light(light.light_id):
            raise ValueError(f"Light '{light.light_id}' already exists in room '{self.name}'")
        self.lights.append(light)

    def get_light(self, light_id: str) -> LayoutLight | None:
        for light in self.lights:
            if light.light_id == light_id:
                return light
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "width": self.width,
            "height": self.height,
            "x": self.x,
            "y": self.y,
            "lights": [light.to_dict() for light in self.lights],
        }
