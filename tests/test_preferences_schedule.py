import pytest

from myhuey.service import HueRoomService


@pytest.fixture
def service(db_path):
    return HueRoomService(db_path)


def test_schedule_defaults(service):
    prefs = service.preferences()
    assert prefs["wake_time"] == "07:00"
    assert prefs["bed_time"] == "23:00"


def test_times_are_quarter_hours(service):
    service.update_preferences({"bed_time": "01:45"})
    assert service.preferences()["bed_time"] == "01:45"
    with pytest.raises(ValueError):
        service.update_preferences({"bed_time": "01:50"})


def test_only_changed_keys_are_saved(service):
    service.update_preferences({"poll_seconds": 10})
    assert service._load()["preferences"] == {"poll_seconds": 10}


def test_legacy_full_dict_still_reads_and_updates(service):
    config = service._load()
    config["preferences"] = {"poll_seconds": 5, "command_gap_ms": 150, "bogus": 1}
    service._save(config)
    service.update_preferences({"wake_time": "06:30"})
    assert service.preferences()["wake_time"] == "06:30"
    assert service._load()["preferences"] == {"command_gap_ms": 150, "wake_time": "06:30"}


def test_stored_copies_of_defaults_are_dropped_on_update(service):
    config = service._load()
    config["preferences"] = {"poll_seconds": 5, "command_gap_ms": 100}  # what older versions saved
    service._save(config)
    service.update_preferences({"show_light_glow": False})
    saved = service._load()["preferences"]
    assert "poll_seconds" not in saved and "command_gap_ms" not in saved
    assert service.preferences()["poll_seconds"] == 5


def test_setting_a_preference_back_to_its_default_stores_nothing(service):
    service.update_preferences({"poll_seconds": 10})
    service.update_preferences({"poll_seconds": 5})
    assert service._load()["preferences"] == {}
