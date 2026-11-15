"""The web setup wizard's bridge check: is that address a Hue bridge, and which one, before pairing."""

import pytest
import requests
from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.errors import BridgeUnreachable
from myhuey.service import HueRoomService
from myhuey.setup import check_bridge

from conftest import USERNAME

CONFIG = {
    "name": "Philips hue", "datastoreversion": "172", "swversion": "1972004020", "apiversion": "1.72.0",
    "mac": "ec:b5:fa:00:00:01", "bridgeid": "ECB5FAFFFE000001", "factorynew": False, "modelid": "BSB002",
}


def test_check_bridge_reads_the_public_config(db_path, fake_bridge):
    session = fake_bridge(CONFIG)
    info = check_bridge("10.0.0.77", service=HueRoomService(db_path))
    assert info == {
        "bridge_ip": "10.0.0.77", "name": "Philips hue", "model": "BSB002", "bridge_id": "ECB5FAFFFE000001",
        "software": "1972004020", "api_version": "1.72.0", "paired": False,
    }
    assert session.calls[0]["method"] == "GET" and session.calls[0]["url"] == "https://10.0.0.77:443/api/config"


def test_check_bridge_knows_the_paired_bridge(db_path, fake_bridge):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    fake_bridge(CONFIG)
    assert check_bridge("10.0.0.77", service=service)["paired"] is True


def test_check_bridge_refuses_a_device_that_is_not_a_bridge(db_path, fake_bridge):
    fake_bridge({"hello": "router"})
    with pytest.raises(BridgeUnreachable, match="not answer like a Hue bridge"):
        check_bridge("10.0.0.1", service=HueRoomService(db_path))


def test_check_endpoint(db_path, fake_bridge):
    fake_bridge(CONFIG)
    client = TestClient(create_app(db_path))
    assert client.get("/api/bridges/check", params={"ip": "10.0.0.77"}).json()["model"] == "BSB002"
    assert client.get("/api/bridges/check", params={"ip": "ftp://x"}).status_code == 400


def test_check_endpoint_unreachable_is_a_502(db_path, fake_bridge):
    fake_bridge(requests.exceptions.ConnectTimeout())
    response = TestClient(create_app(db_path)).get("/api/bridges/check", params={"ip": "10.0.0.99"})
    assert response.status_code == 502 and "10.0.0.99" in response.json()["detail"]


# Pairing, as Signify's guides describe it


from conftest import LIGHTS, PAIRED  # noqa: E402
from myhuey import setup as pairing  # noqa: E402
from myhuey.errors import LinkButtonNotPressed  # noqa: E402
from myhuey.hue import HueBridgeClient  # noqa: E402
from myhuey.setup import instance_name, pair_any, pair_bridge  # noqa: E402


def test_instance_name_is_this_computer_short_and_safe(monkeypatch):
    monkeypatch.setattr(pairing.socket, "gethostname", lambda: "Carls-MacBook-Pro.local")
    assert instance_name() == "Carls-MacBook-Pro"
    monkeypatch.setattr(pairing.socket, "gethostname", lambda: "a very/long host name with stuff!")
    assert instance_name() == "a-very-long-host-na"
    monkeypatch.setattr(pairing.socket, "gethostname", lambda: "")
    assert instance_name() == "computer"


def test_pairing_names_this_computer_and_saves_the_bridge_id(db_path, fake_bridge, monkeypatch):
    monkeypatch.setattr(pairing.socket, "gethostname", lambda: "studio.local")
    monkeypatch.setattr(pairing, "pinned_bridge_id", lambda *args, **kwargs: "001788fffe7a11ce")
    session = fake_bridge(PAIRED)
    service = HueRoomService(db_path)
    pair_bridge("10.0.0.77", service=service)
    assert session.calls[0]["json"]["devicetype"] == "myhuey#studio"
    assert service.get_bridge() == {"ip": "10.0.0.77", "username": USERNAME, "bridge_id": "001788fffe7a11ce"}


def test_pair_any_pairs_the_bridge_whose_button_is_pressed(db_path, monkeypatch):
    stopped = []

    def register(address, app_name="myhuey", *, window=30, should_stop=None, **kwargs):
        if address == "10.0.0.93":
            return USERNAME
        while not should_stop():  # the other bridge waits until told to stop
            pass
        stopped.append(address)
        raise LinkButtonNotPressed(address, window)

    monkeypatch.setattr(HueBridgeClient, "register_user", staticmethod(register))
    monkeypatch.setattr(pairing, "pinned_bridge_id", lambda *args, **kwargs: "ecb5fafffe21ac0f")
    service = HueRoomService(db_path)
    result = pair_any(["10.0.0.77", "10.0.0.93"], service=service)
    assert result["bridge_ip"] == "10.0.0.93" and service.get_bridge()["ip"] == "10.0.0.93"
    assert stopped == ["10.0.0.77"]


def test_pair_any_reports_when_no_button_was_pressed(db_path, monkeypatch):
    def register(address, app_name="myhuey", *, window=30, should_stop=None, **kwargs):
        raise LinkButtonNotPressed(address, window)

    monkeypatch.setattr(HueBridgeClient, "register_user", staticmethod(register))
    with pytest.raises(LinkButtonNotPressed):
        pair_any(["10.0.0.77", "10.0.0.93"], service=HueRoomService(db_path))


def test_register_any_endpoint(db_path, monkeypatch):
    monkeypatch.setattr(pairing, "pair_any", lambda ips, **kwargs: {"bridge_ip": ips[-1], "status": "ready"})
    client = TestClient(create_app(db_path))
    assert client.post("/api/bridge/register-any", json={"bridge_ips": ["10.0.0.77", "10.0.0.93"]}).json()["bridge_ip"] == "10.0.0.93"
    assert client.post("/api/bridge/register-any", json={"bridge_ips": []}).status_code == 422


def test_a_bridge_with_a_new_address_is_found_again_by_its_id(db_path, fake_bridge, monkeypatch):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.50", USERNAME, "001788fffe7a11ce")
    pinned = []
    monkeypatch.setattr("myhuey.service.discover", lambda **kwargs: [
        {"id": "ecb5fafffe21ac0f", "internalipaddress": "10.0.0.93"},
        {"id": "001788FFFE7A11CE", "internalipaddress": "10.0.0.77"}])
    monkeypatch.setattr("myhuey.service.pin_certificate", lambda host, port=443, **kwargs: pinned.append((host, kwargs["expected_id"])))
    fake_bridge(requests.exceptions.ConnectTimeout(), LIGHTS)
    assert [light["name"] for light in service.lights()][:1] == ["Desk lamp"]
    assert service.get_bridge()["ip"] == "10.0.0.77"
    assert pinned == [("10.0.0.77", "001788fffe7a11ce")]


def test_an_unreachable_bridge_without_an_id_is_reported(db_path, fake_bridge, monkeypatch):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.50", USERNAME)
    monkeypatch.setattr("myhuey.service.discover", lambda **kwargs: pytest.fail("no ID to look for"))
    fake_bridge(requests.exceptions.ConnectTimeout())
    with pytest.raises(BridgeUnreachable):
        service.lights()
