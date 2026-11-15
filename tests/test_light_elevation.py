"""Placed lights have a height (automatic from the product unless set) and a pinnable role."""

import json

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.cli import main
from myhuey.migrations import CURRENT_VERSION, migrate
from myhuey.models import Furniture, LayoutLight, Room
from myhuey.placement import resolved_elevation
from myhuey.service import HueRoomService


def _v3_document():
    return {
        "schema_version": 3,
        "rooms": [{"name": "Office", "outline": [[0, 0], [400, 0], [400, 300], [0, 300]],
                   "lights": [{"light_id": "1", "label": "Lamp", "x": 10, "y": 10}],
                   "furniture": [], "openings": [], "ceiling": 244.0}],
        "home": {"plan": None},
    }


def test_v3_document_migrates_to_v4_with_auto_fields():
    upgraded, start = migrate(_v3_document())
    assert start == 3 and upgraded["schema_version"] == CURRENT_VERSION >= 4
    light = upgraded["rooms"][0]["lights"][0]
    assert light["elevation"] is None and light["role"] == "auto"


def _room_with(archetype, furniture_kind=None):
    furniture = []
    if furniture_kind:
        furniture.append(Furniture.from_dict({"kind": furniture_kind, "x": 100, "y": 100, "width": 140, "depth": 70}))
    product = {"archetype": archetype} if archetype else {}
    light = LayoutLight(light_id="1", label="L", x=100, y=100, product=product)
    return light, Room(name="R", furniture=furniture)


@pytest.mark.parametrize("archetype,furniture,expected", [
    ("ceilinground", None, 244), ("pendantround", None, 184), ("recessedceiling", None, 244),
    ("floorshade", None, 150), ("tableshade", None, 115), ("tableshade", "desk", 115),
    ("tableshade", "desk-standing", 150), ("huelightstrip", None, 0), ("huelightstrip", "desk", 75),
    (None, None, 150),
])
def test_resolved_elevation(archetype, furniture, expected):
    light, room = _room_with(archetype, furniture)
    assert resolved_elevation(light, room) == expected


def test_a_light_beside_the_furniture_is_not_on_it():
    light, room = _room_with("huelightstrip", "desk")
    light.x = 300
    assert resolved_elevation(light, room) == 0


def test_ceiling_lights_follow_the_room_ceiling():
    light, room = _room_with("ceilinground")
    room.ceiling = 300
    assert resolved_elevation(light, room) == 300


def test_an_explicit_elevation_wins():
    light, room = _room_with("ceilinground")
    light.elevation = 90
    assert resolved_elevation(light, room) == 90


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.add_room("Den", 400, 300)
    service.assign_light("Den", "1", x=100, y=100)
    return service


def test_explicit_elevation_is_kept_and_auto_clears_it(service):
    service.assign_light("Den", "1", x=100, y=100, elevation=90)
    assert service.get_room("Den").lights[0].elevation == 90
    service.assign_light("Den", "1", x=120, y=100)  # moving keeps it
    assert service.get_room("Den").lights[0].elevation == 90
    service.assign_light("Den", "1", x=120, y=100, elevation="auto")
    assert service.get_room("Den").lights[0].elevation is None


def test_elevation_is_bounded(service):
    with pytest.raises(ValueError):
        service.assign_light("Den", "1", elevation=2000)


def test_role_must_be_pinnable(service):
    service.assign_light("Den", "1", role="bias")
    assert service.get_room("Den").lights[0].role == "bias"
    with pytest.raises(ValueError):
        service.assign_light("Den", "1", role="ambient")


def test_the_api_places_with_elevation_and_role_and_reports_the_resolved_height(service, db_path):
    web = TestClient(create_app(db_path))
    placed = web.post("/api/rooms/Den/lights", json={"light_id": "1", "x": 50, "y": 50, "elevation": 120, "role": "task"})
    assert placed.status_code == 200
    room = web.get("/api/rooms/Den").json()
    assert room["lights"][0]["elevation"] == 120 and room["lights"][0]["role"] == "task"
    assert room["lights"][0]["resolved_elevation"] == 120
    web.post("/api/rooms/Den/lights", json={"light_id": "1", "x": 50, "y": 50, "elevation": "auto"})
    assert web.get("/api/rooms/Den").json()["lights"][0]["resolved_elevation"] == 150
    assert web.post("/api/rooms/Den/lights", json={"light_id": "1", "role": "nope"}).status_code in (400, 422)


def test_cli_assign_accepts_elevation_and_role(service, db_path, capsys):
    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, "room", "assign", "--name", "Den", "--light-id", "1", "--x", "5", "--y", "5",
              "--elevation", "120cm", "--role", "bias"])
    assert caught.value.code == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["elevation"] == 120 and printed["role"] == "bias"
    with pytest.raises(SystemExit):
        main(["--db", db_path, "room", "assign", "--name", "Den", "--light-id", "1", "--x", "5", "--y", "5", "--elevation", "auto"])
    assert service.get_room("Den").lights[0].elevation is None
