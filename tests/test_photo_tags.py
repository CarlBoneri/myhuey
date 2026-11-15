"""Photo tags: lights, furniture, and openings pinned on a room photo, linked to the plan by ID."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from myhuey.api import create_app
from myhuey.cli import main
from myhuey.migrations import CURRENT_VERSION, migrate
from myhuey.models import RoomPhoto
from myhuey.service import HueRoomService


def _jpeg(size=(300, 200)):
    buffer = io.BytesIO()
    Image.new("RGB", size, (120, 110, 100)).save(buffer, "JPEG")
    return buffer.getvalue()


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.add_room("Den", 400, 300)
    service.assign_light("Den", "1", x=50, y=50)
    service.update_room("Den", furniture=[{"id": "desk1", "kind": "desk", "x": 200, "y": 150, "width": 140, "depth": 70}],
                        openings=[{"id": "win1", "kind": "window", "edge": 0, "offset": 100, "width": 90}])
    service.set_room_photo("Den", _jpeg())
    return service


def test_v4_photo_placements_migrate_to_light_tags():
    doc = {"schema_version": 4, "home": {"plan": None}, "rooms": [{
        "name": "Den", "lights": [{"light_id": "1"}], "furniture": [], "openings": [],
        "photo": {"file": "a.jpg", "width": 10, "height": 10, "placements": {"1": {"x": 0.2, "y": 0.3, "rotation": 0, "scale": 1}}}}]}
    upgraded, start = migrate(doc)
    assert start == 4 and CURRENT_VERSION == 5
    photo = upgraded["rooms"][0]["photo"]
    assert photo["tags"] == {"light:1": {"x": 0.2, "y": 0.3, "rotation": 0, "scale": 1}}
    assert "placements" not in photo and photo["floor_transform"] is None


def test_room_photo_reads_legacy_placements():
    photo = RoomPhoto.from_dict({"file": "a.jpg", "width": 1, "height": 1, "placements": {"7": {"x": 0.5, "y": 0.5}}})
    assert set(photo.tags) == {"light:7"}
    assert photo.to_dict()["floor_transform"] is None


def test_tags_for_every_kind(service):
    room = service.set_photo_tags("Den", {
        "light:1": {"x": 0.1, "y": 0.2}, "furniture:desk1": {"x": 0.5, "y": 0.6}, "opening:win1": {"x": 0.9, "y": 0.1},
    })
    assert room.photo.tags["furniture:desk1"] == {"x": 0.5, "y": 0.6, "rotation": 0, "scale": 1}
    assert set(room.photo.tags) == {"light:1", "furniture:desk1", "opening:win1"}


@pytest.mark.parametrize("key", ["light:99", "furniture:nope", "opening:nope", "lamp:1", "1"])
def test_tags_must_name_something_in_the_room(service, key):
    with pytest.raises(ValueError):
        service.set_photo_tags("Den", {key: {"x": 0.1, "y": 0.1}})


def test_removing_items_drops_their_tags(service):
    service.set_photo_tags("Den", {"light:1": {"x": 0.1, "y": 0.2}, "furniture:desk1": {"x": 0.5, "y": 0.6},
                                   "opening:win1": {"x": 0.9, "y": 0.1}})
    service.remove_light("Den", "1")
    service.update_room("Den", furniture=[], openings=[])
    assert service.get_room("Den").photo.tags == {}


def test_replacing_the_photo_keeps_tags(service):
    service.set_photo_tags("Den", {"furniture:desk1": {"x": 0.5, "y": 0.6}})
    service.set_room_photo("Den", _jpeg((200, 100)))
    assert "furniture:desk1" in service.get_room("Den").photo.tags


def test_api_tags_and_the_placements_alias(service, db_path):
    web = TestClient(create_app(db_path))
    saved = web.put("/api/rooms/Den/photo/tags", json={"tags": {"furniture:desk1": {"x": 0.5, "y": 0.6}}})
    assert saved.status_code == 200 and "furniture:desk1" in saved.json()["photo"]["tags"]
    assert web.put("/api/rooms/Den/photo/tags", json={"tags": {"light:99": {"x": 0.1, "y": 0.1}}}).status_code == 400
    # The old endpoint only rewrites light tags and leaves the others.
    alias = web.put("/api/rooms/Den/photo/placements", json={"placements": {"1": {"x": 0.25, "y": 0.75}}})
    assert set(alias.json()["photo"]["tags"]) == {"light:1", "furniture:desk1"}


def _cli(db_path, *argv):
    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, *argv])
    return caught.value.code


def test_cli_tag_untag_and_list(service, db_path, capsys):
    assert _cli(db_path, "room", "tag", "--name", "Den", "--item", "furniture:desk1", "--x", "0.4", "--y", "0.6") == 0
    assert service.get_room("Den").photo.tags["furniture:desk1"]["x"] == 0.4
    capsys.readouterr()
    assert _cli(db_path, "room", "tags", "--name", "Den") == 0
    assert "furniture:desk1" in capsys.readouterr().out
    assert _cli(db_path, "room", "untag", "--name", "Den", "--item", "furniture:desk1") == 0
    assert service.get_room("Den").photo.tags == {}
