"""Desk designs: a library of desks made once and placed into rooms as locked desk sets."""

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app

ITEMS = [
    {"key": "desk", "kind": "desk", "x": 0, "y": 0, "width": 140, "depth": 70},
    {"key": "g9", "kind": "monitor-49", "x": 0, "y": -20, "width": 119.8, "depth": 12, "height": 33.7, "elevation": 82, "curve": 1000},
    {"key": "chair", "kind": "chair", "x": 0, "y": 60, "width": 50, "depth": 50, "seat": 46},
]
LIGHTS = [{"key": "halo", "catalog": "play-gradient-tv", "x": 0, "y": 0, "length": 203, "mount": {"screen": "g9"}}]


def _design(service, name="Coding desk"):
    return service.create_desk(name, ITEMS, LIGHTS)


def test_create_list_rename_delete(service):
    made = _design(service)
    assert [d["name"] for d in service.desks()] == ["Coding desk"]
    assert made["lights"][0]["catalog"] == "play-gradient-tv" and "light_id" not in made["lights"][0]
    assert service.update_desk(made["id"], name="Main desk")["name"] == "Main desk"
    service.delete_desk(made["id"])
    assert service.desks() == []


def test_names_are_unique(service):
    _design(service)
    with pytest.raises(ValueError, match="already exists"):
        _design(service, "coding DESK")


def test_a_design_checks_its_mounts_and_lights(service):
    with pytest.raises(ValueError, match="mounted on"):
        service.create_desk("Bad", ITEMS, [{**LIGHTS[0], "mount": {"screen": "nope"}}])
    with pytest.raises(ValueError, match="catalog"):
        service.create_desk("Bad", ITEMS, [{**LIGHTS[0], "catalog": "lava-lamp"}])


def test_placing_stamps_a_locked_copy(service):
    design = _design(service)
    out = service.place_desk("Den", design["id"], x=200, y=300, rotation=180)
    room = service.get_room("Den")
    entry = next(e for e in room.desk_sets if e["id"] == out["set"])
    members = [item for item in room.furniture if item.set == out["set"]]
    assert entry["name"] == "Coding desk" and len(members) == 3
    desk = next(item for item in members if item.id == entry["base"])
    assert (desk.kind, desk.x, desk.y, desk.rotation) == ("desk", 200, 300, 180)
    g9 = next(item for item in members if item.kind == "monitor-49")
    assert (g9.x, g9.y, g9.curve) == (200, 320, 1000)  # turned 180°: local -20 lands at +20
    halo = next(light for light in room.lights if light.set == out["set"])
    assert halo.planned and halo.light_id.startswith("planned-") and halo.mount == {"screen": g9.id}
    assert halo.product["catalog"] == "play-gradient-tv" and halo.role == "bias"


def test_placing_twice_makes_two_separate_sets(service):
    design = _design(service)
    first = service.place_desk("Den", design["id"], x=100, y=300)
    second = service.place_desk("Den", design["id"], x=300, y=300)
    room = service.get_room("Den")
    assert first["set"] != second["set"]
    ids = [item.id for item in room.furniture]
    assert len(ids) == len(set(ids))
    for set_id in (first["set"], second["set"]):
        screen = next(item for item in room.furniture if item.set == set_id and item.kind == "monitor-49")
        assert next(light for light in room.lights if light.set == set_id).mount == {"screen": screen.id}


def test_editing_a_placed_set_keeps_ids_and_releases_dropped_real_lights(service):
    design = _design(service)
    set_id = service.place_desk("Den", design["id"], x=200, y=300)["set"]
    service.assign_light("Den", "1", x=200, y=300)
    config = service._load()
    next(light for light in service._room_data(config, "Den")["lights"] if light["light_id"] == "1")["set"] = set_id
    service._save(config)
    local = service.desk_set_local("Den", set_id)
    g9 = next(item for item in local["items"] if item["kind"] == "monitor-49")
    g9["y"] = -25
    kept_lights = [light for light in local["lights"] if light.get("light_id") != "1"]  # drop real light 1
    room = service.apply_desk_set("Den", set_id, local["items"], kept_lights)
    moved = next(item for item in room.furniture if item.id == g9["id"])
    assert moved.y == 275 and moved.set == set_id
    real = next(light for light in room.lights if light.light_id == "1")
    assert real.set is None and (real.x, real.y) == (200, 300)  # released, not removed


