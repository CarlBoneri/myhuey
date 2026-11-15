"""The web API: saved config is read on every request, and failures map to clear statuses."""

import pytest
import requests
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.service import HueRoomService

from conftest import GROUPS, LIGHTS, LINK_BUTTON, PAIRED, UNAUTHORIZED, USERNAME


@pytest.fixture
def web(db_path):
    return TestClient(create_app(db_path, pairing_window=5))


def test_health_and_index(web):
    assert web.get("/api/health").json() == {"status": "ok"}

    page = web.get("/")
    assert page.status_code == 200
    assert "/static/app.js" in page.text


# Missing bridge


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("get", "/api/lights", None),
        ("get", "/api/hue/groups", None),
        ("get", "/api/hue/lights/1", None),
        ("post", "/api/rooms/import", None),
        ("put", "/api/lights/1/state", {"on": True}),
    ],
)
def test_a_missing_bridge_is_a_clear_400(web, method, path, body):
    response = web.request(method, path, json=body)

    assert response.status_code == 400
    assert "myhuey bridge setup" in response.json()["detail"]


def test_setup_status_reports_the_bridge_without_the_username(web, db_path):
    assert web.get("/api/setup/status").json() == {"configured": False, "bridge": {}, "pairing_window": 5}

    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    response = web.get("/api/setup/status")

    assert response.json() == {"configured": True, "bridge": {"ip": "10.0.0.77"}, "pairing_window": 5}
    assert USERNAME not in response.text


# Saved config is used on every request


def test_a_bridge_saved_while_the_server_runs_is_used_without_a_restart(web, db_path, fake_bridge):
    session = fake_bridge(LIGHTS)
    assert web.get("/api/lights").status_code == 400

    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)  # what `myhuey bridge setup` does in another process
    response = web.get("/api/lights")

    assert response.status_code == 200
    lights = response.json()
    assert [light["id"] for light in lights] == ["1", "2", "10"]
    assert lights[0]["name"] == "Desk lamp" and lights[0]["on"] is True and lights[0]["supports_color"] is True
    assert lights[1]["color"] is None and lights[1]["supports_color"] is False
    assert lights[2]["reachable"] is False and lights[2]["color_temp"] == 2700
    assert session.calls[-1]["url"] == f"https://10.0.0.77:443/api/{USERNAME}/lights"
    assert USERNAME not in response.text


def test_a_changed_bridge_replaces_the_client_on_the_next_request(web, db_path, fake_bridge):
    session = fake_bridge(LIGHTS)
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    assert web.get("/api/lights").status_code == 200
    assert web.get("/api/lights").status_code == 200

    HueRoomService(db_path).set_bridge("10.0.0.93", "another-user")
    assert web.get("/api/lights").status_code == 200

    assert session.calls[-1]["url"] == "https://10.0.0.93:443/api/another-user/lights"
    assert session.hosts == ["10.0.0.77", "10.0.0.93"]  # one connection setup per bridge, not per request


# Pairing


def test_pairing_saves_the_bridge_and_never_returns_the_username(web, db_path, fake_bridge):
    fake_bridge(LINK_BUTTON, PAIRED, LIGHTS)

    response = web.post("/api/bridge/register", json={"bridge_ip": "10.0.0.77"})

    assert response.status_code == 200
    assert response.json() == {"bridge_ip": "10.0.0.77", "app_name": "myhuey", "status": "ready"}
    assert USERNAME not in response.text
    assert HueRoomService(db_path).get_bridge() == {"ip": "10.0.0.77", "username": USERNAME}
    assert len(web.get("/api/lights").json()) == 3


def test_pairing_without_the_button_press_is_a_409_naming_the_bridge(web, db_path, fake_bridge, clock):
    session = fake_bridge(LINK_BUTTON)

    response = web.post("/api/bridge/register", json={"bridge_ip": "10.0.0.77"})

    assert response.status_code == 409
    assert "10.0.0.77" in response.json()["detail"]
    assert "5 seconds" in response.json()["detail"]
    assert len(session.calls) == 6
    assert HueRoomService(db_path).get_bridge() == {}


def test_pairing_with_a_bad_address_is_a_400(web):
    response = web.post("/api/bridge/register", json={"bridge_ip": "http://10.0.0.77"})

    assert response.status_code == 400
    assert "HTTPS" in response.json()["detail"]


# Bridge failures


