"""Planned lights: catalog products placed in a room before they exist, skipped by the bridge."""

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from myhuey.api import create_app
from myhuey.catalog import CATALOG, catalog_item
from myhuey.cli import main
from myhuey.models import LayoutLight
from myhuey.scenes import Scene, placed_profile
from myhuey.service import HueRoomService
from myhuey.suggest import suggest

from conftest import USERNAME


def _jpeg():
    buffer = io.BytesIO()
    Image.new("RGB", (300, 200), (90, 90, 90)).save(buffer, "JPEG")
    return buffer.getvalue()


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Den", 400, 300)
    service.assign_light("Den", "1", x=50, y=50, product={"archetype": "sultanbulb"})
    return service


def test_catalog_items_are_complete_and_resolve_to_real_profiles():
    assert len(CATALOG) >= 10
    for item in CATALOG.values():
        assert item.color in ("gradient", "color", "white")
        assert item.kind in ("bias", "task", "side", "ambient")
        profile = placed_profile(LayoutLight(light_id="x", label="x", product=item.product()))
        assert profile.gradient == (item.color == "gradient"), item.id
    with pytest.raises(ValueError):
        catalog_item("nope")


def test_planned_lights_round_trip(service):
    light = service.add_planned_light("Den", "floor-lamp", x=120, y=80)
    assert light.planned and light.light_id.startswith("planned-")
    room = service.get_room("Den")
    stored = next(item for item in room.lights if item.light_id == light.light_id)
    assert stored.planned and stored.product["catalog"] == "floor-lamp"
    assert LayoutLight.from_dict({"light_id": "7"}).planned is False  # older documents read unchanged


def test_planned_light_positions_are_checked(service):
    with pytest.raises(ValueError):
        service.add_planned_light("Den", "nope", x=1, y=1)


def test_apply_power_and_brightness_skip_planned_lights(service, fake_bridge):
    planned = service.add_planned_light("Den", "table-lamp", x=200, y=150)
    raw = {"1": {"name": "Lamp", "state": {"on": True, "bri": 100, "xy": [0.3, 0.3]}}}
    scene = Scene.from_dict({"name": "s", "room": "Den", "base_mode": "color", "base_color": "#ff8800"})
    ok = [{"success": {}}]
    # One session for all three (the service keeps its client): apply reads then PUTs; power
    # PUTs, reads back (still on, so it resends once); brightness reads then PUTs.
    session = fake_bridge(raw, ok, ok, raw, ok, raw, ok)
    results = {item["light_id"]: item for item in service.apply_scene_object(scene)}
    assert results[planned.light_id]["planned"] is True and results[planned.light_id]["applied"] is False
    assert "error" not in results[planned.light_id]

    service.set_room_power("Den", False)
    service.set_room_brightness("Den", 40)
    touched = [call["url"] for call in session.calls if call["method"] == "PUT"]

    assert len(touched) == 4 and not any("planned" in url for url in touched)


def test_swap_turns_a_planned_light_into_a_real_one(service):
    service.set_room_photo("Den", _jpeg())
    planned = service.add_planned_light("Den", "desk-lamp", x=200, y=150)
    service.assign_light("Den", planned.light_id, x=210, y=150, elevation=90, role="task")
    service.set_photo_tags("Den", {f"light:{planned.light_id}": {"x": 0.4, "y": 0.5}})

    real = service.swap_planned_light("Den", planned.light_id, "26")

    room = service.get_room("Den")
    assert real.light_id == "26" and not real.planned
    assert (real.x, real.y, real.elevation, real.role) == (210, 150, 90, "task")
    assert all(light.light_id != planned.light_id for light in room.lights)
    assert room.photo.tags == {"light:26": {"x": 0.4, "y": 0.5, "rotation": 0, "scale": 1}}


def test_swap_is_refused_for_a_light_already_in_the_room_or_a_real_source(service):
    planned = service.add_planned_light("Den", "go", x=10, y=10)
    with pytest.raises(ValueError):
        service.swap_planned_light("Den", planned.light_id, "1")
    with pytest.raises(ValueError):
        service.swap_planned_light("Den", "1", "26")


def test_white_only_planned_lights_get_white_in_suggestions(service):
    planned = service.add_planned_light("Den", "ceiling", x=390, y=290)
    from datetime import datetime
    item = suggest(service.get_room("Den"), "relax", at=datetime(2026, 1, 1, 20), wake="07:00", bed="23:00", count=1)[0]
    override = item["scene"].overrides[planned.light_id]
    assert "white" in override and "colors" not in override


def test_api_catalog_planned_and_swap(service, db_path):
    web = TestClient(create_app(db_path))
    assert any(item["id"] == "gradient-strip" for item in web.get("/api/catalog").json())
    created = web.post("/api/rooms/Den/planned-lights", json={"catalog": "spot", "x": 30, "y": 40})
    assert created.status_code == 200 and created.json()["planned"] is True
    planned_id = created.json()["light_id"]
    swapped = web.post(f"/api/rooms/Den/planned-lights/{planned_id}/swap", json={"light_id": "33"})
    assert swapped.status_code == 200 and swapped.json()["light_id"] == "33"
    assert web.post("/api/rooms/Den/planned-lights", json={"catalog": "zzz", "x": 1, "y": 1}).status_code == 400


def _cli(db_path, *argv):
    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, *argv])
    return caught.value.code


def test_cli_catalog_plan_and_swap(service, db_path, capsys):
    assert _cli(db_path, "catalog") == 0
    assert "gradient-strip" in capsys.readouterr().out
    assert _cli(db_path, "room", "plan-light", "--name", "Den", "--catalog", "floor-lamp", "--x", "100", "--y", "80") == 0
    planned_id = json.loads(capsys.readouterr().out)["light_id"]
    assert _cli(db_path, "room", "swap", "--name", "Den", "--light-id", planned_id, "--real", "40") == 0
    assert any(light.light_id == "40" for light in service.get_room("Den").lights)
