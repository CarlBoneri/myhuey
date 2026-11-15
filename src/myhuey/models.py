"""The saved home: rooms drawn to scale, furniture, placed lights, room photos, and scenes.

Every length is in centimeters. Room outlines and positions inside a room are relative to the
room's own origin; a room's x and y place that origin on the home floor plan.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from .geometry import as_points, bounds, polygon_area, rectangle
from .units import UNIT_SYSTEMS

MAX_EXTENT_CM = 10000.0  # 100 m. Anything larger is a typo.
DEFAULT_ROOM_CM = (450.0, 300.0)


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return default


def _clamp_extent(value: float, what: str) -> float:
    if abs(value) > MAX_EXTENT_CM:
        raise ValueError(f"{what} is outside the {MAX_EXTENT_CM / 100:.0f} m limit")
    return value


def validate_outline(raw: Any) -> list[list[float]]:
    """A room outline: at least three distinct corners, a real area, inside the size limit."""
    if not isinstance(raw, (list, tuple)) or len(raw) < 3:
        raise ValueError("A room outline needs at least three corners")
    if len(raw) > 200:
        raise ValueError("A room outline can have at most 200 corners")
    points = as_points(raw)
    for x, y in points:
        _clamp_extent(x, "A corner")
        _clamp_extent(y, "A corner")
    if len(set(points)) < 3 or polygon_area(points) < 100:  # under 10 cm x 10 cm
        raise ValueError("A room outline must enclose an area")
    return [[round(x, 2), round(y, 2)] for x, y in points]


@dataclass
class LayoutLight:
    """A Hue light placed in a room. x and y are its center in cm; rotation is in degrees.

    `length` overrides the light's physical length (lightstrips and string lights are cut
    or extended). `product` caches what the bridge reported, so scenes can be computed
    without asking the bridge.
    """

    light_id: str
    label: str
    x: float = 0.0
    y: float = 0.0
    rotation: float = 0.0
    length: float | None = None
    on: bool = True
    brightness: int = 255
    color_temp: int | None = None
    xy: tuple[float, float] | None = None
    product: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LayoutLight:
        light_id = str(data["light_id"])
        length = data.get("length")
        return cls(
            light_id=light_id,
            label=data.get("label") or f"Light {light_id}",
            x=_num(data.get("x")),
            y=_num(data.get("y")),
            rotation=_num(data.get("rotation")) % 360,
            length=_num(length) if length not in (None, "") else None,
            on=bool(data.get("on", True)),
            brightness=int(data.get("brightness", 255)),
            color_temp=data.get("color_temp"),
            xy=tuple(data["xy"]) if data.get("xy") else None,
            product=dict(data.get("product") or {}),
            metadata=dict(data.get("metadata") or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "light_id": self.light_id,
            "label": self.label,
            "x": self.x,
            "y": self.y,
            "rotation": self.rotation,
            "length": self.length,
            "on": self.on,
            "brightness": self.brightness,
            "color_temp": self.color_temp,
            "xy": list(self.xy) if self.xy else None,
            "product": self.product,
            "metadata": self.metadata,
        }


FURNITURE_SHAPES = ("rect", "ellipse")


@dataclass
class Furniture:
    """A piece of furniture at its real footprint. x and y are its center in cm."""

    id: str
    kind: str
    label: str
    x: float
    y: float
    width: float
    depth: float
    rotation: float = 0.0
    shape: str = "rect"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Furniture:
        width, depth = _num(data.get("width"), 60), _num(data.get("depth"), 60)
        if not (1 <= width <= 2000 and 1 <= depth <= 2000):
            raise ValueError("Furniture must be between 1 cm and 20 m on each side")
        shape = data.get("shape") or "rect"
        if shape not in FURNITURE_SHAPES:
            raise ValueError(f"Furniture shape must be one of {', '.join(FURNITURE_SHAPES)}")
        return cls(
            id=str(data.get("id") or new_id()),
            kind=str(data.get("kind") or "custom")[:40],
            label=str(data.get("label") or data.get("kind") or "Furniture")[:80],
            x=_clamp_extent(_num(data.get("x")), "Furniture"),
            y=_clamp_extent(_num(data.get("y")), "Furniture"),
            width=width,
            depth=depth,
            rotation=_num(data.get("rotation")) % 360,
            shape=shape,
        )

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class RoomPhoto:
    """A photo of the real room, stored under ~/.myhuey/uploads. Placements are fractions
    of the photo's width and height (0 to 1), so they survive any display size."""

    file: str
    width: int
    height: int
    placements: dict[str, dict[str, float]] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> RoomPhoto | None:
        if not data or not data.get("file"):
            return None
        placements = {}
        for light_id, spot in (data.get("placements") or {}).items():
            placements[str(light_id)] = {
                "x": min(1.0, max(0.0, _num(spot.get("x"), 0.5))),
                "y": min(1.0, max(0.0, _num(spot.get("y"), 0.5))),
                "rotation": _num(spot.get("rotation")) % 360,
                "scale": min(10.0, max(0.1, _num(spot.get("scale"), 1.0))),
            }
        return cls(str(data["file"]), int(data.get("width", 0)), int(data.get("height", 0)), placements)

    def to_dict(self) -> dict[str, Any]:
        return {"file": self.file, "width": self.width, "height": self.height, "placements": self.placements}


@dataclass
class Room:
    """A room drawn to scale. `outline` is its floor polygon in cm, relative to the room origin."""

    name: str
    outline: list[list[float]] = field(default_factory=lambda: [list(p) for p in rectangle(*DEFAULT_ROOM_CM)])
    x: float = 0.0
    y: float = 0.0
    units: str = "imperial"
    lights: list[LayoutLight] = field(default_factory=list)
    furniture: list[Furniture] = field(default_factory=list)
    photo: RoomPhoto | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Room:
        outline = data.get("outline")
        if not outline:
            outline = [list(p) for p in rectangle(_num(data.get("width"), 450), _num(data.get("height"), 300))]
        units = data.get("units") if data.get("units") in UNIT_SYSTEMS else "imperial"
        return cls(
            name=data["name"],
            outline=validate_outline(outline),
            x=_num(data.get("x")),
            y=_num(data.get("y")),
            units=units,
            lights=[LayoutLight.from_dict(light) for light in data.get("lights", [])],
            furniture=[Furniture.from_dict(item) for item in data.get("furniture", [])],
            photo=RoomPhoto.from_dict(data.get("photo")),
        )

    @property
    def width(self) -> float:
        min_x, _, max_x, _ = bounds(as_points(self.outline))
        return round(max_x - min_x, 2)

    @property
    def height(self) -> float:
        _, min_y, _, max_y = bounds(as_points(self.outline))
        return round(max_y - min_y, 2)

    @property
    def area(self) -> float:
        """Floor area in square centimeters."""
        return polygon_area(as_points(self.outline))

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
            "x": self.x,
            "y": self.y,
            "units": self.units,
            "outline": self.outline,
            "width": self.width,
            "height": self.height,
            "lights": [light.to_dict() for light in self.lights],
            "furniture": [item.to_dict() for item in self.furniture],
            "photo": self.photo.to_dict() if self.photo else None,
        }