def test_an_unreachable_bridge_is_a_502_without_the_username(web, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    fake_bridge(requests.exceptions.ConnectionError(f"refused https://10.0.0.77/api/{USERNAME}/lights"))

    response = web.get("/api/lights")

    assert response.status_code == 502
    assert "10.0.0.77" in response.json()["detail"]
    assert USERNAME not in response.text


def test_a_rejected_username_is_a_502_with_the_bridge_error(web, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    fake_bridge(UNAUTHORIZED)

    response = web.get("/api/lights")

    assert response.status_code == 502
    assert "unauthorized user" in response.json()["detail"]
    assert USERNAME not in response.text


# Bridge resources


def test_the_bridge_config_is_returned_without_the_whitelist(web, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    fake_bridge({"name": "Hue Bridge", "whitelist": {USERNAME: {"name": "myhuey#myhuey"}}})

    response = web.get("/api/hue/config")

    assert response.json() == {"name": "Hue Bridge"}
    assert USERNAME not in response.text


def test_unsupported_collections_are_a_404(web, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    session = fake_bridge(LIGHTS)

    assert web.get("/api/hue/secrets").status_code == 404
    assert web.get("/api/hue/config/whitelist").status_code == 404
    assert session.calls == []


def test_light_state_changes_are_sent_as_a_hue_state_body(web, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    session = fake_bridge([{"success": {}}])

    response = web.put("/api/lights/1/state", json={"on": True, "brightness": 200, "color_temp": 2700})

    assert response.json() == {"light_id": "1", "status": "ok"}
    assert session.calls[-1]["method"] == "PUT"
    assert session.calls[-1]["url"].endswith("/lights/1/state")
    assert session.calls[-1]["json"] == {"on": True, "bri": 200, "ct": 370}


def test_light_state_rejects_empty_and_out_of_range_changes(web, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    session = fake_bridge([{"success": {}}])

    assert web.put("/api/lights/1/state", json={}).status_code == 400
    assert web.put("/api/lights/1/state", json={"brightness": 999}).status_code == 422
    assert web.put("/api/lights/1/state", json={"color": "not-a-color"}).status_code == 400
    assert session.calls == []


# Rooms


def test_rooms_and_light_placement_round_trip(web):
    assert web.post("/api/rooms", json={"name": "Office"}).status_code == 200
    assert web.post("/api/rooms", json={"name": "Office"}).status_code == 400
    assert web.post("/api/rooms", json={"name": "   "}).status_code == 400

    placed = web.post("/api/rooms/Office/lights", json={"light_id": "1", "x": 120.4, "y": 90, "label": "Desk"})
    assert placed.json()["x"] == 120
    moved = web.post("/api/rooms/Office/lights", json={"light_id": "1", "x": 300, "y": 200})
    assert moved.json()["label"] == "Desk"  # moving a light keeps its label

    assert web.patch("/api/rooms/Office", json={"x": 500, "y": 40}).json()["x"] == 500
    room = web.get("/api/rooms/Office").json()
    assert (room["x"], room["y"], room["width"], room["height"]) == (500, 40, 900, 600)
    assert [(light["light_id"], light["x"], light["y"]) for light in room["lights"]] == [("1", 300, 200)]

    assert web.delete("/api/rooms/Office/lights/1").status_code == 200
    assert web.get("/api/rooms/Office").json()["lights"] == []
    assert web.delete("/api/rooms/Office").status_code == 200
    assert web.get("/api/rooms").json() == []


def test_unknown_rooms_are_a_404(web):
    assert web.get("/api/rooms/Nowhere").status_code == 404
    assert web.patch("/api/rooms/Nowhere", json={"x": 1}).status_code == 404
    assert web.delete("/api/rooms/Nowhere").status_code == 404
    assert web.post("/api/rooms/Nowhere/lights", json={"light_id": "1"}).status_code == 404


def test_importing_rooms_copies_hue_rooms_and_their_lights(web, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    fake_bridge(LIGHTS, GROUPS)

    assert web.post("/api/rooms/import").json() == {"added": ["Office", "Porch-Yard"]}

    rooms = {room["name"]: room for room in web.get("/api/rooms").json()}
    assert sorted(rooms) == ["Office", "Porch-Yard"]  # the zone is not a room
    assert [(light["light_id"], light["label"]) for light in rooms["Office"]["lights"]] == [
        ("1", "Desk lamp"),
        ("2", "Hall"),
    ]
    assert (rooms["Office"]["x"], rooms["Porch-Yard"]["x"]) == (0, 960)  # laid out side by side
