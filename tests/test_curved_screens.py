"""Curved and portrait screens: the curve (mm, as printed on the box) and tilt are saved with the room."""

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.assistant import create_sandbox, set_furniture
from myhuey.models import FURNITURE_HEIGHTS, FURNITURE_SIZES, Furniture
from myhuey.placement import covers, footprint
from myhuey.room_text import layout_problems

G9 = {"kind": "monitor-49", "x": 100, "y": 50, "width": 119.8, "depth": 10, "height": 33.7, "curve": 1000}


def test_old_room_loads_flat():
    item = Furniture.from_dict({"kind": "monitor-27", "width": 61, "depth": 20})
    assert item.curve is None and item.tilt is None
    assert "curve" in item.to_dict() and item.to_dict()["curve"] is None
    assert Furniture.from_dict(item.to_dict()).curve is None


def test_curve_and_tilt_round_trip():
    item = Furniture.from_dict({**G9, "tilt": -8})
    assert (item.curve, item.tilt) == (1000.0, -8.0)
    assert Furniture.from_dict(item.to_dict()) == item


@pytest.mark.parametrize("bad", [{"curve": 400}, {"curve": 20000}, {"tilt": 50}, {"tilt": -46}])
def test_ranges(bad):
    with pytest.raises(ValueError):
        Furniture.from_dict({**G9, **bad})


def test_no_curved_portrait():
    with pytest.raises(ValueError, match="portrait"):
        Furniture.from_dict({"kind": "monitor-27", "width": 34, "height": 61, "curve": 1800})


def test_catalog_has_49():
    assert FURNITURE_SIZES["monitor-49"] == ('Super ultrawide 49"', 119.8, 12.0, "rect")
    assert FURNITURE_HEIGHTS["monitor-49"] == (75, 33.7)


def test_curved_footprint_reaches_forward():
    # 49" 1000R at rotation 0 faces +y. sagitta = 100 cm * (1 - cos(119.8 / 200)) = 17.4 cm
    item = Furniture.from_dict(G9)
    cx, cy, w, d = footprint(item)
    assert w == pytest.approx(112.8, abs=0.2)  # chord
    assert d == pytest.approx(27.4, abs=0.2)  # depth + sagitta
    assert cx == 100 and cy == pytest.approx(50 + 17.4 / 2, abs=0.2)
    assert covers(item, 100 - 55, 50 + 17)  # a wing tip
    assert not covers(item, 100, 50 - 8)  # behind the body


def test_flat_footprint_is_the_item():
    item = Furniture.from_dict({**G9, "curve": None})
    assert footprint(item) == (100, 50, 119.8, 10)


def test_a_turned_curved_screen_reaches_toward_its_front():
    # rotation 90 turns the front from +y to -x
    cx, cy, _, _ = footprint(Furniture.from_dict({**G9, "rotation": 90}))
    assert cx == pytest.approx(100 - 17.4 / 2, abs=0.2) and cy == pytest.approx(50)


def test_room_check_sees_the_wings():
    # A lamp table just in front of the wing tip overlaps the curved screen but not a flat one.
    from myhuey.models import Room
    side = {"kind": "nightstand", "x": 45, "y": 72, "width": 10, "depth": 10, "elevation": 80, "height": 20}
    curved = Room.from_dict({"name": "R", "furniture": [{**G9, "x": 200}, {**side, "x": 145}]})
    flat = Room.from_dict({"name": "R", "furniture": [{**G9, "x": 200, "curve": None}, {**side, "x": 145}]})
    assert any(p["kind"] == "overlap" for p in layout_problems(curved))
    assert not any(p["kind"] == "overlap" for p in layout_problems(flat))


def test_set_furniture_accepts_curve_and_defaults_the_49(service):
    box = create_sandbox(service, "Desk idea")
    from myhuey.assistant import add_room
    add_room(service, box["id"], "Office", width="12ft", depth="14ft")
    out = set_furniture(service, box["id"], "Office", [
        {"kind": "monitor-49", "x": 183, "y": 30},
        {"kind": "monitor-27", "x": 100, "y": 30, "curve": 1800, "tilt": -5},
    ])
    g9, other = out["furniture"]
    assert (g9["curve"], g9["width"], g9["height"]) == (1000, 119.8, 33.7)
    assert (other["curve"], other["tilt"]) == (1800, -5)


def test_api_accepts_curve(db_path):
    web = TestClient(create_app(db_path, pairing_window=5))
    assert web.post("/api/rooms", json={"name": "Office"}).status_code == 200
    saved = web.patch("/api/rooms/Office", json={"furniture": [{**G9, "x": 200, "y": 100, "tilt": -10}]})
    assert saved.status_code == 200
    item = web.get("/api/rooms/Office").json()["furniture"][0]
    assert (item["curve"], item["tilt"]) == (1000, -10)
    assert web.patch("/api/rooms/Office", json={"furniture": [{**G9, "curve": 300}]}).status_code in (400, 422)
