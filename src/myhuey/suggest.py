"""Suggested scenes: a mode, a palette, the clock, and the room's layout make one ordinary scene.

Each light gets a per-light override from its role (see roles.py). Lights near the eyes and
the screen stay near white, at the time-of-day temperature; the palette's color goes to the
rest of the room, stronger the farther a light is from the seat. The result is a snapshot: an
unsaved `Scene` the user previews, tweaks, and saves like any other.
"""

from __future__ import annotations

import math
import random
from datetime import datetime
from typing import Any

from .color import color_temperature_to_rgb, rgb_to_hex
from .catalog import color_of
from .curve import baseline, minutes_until_bed
from .models import LayoutLight, Room, new_id
from .modes import Mode, get_mode
from .palettes import Palette, by_id, lab, load, mix
from .roles import Focus, find_focus, resolve_roles
from .scenes import MAX_GRADIENT_POINTS, WHITE_RANGE, Scene, placed_profile

NIGHT_WINDOW_MIN = 180  # no blue-heavy palettes from this long before bed until wake
NIGHT_TASK_KELVIN = 2700  # in the night window the task light drops the mode's floor to this
BIAS_RANGE = (10.0, 20.0)
BIAS_SHARE = 0.2
VIEW_COLOR, VIEW_LEVEL = 0.25, 0.5
BEHIND_COLOR, BEHIND_LEVEL = 0.1, 0.4
LOST_BIAS_COLOR, LOST_BIAS_LEVEL = 0.25, 0.3  # a pinned role with nothing to serve: dim, low-color ambient
FAR_CM = 300.0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _night(at: datetime, wake: str, bed: str) -> bool:
    """From NIGHT_WINDOW_MIN before bedtime until wake time."""
    return (minutes_until_bed(at.time(), wake, bed) or 0) <= NIGHT_WINDOW_MIN


def _choose(mode: Mode, at: datetime, wake: str, bed: str, palette_id: str | None, count: int, seed: int) -> list[Palette]:
    if palette_id:  # one palette, shown in up to as many rotations as it has colors
        palette = by_id(palette_id)
        return [palette] * min(count, len(palette.colors))
    night = _night(at, wake, bed)
    pool = [palette for palette in load() if not (night and "blue_heavy" in palette.tags)]
    # Every palette that shares a tag with the mode can come up, weighted by how many it
    # shares (a seeded weighted draw without replacement), so Shuffle reaches the whole library.
    rng = random.Random(seed)
    fits = [(len(set(mode.prefers) & set(palette.tags)), palette) for palette in pool]
    keyed = [(rng.random() ** (1 / overlap), palette) for overlap, palette in fits if overlap]
    picked = [palette for _, palette in sorted(keyed, key=lambda item: item[0], reverse=True)[:count]]
    if len(picked) < count:  # too few fitting palettes: fill from the rest
        rest = [palette for overlap, palette in fits if not overlap]
        picked += rng.sample(rest, min(count - len(picked), len(rest)))
    return picked


def _order(colors: list[str], seed: int) -> list[str]:
    ordered = sorted(colors, key=lambda color: lab(color)[0])
    shift = seed % len(ordered)
    return ordered[shift:] + ordered[:shift]


def _around(lights: list[LayoutLight], center: tuple[float, float]) -> list[LayoutLight]:
    return sorted(lights, key=lambda light: (math.atan2(light.y - center[1], light.x - center[0]), light.light_id))


def _center(room: Room, focus: Focus | None) -> tuple[float, float]:
    if focus:
        return focus.seat
    if room.outline:
        return (sum(p[0] for p in room.outline) / len(room.outline), sum(p[1] for p in room.outline) / len(room.outline))
    return (0.0, 0.0)


