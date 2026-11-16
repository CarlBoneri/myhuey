"""`myhuey groups`: saved light groups from the command line."""

import pytest

from myhuey.cli import main
from myhuey.service import HueRoomService

from conftest import LIGHTS, USERNAME


@pytest.fixture
def run(capsys, db_path):
    HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)

    def invoke(*argv):
        with pytest.raises(SystemExit) as caught:
            main(["--db", db_path, *argv])
        captured = capsys.readouterr()
        return caught.value.code, captured.out, captured.err

    return invoke


def test_groups_from_the_command_line(run, fake_bridge):
    assert run("groups", "new", "--name", "Desk", "--lights", "1, 2")[0] == 0
    code, out, _ = run("groups", "list")
    assert code == 0 and out.strip().startswith("Desk · 2 lights (1, 2) · no look · ")
    fake_bridge(LIGHTS, LIGHTS, [{"success": {}}])
    assert run("groups", "save-look", "desk")[0] == 0
    assert "· look saved ·" in run("groups", "list")[1]
    code, out, _ = run("groups", "apply", "Desk")
    assert code == 0 and "2 lights set" in out
    assert run("groups", "rename", "Desk", "--name", "Desk lamps")[0] == 0
    assert run("groups", "delete", "Desk lamps")[0] == 0
    assert run("groups", "list")[1].strip() == "No groups yet."


def test_groups_need_a_group_and_lights(run):
    assert run("groups", "apply")[0] != 0
    assert run("groups", "new", "--name", "Desk")[0] != 0
