"""Suggestions and palettes through the service, the web API, and the CLI."""

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.cli import main
from myhuey.service import HueRoomService

from conftest import USERNAME

TABLE = {"archetype": "tableshade", "productname": "Hue color lamp"}
STRIP = {"archetype": "huelightstrip", "productname": "Hue lightstrip plus"}


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Den", 400, 400)
    service.update_room("Den", furniture=[
        {"kind": "desk", "x": 200, "y": 150, "width": 140, "depth": 70},
        {"kind": "monitor-27", "x": 200, "y": 130, "width": 61, "depth": 20},
    ])
    service.assign_light("Den", "1", x=260, y=160, product=TABLE)
    service.assign_light("Den", "2", x=390, y=190, product=TABLE)
    service.assign_light("Den", "3", x=200, y=115, product=STRIP)
    return service


def _no_bridge_writes(session):
    return not [call for call in session.calls if call["method"] == "PUT"]


def test_service_suggest_previews_without_writing(service, fake_bridge):
    session = fake_bridge()
    before = service._load()
    items = service.suggest("Den", "code", at="22:00", count=3)
    assert len(items) == 3
    assert all(item["preview"] and item["scene"]["origin"]["at"] == "22:00" for item in items)
    assert service._load() == before and _no_bridge_writes(session)


def test_api_suggest(service, db_path):
    web = TestClient(create_app(db_path))
    response = web.post("/api/rooms/Den/suggest", json={"mode": "work", "at": "12:00", "count": 2})
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert {"scene", "palette", "roles", "preview"} <= set(body[0])
    assert body[0]["roles"]["1"] == "task"


def test_api_suggest_rejects_bad_input(service, db_path):
    web = TestClient(create_app(db_path))
    assert web.post("/api/rooms/Den/suggest", json={"mode": "party"}).status_code == 400
    assert web.post("/api/rooms/Nowhere/suggest", json={"mode": "code"}).status_code == 404
    assert web.post("/api/rooms/Den/suggest", json={"mode": "code", "count": 9}).status_code == 422
    assert web.post("/api/rooms/Den/suggest", json={"mode": "code", "at": "25:00"}).status_code == 422


def test_api_apply_unsaved_suggestion(service, db_path, fake_bridge):
    raw = {key: {"name": key, "state": {"on": True, "bri": 10, "xy": [0.3, 0.3], "ct": 300}} for key in ("1", "2", "3")}
    session = fake_bridge(raw, *([[{"success": {}}]] * 3))
    web = TestClient(create_app(db_path))
    scene = web.post("/api/rooms/Den/suggest", json={"mode": "code", "at": "12:00", "count": 1}).json()[0]["scene"]
    response = web.post("/api/rooms/Den/suggest/apply", json=scene)
    assert response.status_code == 200
    assert [call for call in session.calls if call["method"] == "PUT"]
    assert web.get("/api/scenes?room=Den").json() == []  # previewing saves nothing


def test_api_palettes(service, db_path):
    web = TestClient(create_app(db_path))
    warm = web.get("/api/palettes?tag=warm&limit=5").json()
    assert 0 < len(warm) <= 5 and all("warm" in p["tags"] for p in warm)


def test_room_json_has_resolved_roles_per_focus(service, db_path):
    room = TestClient(create_app(db_path)).get("/api/rooms/Den").json()
    roles = {light["light_id"]: light["resolved_roles"] for light in room["lights"]}
    assert {key: value["desk"] for key, value in roles.items()} == {"1": "task", "2": "ambient", "3": "bias"}
    assert {key: value["sofa"] for key, value in roles.items()} == {"1": "ambient", "2": "ambient", "3": "ambient"}  # no sofa
    assert roles["3"]["read"] == "view"  # read sits at the desk, and with no screen the strip is in view
    assert all("resolved_role" not in light for light in room["lights"])


def _cli(db_path, *argv):
    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, *argv])
    return caught.value.code


def test_cli_suggest_and_save(service, db_path, capsys):
    assert _cli(db_path, "suggest", "--room", "Den", "--mode", "code", "--at", "22:00", "--save", "Late") == 0
    scenes = service.scenes("Den")
    assert [scene.name for scene in scenes] == ["Late"] and scenes[0].origin["mode"] == "code"
    assert "Late" in capsys.readouterr().out


def test_cli_suggest_lists_without_saving(service, db_path, capsys):
    assert _cli(db_path, "suggest", "--room", "Den", "--mode", "relax", "--count", "2") == 0
    out = capsys.readouterr().out
    assert out.count("Chill ·") == 2 and service.scenes("Den") == []


def test_cli_palettes(service, db_path, capsys):
    assert _cli(db_path, "palettes", "--tag", "warm", "--limit", "3") == 0
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    assert len(lines) == 3 and all("#" in line for line in lines)


def test_preview_matches_the_capped_scene(service, fake_bridge):
    fake_bridge()
    glare = {"checked": True, "caps": {"1": {"brightness": 15, "kelvin": None, "reason": "direct"}}}
    for item in service.suggest("Den", "code", at="12:00", glare=glare):
        shown = next(light for light in item["preview"] if light["light_id"] == "1")
        assert shown["brightness"] <= 15
        assert item["scene"]["overrides"]["1"]["brightness"] <= 15


def test_api_accepts_glare_and_chill(service, db_path):
    web = TestClient(create_app(db_path))
    body = {"mode": "chill", "at": "20:00", "count": 1, "glare": {"checked": False, "caps": {}}}
    response = web.post("/api/rooms/Den/suggest", json=body)
    assert response.status_code == 200 and response.json()[0]["guide"]["checked"] is False
    assert response.json()[0]["guide"]["glare"] == ["Glare is checked for the desk presets (Code, Work, Study)."]


def test_cli_accepts_chill(service, db_path, capsys):
    assert _cli(db_path, "suggest", "--room", "Den", "--mode", "chill", "--at", "20:00", "--count", "1") == 0
    assert "Chill" in capsys.readouterr().out


@pytest.mark.parametrize("glare", [
    {"checked": True, "caps": {"1": {"brightness": 15}}},
    {"checked": True, "caps": {"1": {"brightness": 15, "kelvin": None, "reason": "bogus"}}},
    {"checked": True, "caps": {"1": {"brightness": "high", "kelvin": None, "reason": "direct"}}},
    {"checked": True, "caps": [1]},
    {"caps": {}},
    {"checked": True, "caps": {"1": {"brightness": 0, "kelvin": None, "reason": "direct"}}},
    {"checked": True, "caps": {"1": {"brightness": 18, "kelvin": 1500, "reason": "reflection"}}},
    {"checked": True, "caps": {"1": {"brightness": 18, "kelvin": 7000, "reason": "reflection"}}},
    {"checked": True, "caps": {str(i): {"brightness": 15, "kelvin": None, "reason": "direct"} for i in range(65)}},
])
def test_api_rejects_a_malformed_glare(service, db_path, glare):
    web = TestClient(create_app(db_path))
    response = web.post("/api/rooms/Den/suggest", json={"mode": "code", "glare": glare})
    assert response.status_code == 422


def test_api_accepts_glare_limits_at_their_bounds(service, db_path):
    web = TestClient(create_app(db_path))
    caps = {str(i): {"brightness": 1, "kelvin": 2000 if i % 2 else 6500, "reason": "reflection"} for i in range(64)}
    response = web.post("/api/rooms/Den/suggest", json={"mode": "code", "count": 1, "glare": {"checked": True, "caps": caps}})
    assert response.status_code == 200
