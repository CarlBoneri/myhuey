"""Generated lighting setups: catalog lights proposed around where someone sits.

Each setup is made of building blocks placed relative to the desk focus (see roles.py): a
gradient strip just behind the monitor (bias), a floor lamp beside the seat, a desk lamp
beside the monitor, and a wall washer in a corner off to the side. Blocks never land in
the line of sight or behind the seat, where they would glare or reflect in the screen.
Each setup also reports what the suggester makes of it in each mode, so people can see the
scenes it enables before buying anything.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from .catalog import catalog_item
from .geometry import as_points, point_in_polygon
from .models import LayoutLight, Room
from .placement import resolved_elevation
from .roles import Focus, find_focus, resolve_roles
from .scenes import evaluate
from .suggest import suggest

Point = tuple[float, float]

BIAS_BEHIND_CM = 12.0
SIDE_OUT_CM = 90.0
SIDE_BACK_CM = 20.0
DESK_LAMP_OUT_CM = 35.0
DESK_LAMP_CLEAR_CM = 20.0  # past the edge of the outermost screen
DESK_LAMP_FORWARD_CM = 15.0
TASK_REACH_CM = 120.0
VIEW_CLEAR_ANGLE = 45.0  # a little wider than the view cone (40°) so proposals never sit on its edge
CORNER_INSET_CM = 25.0
CORNER_MAX_ANGLE = 120.0  # at or past this, a light is behind the seat
SUMMARY_MODES = ("code", "work", "read", "relax")

_SETUPS = [
    ("Bias light", ("bias",)),
    ("Bias + side lamp", ("bias", "side")),
    ("Bias + desk lamp", ("bias", "desk")),
    ("Full desk", ("bias", "side", "corner")),
]


def _add(a: Point, b: Point, scale: float = 1.0) -> Point:
    return (a[0] + b[0] * scale, a[1] + b[1] * scale)


def _inside(room: Room, point: Point) -> bool:
    return point_in_polygon(point, as_points(room.outline))


def _angle_from_gaze(focus: Focus, point: Point) -> float:
    rx, ry = point[0] - focus.seat[0], point[1] - focus.seat[1]
    distance = math.hypot(rx, ry) or 1.0
    ahead = rx * focus.gaze[0] + ry * focus.gaze[1]
    return math.degrees(math.acos(max(-1.0, min(1.0, ahead / distance))))


PULL_STEPS = (1.0, 0.85, 0.7, 0.55, 0.4)


def _fits(room: Room, focus: Focus, point: Point, *, allow_ahead: bool = False) -> bool:
    """Inside the room, and (unless it's the bias strip) not in the line of sight or behind the seat."""
    if not _inside(room, point):
        return False
    angle = _angle_from_gaze(focus, point)
    if angle >= CORNER_MAX_ANGLE:
        return False
    return allow_ahead or angle >= VIEW_CLEAR_ANGLE


def _pulled(room: Room, focus: Focus, point: Point, *, toward: Point | None = None, allow_ahead: bool = False) -> Point | None:
    """The point, or the first one pulled toward the seat (or `toward`) that fits."""
    anchor = toward or focus.seat
    for step in PULL_STEPS:
        candidate = (anchor[0] + (point[0] - anchor[0]) * step, anchor[1] + (point[1] - anchor[1]) * step)
        if _fits(room, focus, candidate, allow_ahead=allow_ahead):
            return candidate
    return None


def _convex_corners(room: Room) -> list[tuple[Point, Point]]:
    """Outline corners that point out of the room (not inner corners of an L), each with an inward direction."""
    points = [(float(x), float(y)) for x, y in room.outline]
    count = len(points)
    signed = sum(points[i][0] * points[(i + 1) % count][1] - points[(i + 1) % count][0] * points[i][1] for i in range(count))
    corners = []
    for i, here in enumerate(points):
        before, after = points[i - 1], points[(i + 1) % count]
        turn = (here[0] - before[0]) * (after[1] - here[1]) - (here[1] - before[1]) * (after[0] - here[0])
        if turn * signed <= 0:
            continue  # an inner corner: a wall washer there would wash nothing
        a = (before[0] - here[0], before[1] - here[1])
        b = (after[0] - here[0], after[1] - here[1])
        la, lb = math.hypot(*a) or 1.0, math.hypot(*b) or 1.0
        inward = (a[0] / la + b[0] / lb, a[1] / la + b[1] / lb)
        length = math.hypot(*inward) or 1.0
        corners.append((here, (inward[0] / length, inward[1] / length)))
    return corners


def _block(room: Room, focus: Focus, kind: str) -> dict[str, Any] | None:
    gaze = focus.gaze
    left = (gaze[1], -gaze[0])
    along_screen = math.degrees(math.atan2(left[1], left[0])) % 360
    if kind == "bias":
        if focus.screen is None:
            return None
        point = _pulled(room, focus, _add(focus.screen, gaze, BIAS_BEHIND_CM), allow_ahead=True)
        if point is None:
            return None
        return {"catalog": "gradient-strip", "point": point, "elevation": focus.screen_height, "rotation": along_screen,
                "why": "Behind your monitor: a soft bias light evens out the contrast between a bright screen and a dark wall."}
    if kind == "side":
        sides = [((1, "left")), ((-1, "right"))]
        targets = [(name, _add(_add(focus.seat, left, side * SIDE_OUT_CM), gaze, -SIDE_BACK_CM)) for side, name in sides]
        # A side with room for the lamp at full distance wins; only then pull one in toward the seat.
        found = next(((name, p) for name, p in targets if _fits(room, focus, p)), None)
        if found is None:
            found = next(((name, p) for name, p in ((n, _pulled(room, focus, t)) for n, t in targets) if p is not None), None)
        if found is None:
            return None
        name, point = found
        return {"catalog": "floor-lamp", "point": point, "elevation": None, "rotation": 0.0,
                "why": f"To your {name}, a little behind your shoulder: lights the room around you without glare on the screen."}
    if kind == "desk":
        anchor = focus.screen or _add(focus.seat, gaze, 60)
        out = focus.screen_half_width + DESK_LAMP_CLEAR_CM if focus.screen else DESK_LAMP_OUT_CM
        for side in (1, -1):
            point = _add(_add(anchor, left, side * out), gaze, -DESK_LAMP_FORWARD_CM)
            if _fits(room, focus, point) and math.hypot(point[0] - focus.seat[0], point[1] - focus.seat[1]) <= TASK_REACH_CM:
                return {"catalog": "desk-lamp", "point": point, "elevation": None, "rotation": 0.0,
                        "why": "Beside your monitors, a little toward you: white task light on the desk for paper and keyboard."}
        return None
    if kind == "corner":
        options = []
        for corner, inward in _convex_corners(room):
            point = _add(corner, inward, CORNER_INSET_CM)
            if _fits(room, focus, point):
                options.append(point)
        if not options:
            return None
        point = max(options, key=lambda p: (math.hypot(p[0] - focus.seat[0], p[1] - focus.seat[1]), -p[0], -p[1]))
        return {"catalog": "wall-washer", "point": point, "elevation": None, "rotation": 0.0,
                "why": "In a corner off to the side: washes the wall with color for depth, away from your line of sight."}
    raise ValueError(f"Unknown block '{kind}'")


def _with_planned(room: Room, blocks: list[dict[str, Any]]) -> tuple[Room, list[str]]:
    copy = Room.from_dict(room.to_dict())
    ids = []
    for index, block in enumerate(blocks):
        item = catalog_item(block["catalog"])
        light_id = f"setup-{index}"
        copy.lights.append(LayoutLight(
            light_id=light_id, label=item.label, x=round(block["point"][0], 1), y=round(block["point"][1], 1),
            rotation=round(block["rotation"], 1), product=item.product(), elevation=block["elevation"], planned=True,
        ))
        ids.append(light_id)
    return copy, ids


def _summary(preview: list[dict[str, Any]], ids: list[str]) -> str:
    mine = [result for result in preview if result["light_id"] in ids]
    white = sum(1 for result in mine if result["on"] and result.get("color_temp"))
    colored = sum(1 for result in mine if result["on"] and not result.get("color_temp"))
    off = sum(1 for result in mine if not result["on"])
    parts = [f"{white} white" if white else "", f"{colored} in palette color" if colored else "", f"{off} off" if off else ""]
    return ", ".join(part for part in parts if part) or "nothing lit"


def _describe(room: Room, name: str, blocks: list[dict[str, Any]], at: datetime, wake: str, bed: str,
              focus_kind: str = "desk", hint: str = "") -> dict[str, Any]:
    copy, ids = _with_planned(room, blocks)
    roles = resolve_roles(copy, find_focus(copy, focus_kind))
    lights = []
    for light_id, block in zip(ids, blocks):
        placed = next(light for light in copy.lights if light.light_id == light_id)
        lights.append({
            "catalog": block["catalog"], "label": placed.label, "x": placed.x, "y": placed.y, "rotation": placed.rotation,
            "elevation": round(resolved_elevation(placed, copy), 1), "fixed_elevation": block["elevation"],
            "role": roles[light_id], "why": block["why"],
        })
    modes = {}
    for mode in SUMMARY_MODES:
        item = suggest(copy, mode, at=at, wake=wake, bed=bed, count=1)[0]
        preview = evaluate(item["scene"], copy)
        modes[mode] = {
            "palette": item["palette"]["name"], "kelvin": item["kelvin"],
            "summary": _summary(preview, ids), "roles": {light_id: item["roles"][light_id] for light_id in ids},
            "preview": [result for result in preview if result["light_id"] in ids],
        }
    return {"name": name, "lights": lights, "modes": modes, "hint": hint}


def generate_setups(room: Room, *, at: datetime, wake: str, bed: str) -> list[dict[str, Any]]:
    """Proposed setups for the room, best first. Each lists its lights (catalog product,
    position, height, role, and why) and what each mode would do with them."""
    focus = find_focus(room, "desk")
    if focus is None:
        corners = [(float(x), float(y)) for x, y in room.outline][:4]
        cx = sum(c[0] for c in corners) / max(1, len(corners))
        cy = sum(c[1] for c in corners) / max(1, len(corners))
        blocks = []
        for corner in corners[::2][:2]:
            length = math.hypot(cx - corner[0], cy - corner[1]) or 1.0
            point = _add(corner, ((cx - corner[0]) / length, (cy - corner[1]) / length), CORNER_INSET_CM)
            blocks.append({"catalog": "floor-shade", "point": point, "elevation": None, "rotation": 0.0,
                           "why": "A lamp in a corner: soft ambient light for the room."})
        return [_describe(room, "Ambient corners", blocks, at, wake, bed,
                          hint="Add a desk and monitor on the plan for desk setups with bias and task light.")]

    setups = []
    for name, kinds in _SETUPS:
        blocks = [_block(room, focus, kind) for kind in kinds]
        if any(block is None for block in blocks):
            continue
        setups.append(_describe(room, name, blocks, at, wake, bed))  # type: ignore[arg-type]
    return setups
