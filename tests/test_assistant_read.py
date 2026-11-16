"""The assistant's reading tools: what the home holds, in centimetres, with no secrets."""

import json
import re
from pathlib import Path
from unittest.mock import ANY

import pytest
import requests

from myhuey.assistant import cm, catalog, get_room, in_layout, list_layouts, list_lights, list_rooms, list_scenes, suggest
from myhuey.errors import LayoutNotFound, RoomNotFound
from myhuey.models import FURNITURE_SIZES
from myhuey.service import HueRoomService

from conftest import LIGHTS, TABLE, USERNAME


def test_list_and_get_room(service):
    (den,) = list_rooms(service)
    assert den == {"name": "Den", "width": 400, "depth": 400, "ceiling": 244.0, "units": ANY, "lights": 3, "has_desk": True, "has_screen": True}
    room = get_room(service, "den")  # names are matched ignoring case
    assert "photo" not in room and room["lights"][0]["resolved_roles"]["desk"] in ("task", "bias", "view", "behind", "ambient")
    with pytest.raises(RoomNotFound):
        get_room(service, "Garage")


def test_catalog_matches_the_web_app():
    rows = re.findall(r"\{ kind: '([\w-]+)', label: '([^']+)', width: (\d+), depth: (\d+)(?:, shape: '(\w+)')? \}", Path("frontend/src/components/Shapes.tsx").read_text())
    assert {kind: (label, float(w), float(d), shape or "rect") for kind, label, w, d, shape in rows} == FURNITURE_SIZES
    desk = next(item for item in catalog()["furniture"] if item["kind"] == "desk")
    assert desk == {"kind": "desk", "label": "Desk", "width": 140.0, "depth": 70.0, "shape": "rect", "elevation": 0, "height": 75}
    assert {item["id"] for item in catalog()["lights"]} >= {"gradient-strip", "desk-lamp"}


@pytest.mark.parametrize("value, expected", [(350, 350), ("350", 350), ("12ft", 365.76), ("3.8m", 380), ("12' 6\"", 381)])
def test_cm_reads_lengths(value, expected):
    assert cm(value, "Width") == pytest.approx(expected)


@pytest.mark.parametrize("value", ["big", -5, 0, "", None])
def test_cm_refuses_nonsense(value):
    with pytest.raises(ValueError, match="Use a number of centimetres, or a length such as 12ft"):
        cm(value, "Width")


def test_lights_with_no_bridge_or_a_silent_one(db_path, fake_bridge):
    assert list_lights(HueRoomService(db_path)) == {"bridge": "not paired", "detail": ANY, "lights": []}

    silent = HueRoomService(db_path)
    silent.set_bridge("10.0.0.77", USERNAME)
    fake_bridge(requests.exceptions.ConnectTimeout("no answer"))
    result = list_lights(silent)
    assert result == {"bridge": "not answering", "detail": ANY, "lights": []}

    answering = HueRoomService(db_path)
    answering.sleep = lambda seconds: None
    answering.add_room("Den", 400, 400)
    answering.assign_light("Den", "1", x=100, y=100, product=TABLE)
    fake_bridge(LIGHTS)
    result = list_lights(answering)
    assert result["bridge"] == "ok" and len(result["lights"]) == 3
    desk_lamp = next(light for light in result["lights"] if light["id"] == "1")
    assert desk_lamp["brightness"] == 100 and desk_lamp["rooms"] == ["Den"]
    assert next(light for light in result["lights"] if light["id"] == "2")["rooms"] == []
    assert USERNAME not in json.dumps(result)


def test_layout_scope_and_secrets(service):
    sandbox = service.new_layout("Try")
    with in_layout(service, "try"):
        service.add_room("Loft", 300, 300)
    assert [r["name"] for r in list_rooms(service)] == ["Den"]
    assert {r["name"] for r in list_rooms(service, layout=sandbox["id"])} == {"Loft"}
    with pytest.raises(LayoutNotFound):
        list_rooms(service, layout="nope")
    assert USERNAME not in json.dumps([list_rooms(service), get_room(service, "Den"), list_layouts(service), list_scenes(service), catalog()])


def test_scenes_and_layouts_are_listed(service):
    service.save_scene({"name": "Calm", "room": "Den", "overrides": {"1": {"brightness": 40}}})
    (scene,) = list_scenes(service, room="den")
    assert scene == {"id": ANY, "name": "Calm", "room": "Den", "lights": 1}
    assert list_scenes(service, room="Den") == [scene]
    with pytest.raises(RoomNotFound):
        list_scenes(service, room="Garage")
    (home,) = list_layouts(service)
    assert home == {"id": ANY, "name": ANY, "active": True, "rooms": 1, "scenes": 1}


def test_suggest_returns_overrides_per_light(service):
    first = suggest(service, "Den", "code", at="14:00")[0]
    assert set(first["lights"]) == {"1", "2", "3"} and first["kelvin"] > 2000
    assert set(first) == {"name", "kelvin", "roles", "lights"}
