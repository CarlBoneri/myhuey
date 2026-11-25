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
    "monitor-49": (75, 33.7),
    "laptop": (75, 2),
    "keyboard": (75, 3),
    "speaker": (75, 20),
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

# Furniture the plan can place: kind -> (label, width, depth, shape) in cm. The same rows as
# FURNITURE_CATALOG in frontend/src/components/Shapes.tsx; a test keeps the two in step.
FURNITURE_SIZES: dict[str, tuple[str, float, float, str]] = {
    "sofa": ("Sofa", 213.0, 91.0, "rect"),
    "sectional": ("Sectional", 280.0, 180.0, "rect"),
    "armchair": ("Armchair", 85.0, 85.0, "rect"),
    "coffee-table": ("Coffee table", 120.0, 60.0, "rect"),
    "tv": ('TV 65"', 145.0, 8.0, "rect"),
    "tv-stand": ("TV stand", 180.0, 45.0, "rect"),
    "bed-king": ("King bed", 193.0, 203.0, "rect"),
    "bed-queen": ("Queen bed", 152.0, 203.0, "rect"),
    "bed-full": ("Full bed", 137.0, 191.0, "rect"),
    "bed-twin": ("Twin bed", 97.0, 191.0, "rect"),
    "nightstand": ("Nightstand", 50.0, 40.0, "rect"),
    "dresser": ("Dresser", 150.0, 50.0, "rect"),
    "desk": ("Desk", 140.0, 70.0, "rect"),
    "desk-l": ("L-desk", 160.0, 150.0, "rect"),
    "desk-standing": ("Standing desk", 140.0, 70.0, "rect"),
    "monitor-24": ('Monitor 24"', 54.0, 18.0, "rect"),
    "monitor-27": ('Monitor 27"', 61.0, 20.0, "rect"),
    "monitor-34": ('Ultrawide 34"', 81.0, 22.0, "rect"),
    "monitor-49": ('Super ultrawide 49"', 119.8, 12.0, "rect"),
    "chair": ("Chair", 50.0, 50.0, "rect"),
    "laptop": ("Laptop (closed)", 31.0, 22.0, "rect"),
    "keyboard": ("Keyboard", 44.0, 14.0, "rect"),
    "speaker": ("Speaker", 12.0, 15.0, "rect"),
    "dining-table": ("Dining table", 180.0, 90.0, "rect"),
    "round-table": ("Round table", 110.0, 110.0, "ellipse"),
    "bookshelf": ("Bookshelf", 90.0, 30.0, "rect"),
    "counter": ("Counter", 240.0, 64.0, "rect"),
    "island": ("Island", 180.0, 100.0, "rect"),
    "rug": ("Rug 8x10", 305.0, 244.0, "rect"),
    "plant": ("Plant", 45.0, 45.0, "ellipse"),
    "tree": ("Tree", 140.0, 140.0, "ellipse"),
    "bathtub": ("Bathtub", 152.0, 76.0, "rect"),
    "pillar-round": ("Round pillar", 30.0, 30.0, "ellipse"),
    "pillar-square": ("Square pillar", 30.0, 30.0, "rect"),
}

# Screens that come curved: kind -> curve radius in mm. The 49" matches the Samsung Odyssey G9.
DEFAULT_CURVES: dict[str, float] = {"monitor-49": 1000.0}

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
    # A light planned from the catalog that isn't installed yet: it takes part in roles and
    # suggestions, but nothing is ever sent to the bridge for it.
    planned: bool = False
    # The desk set this light belongs to (see desks.py), if any.
    set: str | None = None
    # {"screen": <furniture id>}: stuck on that screen's back, facing the wall behind it.
    mount: dict[str, str] | None = None

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
            planned=bool(data.get("planned", False)),
            set=_optional_text(data.get("set")),
            mount=_mount(data.get("mount")),
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
            "planned": self.planned,
            "set": self.set,
            "mount": dict(self.mount) if self.mount else None,
        }


FURNITURE_SHAPES = ("rect", "ellipse")
CURVE_RANGE_MM = (500.0, 10000.0)
TILT_LIMIT_DEG = 45.0


