"""Turning every light in a room on or off at once."""

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.cli import main
from myhuey.service import HueRoomService

from conftest import UNAUTHORIZED, USERNAME


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Office")
    for light_id in ("1", "2", "10"):
        service.assign_light("Office", light_id)
    service.add_room("Kitchen")
    service.assign_light("Kitchen", "7")
    return service


def _state_puts(session):
    return [(c["url"].rsplit("/lights/", 1)[1], c["json"]) for c in session.calls if c["method"] == "PUT"]


def test_room_off_turns_off_every_placed_light_and_nothing_else(service, fake_bridge):
    session = fake_bridge([{"success": {}}])

    results = service.set_room_power("Office", False)

    assert _state_puts(session) == [("1/state", {"on": False}), ("2/state", {"on": False}), ("10/state", {"on": False})]
    assert [r["light_id"] for r in results] == ["1", "2", "10"] and all(r["ok"] for r in results)


def test_one_failing_light_does_not_stop_the_rest(service, fake_bridge):
    session = fake_bridge([{"success": {}}], UNAUTHORIZED, [{"success": {}}])
    results = service.set_room_power("Office", True)
    assert [r["ok"] for r in results] == [True, False, True]
    assert "unauthorized" in results[1]["error"]
    assert len(_state_puts(session)) == 3


def test_room_power_api(service, db_path, fake_bridge):
    fake_bridge([{"success": {}}])
    web = TestClient(create_app(db_path))
    response = web.post("/api/rooms/Office/power", json={"on": True})
    assert response.status_code == 200
    assert response.json()["failed"] == 0 and len(response.json()["results"]) == 3
    assert USERNAME not in response.text
    assert web.post("/api/rooms/Attic/power", json={"on": True}).status_code == 404
    assert web.post("/api/rooms/Office/power", json={}).status_code == 422


def test_an_empty_room_is_a_no_op(service, fake_bridge):
    session = fake_bridge([{"success": {}}])
    service.add_room("Hall")
    assert service.set_room_power("Hall", True) == []
    assert session.calls == []


def test_room_on_and_off_from_the_cli(service, db_path, fake_bridge, capsys):
    fake_bridge([{"success": {}}])
    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, "room", "off", "--name", "Office"])
    out = capsys.readouterr().out
    assert caught.value.code == 0 and "Turned off 3 lights in Office." in out and USERNAME not in out


def test_lights_that_did_not_change_get_the_command_again(service, fake_bridge):
    """Under load the bridge can answer success yet drop a command; check and resend once."""
    still_on = {
        "1": {"name": "Desk", "state": {"on": False}},
        "2": {"name": "Hall", "state": {"on": True}},   # dropped
        "10": {"name": "Porch", "state": {"on": False}},
    }
    ok = [{"success": {}}]
    session = fake_bridge(ok, ok, ok, still_on, ok)

    results = service.set_room_power("Office", False)

    puts = _state_puts(session)
    assert puts[-1] == ("2/state", {"on": False}) and len(puts) == 4
    assert [r["retried"] for r in results] == [False, True, False]
