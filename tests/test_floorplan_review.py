"""Fixes from the floor-plan review: openings follow their wall, no NaN, stable ids, small rooms, rescans."""

import io

from fastapi.testclient import TestClient
from PIL import Image

from myhuey.api import create_app
from myhuey.migrations import CURRENT_VERSION, migrate
from myhuey.models import Room
from myhuey.service import HueRoomService

SQUARE = [[0, 0], [400, 0], [400, 300], [0, 300]]


def _png(size):
    buffer = io.BytesIO()
    Image.new("RGB", size, (255, 255, 255)).save(buffer, "PNG")
    return buffer.getvalue()


def test_reshape_moves_openings_with_their_wall(db_path):
    service = HueRoomService(db_path)
    service.add_room("Office", outline=SQUARE)
    service.update_room("Office", openings=[{"kind": "door", "edge": 2, "offset": 100, "width": 81}])
    # The same square, but starting at another corner: the bottom wall is now edge 3.
    room = service.update_room("Office", outline=[[0, 300], [0, 0], [400, 0], [400, 300]])
    (door,) = room.openings
    assert door.edge == 3 and abs(door.offset - 100) < 0.01


def test_reshape_drops_openings_whose_wall_is_gone(db_path):
    service = HueRoomService(db_path)
    service.add_room("Office", outline=SQUARE)
    service.update_room("Office", openings=[
        {"kind": "window", "edge": 1, "offset": 0, "width": 90},  # on the right wall, which moves 2 m
        {"kind": "window", "edge": 3, "offset": 10, "width": 90},  # on the left wall, which stays
    ])
    room = service.update_room("Office", outline=[[0, 0], [200, 0], [200, 300], [0, 300]])
    assert [(o.edge, o.offset) for o in room.openings] == [(3, 10)]


def test_stretching_keeps_openings_on_their_edge(db_path):
    service = HueRoomService(db_path)
    service.add_room("Office", outline=SQUARE)
    service.update_room("Office", openings=[{"kind": "window", "edge": 1, "offset": 0, "width": 90}])
    assert [o.edge for o in service.update_room("Office", width=600).openings] == [1]


def test_plan_patch_rejects_nan(db_path):
    client = TestClient(create_app(db_path))
    client.post("/api/plan/image", files={"file": ("plan.png", _png((80, 60)), "image/png")})
    response = client.patch("/api/plan", content='{"rotation": NaN, "offset": [NaN, 0]}', headers={"Content-Type": "application/json"})
    assert response.status_code in (400, 422)
    assert client.get("/api/plan").json()["rotation"] == 0


def test_migrated_opening_gets_a_stable_id():
    door = {"kind": "door", "label": "door", "x": 140, "y": 5, "width": 81, "depth": 5, "rotation": 0, "shape": "rect"}
    upgraded, _ = migrate({"schema_version": 2, "bridge": {}, "scenes": [], "rooms": [
        {"name": "A", "outline": SQUARE, "lights": [], "furniture": [door], "photo": None}]})
    opening_id = upgraded["rooms"][0]["openings"][0]["id"]
    assert opening_id and Room.from_dict(upgraded["rooms"][0]).openings[0].id == opening_id
    assert CURRENT_VERSION == 3


def test_create_small_traced_room(db_path):
    closet = [[0, 0], [90, 0], [90, 20], [0, 20]]
    response = TestClient(create_app(db_path)).post("/api/rooms", json={"name": "Closet", "outline": closet, "width": 90, "height": 20})
    assert response.status_code == 200


def test_replacing_plan_image_keeps_real_scale(db_path):
    service = HueRoomService(db_path)
    service.set_plan_image(_png((80, 60)))
    service.update_plan(cm_per_px=2)
    assert service.set_plan_image(_png((160, 120)))["cm_per_px"] == 1


def test_health_reports_api_version(db_path):
    assert TestClient(create_app(db_path)).get("/api/health").json() == {"status": "ok", "api": CURRENT_VERSION}
