"""A room as text, and the layout problems an assistant is told about."""

import pytest

from myhuey.assistant import check_layout, describe_room
from myhuey.errors import RoomNotFound
from myhuey.models import Room
from myhuey.room_text import draw_room, layout_problems
from myhuey.service import HueRoomService


def _room(furniture=(), lights=(), outline=((0, 0), (200, 0), (200, 100), (0, 100))):
    return Room.from_dict({"name": "R", "outline": [list(p) for p in outline], "furniture": list(furniture),
                           "lights": [{"light_id": i, "label": i, "x": x, "y": y, **more} for i, x, y, more in lights]})

def test_draws_furniture_and_lights_to_scale():
    desk = {"id": "d", "kind": "desk", "label": "Desk", "x": 100, "y": 35, "width": 100, "depth": 40}
    result = draw_room(_room([desk], [("9", 100, 90, {})]), cell=10)
    assert result["drawing"].split("\n") == [
        "....................",
        ".....AAAAAAAAAA.....",
        ".....AAAAAAAAAA.....",
        "....................",
        "..........a.........",
    ]
    assert (result["cm_per_column"], result["cm_per_row"]) == (10, 20)
    assert result["legend"] == [{"mark": "A", "what": "desk", "name": "Desk", "x": 100, "y": 35},
                                {"mark": "a", "what": "light", "name": "9", "x": 100, "y": 90}]

def test_l_shaped_room_leaves_the_notch_blank_and_picks_a_cell_that_fits():
    room = _room(outline=((0, 0), (400, 0), (400, 200), (200, 200), (200, 400), (0, 400)))
    result = draw_room(room)
    rows = result["drawing"].split("\n")
    assert max(len(row) for row in rows) <= 72 and result["cm_per_column"] == 10
    assert rows[-1] == "." * 20            # the bottom rows are only the left half; trailing blanks stripped

def test_openings_are_listed_in_words():
    room = Room.from_dict({"name": "R", "openings": [{"kind": "window", "edge": 0, "offset": 100, "width": 90}]})
    assert draw_room(room)["openings"] == ["Window on wall 0 (north side), 100 cm from its start, 90 cm wide, sill 90 cm, top 210 cm"]

def test_each_problem_kind_is_reported_with_its_item():
    desk = {"id": "d", "kind": "desk", "label": "Desk", "x": 100, "y": 50, "width": 100, "depth": 40}
    cases = {
        "outside": _room([{**desk, "x": 190}]),
        "overlap": _room([desk, {**desk, "id": "d2", "x": 120}]),
        "screen_off_desk": _room([desk, {"id": "m", "kind": "monitor-27", "x": 20, "y": 80, "width": 61, "depth": 20}]),
        "screen_faces_wall": _room([desk, {"id": "m", "kind": "monitor-27", "x": 100, "y": 60, "width": 61, "depth": 20}]),   # seat at y = 120, past the wall
        "no_seat": _room([{"id": "s", "kind": "bookshelf", "x": 50, "y": 50, "width": 90, "depth": 30}]),
        "height_unknown": _room([desk], [("1", 20, 20, {"product": {"archetype": "mystery"}})]),
    }
    for kind, room in cases.items():
        assert kind in {p["kind"] for p in layout_problems(room)}, kind
        assert all(p["message"] and "item" in p for p in layout_problems(room))

def test_a_sound_room_has_no_problems():
    desk = {"id": "d", "kind": "desk", "label": "Desk", "x": 100, "y": 30, "width": 100, "depth": 40}
    monitor = {"id": "m", "kind": "monitor-27", "x": 100, "y": 20, "width": 61, "depth": 20}       # on the desk; seat at y = 80, inside
    assert layout_problems(_room([desk, monitor], [("1", 100, 12, {"elevation": 75})])) == []

def test_a_monitor_stands_above_its_desk_in_the_drawing_and_rugs_are_not_drawn():
    desk = {"id": "d", "kind": "desk", "label": "Desk", "x": 100, "y": 30, "width": 100, "depth": 40}
    monitor = {"id": "m", "kind": "monitor-27", "x": 100, "y": 30, "width": 61, "depth": 20}
    rug = {"id": "r", "kind": "rug", "label": "Rug", "x": 100, "y": 50, "width": 200, "depth": 100}
    result = draw_room(_room([rug, desk, monitor]), cell=10)
    assert [(entry["mark"], entry["what"]) for entry in result["legend"]] == [("A", "desk"), ("B", "monitor-27")]
    assert "B" in result["drawing"] and "R" not in result["drawing"]

def test_lights_on_the_far_and_near_walls_are_still_drawn():
    result = draw_room(_room(lights=[("1", 200, 100, {}), ("2", 0, 0, {})]), cell=10)
    rows = result["drawing"].split("\n")
    assert rows[0][0] == "b" and rows[-1][-1] == "a"


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.add_room("Den", 400, 300)
    service.update_room("Den", furniture=[{"kind": "bookshelf", "x": 200, "y": 150, "width": 90, "depth": 30}])
    return service

def test_describe_and_check_a_room_through_the_service(service):
    described = describe_room(service, "den")
    assert described["cm_per_column"] == 10 and described["legend"][0]["what"] == "bookshelf"
    checked = check_layout(service, "DEN")
    assert checked["ok"] is False and [p["kind"] for p in checked["problems"]] == ["no_seat"]
    with pytest.raises(RoomNotFound):
        describe_room(service, "Garage")

def test_describe_and_check_read_a_sandbox_layout(service):
    sandbox = service.new_layout("Try")
    from myhuey.assistant import in_layout
    with in_layout(service, "try"):
        service.add_room("Loft", 200, 100)
        service.update_room("Loft", furniture=[{"kind": "desk", "x": 100, "y": 50, "width": 100, "depth": 40}])
    assert check_layout(service, "Loft", layout=sandbox["id"]) == {"ok": True, "problems": []}
    assert describe_room(service, "Loft", layout="try")["legend"][0]["what"] == "desk"
    with pytest.raises(RoomNotFound):
        check_layout(service, "Loft")
