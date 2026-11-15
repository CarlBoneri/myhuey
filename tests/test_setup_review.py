"""Fixes from the setup-wizard review: pairing errors, one pairing at a time, finding an
existing pairing again, fresh pins for unpaired bridges, and paced bridge writes."""

import threading

import pytest
import requests
from fastapi.testclient import TestClient

from myhuey import setup as pairing
from myhuey.api import API_REVISION, create_app
from myhuey.errors import BridgeCertificateError, LinkButtonNotPressed
from myhuey.hue import HueBridgeClient
from myhuey.service import HueRoomService
from myhuey.setup import PairingInProgress, check_bridge, pair_any, pair_bridge

from conftest import LIGHTS, PAIRED, USERNAME

CONFIG = {"name": "Hue Bridge", "bridgeid": "ECB5FAFFFE21AC0F", "modelid": "BSB002", "swversion": "1", "apiversion": "1.72.0"}


def _fake_register(behaviour):
    def register(address, app_name="myhuey", *, window=30, should_stop=None, **kwargs):
        return behaviour(address, should_stop, window)
    return staticmethod(register)


def test_pair_any_reports_a_real_error_over_a_missed_button(db_path, monkeypatch):
    def behaviour(address, should_stop, window):
        if address == "10.0.0.77":
            raise BridgeCertificateError("certificate changed")
        raise LinkButtonNotPressed(address, window)
    monkeypatch.setattr(HueBridgeClient, "register_user", _fake_register(behaviour))
    with pytest.raises(BridgeCertificateError):
        pair_any(["10.0.0.77", "10.0.0.93"], service=HueRoomService(db_path))


def test_pair_any_stops_every_bridge_when_one_fails_unexpectedly(db_path, monkeypatch):
    stopped = []

    def behaviour(address, should_stop, window):
        if address == "10.0.0.77":
            raise PermissionError("cannot write the pin")
        while not should_stop():
            pass
        stopped.append(address)
        raise LinkButtonNotPressed(address, window)
    monkeypatch.setattr(HueBridgeClient, "register_user", _fake_register(behaviour))
    with pytest.raises(PermissionError):
        pair_any(["10.0.0.77", "10.0.0.93"], service=HueRoomService(db_path))
    assert stopped == ["10.0.0.93"]


def test_only_one_pairing_waits_at_a_time(db_path, monkeypatch):
    entered, release = threading.Event(), threading.Event()

    def behaviour(address, should_stop, window):
        entered.set()
        release.wait(5)
        return USERNAME
    monkeypatch.setattr(HueBridgeClient, "register_user", _fake_register(behaviour))
    monkeypatch.setattr(pairing, "pinned_bridge_id", lambda *args, **kwargs: None)
    service = HueRoomService(db_path)
    first = threading.Thread(target=pair_bridge, args=("10.0.0.93",), kwargs={"service": service})
    first.start()
    entered.wait(5)
    try:
        with pytest.raises(PairingInProgress):
            pair_bridge("10.0.0.93", service=service)
        assert TestClient(create_app(db_path)).post("/api/bridge/register", json={"bridge_ip": "10.0.0.93"}).status_code == 409
    finally:
        release.set()
        first.join(5)
    assert service.get_bridge()["ip"] == "10.0.0.93"


def test_an_existing_pairing_learns_its_bridge_id_and_can_be_found_again(db_path, fake_bridge, monkeypatch):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.50", USERNAME)  # paired by an older version: no bridge_id saved
    monkeypatch.setattr("myhuey.service.pinned_bridge_id", lambda host, port=443, cert_dir=None: "ecb5fafffe21ac0f" if host == "10.0.0.50" else None)
    monkeypatch.setattr("myhuey.service.discover", lambda **kwargs: [{"id": "ecb5fafffe21ac0f", "internalipaddress": "10.0.0.93"}])
    monkeypatch.setattr("myhuey.service.pin_certificate", lambda *args, **kwargs: None)
    fake_bridge(requests.exceptions.ConnectTimeout(), LIGHTS)
    service.lights()
    assert service.get_bridge() == {"ip": "10.0.0.93", "username": USERNAME, "bridge_id": "ecb5fafffe21ac0f"}


def test_relocation_tries_every_candidate(db_path, fake_bridge, monkeypatch):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.50", USERNAME, "ecb5fafffe21ac0f")
    monkeypatch.setattr("myhuey.service.discover", lambda **kwargs: [
        {"id": "ecb5fafffe21ac0f", "internalipaddress": "10.0.0.66"},  # a spoofed answer: fails verification
        {"id": "ecb5fafffe21ac0f", "internalipaddress": "10.0.0.93"}])

    def pin(host, port=443, **kwargs):
        if host == "10.0.0.66":
            raise BridgeCertificateError("not signed by the Hue bridge root CA")
    monkeypatch.setattr("myhuey.service.pin_certificate", pin)
    fake_bridge(requests.exceptions.ConnectTimeout(), LIGHTS)
    service.lights()
    assert service.get_bridge()["ip"] == "10.0.0.93"


def test_unpaired_bridges_are_verified_afresh_but_the_paired_one_keeps_its_pin(db_path, fake_bridge, monkeypatch):
    fake_bridge(CONFIG)
    refreshed = []
    monkeypatch.setattr(pairing, "pin_certificate", lambda host, port=443, **kwargs: refreshed.append((host, kwargs.get("replace"))))
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME, "001788fffe7a11ce")
    check_bridge("10.0.0.93", service=service)
    check_bridge("10.0.0.77", service=service)
    assert refreshed == [("10.0.0.93", True)]


def test_check_bridge_reports_the_id_the_certificate_proves(db_path, fake_bridge, monkeypatch):
    monkeypatch.setattr(pairing, "pin_certificate", lambda *args, **kwargs: None)
    monkeypatch.setattr(pairing, "pinned_bridge_id", lambda *args, **kwargs: "001788fffe7a11ce")
    fake_bridge(CONFIG)  # the config claims another bridge's ID
    with pytest.raises(BridgeCertificateError, match="does not match"):
        check_bridge("10.0.0.93", service=HueRoomService(db_path))


def test_bridge_writes_are_one_at_a_time(db_path, fake_bridge):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Office")
    service.assign_light("Office", "1")
    held = []
    service.sleep = lambda seconds: held.append(service._bridge_writes.locked())
    fake_bridge(LIGHTS, [{"success": {}}])
    service.set_room_brightness("Office", 40)
    service.set_room_power("Office", True)
    assert held and all(held)


def test_room_brightness_refuses_true(db_path):
    response = TestClient(create_app(db_path)).post("/api/rooms/Office/brightness", json={"brightness": True})
    assert response.status_code == 422


def test_health_reports_the_api_revision(db_path):
    assert TestClient(create_app(db_path)).get("/api/health").json()["api"] == API_REVISION >= 4
