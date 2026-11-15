"""Guided pairing: which bridge is asked for, what is saved, and what is never shown."""

import pytest

from myhuey.errors import BridgeUnreachable, LinkButtonNotPressed
from myhuey.hue import HueBridgeClient
from myhuey.service import HueRoomService
from myhuey.setup import bridge_address, candidate_bridge_ips, expand_ip_ranges, pair_bridge, run_setup

from conftest import LIGHTS, LINK_BUTTON, PAIRED, UNAUTHORIZED, USERNAME


def _no_input(prompt):
    raise AssertionError(f"setup asked a question it should not have: {prompt}")


def _discovered(monkeypatch, *addresses):
    found = [{"id": f"bridge-{index}", "internalipaddress": address} for index, address in enumerate(addresses)]
    monkeypatch.setattr(HueBridgeClient, "discover_bridges", staticmethod(lambda: found))


# Addresses


def test_expand_ip_ranges_handles_addresses_ranges_and_junk():
    assert expand_ip_ranges(["10.0.0.77", "10.0.0.0/30", "", "bogus/99", "10.0.0.77"]) == [
        "10.0.0.77",
        "10.0.0.0",
        "10.0.0.1",
        "10.0.0.2",
    ]
    assert expand_ip_ranges(None) == []
    with pytest.raises(ValueError):
        expand_ip_ranges(["10.0.0.0/8"])


def test_candidate_bridge_ips_lists_given_ranges_first_without_duplicates():
    discovered = [{"internalipaddress": "10.0.0.77"}, {"ip": "10.0.0.93"}, {"id": "no-address"}]

    assert candidate_bridge_ips(["10.0.0.93"], discovered) == ["10.0.0.93", "10.0.0.77"]


def test_bridge_address_is_the_host_and_only_a_non_standard_port():
    assert bridge_address("10.0.0.77/443") == "10.0.0.77"
    assert bridge_address("https://10.0.0.77:8443/api") == "10.0.0.77:8443"


# Pairing


def test_pair_bridge_saves_the_pairing_and_returns_no_username(db_path, fake_bridge):
    fake_bridge(PAIRED)
    service = HueRoomService(db_path)

    result = pair_bridge("https://10.0.0.77/", service=service)

    assert result == {"bridge_ip": "10.0.0.77", "app_name": "myhuey", "status": "ready"}
    assert service.get_bridge() == {"ip": "10.0.0.77", "username": USERNAME}


def test_run_setup_names_the_bridge_saves_the_pairing_and_hides_the_username(db_path, fake_bridge):
    session = fake_bridge(LINK_BUTTON, PAIRED, LIGHTS)
    lines = []

    result = run_setup(bridge_ip="10.0.0.77", storage_path=db_path, print_func=lines.append, input_func=_no_input)

    assert result == {"bridge_ip": "10.0.0.77", "app_name": "myhuey", "status": "ready", "lights": 3}
    assert lines[0] == "Press the round link button on the Hue bridge at 10.0.0.77 now."
    assert lines[1] == "Waiting up to 30 seconds for it."
    assert lines[-1] == f"Paired with the bridge at 10.0.0.77 and saved it to {db_path}. Found 3 lights."
    assert USERNAME not in "\n".join(lines) and USERNAME not in repr(result)
    assert [call["method"] for call in session.calls] == ["POST", "POST", "GET"]
    assert HueRoomService(db_path).get_bridge() == {"ip": "10.0.0.77", "username": USERNAME}


def test_run_setup_counts_down_then_fails_without_saving(db_path, fake_bridge, clock):
    fake_bridge(LINK_BUTTON)
    lines = []

    with pytest.raises(LinkButtonNotPressed) as caught:
        run_setup(bridge_ip="10.0.0.77", storage_path=db_path, print_func=lines.append, input_func=_no_input)

    assert "10.0.0.77" in str(caught.value) and "30 seconds" in str(caught.value)
    assert [line.strip() for line in lines if "left" in line] == [
        f"Waiting for the link button on 10.0.0.77: {seconds}s left" for seconds in (30, 25, 20, 15, 10, 5)
    ]
    assert HueRoomService(db_path).get_bridge() == {}


