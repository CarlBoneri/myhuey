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


def _png(color=(255, 255, 255)):
    import io

    from PIL import Image
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buffer, "PNG")
    return buffer.getvalue()


def _names(service):
    return [item["name"] for item in service.layouts()]


def test_list_shows_active_first(service):
    service.new_layout("Try")
    listed = service.layouts()
    assert [(item["name"], item["active"], item["rooms"]) for item in listed] == [("My home", True, 1), ("Try", False, 0)]
    assert set(listed[0]) == {"id", "name", "active", "rooms", "scenes", "updated"}


def test_start_fresh_leaves_active_untouched(service):
    service.set_plan_image(_png())
    plan_file = service.get_plan()["file"]
    created = service.new_layout("Fresh")
    assert created["rooms"] == 0 and created["active"] is False
    with using_layout(created["id"]):
        assert service.list_rooms() == []
        assert service.get_plan()["file"] == plan_file
    assert service.list_rooms() == ["Office"]


def test_duplicate_is_a_deep_copy(service):
    active = service.layouts()[0]["id"]
    copy = service.new_layout("Copy", from_layout=active)
    with using_layout(copy["id"]):
        service.update_room("Office", new_name="Studio")
        assert service.list_rooms() == ["Studio"]
    assert service.list_rooms() == ["Office"]
    again = service.new_layout("Copy of copy", from_layout=copy["id"])
    with using_layout(again["id"]):
        assert service.list_rooms() == ["Studio"]


def test_default_names_count_up(service):
    assert service.new_layout()["name"] == "Layout 2"
    assert service.new_layout()["name"] == "Layout 3"


def test_names_are_unique_ignoring_case(service):
    with pytest.raises(ValueError):
        service.new_layout("my home")
    other = service.new_layout("Try")
    with pytest.raises(ValueError):
        service.rename_layout(other["id"], "MY HOME")
    with pytest.raises(ValueError):
        service.new_layout("x" * 61)
    with pytest.raises(ValueError):
        service.new_layout("   ")
    assert service.rename_layout(other["id"], "try")["name"] == "try"  # its own name, recased


def test_rename_active(service):
    active = service.layouts()[0]["id"]
    assert service.rename_layout(active, "House")["name"] == "House"
    assert _names(service) == ["House"]


def test_activate_swaps_and_keeps_everything(service):
    service.update_preferences({"poll_seconds": 10})
    old = service.layouts()[0]
    fresh = service.new_layout("Fresh")
    with using_layout(fresh["id"]):
        service.add_room("Den", 300, 300)
    result = service.activate_layout(fresh["id"])
    assert result["active"] is True and result["name"] == "Fresh"
    assert service.list_rooms() == ["Den"]
    listed = service.layouts()
    assert [(item["name"], item["active"]) for item in listed] == [("Fresh", True), ("My home", False)]
    with using_layout(old["id"]):
        assert service.list_rooms() == ["Office"]
    assert service.preferences()["poll_seconds"] == 10


def test_activate_the_active_layout_is_a_no_op(service):
    active = service.layouts()[0]
    assert service.activate_layout(active["id"])["id"] == active["id"]
    assert service.list_rooms() == ["Office"]


def test_delete_refused_for_active(service):
    with pytest.raises(ValueError, match="active layout"):
        service.delete_layout(service.layouts()[0]["id"])


def test_delete_removes_sandbox(service):
    fresh = service.new_layout("Fresh")
    service.delete_layout(fresh["id"])
    assert _names(service) == ["My home"]
    with pytest.raises(LayoutNotFound):
        service.delete_layout(fresh["id"])


def test_prune_keeps_images_each_layout_uses(service):
    service.set_room_photo("Office", _png((10, 10, 10)))
    active_photo = service.get_room("Office").photo.file
    fresh = service.new_layout("Fresh")
    with using_layout(fresh["id"]):
        service.add_room("Den", 300, 300)
        service.set_room_photo("Den", _png((200, 10, 10)))  # prunes while the sandbox is open
        sandbox_photo = service.get_room("Den").photo.file
    assert (service.uploads / active_photo).exists()
    service.prune_uploads(min_age_seconds=0)
    assert (service.uploads / sandbox_photo).exists()
    service.delete_layout(fresh["id"])
    assert not (service.uploads / sandbox_photo).exists()
    assert (service.uploads / active_photo).exists()


def test_resolve_by_name_or_id(service):
    fresh = service.new_layout("Fresh")
    assert service.resolve_layout(fresh["id"]) == fresh["id"]
    assert service.resolve_layout("fresh") == fresh["id"]
    assert service.resolve_layout("my home") == service.layouts()[0]["id"]
    with pytest.raises(LayoutNotFound):
        service.resolve_layout("nope")


def test_a_write_that_overlaps_make_active_is_refused(service):
    from myhuey.errors import LayoutChanged
    other = service.new_layout("Other")
    stale = service._load()  # an Active-context request loaded before the swap
    service.activate_layout(other["id"])
    with pytest.raises(LayoutChanged):
        service._save(stale)
    listed = service.layouts()
    assert sorted(item["name"] for item in listed) == ["My home", "Other"]
    assert len({item["id"] for item in listed}) == 2


def test_a_sandbox_write_after_that_sandbox_became_active_is_refused(service):
    from myhuey.errors import LayoutChanged
    other = service.new_layout("Other")
    with using_layout(other["id"]):
        stale = service._load()
        service.activate_layout(other["id"])
        with pytest.raises(LayoutChanged):
            service._save(stale)
    assert sorted(item["name"] for item in service.layouts()) == ["My home", "Other"]
