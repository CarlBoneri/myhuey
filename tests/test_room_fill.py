"""Room shapes on the floor plan can be see-through, so the plan image shows while tracing."""

from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.models import HomePlan

from test_floorplan_api import _png


def test_room_opacity_defaults_and_clamps():
    assert HomePlan.from_dict({"file": "a.png"}).room_opacity == 0.4
    assert HomePlan.from_dict({"file": "a.png", "room_opacity": 3}).room_opacity == 1.0
    assert HomePlan.from_dict({"file": "a.png", "room_opacity": -1}).room_opacity == 0.0


def test_patch_plan_room_opacity(db_path):
    web = TestClient(create_app(db_path))
    assert web.post("/api/plan/image", files={"file": ("plan.png", _png(), "image/png")}).json()["room_opacity"] == 0.4
    assert web.patch("/api/plan", json={"room_opacity": 0.2}).json()["room_opacity"] == 0.2
    assert web.get("/api/plan").json()["room_opacity"] == 0.2
    assert web.patch("/api/plan", json={"room_opacity": 1.5}).status_code == 422
