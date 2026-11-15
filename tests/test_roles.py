"""Where the user sits for a mode, and the role each light plays from there."""

import pytest
from pytest import approx

from myhuey.models import Furniture, LayoutLight, Room
from myhuey.roles import find_focus, resolve_roles

CEILING = {"archetype": "ceilinground"}
FLOOR = {"archetype": "floorshade"}
TABLE = {"archetype": "tableshade"}
STRIP = {"archetype": "huelightstrip"}


def _f(kind, x, y, width, depth, rotation=0):
    return Furniture.from_dict({"kind": kind, "x": x, "y": y, "width": width, "depth": depth, "rotation": rotation})


def _light(light_id, x, y, product, **extra):
    return LayoutLight(light_id=light_id, label=light_id, x=x, y=y, product=product, **extra)


def _office(*lights, monitor=True, desk_kind="desk"):
    furniture = [_f(desk_kind, 200, 150, 140, 70)]
    if monitor:
        furniture.append(_f("monitor-27", 200, 130, 61, 20))
    return Room(name="Office", outline=[[0, 0], [400, 0], [400, 400], [0, 400]], furniture=furniture, lights=list(lights))


def test_desk_focus_sits_in_front_of_monitors():
    focus = find_focus(_office(), "desk")
    assert focus.seat == approx((200, 190))
    assert focus.gaze == approx((0, -1))
    assert focus.eye_height == 115
    assert focus.screen == approx((200, 130))


def test_a_turned_monitor_turns_the_seat():
    room = Room(name="R", furniture=[_f("desk", 200, 200, 70, 140, rotation=90), _f("monitor-27", 220, 200, 61, 20, rotation=90)])
    focus = find_focus(room, "desk")
    assert focus.seat == approx((160, 200))  # screen faces -x after a 90° clockwise turn
    assert focus.gaze == approx((1, 0))


def test_standing_desk_raises_the_eye():
    assert find_focus(_office(desk_kind="desk-standing"), "desk").eye_height == 155


def test_desk_without_monitor_uses_desk_front():
    focus = find_focus(_office(monitor=False), "desk")
    assert focus.seat == approx((200, 215))
    assert focus.gaze == approx((0, -1))
    assert focus.screen is None


def test_sofa_focus_looks_at_tv():
    room = Room(name="Living", furniture=[_f("sofa", 200, 300, 213, 91), _f("tv", 200, 20, 145, 8)])
    focus = find_focus(room, "sofa")
    assert focus.seat == approx((200, 300))
    assert focus.gaze == approx((0, -1))
    assert focus.eye_height == 105
    assert focus.screen == approx((200, 20))


def test_read_prefers_armchair_then_bed_then_desk():
    chair, bed = _f("armchair", 50, 50, 85, 85), _f("bed-queen", 300, 300, 152, 203)
    desk = _f("desk", 200, 150, 140, 70)
    assert find_focus(Room(name="R", furniture=[desk, bed, chair]), "read").seat == approx((50, 50))
    assert find_focus(Room(name="R", furniture=[desk, bed]), "read").seat[0] == approx(300)
    assert find_focus(Room(name="R", furniture=[desk]), "read").seat == approx((200, 215))


def test_no_focus_furniture_returns_none():
    assert find_focus(Room(name="Hall"), "desk") is None
    assert find_focus(Room(name="Hall"), "sofa") is None


def test_strip_behind_monitor_is_bias():
    room = _office(_light("s", 200, 115, STRIP))
    assert resolve_roles(room, find_focus(room, "desk")) == {"s": "bias"}


def test_lamp_beside_the_seat_is_task():
    room = _office(_light("t", 260, 160, TABLE))
    assert resolve_roles(room, find_focus(room, "desk")) == {"t": "task"}


def test_floor_lamp_past_the_screen_is_view_but_ceiling_light_there_is_ambient():
    room = _office(_light("f", 200, 20, FLOOR), _light("c", 200, 20, CEILING))
    assert resolve_roles(room, find_focus(room, "desk")) == {"f": "view", "c": "ambient"}


def test_floor_lamp_behind_chair_is_behind_but_ceiling_light_is_not():
    room = _office(_light("f", 200, 350, FLOOR), _light("c", 200, 350, CEILING))
    assert resolve_roles(room, find_focus(room, "desk")) == {"f": "behind", "c": "ambient"}


def test_light_off_to_the_side_is_ambient():
    room = _office(_light("a", 390, 190, FLOOR))
    assert resolve_roles(room, find_focus(room, "desk")) == {"a": "ambient"}


def test_pinned_role_overrides_geometry():
    room = _office(_light("c", 200, 350, CEILING, role="task"))
    assert resolve_roles(room, find_focus(room, "desk")) == {"c": "task"}


def test_without_focus_everything_unpinned_is_ambient():
    room = Room(name="Hall", lights=[_light("a", 10, 10, FLOOR), _light("b", 20, 20, FLOOR, role="bias")])
    assert resolve_roles(room, None) == {"a": "ambient", "b": "bias"}
