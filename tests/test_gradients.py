"""Gradient lights: live points, mode, and effect; editing them; validation."""

import pytest
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.service import HueRoomService

from conftest import USERNAME

MODES = ["interpolated_palette", "interpolated_palette_mirrored", "random_pixelated", "segmented_palette"]
EFFECTS = ["no_effect", "candle", "fire", "prism"]

V1_LIGHTS = {
    "5": {"name": "Tube", "productname": "Play gradient tube", "modelid": "915005988501",
          "config": {"archetype": "huetube"}, "state": {"on": True, "bri": 200, "xy": [0.5, 0.4], "reachable": True}},
    "8": {"name": "Festavia", "productname": "Festavia string lights", "modelid": "LCX017",
          "config": {"archetype": "stringlight"}, "state": {"on": True, "bri": 100, "xy": [0.3, 0.3], "reachable": True}},
    "1": {"name": "Lamp", "productname": "Hue color lamp", "modelid": "LCA003",
          "config": {"archetype": "sultanbulb"}, "state": {"on": True, "bri": 100, "xy": [0.3, 0.3], "reachable": True}},
}


def _v2(rid, v1, points, mode_values, mode="interpolated_palette", effect="no_effect", capable=5):
    return {
        "id": rid,
        "id_v1": f"/lights/{v1}",
        "gradient": {
            "points": [{"color": {"xy": {"x": x, "y": y}}} for x, y in points],
            "mode": mode,
            "mode_values": mode_values,
            "points_capable": capable,
            "pixel_count": 10,
        },
        "effects": {"effect_values": EFFECTS, "status": effect, "status_values": EFFECTS},
    }


V2_LIGHTS = [
    _v2("rid-tube", "5", [(0.6915, 0.3083), (0.1532, 0.0475)], MODES, mode="segmented_palette", effect="candle"),
    _v2("rid-fest", "8", [], MODES[:3], capable=5),
    {"id": "rid-lamp", "id_v1": "/lights/1"},
]


@pytest.fixture
def service(db_path):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    return service


@pytest.fixture
def bridge(fake_bridge):
    session = fake_bridge(V1_LIGHTS)
    session.v2_lights = V2_LIGHTS
    return session


def test_lights_report_live_gradient_points_mode_and_effect(service, bridge):
    lights = {light["id"]: light for light in service.lights()}

    tube = lights["5"]
    assert tube["gradient"]["mode"] == "segmented_palette"
    assert tube["gradient"]["modes"] == MODES
    assert tube["gradient"]["points_capable"] == 5 and tube["gradient"]["pixel_count"] == 10
    assert len(tube["gradient"]["points"]) == 2
    assert all(p.startswith("#") and len(p) == 7 for p in tube["gradient"]["points"])
    assert tube["effect"] == {"current": "candle", "values": EFFECTS}
    assert tube["profile"]["gradient"] is True

    assert lights["8"]["gradient"]["points"] == []  # no points set yet is still a gradient light
    assert lights["1"]["gradient"] is None and lights["1"]["effect"] is None


def test_lights_still_load_when_v2_fails(service, fake_bridge):
    session = fake_bridge(V1_LIGHTS)
    original = session.request

    def v2_down(method, url, **kwargs):
        if "/clip/v2/" in url:
            from myhuey.errors import BridgeUnreachable

            raise BridgeUnreachable("v2 is down")
        return original(method, url, **kwargs)

    session.request = v2_down
    lights = service.lights()
    assert len(lights) == 3 and all(light["gradient"] is None for light in lights)


# Writing


def _puts(session):
    return [call for call in session.clip_calls if call["method"] == "PUT"]