def test_editing_a_placed_set_removes_a_dropped_planned_light(service):
    set_id = service.place_desk("Den", _design(service)["id"], x=200, y=300)["set"]
    local = service.desk_set_local("Den", set_id)
    room = service.apply_desk_set("Den", set_id, local["items"], [])
    assert not any(light.set == set_id or light.light_id.startswith("planned-") for light in room.lights)


def test_saving_a_set_with_a_real_light_stores_a_catalog_light_only(service):
    set_id = service.place_desk("Den", _design(service)["id"], x=200, y=300)["set"]
    service.assign_light("Den", "9", x=200, y=290, product={"archetype": "huelightstriptv", "productname": "Hue play gradient lightstrip"})
    service.assign_light("Den", "8", x=210, y=290, product={"archetype": "candlebulb"})
    config = service._load()
    for light in service._room_data(config, "Den")["lights"]:
        if light["light_id"] in ("8", "9"):
            light["set"] = set_id
    service._save(config)
    out = service.desk_from_set("Den", set_id, "From the den")
    catalogs = sorted(light["catalog"] for light in out["design"]["lights"])
    assert catalogs == ["play-gradient-tv", "play-gradient-tv"]
    assert not any("light_id" in light for light in out["design"]["lights"])
    assert out["skipped"] == ["Light 8"]
    assert [d["name"] for d in service.desks()] == ["Coding desk", "From the den"]


def test_api_round_trip(service, db_path):
    web = TestClient(create_app(db_path, pairing_window=5))
    made = web.post("/api/desks", json={"name": "Desk A", "items": ITEMS, "lights": LIGHTS})
    assert made.status_code == 200
    design = made.json()["id"]
    assert [d["name"] for d in web.get("/api/desks").json()] == ["Desk A"]
    placed = web.post("/api/rooms/Den/desks", json={"design": design, "x": 200, "y": 300, "rotation": 0})
    assert placed.status_code == 200
    set_id = placed.json()["set"]
    local = web.get(f"/api/rooms/Den/sets/{set_id}").json()
    applied = web.put(f"/api/rooms/Den/sets/{set_id}", json=local)
    assert applied.status_code == 200
    saved = web.post(f"/api/rooms/Den/sets/{set_id}/design", json={"name": "Desk B"})
    assert saved.status_code == 200 and saved.json()["design"]["name"] == "Desk B"
    assert web.patch(f"/api/desks/{design}", json={"name": "Desk C"}).json()["name"] == "Desk C"
    assert web.delete(f"/api/desks/{design}").status_code == 200
    assert web.post("/api/rooms/Den/desks", json={"design": "nope", "x": 0, "y": 0}).status_code in (400, 404)
    # Designs are app-wide: a stale sandbox header does not block them.
    assert web.get("/api/desks", headers={"X-Myhuey-Layout": "gone"}).status_code == 200


def test_assistant_places_only_in_a_sandbox(service):
    from myhuey.assistant import TOOLS, create_sandbox, desk_designs, place_desk
    assert {"desk_designs", "place_desk"} <= set(TOOLS)
    _design(service)
    assert [d["name"] for d in desk_designs(service)] == ["Coding desk"]
    before = service.get_room("Den").to_dict()
    with pytest.raises(Exception, match="sandbox"):
        place_desk(service, None, "Den", "Coding desk", x=200, y=300)
    box = create_sandbox(service, "Desk idea", copy_from="active")
    out = place_desk(service, box["id"], "Den", "Coding desk", x=200, y=300)
    assert len(out["desk_sets"]) == 1
    assert service.get_room("Den").to_dict() == before


def test_a_piece_without_a_size_takes_its_catalog_size_and_curve(service):
    made = service.create_desk("Bare", [{"key": "desk", "kind": "desk"}, {"key": "g9", "kind": "monitor-49", "y": -16}])
    g9 = made["items"][1]
    assert (g9["width"], g9["depth"], g9["height"], g9["curve"], g9["label"]) == (119.8, 12.0, 33.7, 1000.0, 'Super ultrawide 49"')
