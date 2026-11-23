"""Layouts over HTTP: the X-Myhuey-Layout header picks the layout each request works on."""

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.service import HueRoomService

from conftest import USERNAME

H = "X-Myhuey-Layout"


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Office", 300, 300)
    return service


@pytest.fixture
def web(service, db_path):
    return TestClient(create_app(db_path))


def _rooms(web, **headers):
    return [room["name"] for room in web.get("/api/rooms", headers=headers).json()]


def test_layout_crud_round_trip(web):
    listed = web.get("/api/layouts").json()
    assert [(item["name"], item["active"]) for item in listed] == [("My home", True)]
    created = web.post("/api/layouts", json={"name": "Try"}).json()
    assert created["name"] == "Try" and created["active"] is False
    copy = web.post("/api/layouts", json={"name": "Copy", "from": listed[0]["id"]}).json()
    assert copy["rooms"] == 1
    assert web.patch(f"/api/layouts/{created['id']}", json={"name": "Tried"}).json()["name"] == "Tried"
    assert web.post("/api/layouts", json={"name": "tried"}).status_code == 400
    assert web.post(f"/api/layouts/{copy['id']}/activate").json()["active"] is True
    assert web.delete(f"/api/layouts/{copy['id']}").status_code == 400  # it is Active now
    assert web.delete(f"/api/layouts/{created['id']}").json() == {"deleted": created["id"]}
    assert web.delete(f"/api/layouts/{created['id']}").status_code == 404
    assert [item["name"] for item in web.get("/api/layouts").json()] == ["Copy", "My home"]


def test_header_routes_rooms_to_sandbox(web):
    sandbox = web.post("/api/layouts", json={"name": "Try"}).json()["id"]
    assert web.post("/api/rooms", json={"name": "Den", "width": 300, "height": 300}, headers={H: sandbox}).status_code == 200
    assert _rooms(web, **{H: sandbox}) == ["Den"]
    assert _rooms(web) == ["Office"]


def test_header_does_not_leak_into_next_request(web):
    sandbox = web.post("/api/layouts", json={"name": "Try"}).json()["id"]
    for _ in range(3):
        assert _rooms(web, **{H: sandbox}) == []
        assert _rooms(web) == ["Office"]


def test_header_naming_active_reads_active(web):
    active = web.get("/api/layouts").json()[0]["id"]
    assert _rooms(web, **{H: active}) == ["Office"]


def test_unknown_header_is_404(web):
    response = web.get("/api/rooms", headers={H: "nope"})
    assert response.status_code == 404
    assert response.json() == {"detail": "That layout no longer exists"}


def test_room_power_honours_header(web, fake_bridge):
    session = fake_bridge([{"success": {}}])
    sandbox = web.post("/api/layouts", json={"name": "Try"}).json()["id"]
    web.post("/api/rooms", json={"name": "Den", "width": 300, "height": 300}, headers={H: sandbox})
    web.post("/api/rooms/Den/lights", json={"light_id": "7", "x": 50, "y": 50}, headers={H: sandbox})
    response = web.post("/api/rooms/Den/power", json={"on": True}, headers={H: sandbox})
    assert response.status_code == 200
    assert [c["url"].rsplit("/lights/", 1)[1] for c in session.calls if c["method"] == "PUT"] == ["7/state"]
    assert web.post("/api/rooms/Den/power", json={"on": True}).status_code == 404


def test_layouts_endpoints_ignore_a_stale_header(web):
    assert web.get("/api/layouts", headers={H: "gone"}).status_code == 200


def test_health_reports_api_6(web):
    assert web.get("/api/health").json()["api"] == 6
