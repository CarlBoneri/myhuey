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


# --- Mounts and sets stay consistent on save; moving and releasing a set ---------------------

DESK = {"id": "d1", "kind": "desk", "x": 200, "y": 150, "width": 140, "depth": 70, "set": "s1"}
SCREEN = {"id": "m1", "kind": "monitor-27", "x": 200, "y": 130, "width": 61, "depth": 20, "set": "s1"}
CHAIR = {"id": "c1", "kind": "chair", "x": 200, "y": 210, "width": 50, "depth": 50, "set": "s1", "seat": 46}


def _write_room(service, name, change):
    """Edit a stored room directly, for setup the app has no single call for."""
    config = service._load()
    change(service._room_data(config, name))
    service._save(config)


def _with_set(service):
    """The Den with a desk set (desk, 27" screen, chair) and light 3 mounted on the screen."""
    _write_room(service, "Den", lambda data: data.update(desk_sets=[{"id": "s1", "name": "My desk", "base": "d1"}],
                                                          furniture=[DESK, SCREEN, CHAIR]))
    service.assign_light("Den", "3", x=0, y=0, mount={"screen": "m1"})
    return service.get_room("Den")


def _light(room, light_id):
    return next(light for light in room.lights if light.light_id == light_id)


def test_a_mounted_light_sits_on_its_screens_back_as_a_bias_light(service):
    room = _with_set(service)
    strip = _light(room, "3")
    # The screen faces +y, so its back face is depth / 2 behind its middle; its middle height is 75 + 40 / 2.
    assert (strip.x, strip.y, strip.elevation, strip.rotation) == (200, 120, 95, 0)
    assert strip.role == "bias" and strip.set == "s1"


def test_a_mounted_light_follows_its_screen_when_the_furniture_changes(service):
    _with_set(service)
    service.update_room("Den", furniture=[DESK, {**SCREEN, "x": 230, "rotation": 90}, CHAIR])
    strip = _light(service.get_room("Den"), "3")
    # Turned 90°, the front faces -x, so the back face is +x of the middle.
    assert (strip.x, strip.y, strip.rotation) == (240, 130, 90)


def test_removing_the_screen_drops_the_mount_and_leaves_the_light(service):
    _with_set(service)
    service.update_room("Den", furniture=[DESK, CHAIR])
    strip = _light(service.get_room("Den"), "3")
    assert strip.mount is None and (strip.x, strip.y) == (200, 120)
    assert [(light.light_id, light.x) for light in service.get_room("Den").lights if light.light_id != "3"] == [("1", 260), ("2", 390)]


def test_a_set_without_its_base_dissolves(service):
    _with_set(service)
    service.update_room("Den", furniture=[SCREEN, CHAIR])
    room = service.get_room("Den")
    assert room.desk_sets == []
    assert {item.set for item in room.furniture} == {None} and _light(room, "3").set is None


def test_moving_a_set_carries_every_member_and_its_mounted_light(service):
    _with_set(service)
    service.assign_light("Den", "1", x=260, y=160)
    _write_room(service, "Den", lambda data: next(light for light in data["lights"] if light["light_id"] == "1").update(set="s1"))
    room = service.move_desk_set("Den", "s1", x=100, y=300, rotation=90)
    by_id = {item.id: item for item in room.furniture}
    # Turned 90° about the desk: (dx, dy) -> (-dy, dx), then moved so the desk lands at (100, 300).
    assert (by_id["d1"].x, by_id["d1"].y, by_id["d1"].rotation) == (100, 300, 90)
    assert (by_id["m1"].x, by_id["m1"].y, by_id["m1"].rotation) == (120, 300, 90)
    assert (by_id["c1"].x, by_id["c1"].y) == (40, 300)
    lamp = _light(room, "1")
    assert (round(lamp.x, 1), round(lamp.y, 1), lamp.rotation) == (90, 360, 90)
    strip = _light(room, "3")
    assert (strip.x, strip.y) == (130, 300)  # still on the screen's back


def test_releasing_a_set_leaves_its_pieces_where_they_stand(service):
    _with_set(service)
    room = service.release_desk_set("Den", "s1")
    assert room.desk_sets == []
    assert {item.set for item in room.furniture} == {None}
    assert next(item for item in room.furniture if item.id == "m1").x == 200
    assert _light(room, "3").mount == {"screen": "m1"}  # a mount does not need a set


def test_unknown_set_is_refused(service):
    with pytest.raises(ValueError, match="no desk set"):
        service.move_desk_set("Den", "nope", x=0, y=0, rotation=0)


def test_set_furniture_keeps_ids_sets_and_seats(service):
    from myhuey.assistant import create_sandbox, set_furniture
    box = create_sandbox(service, "Desk idea", copy_from="active")
    out = set_furniture(service, box["id"], "Den", [
        {"id": "d1", "kind": "desk", "x": 200, "y": 150, "set": "s1"},
        {"id": "c1", "kind": "chair", "x": 200, "y": 210, "seat": 48},
    ])
    desk, chair = out["furniture"]
    assert (desk["id"], chair["id"], chair["seat"]) == ("d1", "c1", 48)


def test_api_mounts_moves_and_releases(db_path):
    from fastapi.testclient import TestClient

    from myhuey.api import create_app
    from myhuey.service import HueRoomService
    service = HueRoomService(db_path)
    service.add_room("Den", 400, 400)
    _write_room(service, "Den", lambda data: data.update(desk_sets=[{"id": "s1", "name": "My desk", "base": "d1"}],
                                                          furniture=[DESK, SCREEN, CHAIR]))
    web = TestClient(create_app(db_path, pairing_window=5))
    placed = web.post("/api/rooms/Den/lights", json={"light_id": "planned-x", "mount": {"screen": "m1"}})
    assert placed.status_code == 200 and placed.json()["mount"] == {"screen": "m1"} and placed.json()["y"] == 120
    moved = web.patch("/api/rooms/Den/sets/s1", json={"x": 220, "y": 150, "rotation": 0})
    assert moved.status_code == 200
    assert next(light for light in moved.json()["lights"] if light["light_id"] == "planned-x")["x"] == 220
    off = web.post("/api/rooms/Den/lights", json={"light_id": "planned-x", "x": 10, "y": 10, "mount": None})
    assert off.json()["mount"] is None and off.json()["x"] == 10
    assert web.post("/api/rooms/Den/lights", json={"light_id": "planned-y", "mount": {"screen": "gone"}}).status_code == 400
    assert web.patch("/api/rooms/Den/sets/nope", json={"x": 0, "y": 0}).status_code == 400
    assert web.patch("/api/rooms/Den/sets/s1", json={"y": 0}).status_code == 422
    released = web.delete("/api/rooms/Den/sets/s1")
    assert released.status_code == 200 and released.json()["desk_sets"] == []
