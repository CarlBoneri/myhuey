"""Desk sets: pieces placed together from a desk design, lights mounted on a screen, and the chair you sit in."""

import pytest

from myhuey.models import FURNITURE_HEIGHTS, FURNITURE_SIZES, Furniture, LayoutLight, Room
from myhuey.preferences import PREFERENCES, merged, validate


def test_old_data_loads_without_sets_mounts_or_seats():
    item = Furniture.from_dict({"kind": "desk", "width": 140, "depth": 70})
    light = LayoutLight.from_dict({"light_id": "7", "label": "Strip"})
    room = Room.from_dict({"name": "Office"})
    assert (item.set, item.seat) == (None, None)
    assert (light.set, light.mount) == (None, None)
    assert room.desk_sets == []
    assert Room.from_dict(room.to_dict()).desk_sets == []


def test_set_mount_and_seat_round_trip():
    chair = Furniture.from_dict({"kind": "chair", "width": 50, "depth": 50, "set": "s1", "seat": 48})
    light = LayoutLight.from_dict({"light_id": "planned-1", "label": "Strip", "set": "s1", "mount": {"screen": "g9"}})
    room = Room.from_dict({"name": "Office", "desk_sets": [{"id": "s1", "name": "My desk", "base": "d1"}]})
    assert (chair.set, chair.seat) == ("s1", 48.0)
    assert Furniture.from_dict(chair.to_dict()) == chair
    assert LayoutLight.from_dict(light.to_dict()) == light
    assert light.mount == {"screen": "g9"}
    assert Room.from_dict(room.to_dict()).desk_sets == [{"id": "s1", "name": "My desk", "base": "d1"}]


@pytest.mark.parametrize("seat", [29, 91])
def test_seat_height_range(seat):
    with pytest.raises(ValueError, match="seat height"):
        Furniture.from_dict({"kind": "chair", "width": 50, "depth": 50, "seat": seat})


@pytest.mark.parametrize("mount", [{"wall": "x"}, "g9", {"screen": ""}])
def test_a_mount_names_its_screen(mount):
    with pytest.raises(ValueError, match="names the screen"):
        LayoutLight.from_dict({"light_id": "1", "label": "x", "mount": mount})


def test_peripherals_in_the_catalog():
    assert FURNITURE_SIZES["laptop"] == ("Laptop (closed)", 31.0, 22.0, "rect")
    assert FURNITURE_SIZES["keyboard"] == ("Keyboard", 44.0, 14.0, "rect")
    assert FURNITURE_SIZES["speaker"] == ("Speaker", 12.0, 15.0, "rect")
    assert FURNITURE_HEIGHTS["laptop"] == (75, 2) and FURNITURE_HEIGHTS["speaker"] == (75, 20)


def test_eye_preferences_default_to_todays_numbers():
    prefs = merged({})
    assert (prefs["eye_sitting"], prefs["eye_standing"], prefs["screen_distance"]) == (69, 155, 60)
    assert "eye_sitting" in PREFERENCES


@pytest.mark.parametrize("change", [{"eye_sitting": 49}, {"eye_sitting": 69.5}, {"eye_standing": 201}, {"screen_distance": 29}])
def test_eye_preferences_are_whole_cm_in_range(change):
    with pytest.raises(ValueError, match="whole number from"):
        validate(change)


def test_eye_preferences_accept_a_value():
    assert validate({"eye_sitting": 72, "eye_standing": 160, "screen_distance": 70}) == {"eye_sitting": 72, "eye_standing": 160, "screen_distance": 70}


def test_prefs_cli_shows_a_range_briefly(tmp_path, capsys):
    from myhuey.cli import main
    with pytest.raises(SystemExit):
        main(["--db", str(tmp_path / "h.db"), "prefs", "show"])
    line = next(line for line in capsys.readouterr().out.splitlines() if line.startswith("eye_sitting"))
    assert line == "eye_sitting: 69  (50-90)"
