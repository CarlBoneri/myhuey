"""Version 2 documents gain openings, ceilings, furniture heights, and a home plan slot."""

import copy

from myhuey.migrations import CURRENT_VERSION, migrate
from myhuey.models import Room
from myhuey.service import HueRoomService
from myhuey.storage import load_backup

from test_migration import V1, _write_v1

SQUARE = [[0, 0], [400, 0], [400, 300], [0, 300]]


def _v2(furniture):
    return {
        "schema_version": 2,
        "bridge": {},
        "scenes": [],
        "rooms": [{"name": "Office", "x": 0, "y": 0, "units": "imperial", "outline": SQUARE,
                   "lights": [], "furniture": furniture, "photo": None}],
    }


def _item(kind, x, y, width=81, depth=5, rotation=0):
    return {"id": kind[0] + "1", "kind": kind, "label": kind, "x": x, "y": y, "width": width,
            "depth": depth, "rotation": rotation, "shape": "rect"}


def test_v2_door_near_edge_becomes_opening():
    upgraded, start = migrate(_v2([_item("door", 140, 5)]))
    room = upgraded["rooms"][0]
    assert start == 2 and upgraded["schema_version"] == CURRENT_VERSION
    assert room["furniture"] == []
    (opening,) = room["openings"]
    assert opening["kind"] == "door" and opening["edge"] == 0
    assert opening["offset"] == 99.5 and opening["width"] == 81 and opening["top"] == 203
    Room.from_dict(room)  # still valid


def test_v2_window_on_side_wall_clamps_inside_edge():
    upgraded, _ = migrate(_v2([_item("window", 396, 20, width=90, depth=10, rotation=90)]))
    (opening,) = upgraded["rooms"][0]["openings"]
    assert opening["edge"] == 1 and opening["offset"] == 0
    assert (opening["sill"], opening["top"]) == (90, 210)


def test_v2_window_far_from_edge_stays_furniture():
    upgraded, _ = migrate(_v2([_item("window", 200, 40, width=90, depth=10)]))
    room = upgraded["rooms"][0]
    assert room["openings"] == [] and room["furniture"][0]["kind"] == "window"


def test_v3_adds_ceiling_home_and_heights():
    upgraded, _ = migrate(_v2([_item("desk", 200, 150, width=140, depth=70)]))
    room = upgraded["rooms"][0]
    assert room["ceiling"] == 244
    assert (room["furniture"][0]["elevation"], room["furniture"][0]["height"]) == (0, 75)
    assert upgraded["home"] == {"plan": None}


def test_v1_document_migrates_all_the_way(tmp_path):
    path = tmp_path / "myhuey.db"
    _write_v1(path, copy.deepcopy(V1))
    rooms = HueRoomService(path).rooms()
    assert rooms[0].ceiling == 244 and rooms[0].openings == []
    assert load_backup(1, path) is not None
