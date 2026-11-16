"""Saved light groups over HTTP: app-wide, so a layout header never changes them."""

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.service import HueRoomService

from conftest import LIGHTS, USERNAME

H = "X-Myhuey-Layout"


@pytest.fixture
def web(db_path):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    return TestClient(create_app(db_path))


def test_group_crud_over_http(web):
    made = web.post("/api/groups", json={"name": "Desk", "lights": ["1", "2"]}).json()
    assert made["name"] == "Desk" and made["look"] is None
    assert web.post("/api/groups", json={"name": "desk", "lights": ["1"]}).status_code == 400
    assert web.post("/api/groups", json={"name": "Empty", "lights": []}).status_code == 400
    assert web.patch(f"/api/groups/{made['id']}", json={"name": "Desk lamps"}).json()["name"] == "Desk lamps"
    assert web.patch(f"/api/groups/{made['id']}", json={"lights": ["2"]}).json()["lights"] == ["2"]
    assert [g["name"] for g in web.get("/api/groups").json()] == ["Desk lamps"]
    assert web.delete(f"/api/groups/{made['id']}").json() == {"deleted": made["id"]}
    assert web.delete(f"/api/groups/{made['id']}").status_code == 404
    assert web.get(f"/api/groups/nope").status_code in (404, 405)


def test_groups_ignore_the_layout_header(web):
    web.post("/api/groups", json={"name": "Desk", "lights": ["1"]})
    sandbox = web.post("/api/layouts", json={"name": "Try"}).json()["id"]
    assert [g["name"] for g in web.get("/api/groups", headers={H: sandbox}).json()] == ["Desk"]
    assert web.get("/api/groups", headers={H: "deleted-sandbox"}).status_code == 200


def test_look_save_apply_and_clear(web, fake_bridge):
    group = web.post("/api/groups", json={"name": "Desk", "lights": ["1", "2"]}).json()["id"]
    assert web.post(f"/api/groups/{group}/apply").status_code == 400  # nothing saved yet
    fake_bridge(LIGHTS, LIGHTS, [{"success": {}}])
    look = web.put(f"/api/groups/{group}/look").json()["look"]
    assert look["2"] == {"on": False}
    applied = web.post(f"/api/groups/{group}/apply").json()
    assert applied["failed"] == 0 and [r["light_id"] for r in applied["results"]] == ["1", "2"]
    assert USERNAME not in str(applied)
    assert web.delete(f"/api/groups/{group}/look").json()["look"] is None
    assert web.put("/api/groups/nope/look").status_code == 404
