"""The Hue app's scene gallery: shipped as palettes, and recreatable as scenes in any room."""

import json

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.cli import main
from myhuey.hue_scenes import gallery, hue_scene
from myhuey.palettes import load
from myhuey.service import HueRoomService

GRADIENT = {"archetype": "huelightstrip", "productname": "Hue gradient lightstrip"}
BULB = {"archetype": "sultanbulb"}


def test_the_gallery_ships_all_82_scenes_in_12_sets():
    sets = gallery()
    assert len(sets) == 12 and sum(len(s["scenes"]) for s in sets) == 82
    assert sets[0]["name"] == "Defaults"
    for s in sets:
        for scene in s["scenes"]:
            assert 1 <= scene["bri"] <= 254 and scene["colors"] and all(c.startswith("#") for c in scene["colors"])


def test_multi_color_scenes_join_the_palette_library_with_credit():
    hue = [p for p in load() if p.source == "hue"]
    assert len(hue) >= 70
    assert any(p.name == "Savanna sunset" for p in hue)
    assert all(p.credit.get("set") and p.credit.get("url", "").startswith("https://gist.github.com/") for p in hue)


@pytest.fixture
def room(db_path):
    service = HueRoomService(db_path)
    service.add_room("Den", 400, 300)
    service.assign_light("Den", "1", x=50, y=50, product=BULB)
    service.assign_light("Den", "2", x=350, y=250, product=BULB)
    service.assign_light("Den", "3", x=200, y=20, length=200, product=GRADIENT)
    return service.get_room("Den")


def test_a_default_scene_sets_every_light_to_its_white(room):
    scene = hue_scene(room, "Defaults", "Concentrate")
    assert scene.name == "Concentrate (Hue)"
    whites = {override["white"] for override in scene.overrides.values()}
    assert len(whites) == 1 and 4000 <= whites.pop() <= 4600
    assert all(override["brightness"] == 100 for override in scene.overrides.values())


def test_a_color_scene_spreads_its_colors_and_fills_gradients(room):
    scene = hue_scene(room, "Cozy", "Savanna sunset")
    colors = gallery_colors("Cozy", "Savanna sunset")
    assert scene.overrides["3"]["colors"] == colors and scene.overrides["3"]["mode"] == "interpolated_palette"
    assert scene.overrides["1"]["colors"][0] in colors and scene.overrides["2"]["colors"][0] in colors
    assert scene.overrides["1"]["colors"] != scene.overrides["2"]["colors"]


def gallery_colors(set_name, name):
    return next(sc["colors"] for s in gallery() if s["name"] == set_name for sc in s["scenes"] if sc["name"] == name)


def test_unknown_scene_is_an_error(room):
    with pytest.raises(ValueError):
        hue_scene(room, "Cozy", "Nope")


def test_api_and_cli(room, db_path, capsys):
    web = TestClient(create_app(db_path))
    sets = web.get("/api/hue-scenes").json()
    assert len(sets) == 12
    made = web.post("/api/rooms/Den/hue-scenes", json={"set": "Serenity", "name": "Arctic aurora"})
    assert made.status_code == 200 and made.json()["scene"]["name"] == "Arctic aurora (Hue)" and made.json()["preview"]
    assert web.get("/api/scenes?room=Den").json() == []  # a preview until saved

    with pytest.raises(SystemExit) as caught:
        main(["--db", db_path, "hue-scenes", "--room", "Den", "--set", "Party vibes", "--scene", "Miami", "--save"])
    assert caught.value.code == 0
    assert [scene.name for scene in HueRoomService(db_path).scenes("Den")] == ["Miami (Hue)"]
