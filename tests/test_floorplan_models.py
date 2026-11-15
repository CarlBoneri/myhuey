"""Openings (doors and windows), ceiling height, furniture heights, and the home plan image."""

import pytest

from myhuey.models import DEFAULT_CEILING_CM, Furniture, HomePlan, Opening, Room, opening_fits

SQUARE = [[0, 0], [400, 0], [400, 300], [0, 300]]


def test_opening_round_trip():
    window = Opening.from_dict({"kind": "window", "edge": 0, "offset": 50, "width": 120, "sill": 80, "top": 200})
    assert window.to_dict() == {"id": window.id, "kind": "window", "edge": 0, "offset": 50, "width": 120, "sill": 80, "top": 200}
    door = Opening.from_dict({"id": "d1", "kind": "door", "edge": 1, "offset": 10, "width": 81, "sill": 30, "top": 203})
    assert door.to_dict() == {"id": "d1", "kind": "door", "edge": 1, "offset": 10, "width": 81, "sill": None, "top": 203}


def test_opening_rejects_bad_kind_and_width():
    with pytest.raises(ValueError):
        Opening.from_dict({"kind": "hatch", "edge": 0, "offset": 0, "width": 80})
    with pytest.raises(ValueError):
        Opening.from_dict({"kind": "door", "edge": 0, "offset": 0, "width": 0})
    with pytest.raises(ValueError):
        Opening.from_dict({"kind": "window", "edge": 0, "offset": 0, "width": 90, "sill": 200, "top": 100})


def test_room_rejects_opening_past_edge_end():
    ok = {"kind": "door", "edge": 1, "offset": 200, "width": 100}  # edge 1 is 300 long
    assert opening_fits(SQUARE, Opening.from_dict(ok))
    with pytest.raises(ValueError):
        Room.from_dict({"name": "A", "outline": SQUARE, "openings": [{**ok, "offset": 201}]})
    with pytest.raises(ValueError):
        Room.from_dict({"name": "A", "outline": SQUARE, "openings": [{**ok, "edge": 4}]})


def test_room_ceiling_defaults_to_244():
    room = Room.from_dict({"name": "A", "outline": SQUARE})
    assert room.ceiling == DEFAULT_CEILING_CM == 244
    assert room.to_dict()["ceiling"] == 244 and room.to_dict()["openings"] == []
    with pytest.raises(ValueError):
        Room.from_dict({"name": "A", "outline": SQUARE, "ceiling": 50})


def test_furniture_heights_default_by_kind():
    monitor = Furniture.from_dict({"kind": "monitor-27", "width": 61, "depth": 20})
    assert monitor.elevation == 75
    assert Furniture.from_dict({"kind": "pillar-round", "width": 30, "depth": 30}).height == 244
    custom = Furniture.from_dict({"kind": "thing"})
    assert (custom.elevation, custom.height) == (0, 75)
    assert Furniture.from_dict({"kind": "thing", "elevation": 10, "height": 20}).to_dict()["height"] == 20


def test_home_plan_validation():
    assert HomePlan.from_dict(None) is None
    plan = HomePlan.from_dict({"file": "a" * 32 + ".png", "cm_per_px": 2.5, "opacity": 3})
    assert plan.opacity == 1 and plan.offset == [0.0, 0.0] and plan.rotation == 0
    for bad in (0, -1, 101, "x"):
        with pytest.raises(ValueError):
            HomePlan.from_dict({"file": "f.png", "cm_per_px": bad})
