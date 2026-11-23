"""The command line: real error messages on stderr, a useful exit code, and no username in any output."""

import io
import json
import socket

import pytest
import requests

from myhuey.cli import _Countdown, main
from myhuey.service import HueRoomService

from conftest import LIGHTS, LINK_BUTTON, PAIRED, USERNAME


@pytest.fixture
def run(capsys, db_path):
    """Run `myhuey --db <tmp> <argv>` and return (exit code, stdout, stderr)."""

    def invoke(*argv):
        with pytest.raises(SystemExit) as caught:
            main(["--db", db_path, *argv])
        captured = capsys.readouterr()
        return caught.value.code, captured.out, captured.err

    return invoke


# Pairing


def test_register_reports_the_real_error_when_the_button_is_not_pressed(run, db_path, fake_bridge, clock):
    fake_bridge(LINK_BUTTON)

    code, out, err = run("bridge", "register", "--bridge-ip", "10.0.0.77", "--app-name", "myhuey")

    assert code == 1
    assert err == (
        "myhuey: error: The link button on the bridge at 10.0.0.77 was not pressed within 30 seconds. "
        "Press the round button on that bridge, then try again.\n"
    )
    assert "Press the round link button on the Hue bridge at 10.0.0.77 now." in out
    assert "Waiting up to 30 seconds for it." in out
    assert "10.0.0.77: 30s left" in out and "10.0.0.77: 5s left" in out
    assert HueRoomService(db_path).get_bridge() == {}


def test_register_saves_the_bridge_and_never_prints_the_username(run, db_path, fake_bridge):
    fake_bridge(LINK_BUTTON, PAIRED, LIGHTS)

    code, out, err = run("bridge", "register", "--bridge-ip", "10.0.0.77")

    assert code == 0
    assert f"Paired with the bridge at 10.0.0.77 and saved it to {db_path}. Found 3 lights." in out
    assert USERNAME not in out + err
    assert HueRoomService(db_path).get_bridge() == {"ip": "10.0.0.77", "username": USERNAME}


def test_setup_is_a_single_command_that_leaves_a_working_pairing(run, db_path, fake_bridge):
    fake_bridge(PAIRED, LIGHTS)

    assert run("bridge", "setup", "--bridge-ip", "10.0.0.77")[0] == 0
    code, out, _ = run("bridge", "setup")

    assert code == 0
    assert "already paired and responding (3 lights)" in out


def test_the_timeout_option_sets_the_pairing_window(run, fake_bridge, clock):
    session = fake_bridge(LINK_BUTTON)

    code, out, err = run("bridge", "setup", "--bridge-ip", "10.0.0.77", "--timeout", "3")

    assert code == 1
    assert "Waiting up to 3 seconds for it." in out
    assert "within 3 seconds" in err
    assert len(session.calls) == 4


def test_register_requires_a_bridge_address(run):
    code, _, err = run("bridge", "register")

    assert code == 1
    assert "--bridge-ip is required" in err


