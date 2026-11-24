"""Where someone sits for a mode, and what role each light plays from there.

A focus is a seat, the direction the eyes look (gaze), the eye height, and the screen, if
any. Each light's role follows from where it sits relative to that: a strip just behind the
screen is a bias light, a lamp next to the seat is a task light, a lamp at eye height past
the screen is in view (glare), a lamp behind the seat can reflect in the screen, and the rest
is ambient. Plan coordinates are cm with y pointing down; furniture fronts (screens, the seat
side of a desk, sofa, or bed) face +y at rotation 0 and turn clockwise with it.
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from .models import Furniture, LayoutLight, Room
from .placement import resolved_elevation

Point = tuple[float, float]

BIAS_BEHIND_CM = 50.0
BIAS_SIDE_MARGIN_CM = 30.0
BIAS_LEVEL_CM = 60.0  # how far above or below the screen's middle a bias light may sit
TASK_RADIUS_CM = 120.0
VIEW_HALF_ANGLE = 40.0
VIEW_MAX_ELEVATION_ANGLE = 30.0
BEHIND_ANGLE = 120.0
BEHIND_MAX_HEIGHT = 200.0

SEAT_FROM_SCREEN_CM = 60.0
SEAT_FROM_DESK_EDGE_CM = 30.0
BED_HEAD_INSET_CM = 40.0
EYE_SEATED, EYE_STANDING, EYE_LOUNGING = 115.0, 155.0, 105.0

DESKS = ("desk", "desk-l", "desk-standing")
SOFAS = ("sofa", "sectional")
MONITOR_PREFIX = "monitor"


@dataclass(frozen=True)
class Body:
    """The person's own numbers (preferences): eyes above the seat when sitting, eyes when standing,
    and how far the eyes are from the screens when no chair is marked as the seat."""

    eye_sitting: float = 69.0
    eye_standing: float = 155.0
    screen_distance: float = 60.0


DEFAULT_SEAT_CM = 46.0  # a desk chair's seat; 46 + 69 = 115 cm, the seated eye height before seats existed
_body: ContextVar[Body] = ContextVar("body", default=Body())


@contextmanager
def using_body(body: Body) -> Iterator[None]:
    """Work out seats with these numbers for the rest of the block (the API sets it per request)."""
    token = _body.set(body)
    try:
        yield
    finally:
        _body.reset(token)


def current_body() -> Body:
    return _body.get()


@dataclass(frozen=True)
class Focus:
    seat: Point
    gaze: Point  # unit vector
    eye_height: float
    screen: Point | None = None
    screen_height: float | None = None
    screen_half_width: float = 0.0


def _front(item: Furniture) -> Point:
    angle = math.radians(item.rotation)
    return (-math.sin(angle), math.cos(angle))


def _unit(vector: Point) -> Point:
    length = math.hypot(*vector)
    return (vector[0] / length, vector[1] / length) if length else (0.0, -1.0)


def _near(item: Furniture, other: Furniture, margin: float = 30.0) -> bool:
    reach = max(item.width, item.depth) / 2 + margin
    return math.hypot(other.x - item.x, other.y - item.y) <= reach


def _seated_at(item: Furniture, eye: float) -> Focus:
    front = _front(item)
    return Focus(seat=(item.x, item.y), gaze=front, eye_height=eye)


def _desk_focus(room: Room) -> Focus | None:
    desks = [item for item in room.furniture if item.kind in DESKS]
    monitors = [item for item in room.furniture if item.kind.startswith(MONITOR_PREFIX)]
    best: tuple[Furniture | None, list[Furniture]] = (None, [])
    for desk in desks:
        on_desk = [monitor for monitor in monitors if _near(desk, monitor)]
        if best[0] is None or len(on_desk) > len(best[1]):
            best = (desk, on_desk)
    desk, screens = best
    if desk is None and monitors:
        screens = monitors
    body = current_body()
    standing = desk is not None and desk.kind == "desk-standing"
    chairs = [item for item in room.furniture if item.seat is not None]
    if screens:
        cx = sum(item.x for item in screens) / len(screens)
        cy = sum(item.y for item in screens) / len(screens)
        facing = _unit((sum(_front(item)[0] for item in screens), sum(_front(item)[1] for item in screens)))
        half = max(abs(item.x - cx) + item.width / 2 for item in screens) if len(screens) > 1 else screens[0].width / 2
        height = sum(item.elevation + item.height / 2 for item in screens) / len(screens)
        if chairs:
            # The chair you marked as your seat: the one nearest the screens, if there are several.
            chair = min(chairs, key=lambda item: math.hypot(item.x - cx, item.y - cy))
            eye = body.eye_standing if standing else chair.seat + body.eye_sitting
            gaze = _unit((cx - chair.x, cy - chair.y)) if (cx, cy) != (chair.x, chair.y) else _front(chair)
            return Focus((chair.x, chair.y), gaze, eye, (cx, cy), height, half)
        eye = body.eye_standing if standing else DEFAULT_SEAT_CM + body.eye_sitting
        seat = (cx + facing[0] * body.screen_distance, cy + facing[1] * body.screen_distance)
        return Focus(seat, (-facing[0], -facing[1]), eye, (cx, cy), height, half)
    if chairs:
        chair = chairs[0] if desk is None else min(chairs, key=lambda item: math.hypot(item.x - desk.x, item.y - desk.y))
        return _seated_at(chair, body.eye_standing if standing else chair.seat + body.eye_sitting)
    eye = body.eye_standing if standing else DEFAULT_SEAT_CM + body.eye_sitting
    if desk is None:
        return None
    front = _front(desk)
    reach = desk.depth / 2 + SEAT_FROM_DESK_EDGE_CM
    return Focus((desk.x + front[0] * reach, desk.y + front[1] * reach), (-front[0], -front[1]), eye)


def _sofa_focus(room: Room) -> Focus | None:
    sofa = next((item for item in room.furniture if item.kind in SOFAS), None)
    if sofa is None:
        return None
    tv = next((item for item in room.furniture if item.kind == "tv"), None)
    if tv is None:
        return _seated_at(sofa, EYE_LOUNGING)
    gaze = _unit((tv.x - sofa.x, tv.y - sofa.y))
    return Focus((sofa.x, sofa.y), gaze, EYE_LOUNGING, (tv.x, tv.y), tv.elevation + tv.height / 2, tv.width / 2)


def _read_focus(room: Room) -> Focus | None:
    chair = next((item for item in room.furniture if item.kind == "armchair"), None)
    if chair is not None:
        return _seated_at(chair, EYE_LOUNGING)
    bed = next((item for item in room.furniture if item.kind.startswith("bed")), None)
    if bed is not None:
        front = _front(bed)
        inset = bed.depth / 2 - BED_HEAD_INSET_CM  # the head end is the back of the bed
        return Focus((bed.x - front[0] * inset, bed.y - front[1] * inset), front, EYE_LOUNGING)
    focus = _desk_focus(room)
    return Focus(focus.seat, focus.gaze, focus.eye_height) if focus else None


_FINDERS = {"desk": _desk_focus, "read": _read_focus, "sofa": _sofa_focus}
FOCUS_KINDS = tuple(_FINDERS)


def find_focus(room: Room, kind: str) -> Focus | None:
    """Where someone sits for this kind of focus ("desk", "sofa", "read"), or None."""
    if kind not in _FINDERS:
        raise ValueError(f"Focus must be one of {', '.join(_FINDERS)}")
    return _FINDERS[kind](room)


def _role(light: LayoutLight, room: Room, focus: Focus) -> str:
    x, y, height = light.x, light.y, resolved_elevation(light, room)
    if focus.screen is not None and focus.screen_height is not None:
        sx, sy = x - focus.screen[0], y - focus.screen[1]
        behind_screen = sx * focus.gaze[0] + sy * focus.gaze[1]  # along the gaze, past the screen
        sideways = abs(sx * focus.gaze[1] - sy * focus.gaze[0])
        if (0 <= behind_screen <= BIAS_BEHIND_CM and sideways <= focus.screen_half_width + BIAS_SIDE_MARGIN_CM
                and abs(height - focus.screen_height) <= BIAS_LEVEL_CM):
            return "bias"
    rx, ry = x - focus.seat[0], y - focus.seat[1]
    distance = math.hypot(rx, ry)
    ahead = rx * focus.gaze[0] + ry * focus.gaze[1]
    angle = math.degrees(math.acos(max(-1.0, min(1.0, ahead / distance)))) if distance else 0.0
    above = math.degrees(math.atan2(height - focus.eye_height, distance))
    screen_distance = (math.hypot(focus.screen[0] - focus.seat[0], focus.screen[1] - focus.seat[1])
                       if focus.screen else SEAT_FROM_SCREEN_CM)
    if angle <= VIEW_HALF_ANGLE and above < VIEW_MAX_ELEVATION_ANGLE and ahead > screen_distance:
        return "view"
    if distance <= TASK_RADIUS_CM:
        return "task"
    if angle >= BEHIND_ANGLE and height < BEHIND_MAX_HEIGHT:
        return "behind"
    return "ambient"


def resolve_roles(room: Room, focus: Focus | None) -> dict[str, str]:
    """Each light's role: its pinned role, or one worked out from the focus (ambient without one)."""
    roles = {}
    for light in room.lights:
        if light.role != "auto":
            roles[light.light_id] = light.role
        elif focus is None:
            roles[light.light_id] = "ambient"
        else:
            roles[light.light_id] = _role(light, room, focus)
    return roles