def test_run_setup_passes_the_countdown_to_a_custom_callback(db_path, fake_bridge, clock):
    fake_bridge(LINK_BUTTON)
    seen = []

    with pytest.raises(LinkButtonNotPressed):
        run_setup(
            bridge_ip="10.0.0.77",
            storage_path=db_path,
            window=3,
            print_func=lambda line: None,
            input_func=_no_input,
            on_wait=lambda address, remaining: seen.append((address, remaining)),
        )

    assert seen == [("10.0.0.77", 3), ("10.0.0.77", 2), ("10.0.0.77", 1)]


# Saved pairings


def test_run_setup_keeps_a_pairing_that_still_works(db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    session = fake_bridge(LIGHTS)
    lines = []

    result = run_setup(storage_path=db_path, print_func=lines.append, input_func=_no_input)

    assert result == {"bridge_ip": "10.0.0.77", "app_name": "myhuey", "status": "already-paired", "lights": 3}
    assert [call["method"] for call in session.calls] == ["GET"]  # no new pairing was requested
    assert "already paired" in lines[0] and "--force" in lines[0]


def test_run_setup_pairs_again_with_force(db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", "old-user")
    session = fake_bridge(PAIRED, LIGHTS)

    result = run_setup(storage_path=db_path, bridge_ip="10.0.0.77", force=True, print_func=lambda line: None)

    assert result["status"] == "ready"
    assert session.calls[0]["method"] == "POST"
    assert HueRoomService(db_path).get_bridge()["username"] == USERNAME


def test_run_setup_pairs_again_when_the_bridge_rejects_the_saved_username(db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", "revoked-user")
    session = fake_bridge(UNAUTHORIZED, PAIRED, LIGHTS)
    lines = []

    result = run_setup(storage_path=db_path, print_func=lines.append, input_func=_no_input)

    assert result["status"] == "ready"
    assert "no longer works" in lines[0] and "revoked-user" not in lines[0]
    assert [call["method"] for call in session.calls] == ["GET", "POST", "GET"]
    assert HueRoomService(db_path).get_bridge() == {"ip": "10.0.0.77", "username": USERNAME}


def test_run_setup_pairs_a_different_bridge_when_asked(db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", "old-user")
    session = fake_bridge(PAIRED, LIGHTS)
    lines = []

    run_setup(storage_path=db_path, bridge_ip="10.0.0.93", print_func=lines.append, input_func=_no_input)

    assert lines[0] == "Press the round link button on the Hue bridge at 10.0.0.93 now."
    assert session.calls[0]["url"] == "https://10.0.0.93:443/api"
    assert HueRoomService(db_path).get_bridge() == {"ip": "10.0.0.93", "username": USERNAME}


# Choosing a bridge


def test_run_setup_uses_the_only_bridge_found(db_path, fake_bridge, monkeypatch):
    _discovered(monkeypatch, "10.0.0.77")
    fake_bridge(PAIRED, LIGHTS)
    lines = []

    run_setup(storage_path=db_path, print_func=lines.append, input_func=_no_input)

    assert lines[0] == "Found one Hue bridge at 10.0.0.77."
    assert HueRoomService(db_path).get_bridge()["ip"] == "10.0.0.77"


@pytest.mark.parametrize("answer, expected", [("2", "10.0.0.93"), ("", "10.0.0.77"), ("10.0.0.50", "10.0.0.50")])
def test_run_setup_asks_which_bridge_when_several_are_found(db_path, fake_bridge, monkeypatch, answer, expected):
    _discovered(monkeypatch, "10.0.0.77", "10.0.0.93")
    fake_bridge(PAIRED, LIGHTS)
    lines = []

    run_setup(storage_path=db_path, print_func=lines.append, input_func=lambda prompt: answer)

    assert lines[:3] == ["Found these Hue bridges:", "  1. 10.0.0.77", "  2. 10.0.0.93"]
    assert f"Press the round link button on the Hue bridge at {expected} now." in lines
    assert HueRoomService(db_path).get_bridge()["ip"] == expected


def test_run_setup_explains_what_to_do_when_no_bridge_is_found(db_path, monkeypatch):
    def offline():
        raise BridgeUnreachable("Hue bridge discovery failed (ConnectionError).")

    monkeypatch.setattr(HueBridgeClient, "discover_bridges", staticmethod(offline))
    lines = []

    with pytest.raises(ValueError) as caught:
        run_setup(storage_path=db_path, print_func=lines.append, input_func=_no_input)

    assert "--bridge-ip" in str(caught.value)
    assert lines == ["Hue bridge discovery failed (ConnectionError)."]