def test_set_gradient_sends_points_and_mode_through_v2(service, bridge):
    service.set_gradient("5", ["#ff0000", "#00ff00", "#0000ff"], "segmented_palette")

    [put] = _puts(bridge)
    assert put["url"].endswith("/clip/v2/resource/light/rid-tube")
    body = put["json"]
    assert body["on"] == {"on": True}
    assert body["gradient"]["mode"] == "segmented_palette"
    assert len(body["gradient"]["points"]) == 3
    assert set(body["gradient"]["points"][0]["color"]["xy"]) == {"x", "y"}
    assert put["headers"] == {"hue-application-key": USERNAME} and USERNAME not in put["url"]


def test_set_gradient_without_mode_leaves_the_mode_alone(service, bridge):
    service.set_gradient("5", ["#ff0000", "#0000ff"])
    assert "mode" not in _puts(bridge)[0]["json"]["gradient"]


def test_set_effect(service, bridge):
    service.set_effect("5", "fire")
    assert _puts(bridge)[0]["json"] == {"effects": {"effect": "fire"}}


@pytest.mark.parametrize(
    "light_id, colors, mode, message",
    [
        ("1", ["#ff0000", "#0000ff"], None, "does not support gradients"),
        ("5", ["#ff0000"], None, "between 2 and 5"),
        ("5", ["#ff0000"] * 6, None, "between 2 and 5"),
        ("8", ["#ff0000", "#0000ff"], "segmented_palette", "does not support the mode"),
        ("5", ["#ff0000", "nope"], None, "Hex color"),
    ],
)
def test_bad_gradients_are_refused_before_reaching_the_bridge(service, bridge, light_id, colors, mode, message):
    with pytest.raises(ValueError, match=message):
        service.set_gradient(light_id, colors, mode)
    assert _puts(bridge) == []


def test_unsupported_effects_are_refused(service, bridge):
    with pytest.raises(ValueError, match="does not support the effect"):
        service.set_effect("5", "disco")
    with pytest.raises(ValueError, match="has no effects"):
        service.set_effect("1", "candle")
    assert _puts(bridge) == []


def test_gradient_and_effect_api(service, db_path, bridge):
    web = TestClient(create_app(db_path))
    ok = web.put("/api/lights/5/gradient", json={"colors": ["#ff0000", "#0000ff"], "mode": "interpolated_palette_mirrored"})
    assert ok.status_code == 200 and USERNAME not in ok.text
    assert web.put("/api/lights/5/effect", json={"effect": "prism"}).status_code == 200
    assert web.put("/api/lights/1/gradient", json={"colors": ["#ff0000", "#0000ff"]}).status_code == 400
    assert web.put("/api/lights/5/gradient", json={"colors": ["#ff0000"]}).status_code == 400
    assert web.put("/api/lights/5/effect", json={"effect": "disco"}).status_code == 400


def test_gradient_and_effect_cli(service, db_path, bridge, capsys):
    from myhuey.cli import main

    def run(*argv):
        with pytest.raises(SystemExit) as caught:
            main(["--db", db_path, *argv])
        out = capsys.readouterr()
        return caught.value.code, out.out + out.err

    code, out = run("lights", "gradient", "--light-id", "5", "--colors", "#ff0000,#00ff00", "--mode", "segmented_palette")
    assert code == 0 and "Set a 2-color gradient" in out and USERNAME not in out
    code, out = run("lights", "effect", "--light-id", "5", "--effect", "candle")
    assert code == 0 and "candle" in out
    code, out = run("lights", "gradient", "--light-id", "1", "--colors", "#ff0000,#00ff00")
    assert code == 1 and "does not support gradients" in out


def test_reads_after_a_write_ask_the_bridge_again(service, bridge):
    """The v2 cache must not serve the state from before a change the app just made."""
    service.lights()
    for write in (lambda: service.set_gradient("5", ["#ff0000", "#0000ff"]), lambda: service.set_effect("5", "fire")):
        write()
        gets_before = sum(1 for c in bridge.clip_calls if c["method"] == "GET")
        service.lights()
        gets_after = sum(1 for c in bridge.clip_calls if c["method"] == "GET")
        assert gets_after == gets_before + 1
