"""Saved light groups in the service: stored app-wide, captured from and replayed to the bridge."""

import pytest

from myhuey.errors import GroupNotFound
from myhuey.layouts import using_layout
from myhuey.service import HueRoomService

from conftest import LIGHTS, USERNAME


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    return service


def test_groups_round_trip_by_id_or_name(service):
    made = service.create_group(" Desk ", ["1", "2", "1"])
    assert made["name"] == "Desk" and made["lights"] == ["1", "2"] and made["look"] is None
    assert [g["name"] for g in service.groups()] == ["Desk"]
    assert service.update_group("desk", name="Desk lamps")["name"] == "Desk lamps"
    assert service.update_group(made["id"], lights=["10"])["lights"] == ["10"]
    service.delete_group("DESK LAMPS")
    assert service.groups() == []
    with pytest.raises(GroupNotFound):
        service.delete_group(made["id"])


def test_group_names_are_unique_ignoring_case(service):
    service.create_group("Desk", ["1"])
    other = service.create_group("Hall", ["2"])
    with pytest.raises(ValueError):
        service.create_group("desk", ["2"])
    with pytest.raises(ValueError):
        service.update_group(other["id"], name="DESK")
    assert service.update_group(other["id"], name="hall")["name"] == "hall"  # its own name, new case


def test_groups_are_shared_by_every_layout(service):
    service.create_group("Desk", ["1"])
    sandbox = service.new_layout("Try")["id"]
    with using_layout(sandbox):
        assert [g["name"] for g in service.groups()] == ["Desk"]
        service.create_group("From sandbox", ["2"])
    assert [g["name"] for g in service.groups()] == ["Desk", "From sandbox"]


def test_save_look_reads_the_bridge_and_apply_replays_it(service, fake_bridge):
    group = service.create_group("All", ["1", "2", "10", "99"])
    session = fake_bridge(LIGHTS, LIGHTS, [{"success": {}}])  # save reads, apply reads, then each PUT
    look = service.save_group_look(group["id"])["look"]
    assert look == {"1": {"on": True, "bri": 254, "xy": [0.5, 0.4]}, "2": {"on": False}, "10": {"on": True, "bri": 127, "ct": 370}}

    results = service.apply_group("all")
    puts = [(c["url"].rsplit("/lights/", 1)[1], c["json"]) for c in session.calls if c["method"] == "PUT"]
    assert puts == [("1/state", {"on": True, "bri": 254, "xy": [0.5, 0.4]}), ("2/state", {"on": False}), ("10/state", {"on": True, "bri": 127, "ct": 370})]
    assert [(r["light_id"], r["ok"]) for r in results] == [("1", True), ("2", True), ("10", True)]
    assert results[0]["label"] == "Desk lamp"

    assert service.clear_group_look(group["id"])["look"] is None
    with pytest.raises(ValueError):
        service.apply_group(group["id"])  # no look to apply


def test_apply_reports_lights_the_bridge_no_longer_has(service, fake_bridge):
    group = service.create_group("Gone", ["1"])
    fake_bridge(LIGHTS, {"10": LIGHTS["10"]}, [{"success": {}}])
    service.save_group_look(group["id"])
    results = service.apply_group(group["id"])
    assert results == [{"light_id": "1", "label": "Light 1", "ok": False, "error": "Light 1 is no longer on the bridge"}]


def _gradient_strip(rid="rid-desk", v1="1"):
    return {"id": rid, "id_v1": f"/lights/{v1}", "gradient": {
        "points": [{"color": {"xy": {"x": 0.6915, "y": 0.3083}}}, {"color": {"xy": {"x": 0.1532, "y": 0.0475}}}],
        "mode": "segmented_palette", "mode_values": ["interpolated_palette", "segmented_palette"], "points_capable": 5, "pixel_count": 10}}


def test_a_gradient_light_gets_its_points_back_after_its_brightness(service, fake_bridge):
    group = service.create_group("Strip", ["1"])
    session = fake_bridge(LIGHTS, LIGHTS, [{"success": {}}])
    session.v2_lights = [_gradient_strip()]
    look = service.save_group_look(group["id"])["look"]
    assert look["1"]["gradient"]["mode"] == "segmented_palette" and len(look["1"]["gradient"]["colors"]) == 2
    service.apply_group(group["id"])
    v1 = [c for c in session.calls if c["method"] == "PUT"]
    v2 = [c for c in session.clip_calls if c["method"] == "PUT"]
    assert [c["url"].rsplit("/lights/", 1)[1] for c in v1] == ["1/state"] and v1[0]["json"] == {"on": True, "bri": 254}
    assert len(v2) == 1 and v2[0]["url"].endswith("/rid-desk")
    assert v2[0]["json"]["gradient"]["mode"] == "segmented_palette" and len(v2[0]["json"]["gradient"]["points"]) == 2


def test_apply_waits_the_command_gap_between_lights(service, fake_bridge):
    pauses = []
    service.sleep = pauses.append
    service.update_preferences({"command_gap_ms": 300})
    group = service.create_group("All", ["1", "2", "10"])
    fake_bridge(LIGHTS, LIGHTS, [{"success": {}}])
    service.save_group_look(group["id"])
    service.apply_group(group["id"])
    assert pauses == [0.3, 0.3, 0.3]


def test_a_light_that_refuses_does_not_stop_the_rest(service, fake_bridge):
    group = service.create_group("Pair", ["1", "2"])
    refused = [{"error": {"type": 201, "address": "/lights/1/state/xy", "description": "parameter not modifiable"}}]
    fake_bridge(LIGHTS, LIGHTS, refused, [{"success": {}}])
    service.save_group_look(group["id"])
    results = service.apply_group(group["id"])
    assert [(r["light_id"], r["ok"]) for r in results] == [("1", False), ("2", True)]
    assert "not modifiable" in results[0]["error"]


def test_groups_survive_making_a_sandbox_active_and_deleting_layouts(service):
    service.create_group("Desk", ["1"])
    first = next(item["id"] for item in service.layouts() if item["active"])
    sandbox = service.new_layout("Try")["id"]
    service.activate_layout(sandbox)
    assert [g["name"] for g in service.groups()] == ["Desk"]
    service.delete_layout(first)
    assert [g["name"] for g in service.groups()] == ["Desk"]
