"""Uploads are checked and cleaned; themes come from real pixels; room photos keep light positions."""

import io
import os
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from myhuey.api import create_app
from myhuey.images import MAX_UPLOAD_BYTES, ImageRejected, prune_unreferenced, store_image
from myhuey.palette import MOODS, extract_theme
from myhuey.service import HueRoomService


def _jpeg(size=(64, 48), color=(200, 40, 40), exif_gps=False):
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    if exif_gps:
        exif = Image.Exif()
        exif[0x8825] = {1: "N", 2: (40.0, 26.0, 46.0)}  # GPSInfo
        image.save(buffer, "JPEG", exif=exif)
    else:
        image.save(buffer, "JPEG")
    return buffer.getvalue()


def _stripes(path):
    image = Image.new("RGB", (120, 60))
    colors = [(230, 30, 30), (30, 200, 60), (40, 60, 230), (20, 20, 20)]
    for x in range(120):
        for y in range(60):
            image.putpixel((x, y), colors[x // 30])
    image.save(path)
    return path


def test_uploads_are_reencoded_without_exif(tmp_path):
    stored = store_image(_jpeg(exif_gps=True), tmp_path)
    assert stored["file"].endswith(".jpg") and len(stored["file"]) == 36
    with Image.open(tmp_path / stored["file"]) as saved:
        assert 0x8825 not in saved.getexif()


def test_phone_jpegs_with_extra_images_are_accepted(tmp_path):
    """iPhones and many Androids save JPEGs with an embedded depth or HDR image, which
    Pillow reports as MPO. They are JPEGs; keep the main image and drop the rest."""
    main = Image.new("RGB", (400, 300), (200, 80, 40))
    buffer = io.BytesIO()
    main.save(buffer, "MPO", save_all=True, append_images=[Image.new("RGB", (100, 75))])

    stored = store_image(buffer.getvalue(), tmp_path)

    assert (stored["width"], stored["height"]) == (400, 300)
    with Image.open(tmp_path / stored["file"]) as saved:
        assert saved.format == "JPEG" and getattr(saved, "n_frames", 1) == 1


@pytest.mark.parametrize(
    "data, message",
    [
        (b"", "empty"),
        (b"GIF89a" + b"\0" * 100, "JPEG, PNG, or WebP"),
        (b"not an image at all", "not a readable"),
        (b"\xff\xd8" + b"\0" * (MAX_UPLOAD_BYTES + 1), "at most"),
    ],
)
def test_bad_uploads_are_refused(tmp_path, data, message):
    with pytest.raises(ImageRejected, match=message):
        store_image(data, tmp_path)
    assert not any(tmp_path.iterdir())


def test_themes_are_real_pixels_with_their_location(tmp_path):
    path = _stripes(tmp_path / "stripes.png")
    theme = extract_theme(path, 3, "colorful")
    assert len(theme) == 3
    for swatch in theme:
        with Image.open(path) as image:
            pixel = image.getpixel((int(swatch["x"] * 120), int(swatch["y"] * 60)))
        assert "#%02x%02x%02x" % pixel == swatch["color"]
    assert "#141414" not in [s["color"] for s in theme]  # colorful skips the black stripe


def test_moods_change_the_theme(tmp_path):
    path = _stripes(tmp_path / "stripes.png")
    assert "#141414" in [s["color"] for s in extract_theme(path, 2, "dark")]
    assert len({tuple(s["color"] for s in extract_theme(path, 3, mood)) for mood in MOODS}) > 1
    with pytest.raises(ValueError):
        extract_theme(path, 3, "sparkly")


def test_pruning_keeps_referenced_and_fresh_files(tmp_path):
    keep = store_image(_jpeg(), tmp_path)["file"]
    old = store_image(_jpeg(), tmp_path)["file"]
    fresh = store_image(_jpeg(), tmp_path)["file"]
    past = time.time() - 7200
    os.utime(tmp_path / keep, (past, past))
    os.utime(tmp_path / old, (past, past))

    assert prune_unreferenced(tmp_path, {keep}) == [old]
    assert {p.name for p in tmp_path.iterdir()} == {keep, fresh}


@pytest.fixture
def web(db_path):
    HueRoomService(db_path).add_room("Den", 400, 300)
    return TestClient(create_app(db_path))


def test_image_upload_returns_a_theme_and_serves_the_file(web):
    response = web.post("/api/images?mood=bright&count=3", files={"file": ("x.jpg", _jpeg(), "image/jpeg")})
    assert response.status_code == 200
    body = response.json()
    assert body["mood"] == "bright" and 1 <= len(body["theme"]) <= 3
    assert {"color", "x", "y"} <= set(body["theme"][0])

    served = web.get(f"/api/images/{body['file']}")
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    theme = web.get(f"/api/images/{body['file']}/theme?mood=muted").json()
    assert theme["mood"] == "muted" and "dark" in theme["moods"]


@pytest.mark.parametrize("name", ["../myhuey.db", "..%2Fmyhuey.db", "abc.jpg", "0" * 32 + ".exe"])
def test_image_names_cannot_escape_the_uploads_folder(web, name):
    assert web.get(f"/api/images/{name}").status_code in (400, 404)


def test_room_photo_upload_and_light_positions_persist(web, db_path):
    HueRoomService(db_path).assign_light("Den", "1", x=50, y=50)
    uploaded = web.post("/api/rooms/Den/photo", files={"file": ("room.jpg", _jpeg((300, 200)), "image/jpeg")})
    assert uploaded.status_code == 200
    photo = uploaded.json()["photo"]
    assert (photo["width"], photo["height"]) == (300, 200)

    saved = web.put("/api/rooms/Den/photo/placements", json={"placements": {"1": {"x": 0.25, "y": 0.75, "scale": 2}}})
    assert saved.json()["photo"]["tags"]["light:1"] == {"x": 0.25, "y": 0.75, "rotation": 0, "scale": 2}

    # A fresh service (as after a restart) reads the same thing back.
    room = HueRoomService(db_path).get_room("Den")
    assert room.photo.tags["light:1"]["x"] == 0.25
    assert web.get(f"/api/images/{room.photo.file}").status_code == 200

    unknown = web.put("/api/rooms/Den/photo/placements", json={"placements": {"99": {"x": 0.1, "y": 0.1}}})
    assert unknown.status_code == 400

    # Replacing the photo keeps positions and removes the old file.
    old_file = room.photo.file
    web.post("/api/rooms/Den/photo", files={"file": ("room.jpg", _jpeg((200, 100)), "image/jpeg")})
    room = HueRoomService(db_path).get_room("Den")
    assert room.photo.tags["light:1"]["x"] == 0.25 and room.photo.file != old_file
    assert web.get(f"/api/images/{old_file}").status_code == 400

    assert web.delete("/api/rooms/Den/photo").status_code == 200
    assert HueRoomService(db_path).get_room("Den").photo is None


def test_photo_upload_rejects_non_images(web):
    response = web.post("/api/rooms/Den/photo", files={"file": ("x.txt", b"hello", "text/plain")})
    assert response.status_code == 400


def test_room_shape_units_and_furniture_round_trip(web):
    outline = [[0, 0], [400, 0], [400, 150], [250, 150], [250, 300], [0, 300]]
    furniture = [{"kind": "sofa", "label": "Sofa", "x": 100, "y": 60, "width": 213, "depth": 91, "rotation": 90}]
    room = web.patch("/api/rooms/Den", json={"outline": outline, "units": "metric", "furniture": furniture}).json()
    assert room["outline"] == outline and room["units"] == "metric"
    assert room["furniture"][0]["label"] == "Sofa" and room["furniture"][0]["id"]

    stretched = web.patch("/api/rooms/Den", json={"width": 800}).json()
    assert stretched["width"] == 800 and stretched["outline"][3] == [500, 150]  # shape kept, stretched

    assert web.patch("/api/rooms/Den", json={"outline": [[0, 0], [10, 0], [20, 0]]}).status_code == 400
    assert web.patch("/api/rooms/Den", json={"units": "cubits"}).status_code == 400

    placed = web.post("/api/rooms/Den/lights", json={"light_id": "7", "x": 10, "y": 20, "rotation": 45, "length": 300})
    assert (placed.json()["rotation"], placed.json()["length"]) == (45, 300)
