"""Generated setups: catalog lights proposed around the desk, with what each setup enables."""

import io
import math
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from myhuey.api import create_app
from myhuey.cli import main
from myhuey.geometry import as_points, point_in_polygon
from myhuey.models import Furniture, Room
from myhuey.roles import find_focus
from myhuey.service import HueRoomService
from myhuey.setups import generate_setups

NOON = datetime(2026, 1, 1, 12)


def _f(kind, x, y, width, depth, rotation=0):
    return Furniture.from_dict({"kind": kind, "x": x, "y": y, "width": width, "depth": depth, "rotation": rotation})


def _office(width=400, height=400, desk_x=200):
    return Room(name="Office", outline=[[0, 0], [width, 0], [width, height], [0, height]],
                furniture=[_f("desk", desk_x, 150, 140, 70), _f("monitor-27", desk_x, 130, 61, 20)])


def _by_name(setups):
    return {setup["name"]: setup for setup in setups}


def test_four_setups_around_a_desk():
    setups = generate_setups(_office(), at=NOON, wake="07:00", bed="23:00")
    assert [s["name"] for s in setups] == ["Bias light", "Bias + side lamp", "Bias + desk lamp", "Full desk"]


def test_bias_strip_sits_just_behind_the_monitor_at_screen_height():
    bias = _by_name(generate_setups(_office(), at=NOON, wake="07:00", bed="23:00"))["Bias light"]["lights"][0]
    assert bias["catalog"] == "gradient-strip" and bias["role"] == "bias"
    assert bias["x"] == pytest.approx(200) and bias["y"] == pytest.approx(130 - 12)
    assert bias["elevation"] == pytest.approx(75 + 20)
    assert "monitor" in bias["why"]


def test_side_lamp_goes_left_and_flips_right_near_a_wall():
    room = _office()
    focus = find_focus(room, "desk")  # seat (200, 190) looking toward -y: left is -x
    side = [l for l in _by_name(generate_setups(room, at=NOON, wake="07:00", bed="23:00"))["Bias + side lamp"]["lights"]
            if l["catalog"] == "floor-lamp"][0]
    assert side["x"] < focus.seat[0]
    near_left_wall = _office(desk_x=80)
    side = [l for l in _by_name(generate_setups(near_left_wall, at=NOON, wake="07:00", bed="23:00"))["Bias + side lamp"]["lights"]
            if l["catalog"] == "floor-lamp"][0]
    assert side["x"] > 80


def test_proposed_lights_are_inside_the_room_and_never_glare_or_reflect():
    for room in (_office(), _office(width=260, height=260, desk_x=130)):
        for setup in generate_setups(room, at=NOON, wake="07:00", bed="23:00"):
            for light in setup["lights"]:
                assert point_in_polygon((light["x"], light["y"]), as_points(room.outline)), (setup["name"], light)
                assert light["role"] not in ("view", "behind"), (setup["name"], light)


def test_each_setup_reports_the_scenes_it_enables():
    setup = _by_name(generate_setups(_office(), at=NOON, wake="07:00", bed="23:00"))["Full desk"]
    assert set(setup["modes"]) == {"code", "work", "read", "relax"}
    code = setup["modes"]["code"]
    assert code["palette"] and code["summary"]
    assert len(code["preview"]) == len(setup["lights"])


def test_no_desk_gives_one_ambient_setup_with_a_hint():
    room = Room(name="Hall", outline=[[0, 0], [300, 0], [300, 300], [0, 300]])
    setups = generate_setups(room, at=NOON, wake="07:00", bed="23:00")
    assert len(setups) == 1 and setups[0]["name"] == "Ambient corners"
    assert "desk" in setups[0]["hint"].lower()


def _jpeg():
    buffer = io.BytesIO()
    Image.new("RGB", (300, 200), (90, 90, 90)).save(buffer, "JPEG")
    return buffer.getvalue()


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.add_room("Den", 400, 400)
    service.update_room("Den", furniture=[
        {"kind": "desk", "x": 200, "y": 150, "width": 140, "depth": 70},
        {"kind": "monitor-27", "x": 200, "y": 130, "width": 61, "depth": 20},
    ])
    return service


def test_adding_a_setup_creates_planned_lights(service):
    added = service.add_setup("Den", 1)
    room = service.get_room("Den")
    assert len(added) == 2 and all(light.planned for light in room.lights)
    assert {light.product["catalog"] for light in room.lights} == {"gradient-strip", "floor-lamp"}
    with pytest.raises(ValueError):
        service.add_setup("Den", 9)


FLOOR = {"photo": [[0.1, 0.9], [0.9, 0.9], [0.7, 0.5], [0.3, 0.5]], "plan": [[0, 400], [400, 400], [400, 0], [0, 0]]}


def test_floor_mapping_is_stored_and_checked(service):
    service.set_room_photo("Den", _jpeg())
    room = service.set_floor_transform("Den", FLOOR["photo"], FLOOR["plan"])
    assert room.photo.floor_transform == FLOOR
    with pytest.raises(ValueError):
        service.set_floor_transform("Den", FLOOR["photo"][:3], FLOOR["plan"][:3])
    with pytest.raises(ValueError):
        service.set_floor_transform("Den", [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.5, 0.9]], FLOOR["plan"])  # three in a line
    with pytest.raises(ValueError):
        service.set_floor_transform("Den", [[1.5, 0.1], [0.9, 0.9], [0.7, 0.5], [0.3, 0.5]], FLOOR["plan"])
    assert service.set_floor_transform("Den", None, None).photo.floor_transform is None


def test_api_and_cli(service, db_path, capsys):
    web = TestClient(create_app(db_path))
    setups = web.get("/api/rooms/Den/setups").json()
    assert len(setups) == 4 and setups[0]["lights"]
    added = web.post("/api/rooms/Den/setups/apply", json={"index": 0})
    assert added.status_code == 200 and added.json()[0]["planned"] is True
    service.set_room_photo("Den", _jpeg())
    assert web.put("/api/rooms/Den/photo/floor", json=FLOOR).status_code == 200
    assert web.delete("/api/rooms/Den/photo/floor").status_code == 200

    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, "setups", "--room", "Den"])
    assert caught.value.code == 0 and "Full desk" in capsys.readouterr().out
