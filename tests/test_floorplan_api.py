"""The home plan image, rooms created at a position, openings, and ceilings over HTTP."""

import io

from fastapi.testclient import TestClient
from PIL import Image

from myhuey.api import create_app
from myhuey.service import HueRoomService

SQUARE = [[0, 0], [400, 0], [400, 300], [0, 300]]


def _png():
    buffer = io.BytesIO()
    Image.new("RGB", (80, 60), (255, 255, 255)).save(buffer, "PNG")
    return buffer.getvalue()


def _client(db_path):
    return TestClient(create_app(db_path))


def test_plan_upload_and_defaults(db_path):
    client = _client(db_path)
    assert client.get("/api/plan").json() is None
    plan = client.post("/api/plan/image", files={"file": ("plan.png", _png(), "image/png")}).json()
    assert plan["cm_per_px"] == 1 and plan["opacity"] == 0.5 and plan["width"] == 80
    assert client.get("/api/plan").json()["file"] == plan["file"]
    changed = client.patch("/api/plan", json={"cm_per_px": 2.5, "offset": [10, -20], "rotation": 90, "opacity": 0.3}).json()
    assert (changed["cm_per_px"], changed["offset"], changed["rotation"], changed["opacity"]) == (2.5, [10, -20], 90, 0.3)
    assert changed["file"] == plan["file"]


def test_plan_rejects_bad_scale(db_path):
    client = _client(db_path)
    client.post("/api/plan/image", files={"file": ("plan.png", _png(), "image/png")})
    assert client.patch("/api/plan", json={"cm_per_px": 0}).status_code == 422
    assert client.patch("/api/plan", json={"cm_per_px": 500}).status_code == 422


def test_patch_without_plan_is_an_error(db_path):
    assert _client(db_path).patch("/api/plan", json={"opacity": 0.2}).status_code == 400


def test_plan_image_survives_prune(db_path):
    service = HueRoomService(db_path)
    plan = service.set_plan_image(_png())
    assert plan["file"] in service.referenced_images()
    service.prune_uploads(min_age_seconds=0)
    assert service.image_file(plan["file"]).exists()
    service.remove_plan()
    assert service.get_plan() is None
    assert not (service.uploads / plan["file"]).exists()


def test_create_room_at_position(db_path):
    room = _client(db_path).post("/api/rooms", json={"name": "Hall", "outline": SQUARE, "x": 120, "y": -40}).json()
    assert (room["x"], room["y"]) == (120, -40)


def test_room_openings_and_ceiling(db_path):
    client = _client(db_path)
    client.post("/api/rooms", json={"name": "Office", "outline": SQUARE})
    window = {"kind": "window", "edge": 0, "offset": 100, "width": 120}
    room = client.patch("/api/rooms/Office", json={"openings": [window], "ceiling": 270}).json()
    assert room["ceiling"] == 270 and room["openings"][0]["sill"] == 90
    bad = client.patch("/api/rooms/Office", json={"openings": [{**window, "offset": 350}]})
    assert bad.status_code == 400 and "does not fit" in bad.json()["detail"]


def test_replacing_outline_drops_openings_that_no_longer_fit(db_path):
    service = HueRoomService(db_path)
    service.add_room("Office", outline=SQUARE)
    service.update_room("Office", openings=[
        {"kind": "door", "edge": 0, "offset": 300, "width": 81},  # its stretch of wall is cut off
        {"kind": "window", "edge": 3, "offset": 10, "width": 90},  # the left wall stays
        {"kind": "window", "edge": 1, "offset": 0, "width": 90},  # the right wall moves 2 m
    ])
    room = service.update_room("Office", outline=[[0, 0], [200, 0], [200, 300], [0, 300]])
    assert [(o.kind, o.edge) for o in room.openings] == [("window", 3)]
    triangle = service.update_room("Office", outline=[[0, 0], [200, 0], [0, 300]])
    assert [o.edge for o in triangle.openings] == [2]  # the left wall is now the triangle's last edge


def test_furniture_heights_over_api(db_path):
    client = _client(db_path)
    client.post("/api/rooms", json={"name": "Office", "outline": SQUARE})
    room = client.patch("/api/rooms/Office", json={"furniture": [{"kind": "monitor-27", "width": 61, "depth": 20}]}).json()
    assert room["furniture"][0]["elevation"] == 75
