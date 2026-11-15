"""Scenes painted onto a room: color zones, an optional image laid over the floor, and a base.

Each placed light reads its color where it sits. Lights with a gradient read several points
along their length, start to end. Layers are checked top-down: zones (last drawn on top),
then the image, then the base.
"""

from __future__ import annotations

import math
import re

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from .color import color_temperature_to_rgb, hex_to_rgb, rgb_to_hex, rgb_to_xy
from .geometry import Point, as_points, distance_to_polygon, point_in_polygon, sample_along
from .models import LayoutLight, Room, new_id
from .shapes import LightProfile, light_profile

BASE_MODES = ("off", "keep", "color", "nearest")
MAX_GRADIENT_POINTS = 5


def _brightness(value: Any, default: float = 100.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return round(min(100.0, max(0.0, number)), 1)


def _color(value: Any) -> str:
    return rgb_to_hex(hex_to_rgb(str(value)))


WHITE_RANGE = (2000, 6500)  # kelvin a white override may ask for
GRADIENT_MODES = ("interpolated_palette", "interpolated_palette_mirrored", "segmented_palette", "random_pixelated")
_EFFECT_NAME = re.compile(r"^[a-z_]{1,40}$")


def _overrides(raw: Any) -> dict[str, dict[str, Any]]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("overrides must map light IDs to settings")
    return {str(light_id): _override(value) for light_id, value in raw.items()}


def _override(data: Any) -> dict[str, Any]:
    """One light's override, checked strictly: it is sent to the bridge as given."""
    if not isinstance(data, dict):
        raise ValueError("A light override must be an object")
    clean: dict[str, Any] = {}
    if data.get("colors"):
        if not isinstance(data["colors"], list):
            raise ValueError("An override's colors must be a list")
        colors = [_color(value) for value in data["colors"]]
        if not 1 <= len(colors) <= MAX_GRADIENT_POINTS:
            raise ValueError(f"An override takes 1 to {MAX_GRADIENT_POINTS} colors")
        clean["colors"] = colors
    if data.get("mode"):
        if data["mode"] not in GRADIENT_MODES:
            raise ValueError(f"mode must be one of {', '.join(GRADIENT_MODES)}")
        clean["mode"] = data["mode"]
    if data.get("effect"):
        if not isinstance(data["effect"], str) or not _EFFECT_NAME.match(data["effect"]):
            raise ValueError("effect must be an effect name such as candle or no_effect")
        clean["effect"] = data["effect"]
    if data.get("white") is not None:
        white = data["white"]
        if isinstance(white, bool) or not isinstance(white, (int, float)) or not WHITE_RANGE[0] <= white <= WHITE_RANGE[1]:
            raise ValueError(f"An override's white must be {WHITE_RANGE[0]} to {WHITE_RANGE[1]} kelvin")
        clean["white"] = int(round(white))
    if data.get("brightness") is not None:
        if isinstance(data["brightness"], bool) or not isinstance(data["brightness"], (int, float)):
            raise ValueError("An override's brightness must be a number from 0 to 100")
        clean["brightness"] = _brightness(data["brightness"])
    if data.get("on") is not None:
        if not isinstance(data["on"], bool):
            raise ValueError("An override's on must be true or false")
        clean["on"] = data["on"]
    return clean


_ORIGIN_KEYS = ("mode", "palette_id", "palette_name", "at")


def _origin(raw: Any) -> dict[str, str] | None:
    if not raw:
        return None
    if not isinstance(raw, dict):
        raise ValueError("A scene's origin must be an object")
    return {key: str(raw[key])[:80] for key in _ORIGIN_KEYS if raw.get(key) is not None}


@dataclass
class Zone:
    id: str
    points: list[list[float]]
    color: str
    brightness: float = 100.0
    name: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Zone:
        points = data.get("points") or []
        if len(points) < 3:
            raise ValueError("A zone needs at least three points")
        if len(points) > 400:
            raise ValueError("A zone can have at most 400 points")
        return cls(
            id=str(data.get("id") or new_id()),
            points=[[round(float(x), 2), round(float(y), 2)] for x, y in points],
            color=_color(data.get("color", "#ffffff")),
            brightness=_brightness(data.get("brightness")),
            name=str(data.get("name") or "")[:60],
        )

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class ImageLayer:
    """An uploaded image stretched over a rectangle of the room (cm), turned `rotation`
    degrees clockwise around that rectangle's center."""

    file: str
    x: float
    y: float
    width: float
    height: float
    opacity: float = 0.8
    brightness: float = 100.0
    brightness_from_image: bool = True
    mood: str = "colorful"
    picks: list[dict[str, Any]] = field(default_factory=list)  # theme swatches: color and x, y (0-1)
    rotation: float = 0.0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> ImageLayer | None:
        if not data or not data.get("file"):
            return None
        width, height = float(data.get("width", 0)), float(data.get("height", 0))
        if width <= 0 or height <= 0:
            raise ValueError("An image layer needs a size")
        return cls(
            file=str(data["file"]),
            x=round(float(data.get("x", 0)), 2),
            y=round(float(data.get("y", 0)), 2),
            width=round(width, 2),
            height=round(height, 2),
            opacity=min(1.0, max(0.0, float(data.get("opacity", 0.8)))),
            brightness=_brightness(data.get("brightness")),
            brightness_from_image=bool(data.get("brightness_from_image", True)),
            mood=str(data.get("mood") or "colorful")[:20],
            rotation=round(float(data.get("rotation") or 0), 2) % 360,
            picks=[
                {
                    "color": _color(item.get("color", "#ffffff")),
                    "x": min(1.0, max(0.0, float(item.get("x", 0.5)))),
                    "y": min(1.0, max(0.0, float(item.get("y", 0.5)))),
                }
                for item in (data.get("picks") or [])[:10]
            ],
        )

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class Scene:
    id: str
    name: str
    room: str
    zones: list[Zone] = field(default_factory=list)
    image: ImageLayer | None = None
    base_mode: str = "off"
    base_color: str = "#ffffff"
    base_brightness: float = 50.0
    palette: list[str] = field(default_factory=list)
    updated_at: str = ""
    # Per-light settings that replace what the zones give: colors (2-5, start to end), mode,
    # effect, white (kelvin), brightness (0-100), on. Any of them may be left out.
    overrides: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Where a suggested scene came from: mode, palette_id, palette_name, at. None for others.
    origin: dict[str, str] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Scene:
        name = str(data.get("name") or "").strip()
        if not name:
            raise ValueError("A scene needs a name")
        room = str(data.get("room") or "").strip()
        if not room:
            raise ValueError("A scene belongs to a room")
        base_mode = data.get("base_mode") or "off"
        if base_mode not in BASE_MODES:
            raise ValueError(f"base_mode must be one of {', '.join(BASE_MODES)}")
        return cls(
            id=str(data.get("id") or new_id()),
            name=name[:80],
            room=room,
            zones=[Zone.from_dict(zone) for zone in data.get("zones") or []][:100],
            image=ImageLayer.from_dict(data.get("image")),
            base_mode=base_mode,
            base_color=_color(data.get("base_color", "#ffffff")),
            base_brightness=_brightness(data.get("base_brightness"), 50.0),
            palette=[_color(item) for item in (data.get("palette") or [])][:16],
            updated_at=str(data.get("updated_at") or ""),
            overrides=_overrides(data.get("overrides")),
            origin=_origin(data.get("origin")),
        )

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "room": self.room,
            "zones": [zone.to_dict() for zone in self.zones],
            "image": self.image.to_dict() if self.image else None,
            "base_mode": self.base_mode,
            "base_color": self.base_color,
            "base_brightness": self.base_brightness,
            "palette": self.palette,
            "updated_at": self.updated_at,
            "overrides": self.overrides,
            "origin": self.origin,
        }


