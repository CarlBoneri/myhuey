import pytest
import requests

from myhuey.migrations import CURRENT_VERSION
from myhuey.color import (
    build_hue_state,
    color_temperature_to_mired,
    hex_to_rgb,
    light_state_to_hex,
    mired_to_color_temperature,
    rgb_to_hex,
    rgb_to_xy,
    xy_to_hex,
)
from myhuey.errors import BridgeCertificateError, BridgeUnreachable, HueApiError, LinkButtonNotPressed
from myhuey.hue import HueBridgeClient
from myhuey.storage import load_config, save_config

from conftest import LIGHTS, LINK_BUTTON, PAIRED, USERNAME, FakeResponse, FakeSession


# Endpoint parsing


@pytest.mark.parametrize(
    "address, expected",
    [
        ("10.0.0.77", ("10.0.0.77", 443)),
        ("  10.0.0.77  ", ("10.0.0.77", 443)),
        ("10.0.0.77:8443", ("10.0.0.77", 8443)),
        ("10.0.0.77/443", ("10.0.0.77", 443)),
        ("https://10.0.0.77", ("10.0.0.77", 443)),
        ("https://10.0.0.77:8443/api", ("10.0.0.77", 8443)),
        ("bridge.local", ("bridge.local", 443)),
    ],
)
def test_normalize_bridge_endpoint_accepts_common_forms(address, expected):
    assert HueBridgeClient.normalize_bridge_endpoint(address) == expected


@pytest.mark.parametrize("address", ["", "   ", "http://10.0.0.77", "ftp://10.0.0.77", "10.0.0.77:notaport"])
def test_normalize_bridge_endpoint_rejects_bad_addresses(address):
    with pytest.raises(ValueError):
        HueBridgeClient.normalize_bridge_endpoint(address)


# Collections, resources, params


def test_collection_passes_params_and_builds_the_url():
    session = FakeSession({"1": {"name": "Lamp"}})
    client = HueBridgeClient("192.168.1.10", "token", session=session)

    assert client.collection("lights", params={"foo": "bar"}) == {"1": {"name": "Lamp"}}
    assert session.calls[0]["method"] == "GET"
    assert session.calls[0]["url"] == "https://192.168.1.10:443/api/token/lights"
    assert session.calls[0]["params"] == {"foo": "bar"}


def test_resource_supports_actions_methods_and_payloads():
    session = FakeSession([{"success": {"/lights/3/state/on": True}}], {"name": "Office"})
    client = HueBridgeClient("bridge.local", "user", session=session)

    client.resource("lights", "3", action="state", method="put", payload={"on": True})
    assert client.get_group("1") == {"name": "Office"}

    assert session.calls[0]["method"] == "PUT"
    assert session.calls[0]["url"] == "https://bridge.local:443/api/user/lights/3/state"
    assert session.calls[0]["json"] == {"on": True}
    assert session.calls[1]["url"] == "https://bridge.local:443/api/user/groups/1"


def test_set_light_color_sends_a_hue_state_body():
    session = FakeSession([{"success": {}}])
    HueBridgeClient("10.0.0.5", "user", session=session).set_light_color("4", color="#ff0000", brightness=300, on=True)

    body = session.calls[0]["json"]
    assert body["on"] is True
    assert body["bri"] == 254
    assert body["xy"] == pytest.approx([0.7006, 0.2993], abs=0.001)


def test_set_light_color_without_changes_is_an_error():
    with pytest.raises(ValueError):
        HueBridgeClient("10.0.0.5", "user", session=FakeSession({})).set_light_color("4")


@pytest.mark.parametrize("segment", ["../config", "1/state", "", "a b", "lights?x=1"])
def test_path_segments_cannot_escape_the_resource(segment):
    client = HueBridgeClient("10.0.0.5", "user", session=FakeSession({}))
    with pytest.raises(ValueError):
        client.resource("lights", segment)
    with pytest.raises(ValueError):
        client.collection(segment)


