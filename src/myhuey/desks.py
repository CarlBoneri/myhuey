"""Desk sets and mounted lights.

A desk set is a group of pieces placed together from a desk design. Its members keep their
real room coordinates (so every reader of a room works unchanged) and carry the set's id; the
set moves as one. A light can be mounted on a screen's back: it takes its place, height, and
facing from the screen and is a bias light.

`settle` is run on every save, so the stored room always agrees with these rules.
"""

from __future__ import annotations

import math

from .models import Furniture, LayoutLight, Room


def _front(item: Furniture) -> tuple[float, float]:
    angle = math.radians(item.rotation)
    return -math.sin(angle), math.cos(angle)


def _r2(value: float) -> float:
    return round(value, 2)


def mount_spot(screen: Furniture) -> tuple[float, float, float, float]:
    """Where a light mounted on this screen sits: its back-face middle (x, y), middle height, and turn."""
    fx, fy = _front(screen)
    return (_r2(screen.x - fx * screen.depth / 2), _r2(screen.y - fy * screen.depth / 2),
            _r2(screen.elevation + screen.height / 2), screen.rotation)


def settle(room: Room) -> None:
    """Make the room agree with the set and mount rules, in place.

    A set whose base piece is gone dissolves; a member naming a set the room does not have
    leaves it. A mounted light sits on its screen's back as a bias light and belongs to the
    screen's set; a mount whose screen is gone is dropped and the light stays where it was.
    """
    pieces = {item.id: item for item in room.furniture}
    room.desk_sets = [entry for entry in room.desk_sets if entry["base"] in pieces]
    known = {entry["id"] for entry in room.desk_sets}
    for item in room.furniture:
        if item.set not in known:
            item.set = None
    for light in room.lights:
        if light.set not in known:
            light.set = None
        if light.mount is None:
            continue
        screen = pieces.get(light.mount["screen"])
        if screen is None:
            light.mount = None
            continue
        light.x, light.y, light.elevation, light.rotation = mount_spot(screen)
        light.role = "bias"
        light.set = screen.set


def find_set(room: Room, set_id: str) -> dict[str, str]:
    entry = next((entry for entry in room.desk_sets if entry["id"] == set_id), None)
    if entry is None:
        raise ValueError(f"'{room.name}' has no desk set '{set_id}'")
    return entry


def move_set(room: Room, set_id: str, x: float, y: float, rotation: float) -> None:
    """Move and turn a set as one piece, so its base lands at (x, y) turned to `rotation`."""
    entry = find_set(room, set_id)
    base = next(item for item in room.furniture if item.id == entry["base"])
    turn = (float(rotation) - base.rotation) % 360
    cos, sin = math.cos(math.radians(turn)), math.sin(math.radians(turn))
    ox, oy = base.x, base.y

    def carry(thing: Furniture | LayoutLight) -> None:
        dx, dy = thing.x - ox, thing.y - oy
        thing.x = _r2(float(x) + dx * cos - dy * sin)
        thing.y = _r2(float(y) + dx * sin + dy * cos)
        thing.rotation = round((thing.rotation + turn) % 360, 2)

    for item in room.furniture:
        if item.set == set_id:
            carry(item)
    for light in room.lights:
        if light.set == set_id:
            carry(light)
    settle(room)


def release_set(room: Room, set_id: str) -> None:
    """Dissolve a set: its pieces stay where they stand, no longer locked together."""
    find_set(room, set_id)
    room.desk_sets = [entry for entry in room.desk_sets if entry["id"] != set_id]
    settle(room)
