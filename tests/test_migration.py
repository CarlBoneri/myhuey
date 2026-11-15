"""Version 1 documents (abstract room units) upgrade to version 2 (centimeters) without loss."""

import copy
import json
import sqlite3

import pytest

from myhuey.migrations import CURRENT_VERSION, V1_CM_PER_UNIT, migrate
from myhuey.models import Room
from myhuey.service import HueRoomService
from myhuey.storage import load_backup, load_config

from conftest import USERNAME

V1 = {
    "bridge": {"ip": "10.0.0.77", "username": USERNAME},
    "rooms": [
        {
            "name": "Office",
            "width": 900,
            "height": 600,
            "x": 1940,
            "y": -40,
            "lights": [
                {"light_id": "21", "label": "Desk", "x": 100, "y": 90, "width": 80, "height": 80,
                 "on": True, "brightness": 255, "color_temp": None, "xy": None, "metadata": {"note": "kept"}},
                {"light_id": "34", "label": "Shelf", "x": 290, "y": 100, "width": 80, "height": 80,
                 "on": True, "brightness": 255, "color_temp": None, "xy": [0.4, 0.4], "metadata": {}},
            ],
        },
        {"name": "🎄", "width": 900, "height": 600, "x": 1920, "y": 1320, "lights": []},
        {"name": "new_office", "width": 1200, "height": 400, "x": 0, "y": 1980, "lights": []},
    ],
}


def _write_v1(path, document):
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    connection.execute("INSERT INTO app_state VALUES ('config', ?)", (json.dumps(document),))
    connection.commit()
    connection.close()


def test_migration_scales_rooms_and_lights_to_centimeters():
    upgraded, start = migrate(copy.deepcopy(V1))

    assert start == 1 and upgraded["schema_version"] == CURRENT_VERSION
    office = upgraded["rooms"][0]
    assert office["outline"] == [[0, 0], [450, 0], [450, 300], [0, 300]]
    assert (office["x"], office["y"]) == (1940 * V1_CM_PER_UNIT, -40 * V1_CM_PER_UNIT)
    desk = office["lights"][0]
    assert (desk["x"], desk["y"], desk["rotation"]) == (50, 45, 0)
    assert desk["metadata"] == {"note": "kept"} and desk["label"] == "Desk"
    assert office["lights"][1]["xy"] == [0.4, 0.4]
    assert upgraded["rooms"][2]["outline"][2] == [600, 200]  # a non-default size keeps its proportions
    assert upgraded["scenes"] == [] and upgraded["bridge"] == V1["bridge"]


def test_relative_layout_is_preserved():
    """Hand-arranged lights keep the same place relative to the room and each other."""
    upgraded, _ = migrate(copy.deepcopy(V1))
    room = Room.from_dict(upgraded["rooms"][0])
    for old, new in zip(V1["rooms"][0]["lights"], room.lights):
        assert new.x / room.width == pytest.approx(old["x"] / 900)
        assert new.y / room.height == pytest.approx(old["y"] / 600)


def test_migrating_is_idempotent():
    once, _ = migrate(copy.deepcopy(V1))
    twice, start = migrate(copy.deepcopy(once))
    assert start == CURRENT_VERSION and twice == once


def test_loading_a_v1_database_upgrades_it_and_keeps_a_backup(tmp_path):
    path = tmp_path / "myhuey.db"
    _write_v1(path, V1)

    loaded = load_config(path)

    assert loaded["schema_version"] == CURRENT_VERSION
    assert [room["name"] for room in loaded["rooms"]] == ["Office", "🎄", "new_office"]
    assert load_backup(1, path) == V1  # the original is kept, untouched
    # The upgrade was saved, so the next load does not migrate again.
    raw = json.loads(sqlite3.connect(path).execute("SELECT value FROM app_state WHERE key='config'").fetchone()[0])
    assert raw["schema_version"] == CURRENT_VERSION


def test_the_service_reads_migrated_rooms(tmp_path):
    path = tmp_path / "myhuey.db"
    _write_v1(path, V1)
    service = HueRoomService(path)

    office = service.get_room("Office")
    assert (office.width, office.height) == (450, 300)
    assert office.get_light("21").label == "Desk"
    assert service.get_bridge()["ip"] == "10.0.0.77"


def test_json_storage_keeps_a_backup_file(tmp_path):
    path = tmp_path / "config.json"
    path.write_text(json.dumps(V1), encoding="utf-8")

    assert load_config(path)["schema_version"] == CURRENT_VERSION
    assert load_backup(1, path) == V1
