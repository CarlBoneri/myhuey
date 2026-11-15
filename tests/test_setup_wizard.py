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