# Errors


def test_bridge_error_entries_raise_hue_api_error():
    session = FakeSession([{"error": {"type": 1, "address": "/lights", "description": "unauthorized user"}}])
    with pytest.raises(HueApiError) as caught:
        HueBridgeClient("10.0.0.5", "bad-user", session=session).get_lights()

    assert caught.value.type == HueApiError.UNAUTHORIZED
    assert "unauthorized user" in str(caught.value)


@pytest.mark.parametrize(
    "failure, expected",
    [
        (requests.exceptions.ConnectionError(f"refused https://10.0.0.5/api/{USERNAME}/lights"), BridgeUnreachable),
        (requests.exceptions.ReadTimeout(f"timeout https://10.0.0.5/api/{USERNAME}/lights"), BridgeUnreachable),
        (requests.exceptions.SSLError(f"handshake failure for /api/{USERNAME}/lights"), BridgeUnreachable),
        (requests.exceptions.SSLError(f'Fingerprints did not match. /api/{USERNAME} Expected "aa", got "bb"'), BridgeCertificateError),
        (FakeResponse({}, status_code=503), BridgeUnreachable),
        (FakeResponse(ValueError(f"not json /api/{USERNAME}")), BridgeUnreachable),
    ],
)
def test_transport_failures_are_reported_without_the_username(failure, expected):
    client = HueBridgeClient("10.0.0.5", USERNAME, session=FakeSession(failure))
    with pytest.raises(expected) as caught:
        client.get_lights()

    assert USERNAME not in str(caught.value)
    assert "10.0.0.5" in str(caught.value)
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__


def test_client_repr_does_not_contain_the_username():
    assert USERNAME not in repr(HueBridgeClient("10.0.0.5", USERNAME, session=FakeSession({})))


# Pairing


def test_register_user_keeps_asking_until_the_button_is_pressed():
    session = FakeSession(LINK_BUTTON, LINK_BUTTON, PAIRED)
    waits = []

    username = HueBridgeClient.register_user("10.0.0.77/443", "myhuey", session=session, on_wait=waits.append)

    assert username == USERNAME
    assert len(session.calls) == 3
    assert session.calls[0]["url"] == "https://10.0.0.77:443/api"
    assert session.calls[0]["json"] == {"devicetype": "myhuey#myhuey"}
    assert len(waits) == 2
    assert all(0 < remaining <= 30 for remaining in waits)


def test_register_user_default_window_is_thirty_seconds(clock):
    session = FakeSession(LINK_BUTTON)

    with pytest.raises(LinkButtonNotPressed) as caught:
        HueBridgeClient.register_user("10.0.0.77", session=session)

    assert clock.now == 30
    assert len(session.calls) == 31  # one per second for 30 seconds, plus the first
    assert "10.0.0.77" in str(caught.value)
    assert "30 seconds" in str(caught.value)


def test_register_user_stops_at_once_on_other_bridge_errors():
    session = FakeSession([{"error": {"type": 7, "address": "/devicetype", "description": "invalid value"}}])
    with pytest.raises(HueApiError) as caught:
        HueBridgeClient.register_user("10.0.0.77", session=session)

    assert caught.value.type == 7
    assert len(session.calls) == 1


def test_register_user_rejects_devices_that_are_not_bridges():
    with pytest.raises(BridgeUnreachable):
        HueBridgeClient.register_user("10.0.0.50", session=FakeSession({"hello": "world"}))


def test_discover_bridges_reports_failures_clearly(monkeypatch):
    def offline(*args, **kwargs):
        raise requests.exceptions.ConnectionError("no route")

    monkeypatch.setattr("myhuey.hue.requests.get", offline)
    with pytest.raises(BridgeUnreachable):
        HueBridgeClient.discover_bridges()


# Color helpers


