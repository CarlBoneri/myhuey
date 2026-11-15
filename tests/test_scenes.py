"""Scenes: zones and images decide each light's color; applying sends v1 or v2 commands."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from myhuey.api import create_app
from myhuey.models import LayoutLight, Room
from myhuey.scenes import Scene, color_at, evaluate
from myhuey.service import HueRoomService

from conftest import USERNAME

STRIP = {"archetype": "huelightstrip", "productname": "Hue gradient lightstrip", "modelid": "LCX004"}
BULB = {"archetype": "sultanbulb", "productname": "Hue color lamp", "modelid": "LCA003"}

LEFT = [[0, 0], [200, 0], [200, 300], [0, 300]]
RIGHT = [[200, 0], [400, 0], [400, 300], [200, 300]]


def _room(*lights):
    return Room(name="Den", outline=[[0, 0], [400, 0], [400, 300], [0, 300]], lights=list(lights))


def _scene(**extra):
    return Scene.from_dict(
        {
            "name": "Sunset",
            "room": "Den",
            "zones": [
                {"points": LEFT, "color": "#ff0000", "brightness": 80},
                {"points": RIGHT, "color": "#0000ff", "brightness": 40},
            ],
            **extra,
        }
    )


def test_a_bulb_takes_the_zone_it_sits_in():
    room = _room(LayoutLight("1", "Lamp", x=100, y=100, product=BULB), LayoutLight("2", "Lamp", x=300, y=100, product=BULB))
    results = evaluate(_scene(), room)
    assert [(r["light_id"], r["color"], r["brightness"]) for r in results] == [("1", "#ff0000", 80), ("2", "#0000ff", 40)]
    assert results[0]["gradient"] is None and results[0]["on"] is True


def test_a_gradient_strip_takes_colors_along_its_length():
    strip = LayoutLight("5", "Strip", x=190, y=150, rotation=0, length=300, product=STRIP)
    [result] = evaluate(_scene(), _room(strip))
    assert result["gradient"][0] == "#ff0000" and result["gradient"][-1] == "#0000ff"
    assert len(result["gradient"]) == 5
    assert result["brightness"] == pytest.approx((80 * 3 + 40 * 2) / 5, abs=0.1)

    flipped = LayoutLight("5", "Strip", x=190, y=150, rotation=180, length=300, product=STRIP)
    [result] = evaluate(_scene(), _room(flipped))
    assert result["gradient"][0] == "#0000ff"  # rotation decides which end starts the gradient


def test_the_bridge_point_count_limits_the_gradient():
    strip = LayoutLight("5", "Strip", x=200, y=150, length=300, product=STRIP)
    [result] = evaluate(_scene(), _room(strip), gradient_points={"5": 3})
    assert len(result["gradient"]) == 3


def test_later_zones_sit_on_top():
    scene = _scene()
    scene.zones.append(scene.zones[0].__class__.from_dict({"points": [[50, 50], [150, 50], [150, 150], [50, 150]], "color": "#00ff00"}))
    assert color_at(scene, (100, 100))[0] == "#00ff00"


@pytest.mark.parametrize(
    "mode, expected",
    [("off", None), ("color", ("#ffcc00", 30.0)), ("nearest", ("#0000ff", 40.0))],
)
def test_the_base_covers_lights_outside_every_zone(mode, expected):
    scene = _scene(base_mode=mode, base_color="#ffcc00", base_brightness=30)
    assert color_at(scene, (450, 150)) == expected


def test_keep_leaves_uncovered_lights_alone():
    room = _room(LayoutLight("9", "Porch", x=500, y=500, product=BULB))
    [result] = evaluate(_scene(base_mode="keep"), room)
    assert result["keep"] is True and result["on"] is False


def test_an_image_layer_colors_lights_beneath_it():
    def lookup(u, v):
        if not (0 <= u <= 1 and 0 <= v <= 1):
            return None
        return (0, 255, 0) if u < 0.5 else (255, 255, 255)

    scene = Scene.from_dict(
        {"name": "Pic", "room": "Den", "image": {"file": "x.jpg", "x": 0, "y": 0, "width": 400, "height": 300}}
    )
    assert color_at(scene, (100, 100), lookup) == ("#00ff00", 100)
    assert color_at(scene, (300, 100), lookup) == ("#ffffff", 100)
    assert color_at(scene, (900, 100), lookup) is None  # off the image


def test_scenes_reject_bad_input():
    with pytest.raises(ValueError):
        Scene.from_dict({"name": "", "room": "Den"})
    with pytest.raises(ValueError):
        Scene.from_dict({"name": "x", "room": "Den", "base_mode": "party"})
    with pytest.raises(ValueError):
        Scene.from_dict({"name": "x", "room": "Den", "zones": [{"points": [[0, 0], [1, 1]], "color": "#fff"}]})


# Service and API


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.sleep = lambda seconds: None
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Den", 400, 300)
    service.assign_light("Den", "1", x=100, y=100, product=BULB)
    service.assign_light("Den", "5", x=200, y=150, length=300, product=STRIP)
    return service


RAW_LIGHTS = {
    "1": {"name": "Lamp", "state": {"on": True, "bri": 10, "xy": [0.3, 0.3]}},
    "5": {"name": "Strip", "state": {"on": True, "bri": 10, "xy": [0.3, 0.3]}},
}


def test_applying_sends_gradients_through_v2_and_the_rest_through_v1(service, fake_bridge):
    session = fake_bridge(RAW_LIGHTS, [{"success": {}}])
    session.v2_lights = [
        {"id": "rid-strip", "id_v1": "/lights/5", "gradient": {"points_capable": 5}},
        {"id": "rid-lamp", "id_v1": "/lights/1"},
    ]
    scene = service.save_scene(_scene().to_dict())

    results = service.apply_scene(scene.id)

    assert all(r["applied"] for r in results)
    v1 = [call for call in session.calls if call["method"] == "PUT"]
    assert v1[0]["url"].endswith("/lights/1/state")
    # The lamp is already on, so "on" is left out (one ZigBee message fewer).
    assert "on" not in v1[0]["json"] and v1[0]["json"]["bri"] == round(80 * 2.54)
    put = [call for call in session.clip_calls if call["method"] == "PUT"]
    assert put[0]["url"].endswith("/clip/v2/resource/light/rid-strip")
    assert len(put[0]["json"]["gradient"]["points"]) == 5
    assert put[0]["headers"] == {"hue-application-key": USERNAME}  # the key goes in a header, never the URL
    assert USERNAME not in put[0]["url"]


def test_scenes_round_trip_through_the_api(service, db_path, fake_bridge):
    web = TestClient(create_app(db_path))
    created = web.post("/api/scenes", json=_scene().to_dict())
    assert created.status_code == 200
    scene_id = created.json()["id"]

    assert [s["name"] for s in web.get("/api/scenes?room=Den").json()] == ["Sunset"]
    renamed = web.put(f"/api/scenes/{scene_id}", json={**created.json(), "name": "Dusk"})
    assert renamed.json()["name"] == "Dusk" and renamed.json()["id"] == scene_id

    preview = web.post("/api/scenes/preview", json=renamed.json()).json()
    assert {r["light_id"] for r in preview} == {"1", "5"}

    session = fake_bridge(RAW_LIGHTS, [{"success": {}}])
    applied = web.post(f"/api/scenes/{scene_id}/apply").json()
    assert applied["failed"] == 0 and USERNAME not in str(applied)
    assert session.calls  # it reached the bridge

    assert web.delete(f"/api/scenes/{scene_id}").status_code == 200
    assert web.get(f"/api/scenes/{scene_id}").status_code == 404


def test_scenes_need_an_existing_room(service, db_path):
    web = TestClient(create_app(db_path))
    response = web.post("/api/scenes", json={"name": "x", "room": "Attic"})
    assert response.status_code == 404


def test_renaming_or_deleting_a_room_follows_through_to_its_scenes(service):
    scene = service.save_scene(_scene().to_dict())
    service.update_room("Den", new_name="Library")
    assert service.get_scene(scene.id).room == "Library"
    service.remove_room("Library")
    assert service.scenes() == []


def test_scenes_with_an_image_read_colors_from_the_upload(service):
    image = Image.new("RGB", (40, 30), (0, 255, 0))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    uploaded = service.upload_image(buffer.getvalue())
    scene = service.save_scene(
        {"name": "Green", "room": "Den",
         "image": {"file": uploaded["file"], "x": 0, "y": 0, "width": 400, "height": 300}}
    )
    results = {r["light_id"]: r for r in service.preview_scene(scene)}
    red, green, blue = (int(results["1"]["color"][i : i + 2], 16) for i in (1, 3, 5))
    assert green > 250 and red < 5 and blue < 5  # JPEG re-encoding may shift a channel by one


# Per-light overrides


def test_an_override_wins_over_the_zone_under_the_light():
    room = _room(LayoutLight("5", "Strip", x=190, y=150, length=300, product=STRIP), LayoutLight("1", "Lamp", x=100, y=100, product=BULB))
    scene = _scene(overrides={
        "5": {"colors": ["#00ff00", "#ffff00"], "mode": "segmented_palette", "effect": "candle", "brightness": 30},
        "1": {"on": False},
    })
    results = {r["light_id"]: r for r in evaluate(scene, room)}
    strip = results["5"]
    assert strip["gradient"] == ["#00ff00", "#ffff00"] and strip["color"] == "#00ff00"
    assert (strip["mode"], strip["effect"], strip["brightness"], strip["on"]) == ("segmented_palette", "candle", 30, True)
    assert strip["override"] is True
    assert results["1"]["on"] is False and results["1"]["override"] is True


def test_a_mode_only_override_keeps_the_zone_colors():
    strip = LayoutLight("5", "Strip", x=190, y=150, length=300, product=STRIP)
    [result] = evaluate(_scene(overrides={"5": {"mode": "interpolated_palette_mirrored"}}), _room(strip))
    assert result["gradient"][0] == "#ff0000" and result["gradient"][-1] == "#0000ff"
    assert result["mode"] == "interpolated_palette_mirrored"


def test_overrides_for_lights_no_longer_in_the_room_are_ignored():
    room = _room(LayoutLight("1", "Lamp", x=100, y=100, product=BULB))
    results = evaluate(_scene(overrides={"77": {"colors": ["#ffffff", "#000000"]}}), room)
    assert [r["light_id"] for r in results] == ["1"]


def test_overrides_are_validated():
    with pytest.raises(ValueError):
        _scene(overrides={"5": {"colors": ["#ff0000", "nope"]}})
    with pytest.raises(ValueError):
        _scene(overrides={"5": {"colors": ["#ff0000"] * 6}})
    assert _scene(overrides={"5": {"brightness": 400}}).overrides["5"]["brightness"] == 100


def test_applying_sends_the_override_mode_and_effect(service, fake_bridge):
    session = fake_bridge(RAW_LIGHTS, [{"success": {}}])
    session.v2_lights = [
        {"id": "rid-strip", "id_v1": "/lights/5", "gradient": {"points_capable": 5, "mode_values": ["interpolated_palette", "segmented_palette"]},
         "effects": {"effect_values": ["no_effect", "candle"], "status": "no_effect"}},
        {"id": "rid-lamp", "id_v1": "/lights/1"},
    ]
    scene = service.save_scene(_scene(overrides={"5": {"colors": ["#00ff00", "#ffff00"], "mode": "segmented_palette", "effect": "candle"}}).to_dict())

    results = service.apply_scene(scene.id)

    assert all(r["applied"] for r in results), results
    puts = [c["json"] for c in session.clip_calls if c["method"] == "PUT"]
    assert puts[0]["gradient"]["mode"] == "segmented_palette" and len(puts[0]["gradient"]["points"]) == 2
    assert puts[1] == {"effects": {"effect": "candle"}}


def test_apply_orders_effect_writes_so_colors_survive(service, fake_bridge):
    """On the bridge an effect clears the gradient and a gradient cancels the effect. A real
    effect is sent after the gradient; "no_effect" is never sent, since the gradient stops it."""
    session = fake_bridge(RAW_LIGHTS, [{"success": {}}])
    session.v2_lights = [
        {"id": "rid-strip", "id_v1": "/lights/5", "gradient": {"points_capable": 5, "mode_values": ["interpolated_palette"]},
         "effects": {"effect_values": ["no_effect", "candle"], "status": "candle"}},
        {"id": "rid-lamp", "id_v1": "/lights/1"},
    ]
    scene = service.save_scene(_scene(overrides={"5": {"colors": ["#00ff00", "#ffff00"], "effect": "no_effect"}}).to_dict())
    service.apply_scene(scene.id)
    puts = [c["json"] for c in session.clip_calls if c["method"] == "PUT"]
    assert len(puts) == 1 and "gradient" in puts[0]


@pytest.mark.parametrize(
    "overrides",
    [
        ["x"],
        {"5": "not an object"},
        {"5": {"on": "false"}},
        {"5": {"brightness": "abc"}},
        {"5": {"mode": "disco_palette"}},
        {"5": {"effect": "Fire!; drop"}},
    ],
)
def test_malformed_overrides_are_refused(overrides):
    with pytest.raises(ValueError):
        _scene(overrides=overrides)


def test_malformed_overrides_are_a_400_from_the_api(service, db_path):
    web = TestClient(create_app(db_path))
    response = web.post("/api/scenes", json={**_scene().to_dict(), "id": None, "overrides": ["x"]})
    assert response.status_code == 400


def test_apply_skips_a_mode_or_effect_the_light_does_not_have(service, fake_bridge):
    session = fake_bridge(RAW_LIGHTS, [{"success": {}}])
    session.v2_lights = [
        {"id": "rid-strip", "id_v1": "/lights/5", "gradient": {"points_capable": 5, "mode_values": ["interpolated_palette"]},
         "effects": {"effect_values": ["no_effect", "candle"], "status": "no_effect"}},
        {"id": "rid-lamp", "id_v1": "/lights/1"},
    ]
    scene = service.save_scene(_scene(overrides={"5": {"colors": ["#00ff00", "#ffff00"], "mode": "segmented_palette", "effect": "fire"}}).to_dict())

    results = {r["light_id"]: r for r in service.apply_scene(scene.id)}

    puts = [c["json"] for c in session.clip_calls if c["method"] == "PUT"]
    assert len(puts) == 1 and "mode" not in puts[0]["gradient"]  # colors still land
    assert results["5"]["applied"] is True
    assert "segmented_palette" in results["5"]["warning"] and "fire" in results["5"]["warning"]


def test_a_rotated_image_colors_lights_by_where_it_now_lies():
    """Turned 90° clockwise, the image's left half (green) lies along the top of its box."""
    def lookup(u, v):
        if not (0 <= u <= 1 and 0 <= v <= 1):
            return None
        return (0, 255, 0) if u < 0.5 else (255, 255, 255)

    layer = {"file": "x.jpg", "x": 0, "y": 0, "width": 400, "height": 400}
    upright = Scene.from_dict({"name": "Pic", "room": "Den", "image": layer})
    turned = Scene.from_dict({"name": "Pic", "room": "Den", "image": {**layer, "rotation": 90}})

    assert color_at(turned, (200, 50), lookup)[0] == "#00ff00"   # top of the box
    assert color_at(turned, (200, 350), lookup)[0] == "#ffffff"  # bottom of the box
    assert color_at(upright, (50, 200), lookup)[0] == "#00ff00"
    assert turned.image.rotation == 90 and Scene.from_dict({"name": "P", "room": "D", "image": {**layer, "rotation": -90}}).image.rotation == 270