def suggest(
    room: Room,
    mode: str,
    *,
    at: datetime,
    wake: str,
    bed: str,
    palette_id: str | None = None,
    count: int = 4,
    seed: int = 0,
) -> list[dict[str, Any]]:
    """`count` suggestions: {"scene": unsaved Scene, "palette": dict, "roles": {id: role}, "white": hex}."""
    chosen_mode = get_mode(mode)
    kelvin, level = baseline(at.time(), wake, bed)
    kelvin = int(_clamp(kelvin + chosen_mode.kelvin_offset, *WHITE_RANGE))
    level = _clamp(level * chosen_mode.brightness, 1, 100)
    white = rgb_to_hex(color_temperature_to_rgb(kelvin))
    focus = find_focus(room, chosen_mode.focus)
    roles = resolve_roles(room, focus)
    center = _center(room, focus)
    stamp = at.strftime("%H:%M")
    # The task floor (read's 4000 K) holds only outside the night window; near bed it stays warm.
    floor = chosen_mode.task_min_kelvin
    if floor and _night(at, wake, bed):
        floor = min(floor, NIGHT_TASK_KELVIN)
    task_kelvin = max(kelvin, floor)

    results = []
    for index, palette in enumerate(_choose(chosen_mode, at, wake, bed, palette_id, count, seed)):
        colors = _order(palette.colors, seed + index)
        overrides = _overrides(room, chosen_mode, roles, focus, center, colors, kelvin, task_kelvin, level, white)
        scene = Scene(
            id=new_id(), name=f"{chosen_mode.title} · {palette.name}", room=room.name, overrides=overrides,
            origin={"mode": chosen_mode.name, "palette_id": palette.id, "palette_name": palette.name, "at": stamp},
        )
        results.append({"scene": scene, "palette": palette.to_dict(), "roles": roles, "white": white, "kelvin": kelvin})
    return results


def _overrides(
    room: Room, mode: Mode, roles: dict[str, str], focus: Focus | None, center: tuple[float, float],
    colors: list[str], kelvin: int, task_kelvin: int, level: float, white: str,
) -> dict[str, dict[str, Any]]:
    overrides: dict[str, dict[str, Any]] = {}
    strength = mode.color_strength
    has_screen = bool(focus and focus.screen)
    colored = 0  # the next palette color to hand out, going around the room
    for light in _around(room.lights, center):
        role = roles[light.light_id]
        # A pinned task or view light when the mode finds no seat, or a pinned bias light with no
        # screen, has nothing to serve: it falls back to dim, low-color ambient (and keeps its pin).
        if (role in ("task", "view") and focus is None) or (role == "bias" and not has_screen):
            share, brightness = LOST_BIAS_COLOR * strength, level * LOST_BIAS_LEVEL
        elif role == "task":
            overrides[light.light_id] = {
                "white": task_kelvin, "brightness": round(_clamp(level * mode.task_brightness, 1, 100), 1),
            }
            continue
        elif role == "bias":
            if mode.bias:
                overrides[light.light_id] = {"white": kelvin, "brightness": round(_clamp(level * BIAS_SHARE, *BIAS_RANGE), 1)}
            else:
                overrides[light.light_id] = {"on": False}
            continue
        elif role == "view":
            share, brightness = (0.0 if mode.ambient_only else VIEW_COLOR * strength), level * VIEW_LEVEL
        elif role == "behind":
            share, brightness = (0.0 if mode.ambient_only else BEHIND_COLOR * strength), level * BEHIND_LEVEL
        else:
            distance = math.hypot(light.x - center[0], light.y - center[1])
            share, brightness = strength * _clamp(distance / FAR_CM, 0.5, 1.0), level
        brightness = round(_clamp(brightness, 1, 100), 1)
        if share <= 0 or color_of(light.product) == "white":  # white-only planned lights can't show color
            overrides[light.light_id] = {"white": kelvin, "brightness": brightness}
            continue
        profile = placed_profile(light)
        # Only ambient gradient lights spread the palette along their length; treated lights get one color.
        points = min(MAX_GRADIENT_POINTS, max(2, len(colors))) if profile.gradient and role == "ambient" else 1
        picked = [colors[(colored + step) % len(colors)] for step in range(points)]
        colored += 1
        override: dict[str, Any] = {"colors": [mix(color, white, share) for color in picked], "brightness": brightness}
        if points > 1:
            override["mode"] = "interpolated_palette"
        overrides[light.light_id] = override
    return overrides
