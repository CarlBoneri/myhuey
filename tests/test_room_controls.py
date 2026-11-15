"""A master brightness for each room, app preferences, and lighter bridge traffic."""

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.cli import main
from myhuey.service import HueRoomService

from conftest import LIGHTS, USERNAME

OK = [{"success": {}}]


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Office")
    for light_id in ("1", "2", "10"):  # 1 and 10 are on, 2 is off
        service.assign_light("Office", light_id)
    return service


def _puts(session):
    return [(c["url"].rsplit("/lights/", 1)[1], c["json"]) for c in session.calls if c["method"] == "PUT"]


def test_room_brightness_dims_only_the_lights_that_are_on(service, fake_bridge):
    session = fake_bridge(LIGHTS, OK)
    results = service.set_room_brightness("Office", 50)
    assert _puts(session) == [("1/state", {"bri": 127}), ("10/state", {"bri": 127})]
    assert [r["light_id"] for r in results] == ["1", "10"] and all(r["ok"] for r in results)


def test_room_brightness_is_kept_between_1_and_100(service, fake_bridge):
    session = fake_bridge(LIGHTS, OK)
    service.set_room_brightness("Office", 100)
    assert _puts(session)[0][1] == {"bri": 254}
    with pytest.raises(ValueError):
        service.set_room_brightness("Office", 0)


def test_room_brightness_api_and_cli(service, db_path, fake_bridge, capsys):
    fake_bridge(LIGHTS, OK)
    response = TestClient(create_app(db_path)).post("/api/rooms/Office/brightness", json={"brightness": 30})
    assert response.json()["failed"] == 0 and len(response.json()["results"]) == 2
    assert TestClient(create_app(db_path)).post("/api/rooms/Office/brightness", json={"brightness": 101}).status_code == 422
    fake_bridge(LIGHTS, OK)
    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, "room", "dim", "--name", "Office", "--level", "30"])
    assert caught.value.code == 0 and "Set 2 lights in Office to 30%." in capsys.readouterr().out


def test_preferences_have_defaults_and_validate(db_path):
    service = HueRoomService(db_path)
    prefs = service.preferences()
    assert prefs["room_sliders"] is True and prefs["poll_seconds"] == 5 and prefs["command_gap_ms"] == 100
    changed = service.update_preferences({"room_sliders": False, "poll_seconds": 10, "default_units": "metric"})
    assert (changed["room_sliders"], changed["poll_seconds"], changed["default_units"]) == (False, 10, "metric")
    assert HueRoomService(db_path).preferences()["poll_seconds"] == 10
    for bad in ({"poll_seconds": 7}, {"room_sliders": "yes"}, {"nonsense": 1}):
        with pytest.raises(ValueError):
            service.update_preferences(bad)


def test_preferences_shape_new_rooms_and_bridge_pacing(db_path, fake_bridge):
    service = HueRoomService(db_path)
    slept = []
    service.sleep = slept.append
    service.set_bridge("10.0.0.77", USERNAME)
    service.update_preferences({"default_units": "metric", "command_gap_ms": 200})
    assert service.add_room("Den").units == "metric"
    service.assign_light("Den", "1")
    fake_bridge(OK)
    service.set_room_power("Den", False)
    assert slept[0] == 0.2


def test_preferences_api_and_cli(db_path, capsys):
    client = TestClient(create_app(db_path))
    assert client.get("/api/preferences").json()["show_light_glow"] is True
    assert client.patch("/api/preferences", json={"show_light_glow": False}).json()["show_light_glow"] is False
    assert client.patch("/api/preferences", json={"poll_seconds": 3}).status_code == 400
    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, "prefs", "set", "--key", "poll_seconds", "--value", "30"])
    assert caught.value.code == 0 and HueRoomService(db_path).preferences()["poll_seconds"] == 30
    with pytest.raises(SystemExit):
        main(["--db", db_path, "prefs", "show"])
    assert "poll_seconds: 30" in capsys.readouterr().out


def test_scenes_do_not_resend_on_to_lights_that_are_already_on(service, fake_bridge):
    """Signify's performance guide: every field is a ZigBee message; skip "on" when it already is."""
    service.save_scene({"name": "Warm", "room": "Office", "base_mode": "color", "base_color": "#ff8800", "base_brightness": 60})
    session = fake_bridge(LIGHTS, OK)
    service.apply_scene("Warm")
    sent = dict(_puts(session))
    assert "on" not in sent["1/state"] and sent["2/state"]["on"] is True