def _optional_text(value: Any) -> str | None:
    """An id that may be left out: None and blank stay None."""
    text = str(value or "").strip()[:40]
    return text or None


def _mount(value: Any) -> dict[str, str] | None:
    if value in (None, "", {}):
        return None
    screen = value.get("screen") if isinstance(value, dict) else None
    if not isinstance(screen, str) or not screen.strip() or set(value) != {"screen"}:
        raise ValueError("A mount names the screen it is on: {\"screen\": <furniture id>}")
    return {"screen": screen.strip()[:40]}


SEAT_RANGE_CM = (30.0, 90.0)


def _optional(value: Any) -> float | None:
    """A number that may be left out: None and "" stay None."""
    return None if value in (None, "") else _num(value)


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
    # A screen's curve radius in mm, as printed on the box (1000 = 1000R); None is flat.
    curve: float | None = None
    # How far a screen leans, in degrees; negative leans back. None is the default for the kind.
    tilt: float | None = None
    # The desk set this piece belongs to (see desks.py), if any.
    set: str | None = None
    # A chair's seat height in cm when this is where you sit; None for any other piece.
    seat: float | None = None

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
        curve = _optional(data.get("curve"))
        if curve is not None and not CURVE_RANGE_MM[0] <= curve <= CURVE_RANGE_MM[1]:
            raise ValueError("A screen's curve must be between 500R and 10000R")
        if curve is not None and height > width:
            raise ValueError("A portrait screen cannot be curved")
        seat = _optional(data.get("seat"))
        if seat is not None and not SEAT_RANGE_CM[0] <= seat <= SEAT_RANGE_CM[1]:
            raise ValueError("A chair's seat height must be between 30 and 90 cm")
        tilt = _optional(data.get("tilt"))
        if tilt is not None and not -TILT_LIMIT_DEG <= tilt <= TILT_LIMIT_DEG:
            raise ValueError("A screen's tilt must be between -45° and 45°")
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
            curve=curve,
            tilt=tilt,
            set=_optional_text(data.get("set")),
            seat=seat,
        )

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def _desk_sets(raw: Any) -> list[dict[str, str]]:
    entries = []
    for entry in raw or []:
        if not isinstance(entry, dict) or not entry.get("id") or not entry.get("base"):
            raise ValueError("A desk set needs an id and the id of its base piece")
        entries.append({"id": str(entry["id"])[:40], "name": str(entry.get("name") or "Desk")[:80], "base": str(entry["base"])[:40]})
    return entries[:50]


TAG_KINDS = ("light", "furniture", "opening")


def split_tag(key: str) -> tuple[str, str]:
    """A photo tag key such as "light:26" or "furniture:ab12" as (kind, id)."""
    kind, _, item_id = str(key).partition(":")
    if kind not in TAG_KINDS or not item_id:
        raise ValueError(f"A photo tag is kind:id with kind one of {', '.join(TAG_KINDS)}, not '{key}'")
    return kind, item_id


MIN_FLOOR_PHOTO_AREA = 0.01  # of the photo
MIN_FLOOR_PLAN_AREA = 2500.0  # cm², half a metre square


