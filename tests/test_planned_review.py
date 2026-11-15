"""Fixes from the planned-lights review: swaps keep scenes working, planned lights stay planned,
floor mappings are sane, and proposed setups stay inside the room and out of the screens."""

from datetime import datetime

import pytest

from myhuey.geometry import as_points, point_in_polygon
from myhuey.models import Furniture, Room, floor_transform
from myhuey.roles import find_focus
from myhuey.scenes import Scene
from myhuey.service import HueRoomService
from myhuey.setups import generate_setups

from conftest import USERNAME

NOON = datetime(2026, 1, 1, 12)


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Den", 400, 300)
    return service


def test_swap_renames_the_light_in_saved_scenes(service):
    planned = service.add_planned_light("Den", "gradient-strip", x=100, y=100)
    service.save_scene(Scene.from_dict({"id": "s1", "name": "Code", "room": "Den",
                                        "overrides": {planned.light_id: {"white": 4000, "brightness": 15}}}).to_dict())
    service.swap_planned_light("Den", planned.light_id, "26")
    assert service.get_scene("s1").overrides == {"26": {"white": 4000, "brightness": 15}}


def test_planned_flag_is_written_with_the_light(service, monkeypatch):
    saves = []
    original = service._save
    monkeypatch.setattr(service, "_save", lambda config: (saves.append(1), original(config)))
    planned = service.add_planned_light("Den", "go", x=10, y=10)
    assert len(saves) == 1 and planned.planned


def test_direct_control_refuses_planned_lights(service):
    planned = service.add_planned_light("Den", "go", x=10, y=10)
    with pytest.raises(ValueError):
        service.set_light(planned.light_id, on=True)
    with pytest.raises(ValueError):
        service.set_gradient(planned.light_id, ["#ff0000", "#0000ff"])
    with pytest.raises(ValueError):
        service.set_effect(planned.light_id, "candle")


SQUARE_PLAN = [[0, 400], [400, 400], [400, 0], [0, 0]]


@pytest.mark.parametrize("photo,plan", [
    ([[0.1, 0.9], [0.9, 0.9], [0.5, 0.5005], [0.5, 0.5]], SQUARE_PLAN),  # nearly a triangle
    ([[0.1, 0.9], [0.9, 0.9], [0.3, 0.5], [0.7, 0.5]], SQUARE_PLAN),     # crossed (bowtie)
    ([[0.1, 0.9], [0.9, 0.9], [0.7, 0.5], [0.3, 0.5]], [[0, 0], [400, 0], [400, 400], [0, 400]]),  # mirrored winding
    ([[0.40, 0.50], [0.45, 0.50], [0.45, 0.52], [0.40, 0.52]], SQUARE_PLAN),  # too small on the photo
])
def test_bad_floor_mappings_are_refused(photo, plan):
    with pytest.raises(ValueError):
        floor_transform(photo, plan)


def test_a_good_floor_mapping_passes():
    assert floor_transform([[0.1, 0.9], [0.9, 0.9], [0.7, 0.5], [0.3, 0.5]], SQUARE_PLAN)


def _f(kind, x, y, width, depth, rotation=0):
    return Furniture.from_dict({"kind": kind, "x": x, "y": y, "width": width, "depth": depth, "rotation": rotation})


L_SHAPE = [[0, 0], [300, 0], [300, 250], [450, 250], [450, 430], [0, 430]]


def _all_inside(room):
    for setup in generate_setups(room, at=NOON, wake="07:00", bed="23:00"):
        for light in setup["lights"]:
            assert point_in_polygon((light["x"], light["y"]), as_points(room.outline)), (setup["name"], light)
            assert light["role"] not in ("view", "behind"), (setup["name"], light)


def test_monitor_against_the_wall_keeps_the_bias_strip_inside():
    room = Room(name="R", outline=[[0, 0], [400, 0], [400, 300], [0, 300]],
                furniture=[_f("desk", 200, 35, 140, 70), _f("monitor-27", 200, 10, 61, 16)])
    _all_inside(room)
    assert any(s["name"] == "Bias light" for s in generate_setups(room, at=NOON, wake="07:00", bed="23:00"))


def test_l_shaped_room_keeps_every_light_inside_and_skips_inner_corners():
    room = Room(name="R", outline=L_SHAPE, furniture=[_f("desk", 150, 60, 140, 70), _f("monitor-27", 150, 40, 61, 20)])
    _all_inside(room)
    full = [s for s in generate_setups(room, at=NOON, wake="07:00", bed="23:00") if s["name"] == "Full desk"]
    if full:
        washer = next(l for l in full[0]["lights"] if l["catalog"] == "wall-washer")
        assert (round(washer["x"]), round(washer["y"])) != (300, 250)  # never the inner corner


def test_a_desk_in_a_corner_still_gets_a_side_lamp_pulled_toward_the_seat():
    room = Room(name="R", outline=[[0, 0], [300, 0], [300, 300], [0, 300]],
                furniture=[_f("desk", 60, 60, 140, 70, rotation=315), _f("monitor-27", 45, 45, 61, 20, rotation=315)])
    names = [s["name"] for s in generate_setups(room, at=NOON, wake="07:00", bed="23:00")]
    assert "Bias + side lamp" in names
    _all_inside(room)


def test_with_two_monitors_the_desk_lamp_clears_both_screens():
    room = Room(name="R", outline=[[0, 0], [400, 0], [400, 300], [0, 300]],
                furniture=[_f("desk", 200, 60, 180, 70), _f("monitor-27", 170, 40, 61, 20), _f("monitor-27", 232, 40, 61, 20)])
    focus = find_focus(room, "desk")
    setup = next(s for s in generate_setups(room, at=NOON, wake="07:00", bed="23:00") if s["name"] == "Bias + desk lamp")
    lamp = next(l for l in setup["lights"] if l["catalog"] == "desk-lamp")
    assert abs(lamp["x"] - focus.screen[0]) >= focus.screen_half_width + 15
    assert lamp["role"] == "task"