# Evaluation

Sample = tuple[str, float]  # (hex color, brightness 0-100)
ImageLookup = Callable[[float, float], tuple[int, int, int] | None]


def placed_profile(light: LayoutLight) -> LightProfile:
    """The physical profile of a placed light, from what the bridge reported when it was saved."""
    product = light.product or {}
    return light_profile(product.get("archetype"), product.get("productname"), product.get("modelid"))


def light_length(light: LayoutLight, profile: LightProfile) -> float:
    return light.length if (light.length and profile.adjustable) else profile.length


def sample_points(light: LayoutLight, profile: LightProfile, gradient_points: int) -> list[Point]:
    """Where a light reads its color: its center, or `gradient_points` spots along its length."""
    center = (light.x, light.y)
    if not profile.linear or gradient_points < 2:
        return [center]
    return sample_along(center, light.rotation, light_length(light, profile), gradient_points)


def _image_sample(layer: ImageLayer, lookup: ImageLookup, point: Point) -> Sample | None:
    # Undo the layer's rotation: turn the point back around the image center.
    cx, cy = layer.x + layer.width / 2, layer.y + layer.height / 2
    angle = math.radians(-layer.rotation)
    dx, dy = point[0] - cx, point[1] - cy
    local_x = dx * math.cos(angle) - dy * math.sin(angle)
    local_y = dx * math.sin(angle) + dy * math.cos(angle)
    u = (local_x + layer.width / 2) / layer.width
    v = (local_y + layer.height / 2) / layer.height
    rgb = lookup(u, v)
    if rgb is None:
        return None
    brightness = layer.brightness
    if layer.brightness_from_image:
        brightness = round(layer.brightness * max(rgb) / 255, 1)
    return rgb_to_hex(rgb), brightness


