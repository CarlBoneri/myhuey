import pytest

from myhuey.errors import LayoutNotFound
from myhuey.layout_store import load_layout, save_layout
from myhuey.layouts import using_layout
from myhuey.service import HueRoomService


@pytest.fixture
def service(tmp_path):
    service = HueRoomService(tmp_path / "home.db")
    service.add_room("Office", 300, 300)
    return service


def sandbox(service, layout_id="s1", rooms=(), version=5):
    save_layout({"id": layout_id, "name": "Try", "created": 1, "updated": 1, "schema_version": version,
                 "rooms": list(rooms), "scenes": [], "home": {"plan": None}}, service.storage_path)


def test_identity_created_on_first_use(tmp_path):
    service = HueRoomService(tmp_path / "home.db")
    first = service._load()["layout"]
    assert first["name"] == "My home"
    assert service._load()["layout"]["id"] == first["id"]


def test_sandbox_reads_and_writes_stay_in_the_sandbox(service):
    sandbox(service)
    with using_layout("s1"):
        service.add_room("Den", 300, 300)
        assert service.list_rooms() == ["Den"]
    assert service.list_rooms() == ["Office"]
    assert [room["name"] for room in load_layout("s1", service.storage_path)["rooms"]] == ["Den"]


def test_naming_the_active_layout_reads_active(service):
    active = service._load()["layout"]["id"]
    with using_layout(active):
        assert service.list_rooms() == ["Office"]


def test_preference_changed_in_sandbox_is_global(service):
    sandbox(service)
    with using_layout("s1"):
        service.update_preferences({"poll_seconds": 10})
    assert service.preferences()["poll_seconds"] == 10
    assert service.list_rooms() == ["Office"]


def test_unknown_layout_raises(service):
    with using_layout("nope"), pytest.raises(LayoutNotFound, match="That layout no longer exists"):
        service.rooms()


def test_old_sandbox_is_migrated_when_opened(service):
    old_room = {
        "name": "Den", "x": 0, "y": 0, "units": "imperial", "outline": [[0, 0], [300, 0], [300, 300], [0, 300]],
        "lights": [{"light_id": "1", "x": 10, "y": 10, "elevation": None, "role": "auto"}],
        "furniture": [], "openings": [], "ceiling": 244.0,
        "photo": {"file": "p.png", "width": 10, "height": 10, "placements": {"1": {"x": 0.5, "y": 0.5}}},
    }
    sandbox(service, rooms=[old_room], version=4)
    with using_layout("s1"):
        assert service.list_rooms() == ["Den"]
    saved = load_layout("s1", service.storage_path)
    assert saved["schema_version"] == 5
    assert saved["rooms"][0]["photo"]["tags"] == {"light:1": {"x": 0.5, "y": 0.5}}
    import sqlite3
    with sqlite3.connect(service.storage_path) as connection:
        row = connection.execute("SELECT value FROM app_state WHERE key = 'layout_backup:s1:v4'").fetchone()
    assert row is not None