def floor_transform(photo: Any, plan: Any) -> dict[str, list[list[float]]]:
    """Four floor points on the photo (0-1 fractions) and the plan points (cm) they are."""
    try:
        photo_points = [[float(x), float(y)] for x, y in photo]
        plan_points = [[float(x), float(y)] for x, y in plan]
    except (TypeError, ValueError):
        raise ValueError("A floor mapping is four [x, y] points on the photo and four on the plan") from None
    if len(photo_points) != 4 or len(plan_points) != 4:
        raise ValueError("A floor mapping needs exactly four points on the photo and four on the plan")
    if not all(0 <= value <= 1 for point in photo_points for value in point):
        raise ValueError("Floor points on the photo are fractions of its width and height, 0 to 1")
    def turns(points: list[list[float]]) -> list[float]:
        return [
            (points[(i + 1) % 4][0] - points[i][0]) * (points[(i + 2) % 4][1] - points[(i + 1) % 4][1])
            - (points[(i + 1) % 4][1] - points[i][1]) * (points[(i + 2) % 4][0] - points[(i + 1) % 4][0])
            for i in range(4)
        ]

    def area(points: list[list[float]]) -> float:
        return abs(sum(points[i][0] * points[(i + 1) % 4][1] - points[(i + 1) % 4][0] * points[i][1] for i in range(4))) / 2

    photo_turns, plan_turns = turns(photo_points), turns(plan_points)
    for values in (photo_turns, plan_turns):
        if not (all(value > 0 for value in values) or all(value < 0 for value in values)):
            raise ValueError("Pick the four floor points in order around the floor (no crossing, no three in a line)")
    if (photo_turns[0] > 0) != (plan_turns[0] > 0):
        raise ValueError("The plan corners are in the opposite order to the photo points; match them going the same way around")
    if area(photo_points) < MIN_FLOOR_PHOTO_AREA or area(plan_points) < MIN_FLOOR_PLAN_AREA:
        raise ValueError("Spread the four floor points out: use corners far apart, such as the room's corners")
    return {"photo": [[round(x, 4), round(y, 4)] for x, y in photo_points], "plan": [[round(x, 1), round(y, 1)] for x, y in plan_points]}


@dataclass
class RoomPhoto:
    """A photo of the real room, stored under ~/.myhuey/uploads.

    Tags pin plan items where they appear in the photo: keys are "light:<id>",
    "furniture:<id>", or "opening:<id>", and positions are fractions of the photo's width and
    height (0 to 1), so they survive any display size. The photo never moves anything on the
    plan. `floor_transform` holds four floor points on the photo and the plan points they are.
    """

    file: str
    width: int
    height: int
    tags: dict[str, dict[str, float]] = field(default_factory=dict)
    floor_transform: Any = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> RoomPhoto | None:
        if not data or not data.get("file"):
            return None
        raw = data.get("tags")
        if raw is None:  # before schema v5: light placements keyed by light ID
            raw = {f"light:{light_id}": spot for light_id, spot in (data.get("placements") or {}).items()}
        tags = {}
        for key, spot in raw.items():
            try:
                split_tag(key)
            except ValueError:
                continue  # a malformed key never stops the room from loading; it is dropped on the next save
            tags[str(key)] = {
                "x": min(1.0, max(0.0, _num(spot.get("x"), 0.5))),
                "y": min(1.0, max(0.0, _num(spot.get("y"), 0.5))),
                "rotation": _num(spot.get("rotation")) % 360,
                "scale": min(10.0, max(0.1, _num(spot.get("scale"), 1.0))),
            }
        return cls(str(data["file"]), int(data.get("width", 0)), int(data.get("height", 0)), tags,
                   data.get("floor_transform"))

    def to_dict(self) -> dict[str, Any]:
        return {"file": self.file, "width": self.width, "height": self.height, "tags": self.tags,
                "floor_transform": self.floor_transform}


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
    # How solid room shapes are drawn over the image, so it shows through while tracing.
    room_opacity: float = 0.4

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
            room_opacity=min(1.0, max(0.0, _num(data.get("room_opacity"), 0.4))),
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
    # The id of the Hue room this room mirrors, once a refresh has linked them.
    hue_room: str | None = None
    # Desk sets placed here: {"id", "name", "base"}; members carry the id in their `set`.
    desk_sets: list[dict[str, str]] = field(default_factory=list)

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
            hue_room=str(data.get("hue_room") or "").strip() or None,
            desk_sets=_desk_sets(data.get("desk_sets")),
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

    def has_tag_target(self, key: str) -> bool:
        kind, item_id = split_tag(key)
        if kind == "light":
            return any(light.light_id == item_id for light in self.lights)
        if kind == "furniture":
            return any(item.id == item_id for item in self.furniture)
        return any(opening.id == item_id for opening in self.openings)

    def prune_photo_tags(self) -> None:
        """Drop photo tags whose light, furniture, or opening is no longer in the room."""
        if self.photo:
            self.photo.tags = {key: spot for key, spot in self.photo.tags.items() if self.has_tag_target(key)}

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
            "hue_room": self.hue_room,
            "desk_sets": [dict(entry) for entry in self.desk_sets],
        }
