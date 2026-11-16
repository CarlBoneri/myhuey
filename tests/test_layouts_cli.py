"""`myhuey layouts` and the global --layout option."""

import json

import pytest

from myhuey.cli import main
from myhuey.service import HueRoomService


@pytest.fixture
def run(capsys, db_path):
    def invoke(*argv):
        with pytest.raises(SystemExit) as caught:
            main(["--db", db_path, *argv])
        captured = capsys.readouterr()
        return caught.value.code, captured.out, captured.err

    return invoke


@pytest.fixture(autouse=True)
def office(db_path):
    HueRoomService(db_path).add_room("Office", 300, 300)


def _room_names(run, *before):
    code, out, _ = run(*before, "room", "list")
    assert code == 0
    return [room["name"] for room in json.loads(out)]


def test_list_after_new(run):
    assert run("layouts", "new", "Try")[0] == 0
    code, out, _ = run("layouts", "list")
    lines = out.strip().splitlines()
    assert code == 0 and len(lines) == 2
    assert lines[0].startswith("* My home (active) · 1 rooms · 0 scenes · ")
    assert lines[1].startswith("  Try · 0 rooms · 0 scenes · ")


def test_layout_option_keeps_work_in_the_sandbox(run):
    run("layouts", "new", "Try")
    code, _, err = run("--layout", "try", "room", "create", "--name", "Den", "--width", "10ft", "--height", "10ft")
    assert code == 0, err
    assert _room_names(run, "--layout", "Try") == ["Den"]
    assert _room_names(run) == ["Office"]


def test_unknown_layout_option_is_an_error(run):
    code, _, err = run("--layout", "nope", "room", "list")
    assert code == 1 and "That layout no longer exists" in err


def test_duplicate_rename_activate_delete(run):
    assert run("layouts", "duplicate", "My home", "--name", "Copy")[0] == 0
    assert run("layouts", "rename", "Copy", "--name", "Second")[0] == 0
    code, out, _ = run("layouts", "activate", "second")
    assert code == 0 and "Second" in out
    assert run("layouts", "list")[1].splitlines()[0].startswith("* Second (active)")
    code, _, err = run("layouts", "delete", "Second")
    assert code == 1 and "active layout" in err
    code, out, _ = run("layouts", "delete", "My home")
    assert code == 0 and "My home" in out
