"""The saved home: rooms drawn to scale, furniture, placed lights, room photos, and scenes.

Every length is in centimeters. Room outlines and positions inside a room are relative to the
room's own origin; a room's x and y place that origin on the home floor plan.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from typing import Any

from .geometry import as_points, bounds, polygon_area, rectangle
from .units import UNIT_SYSTEMS

MAX_EXTENT_CM = 10000.0  # 100 m. Anything larger is a typo.
DEFAULT_ROOM_CM = (450.0, 300.0)
DEFAULT_CEILING_CM = 244.0  # 8 ft
EDGE_TOLERANCE_CM = 0.5

# (elevation, height) in cm for furniture kinds whose height matters for light and glare.
# Elevation is how far the piece's bottom sits off the floor.
FURNITURE_HEIGHTS: dict[str, tuple[float, float]] = {
    "desk": (0, 75),
    "desk-l": (0, 75),
    "desk-standing": (0, 110),
    "monitor-24": (75, 36),
    "monitor-27": (75, 40),
    "monitor-34": (75, 37),
    "tv": (60, 84),
    "pillar-round": (0, DEFAULT_CEILING_CM),
    "pillar-square": (0, DEFAULT_CEILING_CM),
    "bookshelf": (0, 180),
    "dresser": (0, 80),
    "nightstand": (0, 60),
    "rug": (0, 1),
    "bed-king": (0, 60),
    "bed-queen": (0, 60),
    "bed-full": (0, 60),
    "bed-twin": (0, 60),
    "counter": (0, 91),
    "island": (0, 91),
    "sofa": (0, 85),
    "sectional": (0, 85),
}
DEFAULT_FURNITURE_HEIGHT = (0.0, 75.0)

# Roles a user can pin on a light. Suggestions also use "behind" and "ambient" internally.
PINNABLE_ROLES = ("auto", "bias", "task", "view")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return round(number, 2) if math.isfinite(number) else default


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
    # Height of the light in cm, or None to work it out from the product (see placement.py).
    elevation: float | None = None
    # "auto" lets suggestions work the role out from where the light sits; the rest pin it.
    role: str = "auto"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LayoutLight:
        light_id = str(data["light_id"])
        length = data.get("length")
        elevation = data.get("elevation")
        if elevation in ("", "auto"):
            elevation = None
        if elevation is not None:
            elevation = _num(elevation)
            if not 0 <= elevation <= 1000:
                raise ValueError("A light's height must be between 0 and 10 m")
        role = str(data.get("role") or "auto")
        if role not in PINNABLE_ROLES:
            raise ValueError(f"A light's role must be one of {', '.join(PINNABLE_ROLES)}")
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
            elevation=elevation,
            role=role,
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
            "elevation": self.elevation,
            "role": self.role,
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
    elevation: float = 0.0
    height: float = 75.0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Furniture:
        width, depth = _num(data.get("width"), 60), _num(data.get("depth"), 60)
        if not (1 <= width <= 2000 and 1 <= depth <= 2000):
            raise ValueError("Furniture must be between 1 cm and 20 m on each side")
        shape = data.get("shape") or "rect"
        if shape not in FURNITURE_SHAPES:
            raise ValueError(f"Furniture shape must be one of {', '.join(FURNITURE_SHAPES)}")
        kind = str(data.get("kind") or "custom")[:40]
        default_elevation, default_height = FURNITURE_HEIGHTS.get(kind, DEFAULT_FURNITURE_HEIGHT)
        elevation = _num(data.get("elevation"), default_elevation) if data.get("elevation") is not None else default_elevation
        height = _num(data.get("height"), default_height) if data.get("height") is not None else default_height
        if not (0 <= elevation <= 1000 and 0 < height <= 1000):
            raise ValueError("Furniture elevation and height must be between 0 and 10 m")
        return cls(
            id=str(data.get("id") or new_id()),
            kind=kind,
            label=str(data.get("label") or data.get("kind") or "Furniture")[:80],
            x=_clamp_extent(_num(data.get("x")), "Furniture"),
            y=_clamp_extent(_num(data.get("y")), "Furniture"),
            width=width,
            depth=depth,
            rotation=_num(data.get("rotation")) % 360,
            shape=shape,
            elevation=float(elevation),
            height=float(height),
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


OPENING_KINDS = ("door", "window")


def edge_length(outline: list[list[float]], index: int) -> float:
    a = outline[index]
    b = outline[(index + 1) % len(outline)]
    return math.hypot(b[0] - a[0], b[1] - a[1])


@dataclass
class Opening:
    """A door or window in a room's wall. It sits on outline edge `edge` (from corner `edge`
    to the next), starting `offset` cm along it, `width` cm wide. Windows have a sill and a
    top height off the floor; doors only a top."""

    id: str
    kind: str
    edge: int
    offset: float
    width: float
    sill: float | None = None
    top: float | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Opening:
        kind = data.get("kind")
        if kind not in OPENING_KINDS:
            raise ValueError(f"An opening must be one of {', '.join(OPENING_KINDS)}")
        try:
            edge = int(data.get("edge"))
        except (TypeError, ValueError):
            raise ValueError("An opening needs the index of its wall edge") from None
        offset, width = _num(data.get("offset")), _num(data.get("width"))
        if edge < 0 or offset < 0 or not (1 <= width <= 2000):
            raise ValueError("An opening needs an edge, an offset of 0 or more, and a width from 1 cm to 20 m")
        top = _num(data.get("top"), 0) if data.get("top") is not None else None
        sill = None
        if kind == "window":
            sill = _num(data.get("sill"), 0) if data.get("sill") is not None else 90.0
            top = top if top is not None else 210.0
            if not (0 <= sill < top <= 1000):
                raise ValueError("A window's sill must be below its top")
        elif top is not None and not (0 < top <= 1000):
            raise ValueError("A door's top must be between 0 and 10 m")
        return cls(str(data.get("id") or new_id()), kind, edge, offset, width, sill, top)

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


OPENING_FOLLOW_CM = 30.0  # how far a wall may move and still keep its doors and windows


def reanchor_openings(old: list[list[float]], new: list[list[float]], openings: list[Opening]) -> list[Opening]:
    """Move each opening onto the wall of `new` nearest to where it sat on `old`, so a
    reshaped or re-traced room keeps its doors and windows on the same walls. Openings
    whose wall moved away or became too short are dropped."""
    from .geometry import distance_to_segment

    kept = []
    for opening in openings:
        if opening.edge >= len(old):
            continue
        a, b = old[opening.edge], old[(opening.edge + 1) % len(old)]
        length = edge_length(old, opening.edge) or 1.0
        along = opening.offset + opening.width / 2
        mid = (a[0] + (b[0] - a[0]) * along / length, a[1] + (b[1] - a[1]) * along / length)
        best = None
        for index, p in enumerate(new):
            q = new[(index + 1) % len(new)]
            distance = distance_to_segment(mid, (p[0], p[1]), (q[0], q[1]))
            if distance <= OPENING_FOLLOW_CM and (best is None or distance < best[0]):
                best = (distance, index, p, q)
        if best is None:
            continue
        _, index, p, q = best
        wall = edge_length(new, index)
        if opening.width > wall + EDGE_TOLERANCE_CM:
            continue
        position = ((mid[0] - p[0]) * (q[0] - p[0]) + (mid[1] - p[1]) * (q[1] - p[1])) / (wall or 1.0)
        offset = min(max(position - opening.width / 2, 0.0), max(wall - opening.width, 0.0))
        kept.append(Opening(opening.id, opening.kind, index, round(offset, 2), opening.width, opening.sill, opening.top))
    return kept


def opening_fits(outline: list[list[float]], opening: Opening) -> bool:
    if opening.edge >= len(outline):
        return False
    return opening.offset + opening.width <= edge_length(outline, opening.edge) + EDGE_TOLERANCE_CM


@dataclass
class HomePlan:
    """A floor-plan image under the home. A pixel (px, py) of the stored image lands at
    offset + rotate(rotation) * (px, py) * cm_per_px on the home plan."""

    file: str
    cm_per_px: float = 1.0
    offset: list[float] = field(default_factory=lambda: [0.0, 0.0])
    rotation: float = 0.0
    opacity: float = 0.5
    width: int = 0
    height: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> HomePlan | None:
        if not data or not data.get("file"):
            return None
        try:
            scale = float(data.get("cm_per_px", 1.0))
        except (TypeError, ValueError):
            raise ValueError("cm_per_px must be a number") from None
        if not (0 < scale <= 100) or math.isnan(scale):
            raise ValueError("cm_per_px must be above 0 and at most 100")
        raw_offset = data.get("offset") or [0, 0]
        offset = [_clamp_extent(_num(raw_offset[0]), "The plan"), _clamp_extent(_num(raw_offset[1]), "The plan")]
        return cls(
            file=str(data["file"]),
            cm_per_px=round(scale, 6),
            offset=offset,
            rotation=_num(data.get("rotation")) % 360,
            opacity=min(1.0, max(0.0, _num(data.get("opacity"), 0.5))),
            width=int(data.get("width") or 0),
            height=int(data.get("height") or 0),
        )

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


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
    ceiling: float = DEFAULT_CEILING_CM
    openings: list[Opening] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Room:
        outline = data.get("outline")
        if not outline:
            outline = [list(p) for p in rectangle(_num(data.get("width"), 450), _num(data.get("height"), 300))]
        units = data.get("units") if data.get("units") in UNIT_SYSTEMS else "imperial"
        outline = validate_outline(outline)
        ceiling = _num(data.get("ceiling"), DEFAULT_CEILING_CM) if data.get("ceiling") is not None else DEFAULT_CEILING_CM
        if not (150 <= ceiling <= 1000):
            raise ValueError("A ceiling must be between 1.5 m and 10 m high")
        openings = [Opening.from_dict(item) for item in data.get("openings") or []][:100]
        for opening in openings:
            if not opening_fits(outline, opening):
                raise ValueError(f"The {opening.kind} on edge {opening.edge} does not fit on that wall")
        return cls(
            name=data["name"],
            outline=outline,
            x=_num(data.get("x")),
            y=_num(data.get("y")),
            units=units,
            lights=[LayoutLight.from_dict(light) for light in data.get("lights", [])],
            furniture=[Furniture.from_dict(item) for item in data.get("furniture", [])],
            photo=RoomPhoto.from_dict(data.get("photo")),
            ceiling=ceiling,
            openings=openings,
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
            "ceiling": self.ceiling,
            "openings": [opening.to_dict() for opening in self.openings],
        }
