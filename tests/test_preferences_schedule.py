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
    config["preferences"] = {"poll_seconds": 5, "command_gap_ms": 100, "bogus": 1}
    service._save(config)
    service.update_preferences({"wake_time": "06:30"})
    assert service.preferences()["wake_time"] == "06:30"
    assert "bogus" not in service._load()["preferences"]
