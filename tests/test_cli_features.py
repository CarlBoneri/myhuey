"""CLI parity: room shapes in real units, furniture, photos, scenes, and palettes."""

import io

import pytest
from PIL import Image

from myhuey.cli import main
from myhuey.service import HueRoomService

from conftest import USERNAME


@pytest.fixture
def run(capsys, db_path):
    def invoke(*argv):
        with pytest.raises(SystemExit) as caught:
            main(["--db", db_path, *argv])
        captured = capsys.readouterr()
        return caught.value.code, captured.out, captured.err

    return invoke


@pytest.fixture
def picture(tmp_path):
    path = tmp_path / "pic.png"
    image = Image.new("RGB", (60, 40), (250, 120, 20))
    for x in range(30):
        for y in range(40):
            image.putpixel((x, y), (20, 80, 240))
    image.save(path)
    return str(path)


def test_rooms_take_real_dimensions_and_outlines(run, db_path):
    code, out, _ = run("room", "create", "--name", "Den", "--width", "12ft", "--height", "10ft 6in")
    assert code == 0 and "12' x 10' 6\"" in out

    code, out, _ = run("room", "update", "--name", "Den", "--outline", "0,0 14,0 14,8 8,8 8,12 0,12")
    assert code == 0 and "6 corners" in out
    room = HueRoomService(db_path).get_room("Den")
    assert room.outline[2] == [pytest.approx(426.72), pytest.approx(243.84)]

    code, out, _ = run("room", "update", "--name", "Den", "--units", "metric", "--width", "5m")
    assert "5.00 m" in out

    assert "Cannot read the length" in run("room", "update", "--name", "Den", "--width", "huge")[2]


def test_lights_get_rotation_and_length(run, db_path):
    run("room", "create", "--name", "Den")
    code, out, _ = run(
        "room", "assign", "--name", "Den", "--light-id", "4", "--x", "100", "--y", "50", "--rotation", "90", "--length", "2m"
    )
    assert code == 0
    light = HueRoomService(db_path).get_room("Den").get_light("4")
    assert (light.rotation, light.length) == (90, 200)


def test_furniture_commands(run, db_path):
    run("room", "create", "--name", "Den")
    code, out, _ = run("furniture", "add", "--room", "Den", "--kind", "sofa", "--width", "7ft", "--depth", "3ft", "--x", "200", "--y", "80")
    assert code == 0 and "Added sofa" in out
    piece = HueRoomService(db_path).get_room("Den").furniture[0]
    assert piece.width == pytest.approx(213.36)

    assert "7' x 3'" in run("furniture", "list", "--room", "Den")[1]
    assert run("furniture", "remove", "--room", "Den", "--id", piece.id)[0] == 0
    assert HueRoomService(db_path).get_room("Den").furniture == []


def test_room_photo_from_the_cli(run, db_path, picture):
    run("room", "create", "--name", "Den")
    code, out, _ = run("room", "photo", "--name", "Den", "--file", picture)
    assert code == 0 and "60x40" in out
    assert HueRoomService(db_path).get_room("Den").photo is not None
    assert run("room", "remove-photo", "--name", "Den")[0] == 0


def test_scene_lifecycle_from_the_cli(run, db_path, fake_bridge, picture):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    run("room", "create", "--name", "Den", "--width", "4m", "--height", "3m", "--units", "metric")
    service.assign_light("Den", "1", x=100, y=100, product={"archetype": "sultanbulb"})

    code, out, _ = run("scene", "create", "--name", "Cozy", "--room", "Den", "--base-mode", "color", "--color", "#ffaa00", "--brightness", "40")
    assert code == 0
    code, _, _ = run("scene", "zone", "--scene", "Cozy", "--rect", "0,0,200,200", "--color", "#ff0000", "--brightness", "70")
    assert code == 0

    code, out, _ = run("scene", "preview", "--scene", "Cozy")
    assert "#ff0000 at 70%" in out

    code, out, _ = run("scene", "image", "--scene", "Cozy", "--file", picture, "--mood", "bright", "--rotation", "90")
    assert code == 0 and "Palette:" in out
    layer = HueRoomService(db_path).get_scene("Cozy").image
    assert layer.rotation == 90 and (layer.width, layer.height) == (300, 400)  # turned, it still covers the 4 m x 3 m room

    fake_bridge({"1": {"name": "Lamp", "state": {"on": False, "xy": [0.3, 0.3]}}}, [{"success": {}}])
    code, out, err = run("scene", "apply", "--scene", "Cozy")
    assert code == 0, err
    assert "Applied 'Cozy'" in out and USERNAME not in out

    assert "Cozy" in run("scene", "list")[1]
    assert run("scene", "delete", "--scene", "Cozy")[0] == 0
    assert "not found" in run("scene", "show", "--scene", "Cozy")[2]


def test_palette_from_a_file(run, picture):
    code, out, _ = run("palette", "--file", picture, "--count", "2")
    assert code == 0
    lines = out.strip().splitlines()
    assert len(lines) == 2 and all(line.startswith("#") for line in lines)
    assert "across" in lines[0]