def test_color_helpers_convert_between_hex_rgb_xy_and_color_temperature():
    assert hex_to_rgb("#ff8000") == (255, 128, 0)
    assert hex_to_rgb("f80") == (255, 136, 0)
    assert rgb_to_hex((255, 128, 0)) == "#ff8000"
    assert rgb_to_hex((300.4, -5, 127.6)) == "#ff0080"
    assert color_temperature_to_mired(2700) == 370
    assert mired_to_color_temperature(370) == 2700

    with pytest.raises(ValueError):
        hex_to_rgb("#12345")
    with pytest.raises(ValueError):
        hex_to_rgb("#gggggg")


@pytest.mark.parametrize("color", ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#ff8000", "#40c0ff"])
def test_xy_round_trip_preserves_the_hue(color):
    red, green, blue = hex_to_rgb(color)
    back = hex_to_rgb(xy_to_hex(rgb_to_xy((red, green, blue))))
    scale = 255 / max(red, green, blue)
    assert back == pytest.approx((red * scale, green * scale, blue * scale), abs=3)


def test_build_hue_state_only_sends_what_was_given():
    assert build_hue_state() == {}
    assert build_hue_state(on=False) == {"on": False}
    assert build_hue_state(brightness=0) == {"bri": 1}
    assert build_hue_state(color_temp=2700) == {"ct": 370}
    assert build_hue_state(color_temp=250) == {"ct": 250}
    assert build_hue_state(color_temp=10000) == {"ct": 153}
    assert build_hue_state(xy=[0.3, 0.4]) == {"xy": [0.3, 0.4]}
    assert build_hue_state(color=(255, 0, 0))["xy"] == pytest.approx([0.7006, 0.2993], abs=0.001)


def test_light_state_to_hex_follows_the_color_mode():
    assert light_state_to_hex(LIGHTS["1"]["state"]) == xy_to_hex([0.5, 0.4])
    assert light_state_to_hex({"on": True, "bri": 100}) is None
    assert light_state_to_hex({"xy": [0.0, 0.0]}) is None

    warm = hex_to_rgb(light_state_to_hex({"ct": 500, "colormode": "ct"}))
    cool = hex_to_rgb(light_state_to_hex({"ct": 153, "colormode": "ct"}))
    assert warm[2] < cool[2]


# Storage


def test_sqlite_storage_round_trip(tmp_path):
    db_path = tmp_path / "myhuey.db"
    save_config({"bridge": {"ip": "192.168.1.7", "username": "demo-user"}, "rooms": [{"name": "Kitchen"}]}, db_path)

    loaded = load_config(db_path)
    assert loaded["bridge"] == {"ip": "192.168.1.7", "username": "demo-user"}
    assert loaded["rooms"][0]["name"] == "Kitchen"


def test_sqlite_storage_creates_missing_parent_directory(tmp_path):
    db_path = tmp_path / "missing" / "nested" / "myhuey.db"

    assert load_config(db_path) == {"bridge": {}, "rooms": [], "scenes": [], "home": {"plan": None}, "schema_version": CURRENT_VERSION}
    assert db_path.exists()


def test_storage_file_is_private_to_the_owner(tmp_path):
    for name in ("myhuey.db", "config.json"):
        target = save_config({"bridge": {"ip": "10.0.0.1", "username": USERNAME}}, tmp_path / name)
        assert target.stat().st_mode & 0o777 == 0o600


def test_json_storage_round_trip_and_recovery(tmp_path):
    path = tmp_path / "config.json"
    assert load_config(path) == {"bridge": {}, "rooms": [], "scenes": [], "home": {"plan": None}, "schema_version": CURRENT_VERSION}

    save_config({"rooms": [{"name": "Den"}], "schema_version": 3}, path)
    assert load_config(path)["rooms"] == [{"name": "Den"}]

    path.write_text("{not json", encoding="utf-8")
    assert load_config(path) == {"bridge": {}, "rooms": [], "scenes": [], "home": {"plan": None}, "schema_version": CURRENT_VERSION}
