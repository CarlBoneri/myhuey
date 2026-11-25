"""A room as text: a scaled drawing an assistant can read, and a list of layout problems.

Pure functions over the Room model. Plan coordinates are centimetres, x right, y down.
"""

from __future__ import annotations

import math
import string
from typing import Any

from .geometry import as_points, bounds, distance_to_polygon, point_in_polygon
from .models import Furniture, Room
from .placement import UNKNOWN_CM, _CEILING, _FLOOR, _PENDANT, _STRIP, _TABLE, covers, footprint, resolved_elevation
from .roles import DESKS, MONITOR_PREFIX, _front, find_focus

CELLS = (5, 10, 20, 25, 50, 100)
MAX_COLUMNS = 72
OUTSIDE_TOLERANCE_CM = 2.0
SEAT_FROM_SCREEN_CM = 60.0
_KNOWN_ARCHETYPES = _CEILING | _PENDANT | _FLOOR | _TABLE | _STRIP
_SIDES = {(0, -1): "north", (0, 1): "south", (1, 0): "east", (-1, 0): "west"}


def _number(value: float) -> str:
    return f"{value:g}"


def _mark(index: int, letters: str) -> str:
    return letters[index % len(letters)]


def _cell_for(width: float) -> float:
    for cell in CELLS:
        if math.ceil(width / cell) <= MAX_COLUMNS:
            return float(cell)
    return float(CELLS[-1])


def _solid(room: Room) -> list[Furniture]:
    return [item for item in room.furniture if item.kind != "rug"]


def _top(item: Furniture) -> float:
    return item.elevation + item.height


def draw_room(room: Room, cell: float | None = None) -> dict[str, Any]:
    """The room as rows of characters. A column is `cell` cm wide and a row `2 * cell` tall.
    Where pieces stack (a monitor on a desk) the one standing highest is the one shown."""
    outline = as_points(room.outline)
    min_x, min_y, max_x, max_y = bounds(outline)
    cell = float(cell) if cell else _cell_for(max_x - min_x)
    row_cm = 2 * cell
    columns, rows = math.ceil((max_x - min_x) / cell), math.ceil((max_y - min_y) / row_cm)

    marks = {item.id: _mark(index, string.ascii_uppercase) for index, item in enumerate(_solid(room))}
    light_cells = {}
    for index, light in enumerate(room.lights):
        row = min(max(int((light.y - min_y) // row_cm), 0), rows - 1)
        column = min(max(int((light.x - min_x) // cell), 0), columns - 1)
        light_cells[(row, column)] = _mark(index, string.ascii_lowercase)

    lines = []
    for row in range(rows):
        y = min_y + (row + 0.5) * row_cm
        line = []
        for column in range(columns):
            x = min_x + (column + 0.5) * cell
            if (row, column) in light_cells:
                line.append(light_cells[(row, column)])
            elif not point_in_polygon((x, y), outline):
                line.append(" ")
            else:
                over = [item for item in _solid(room) if covers(item, x, y)]
                line.append(marks[max(over, key=_top).id] if over else ".")
        lines.append("".join(line).rstrip())

    legend = [{"mark": marks[item.id], "what": item.kind, "name": item.label, "x": item.x, "y": item.y} for item in _solid(room)]
    legend += [{"mark": _mark(index, string.ascii_lowercase), "what": "light", "name": light.label, "x": light.x, "y": light.y}
               for index, light in enumerate(room.lights)]
    return {
        "drawing": "\n".join(lines),
        "cm_per_column": cell,
        "cm_per_row": row_cm,
        "legend": legend,
        "openings": [_opening_sentence(room, opening) for opening in room.openings],
    }


def _outward_side(outline: list[tuple[float, float]], edge: int) -> str:
    (ax, ay), (bx, by) = outline[edge % len(outline)], outline[(edge + 1) % len(outline)]
    area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(outline, outline[1:] + outline[:1]))
    dx, dy = bx - ax, by - ay
    nx, ny = (dy, -dx) if area >= 0 else (-dy, dx)
    if abs(nx) >= abs(ny):
        return _SIDES[(1 if nx > 0 else -1, 0)]
    return _SIDES[(0, 1 if ny > 0 else -1)]


def _opening_sentence(room: Room, opening) -> str:
    side = _outward_side(as_points(room.outline), opening.edge)
    text = f"{opening.kind.capitalize()} on wall {opening.edge} ({side} side), {_number(opening.offset)} cm from its start, {_number(opening.width)} cm wide"
    if opening.sill is not None:
        text += f", sill {_number(opening.sill)} cm"
    if opening.top is not None:
        text += f", top {_number(opening.top)} cm"
    return text


def _corners(item: Furniture) -> list[tuple[float, float]]:
    cx, cy, width, depth = footprint(item)
    angle = math.radians(item.rotation)
    cos, sin = math.cos(angle), math.sin(angle)
    return [(cx + lx * cos - ly * sin, cy + lx * sin + ly * cos)
            for lx, ly in ((-width / 2, -depth / 2), (width / 2, -depth / 2),
                           (width / 2, depth / 2), (-width / 2, depth / 2))]


def _outside(point: tuple[float, float], outline: list[tuple[float, float]]) -> bool:
    return not point_in_polygon(point, outline) and distance_to_polygon(point, outline) > OUTSIDE_TOLERANCE_CM


def layout_problems(room: Room) -> list[dict[str, Any]]:
    """What is wrong with the layout, each as {kind, item, message}. An empty list is a sound room."""
    outline = as_points(room.outline)
    problems: list[dict[str, Any]] = []

    def report(kind: str, item: str | None, message: str) -> None:
        problems.append({"kind": kind, "item": item, "message": message})

    for light in room.lights:
        if _outside((light.x, light.y), outline):
            report("outside", light.light_id, f"Light {light.label} is outside the room outline.")
    for item in room.furniture:
        if any(_outside(point, outline) for point in [(item.x, item.y), *_corners(item)]):
            report("outside", item.id, f"{item.label} sticks out of the room outline.")

    solid = _solid(room)
    for index, first in enumerate(solid):
        for second in solid[index + 1:]:
            if first.elevation >= _top(second) or second.elevation >= _top(first):
                continue
            if any(covers(first, *point) for point in [(second.x, second.y), *_corners(second)]) or \
               any(covers(second, *point) for point in [(first.x, first.y), *_corners(first)]):
                report("overlap", first.id, f"{first.label} and {second.label} overlap.")

    desks = [item for item in room.furniture if item.kind in DESKS]
    for item in room.furniture:
        is_monitor = item.kind.startswith(MONITOR_PREFIX)
        if (is_monitor or (item.kind == "tv" and desks)) and not any(covers(desk, item.x, item.y) for desk in desks):
            report("screen_off_desk", item.id, f"{item.label} is not on a desk.")
        if is_monitor:
            front = _front(item)
            seat = (item.x + front[0] * SEAT_FROM_SCREEN_CM, item.y + front[1] * SEAT_FROM_SCREEN_CM)
            if not point_in_polygon(seat, outline):
                report("screen_faces_wall", item.id, f"Where someone would sit to use {item.label} is outside the room: it faces a wall.")

    if find_focus(room, "desk") is None:
        report("no_seat", None, "There is no desk or monitor, so no seat to light for.")

    for light in room.lights:
        archetype = str((light.product or {}).get("archetype") or "").lower()
        if light.elevation is None and resolved_elevation(light, room) == UNKNOWN_CM and archetype not in _KNOWN_ARCHETYPES:
            report("height_unknown", light.light_id, f"Light {light.label} has no height and its product gives no default. Set its elevation.")
    return problems
