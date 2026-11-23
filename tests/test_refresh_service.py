import copy

import pytest

from conftest import USERNAME
from myhuey.errors import RefreshChanged
from myhuey.service import HueRoomService

TABLE = {"archetype": "tableshade", "productname": "Hue color lamp", "modelid": "X"}

BRIDGE_LIGHTS = {
    "1": {"name": "Bridge one", "productname": "Hue go", "modelid": "G1", "config": {"archetype": "huego"}},
    "2": {"name": "Bridge two", "productname": "Hue bulb", "modelid": "B1", "config": {"archetype": "sultanbulb"}},
}
BEFORE = {
    "1": {"name": "Office", "type": "Room", "lights": ["1", "2"]},
    "4": {"name": "Hallway", "type": "Room", "lights": []},
}
AFTER = {
    "1": {"name": "Office", "type": "Room", "lights": ["1"]},
    "4": {"name": "Hallway", "type": "Room", "lights": ["2"]},
}


@pytest.fixture
def paired(db_path):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Office")
    service.add_room("Hallway")
    service.assign_light("Office", "1", x=100, y=100, label="Desk")
    service.assign_light("Office", "2", x=200, y=100, label="Floor lamp", product=TABLE, length=80)
    config = service._load()
    for room in config["rooms"]:
        if room["name"] == "Office":
            room["photo"] = {"file": "a.jpg", "width": 10, "height": 10, "tags": {"light:2": {"x": 0.5, "y": 0.5}, "light:1": {"x": 0.1, "y": 0.1}}}
    service._save(config)
    return service


def rooms_by_name(service):
    return {room.name: room for room in service.rooms()}


def test_apply_moves_a_light_between_rooms_in_one_save_and_marks_it_arrived(paired, fake_bridge):
    fake_bridge(BRIDGE_LIGHTS, AFTER, BRIDGE_LIGHTS, AFTER)  # preview, then apply, each read lights then groups
    preview = paired.refresh_preview()
    result = paired.refresh_rooms(preview["fingerprint"])
    assert result["fingerprint"] == preview["fingerprint"]

    rooms = rooms_by_name(paired)
    assert [l.light_id for l in rooms["Office"].lights] == ["1"]
    assert "light:2" not in (rooms["Office"].photo.tags if rooms["Office"].photo else {})
    assert "light:1" in rooms["Office"].photo.tags
    (arrived,) = rooms["Hallway"].lights
    assert (arrived.light_id, arrived.x, arrived.y) == ("2", 40, 40)
    assert arrived.metadata == {"arrived": True}
    assert (arrived.label, arrived.product, arrived.length) == ("Floor lamp", TABLE, 80)
    assert (arrived.rotation, arrived.elevation, arrived.role, arrived.planned, arrived.on, arrived.brightness) == (0, None, "auto", False, True, 255)
    assert (rooms["Office"].hue_room, rooms["Hallway"].hue_room) == ("1", "4")


def test_apply_refuses_when_the_bridge_changed_since_the_preview_and_saves_nothing(paired, fake_bridge):
    session = fake_bridge(BRIDGE_LIGHTS, AFTER)
    fp = paired.refresh_preview()["fingerprint"]
    changed = copy.deepcopy(AFTER)
    changed["1"]["lights"] = []
    session.answers = [BRIDGE_LIGHTS, changed]
    before = [r.to_dict() for r in paired.rooms()]
    with pytest.raises(RefreshChanged, match="Look again before applying"):
        paired.refresh_rooms(fp)
    assert [r.to_dict() for r in paired.rooms()] == before


def test_a_light_that_moves_into_a_new_hue_room_keeps_its_label_product_and_length(paired, fake_bridge):
    groups = {"1": {"name": "Office", "type": "Room", "lights": ["1"]}, "7": {"name": "Den", "type": "Room", "lights": ["2"]}}
    fake_bridge(BRIDGE_LIGHTS, groups, BRIDGE_LIGHTS, groups)
    paired.refresh_rooms(paired.refresh_preview()["fingerprint"])
    rooms = rooms_by_name(paired)
    (light,) = rooms["Den"].lights
    assert (light.label, light.product, light.length) == ("Floor lamp", TABLE, 80)
    assert (light.x, light.y, light.metadata) == (75, 75, {})
    assert rooms["Den"].hue_room == "7"
    assert (rooms["Den"].x, rooms["Den"].y) == (2 * 500.0, 0.0)  # third grid spot
    assert [l.light_id for l in rooms["Office"].lights] == ["1"]


def test_a_new_room_light_with_no_stored_record_takes_the_bridge_product(paired, fake_bridge):
    groups = {"1": {"name": "Office", "type": "Room", "lights": ["1", "2"]}, "7": {"name": "Den", "type": "Room", "lights": ["5"]}}
    lights = {**BRIDGE_LIGHTS, "5": BRIDGE_LIGHTS["1"]}
    fake_bridge(lights, groups, lights, groups)
    paired.refresh_rooms(paired.refresh_preview()["fingerprint"])
    (light,) = rooms_by_name(paired)["Den"].lights
    assert (light.label, light.length) == ("Bridge one", None)
    assert light.product == {"archetype": "huego", "productname": "Hue go", "modelid": "G1"}