def test_an_unreachable_bridge_is_reported_without_a_traceback_or_the_username(run, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    fake_bridge(requests.exceptions.ConnectionError(f"refused https://10.0.0.77/api/{USERNAME}/lights"))

    code, out, err = run("lights", "list")

    assert code == 1
    assert err == "myhuey: error: Cannot reach the Hue bridge at 10.0.0.77:443 (ConnectionError).\n"
    assert "Traceback" not in out + err
    assert USERNAME not in out + err


def test_the_terminal_countdown_rewrites_one_line():
    stream = io.StringIO()
    countdown = _Countdown(stream)

    countdown.update("10.0.0.77", 29.2)
    countdown.update("10.0.0.77", 28.2)
    countdown.print("done")

    assert stream.getvalue() == (
        "\r  Waiting for the link button on 10.0.0.77: 30s left "
        "\r  Waiting for the link button on 10.0.0.77: 29s left \ndone\n"
    )


# Status


def test_status_without_a_pairing_points_to_setup(run):
    code, out, _ = run("bridge", "status")

    assert code == 1
    assert "myhuey bridge setup" in out


def test_status_shows_the_bridge_and_not_the_username(run, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    fake_bridge(LIGHTS)

    code, out, err = run("bridge", "status")

    assert code == 0
    assert f"Bridge: 10.0.0.77 (pairing saved in {db_path})" in out
    assert "Reachable: yes, 3 lights" in out
    assert USERNAME not in out + err


# Lights and rooms


def test_lights_commands_need_a_paired_bridge(run):
    code, _, err = run("lights", "list")

    assert code == 1
    assert err == "myhuey: error: No Hue bridge is configured. Run `myhuey bridge setup` to pair one.\n"


def test_lights_list_and_set(run, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    session = fake_bridge(LIGHTS, [{"success": {}}])

    code, out, _ = run("lights", "list")
    assert code == 0
    assert [light["name"] for light in json.loads(out)] == ["Desk lamp", "Hall", "Porch"]

    code, out, _ = run("lights", "set", "--light-id", "2", "--on", "off", "--brightness", "120")
    assert code == 0
    assert out == "Updated light 2.\n"
    assert session.calls[-1]["url"].endswith("/lights/2/state")
    assert session.calls[-1]["json"] == {"on": False, "bri": 120}


def test_lights_set_needs_a_light_and_a_change(run, db_path, fake_bridge):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)
    session = fake_bridge([{"success": {}}])

    assert "--light-id is required" in run("lights", "set", "--on", "on")[2]
    assert "No light changes were given" in run("lights", "set", "--light-id", "2")[2]
    assert session.calls == []


def test_room_commands_manage_the_layout(run, db_path):
    assert run("room", "create", "--name", "Office")[0] == 0
    code, out, _ = run("room", "assign", "--name", "Office", "--light-id", "1", "--x", "120", "--y", "90", "--label", "Desk")
    assert code == 0
    assert json.loads(out)["label"] == "Desk"

    rooms = json.loads(run("room", "list")[1])
    assert [(room["name"], len(room["lights"])) for room in rooms] == [("Office", 1)]

    assert run("room", "remove-light", "--name", "Office", "--light-id", "1")[0] == 0
    assert HueRoomService(db_path).get_room("Office").lights == []

    code, _, err = run("room", "delete", "--name", "Nowhere")
    assert code == 1
    assert err == "myhuey: error: Room 'Nowhere' not found\n"
    assert "--name is required" in run("room", "create")[2]


# Server


def test_serve_refuses_a_port_that_is_already_in_use(run):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as holder:
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        port = holder.getsockname()[1]

        code, _, err = run("serve", "--port", str(port))

    assert code == 1
    assert f"Cannot listen on 127.0.0.1:{port}" in err
    assert "--port" in err


def test_cli_room_refresh_prints_the_preview_and_applies_with_apply(run, db_path, fake_bridge):
    service = HueRoomService(db_path)
    service.set_bridge("10.0.0.77", USERNAME)
    service.add_room("Office")
    service.add_room("Hallway")
    service.add_room("Garage")
    service.assign_light("Office", "1", label="Desk")
    service.assign_light("Office", "2", label="Floor lamp")
    groups = {
        "1": {"name": "Office", "type": "Room", "lights": ["1"]},
        "2": {"name": "Hallway", "type": "Room", "lights": ["2"]},
        "3": {"name": "Den", "type": "Room", "lights": ["1", "10"]},
    }
    fake_bridge(*[LIGHTS, groups] * 4)  # each call reads lights, then groups

    code, out, _ = run("room", "refresh")
    assert code == 0
    assert "Office: − Floor lamp (to Hallway)" in out
    assert "Hallway: + Floor lamp (from Office)" in out
    assert "Den: new room, 2 lights" in out
    assert "Garage: not on the bridge, left alone" in out
    assert "Applied." not in out
    assert [light.light_id for light in service.get_room("Office").lights] == ["1", "2"]

    code, out, _ = run("room", "refresh", "--apply")
    assert code == 0 and "Applied." in out
    assert [light.light_id for light in service.get_room("Office").lights] == ["1"]

    code, out, _ = run("room", "refresh")
    assert "Rooms already match Hue." in out