def color_at(scene: Scene, point: Point, image_lookup: ImageLookup | None = None) -> Sample | None:
    """The color and brightness a light at `point` takes, or None to leave it off.

    Zones drawn later sit on top. Points outside every zone and the image get the base:
    off, a fixed color, or (`nearest`) the closest zone's color.
    """
    for zone in reversed(scene.zones):
        if point_in_polygon(point, as_points(zone.points)):
            return zone.color, zone.brightness
    if scene.image and image_lookup:
        found = _image_sample(scene.image, image_lookup, point)
        if found:
            return found
    if scene.base_mode == "color":
        return scene.base_color, scene.base_brightness
    if scene.base_mode == "nearest" and scene.zones:
        nearest = min(scene.zones, key=lambda zone: distance_to_polygon(point, as_points(zone.points)))
        return nearest.color, nearest.brightness
    return None


def evaluate(
    scene: Scene,
    room: Room,
    *,
    image_lookup: ImageLookup | None = None,
    gradient_points: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """What every placed light in the room shows for this scene.

    `gradient_points` maps light IDs to how many gradient points the bridge reports for them.
    Without it, the light's product decides (5 points for gradient products, 1 otherwise).
    A result with `keep` true is not changed when the scene is applied.
    """
    results = []
    for light in room.lights:
        profile = placed_profile(light)
        points = (gradient_points or {}).get(light.light_id)
        if points is None:
            points = MAX_GRADIENT_POINTS if profile.gradient else 1
        points = max(1, min(MAX_GRADIENT_POINTS, points))
        samples = [color_at(scene, point, image_lookup) for point in sample_points(light, profile, points)]
        lit = [sample for sample in samples if sample and sample[1] > 0]

        result: dict[str, Any] = {
            "light_id": light.light_id, "label": light.label, "keep": False,
            "mode": None, "effect": None, "override": False, "color_temp": None,
        }
        if not lit:
            keep = scene.base_mode == "keep" and all(sample is None for sample in samples)
            result.update(on=False, keep=keep, color=None, xy=None, brightness=0, gradient=None)
        else:
            center = lit[len(lit) // 2]
            brightness = round(sum(sample[1] for sample in lit) / len(lit), 1)
            # Gradient points that fall in the dark take the neighboring lit color.
            gradient = None
            if len(samples) > 1:
                filled = [sample[0] if sample else None for sample in samples]
                last = lit[0][0]
                for index, value in enumerate(filled):
                    filled[index] = last = value or last
                gradient = filled if len(set(filled)) > 1 else None
            result.update(
                on=True,
                color=center[0],
                xy=list(rgb_to_xy(hex_to_rgb(center[0]))),
                brightness=brightness,
                gradient=gradient,
            )
        override = scene.overrides.get(light.light_id)
        if override:
            _apply_override(result, override, gradient_capable=points >= 2)
        results.append(result)
    return results


def _apply_override(result: dict[str, Any], override: dict[str, Any], gradient_capable: bool) -> None:
    """Lay a per-light override over what the zones gave this light."""
    result["override"] = True
    result["keep"] = False
    white = override.get("white")
    if white and not override.get("colors"):
        rgb = color_temperature_to_rgb(white)
        result.update(on=True, color_temp=white, color=rgb_to_hex(rgb), xy=list(rgb_to_xy(rgb)), gradient=None)
        if not result["brightness"]:
            result["brightness"] = 100.0
    colors = override.get("colors")
    if colors:
        result["on"] = True
        result["color"] = colors[0]
        result["xy"] = list(rgb_to_xy(hex_to_rgb(colors[0])))
        result["gradient"] = colors if gradient_capable and len(colors) > 1 else None
        if not result["brightness"]:
            result["brightness"] = 100.0
    for key in ("mode", "effect"):
        if override.get(key):
            result[key] = override[key]
            result["on"] = True if result["color"] else result["on"]
    if "brightness" in override:
        result["brightness"] = override["brightness"]
    if "on" in override:
        result["on"] = override["on"]
