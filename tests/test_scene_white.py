"""Scenes can set a white temperature per light, and unsaved scenes can be applied."""

import pytest

from myhuey.scenes import Scene
from myhuey.service import HueRoomService

from conftest import USERNAME

BULB = {"archetype": "sultanbulb", "productname": "Hue color lamp", "modelid": "LCA003"}


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Den", 400, 300)
    service.assign_light("Den", "1", x=100, y=100, product=BULB)
    service.assign_light("Den", "5", x=300, y=150, product=BULB)
    return service


def _white_scene(**overrides):
    return Scene.from_dict({"name": "w", "room": "Den", "overrides": overrides})


def test_white_override_validates():
    with pytest.raises(ValueError):
        _white_scene(**{"1": {"white": 9000}})
    with pytest.raises(ValueError):
        _white_scene(**{"1": {"white": "warm"}})
    assert _white_scene(**{"1": {"white": 2700}}).overrides["1"]["white"] == 2700


def test_evaluate_reports_color_temp(service):
    scene = _white_scene(**{"1": {"white": 2700, "brightness": 40}})
    result = {item["light_id"]: item for item in service.preview_scene(scene)}["1"]
    assert result["on"] is True
    assert result["color_temp"] == 2700
    assert result["brightness"] == 40
    assert result["color"].startswith("#")
    assert result["gradient"] is None


def test_lights_without_a_white_have_no_color_temp(service):
    scene = _white_scene(**{"1": {"colors": ["#ff0000"]}})
    result = {item["light_id"]: item for item in service.preview_scene(scene)}["1"]
    assert result["color_temp"] is None


def test_apply_sends_ct_to_ct_lights_and_xy_to_color_only_lights(service, fake_bridge):
    raw = {
        "1": {"name": "A", "state": {"on": True, "bri": 10, "ct": 300},
              "capabilities": {"control": {"ct": {"min": 153, "max": 454}}}},
        "5": {"name": "B", "state": {"on": True, "bri": 10, "xy": [0.3, 0.3]}},
    }
    session = fake_bridge(raw, [{"success": {}}], [{"success": {}}])
    scene = _white_scene(**{"1": {"white": 2000}, "5": {"white": 2500}})

    results = service.apply_scene_object(scene)

    assert all(item["applied"] for item in results)
    puts = {call["url"].split("/")[-2]: call["json"] for call in session.calls if call["method"] == "PUT"}
    assert puts["1"]["ct"] == 454  # 2000 K is 500 mirek, clamped to this light's range
    assert "xy" not in puts["1"]
    assert "xy" in puts["5"] and "ct" not in puts["5"]


def test_origin_round_trips():
    origin = {"mode": "code", "palette_id": "gen-1", "palette_name": "Dusk", "at": "22:40"}
    scene = Scene.from_dict({"name": "x", "room": "Den", "origin": origin})
    assert scene.to_dict()["origin"] == origin
    assert Scene.from_dict({"name": "x", "room": "Den"}).to_dict()["origin"] is None


def test_a_white_only_bulb_given_a_color_gets_the_nearest_white(service, fake_bridge):
    raw = {"1": {"name": "A", "state": {"on": True, "bri": 10, "ct": 153},
                 "capabilities": {"control": {"ct": {"min": 153, "max": 454}}}},
           "5": {"name": "B", "state": {"on": True, "bri": 10, "xy": [0.3, 0.3]}}}
    session = fake_bridge(raw, [{"success": {}}], [{"success": {}}])
    scene = _white_scene(**{"1": {"colors": ["#ffb070"]}, "5": {"colors": ["#ffb070"]}})

    service.apply_scene_object(scene)

    puts = {call["url"].split("/")[-2]: call["json"] for call in session.calls if call["method"] == "PUT"}
    assert 333 <= puts["1"]["ct"] <= 454  # a warm amber lands as warm white (≤ 3000 K), not the old 6500 K
    assert "xy" in puts["5"]