def test_refresh_preview_never_writes_to_the_bridge(paired, fake_bridge):
    session = fake_bridge(BRIDGE_LIGHTS, AFTER)
    paired.refresh_preview()
    assert session.calls and all(c["method"] == "GET" for c in session.calls)
    assert all(c["method"] == "GET" for c in session.clip_calls)


def test_moving_an_arrived_light_clears_its_mark_and_other_edits_keep_it(paired, fake_bridge):
    fake_bridge(BRIDGE_LIGHTS, AFTER, BRIDGE_LIGHTS, AFTER)
    paired.refresh_rooms(paired.refresh_preview()["fingerprint"])
    paired.assign_light("Hallway", "2", x=40, y=40, label="Renamed", rotation=30)
    assert rooms_by_name(paired)["Hallway"].lights[0].metadata == {"arrived": True}
    paired.assign_light("Hallway", "2", x=90, y=40)
    assert rooms_by_name(paired)["Hallway"].lights[0].metadata == {}


def test_import_links_the_rooms_it_adds(db_path, fake_bridge):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    fake_bridge(BRIDGE_LIGHTS, BEFORE)
    service.import_rooms()
    assert {r.name: r.hue_room for r in service.rooms()} == {"Office": "1", "Hallway": "4"}


def test_refresh_rooms_never_writes_to_the_bridge(paired, fake_bridge):
    session = fake_bridge(BRIDGE_LIGHTS, AFTER, BRIDGE_LIGHTS, AFTER)
    paired.refresh_rooms(paired.refresh_preview()["fingerprint"])
    assert session.calls and all(c["method"] == "GET" for c in session.calls)
    assert all(c["method"] == "GET" for c in session.clip_calls)


def test_an_unchanged_room_only_gets_its_link_on_apply(paired, fake_bridge):
    fake_bridge(BRIDGE_LIGHTS, BEFORE, BRIDGE_LIGHTS, BEFORE)
    before = {r.name: r.to_dict() for r in paired.rooms()}
    preview = paired.refresh_preview()
    assert [(c["room"], c["status"], c["link"]) for c in preview["rooms"]] == [("Office", "unchanged", True), ("Hallway", "unchanged", True)]
    paired.refresh_rooms(preview["fingerprint"])
    after = {r.name: r.to_dict() for r in paired.rooms()}
    assert (after["Office"]["hue_room"], after["Hallway"]["hue_room"]) == ("1", "4")
    for name in before:
        assert {**after[name], "hue_room": None} == {**before[name], "hue_room": None}


def test_refresh_in_a_sandbox_changes_the_sandbox_not_the_active_home(paired, fake_bridge):
    from myhuey.layouts import using_layout

    active = paired.layouts()[0]["id"]
    sandbox = paired.new_layout("Try", from_layout=active)["id"]
    before = [r.to_dict() for r in paired.rooms()]
    fake_bridge(BRIDGE_LIGHTS, AFTER, BRIDGE_LIGHTS, AFTER)
    with using_layout(sandbox):
        paired.refresh_rooms(paired.refresh_preview()["fingerprint"])
        assert [l.light_id for l in rooms_by_name(paired)["Hallway"].lights] == ["2"]
    assert [r.to_dict() for r in paired.rooms()] == before


def test_a_linked_room_keeps_its_link_through_a_rename(paired, fake_bridge):
    fake_bridge(BRIDGE_LIGHTS, BEFORE, BRIDGE_LIGHTS, BEFORE)
    paired.refresh_rooms(paired.refresh_preview()["fingerprint"])
    paired.update_room("Office", new_name="Study")
    assert rooms_by_name(paired)["Study"].hue_room == "1"


def test_import_skips_a_hue_room_already_linked_under_another_name(db_path, fake_bridge):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("My office", hue_room="1")
    fake_bridge(BRIDGE_LIGHTS, BEFORE)
    assert service.import_rooms() == ["Hallway"]
    assert service.list_rooms() == ["My office", "Hallway"]


def test_refresh_reads_the_bridge_before_loading_the_rooms(paired, fake_bridge, monkeypatch):
    # Loading the rooms last keeps the window for overwriting another edit as small as it can be.
    fake_bridge(BRIDGE_LIGHTS, AFTER, BRIDGE_LIGHTS, AFTER)
    order: list[str] = []
    client = paired.client()
    real_lights, real_groups, real_load = client.get_lights, client.get_groups, paired._load
    monkeypatch.setattr(client, "get_lights", lambda: order.append("lights") or real_lights())
    monkeypatch.setattr(client, "get_groups", lambda: order.append("groups") or real_groups())
    monkeypatch.setattr(paired, "client", lambda: client)
    monkeypatch.setattr(paired, "_load", lambda *a, **k: order.append("load") or real_load(*a, **k))
    fp = paired.refresh_preview()["fingerprint"]
    assert order == ["lights", "groups", "load"]
    order.clear()
    paired.refresh_rooms(fp)
    assert order[:3] == ["lights", "groups", "load"]
