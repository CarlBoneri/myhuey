"""Where you sit and how high your eyes are: your own numbers, and the chair you mark as your seat."""

from fastapi.testclient import TestClient

from myhuey.api import create_app
from myhuey.roles import Body, find_focus, using_body


def test_without_a_seat_chair_the_focus_is_what_it_always_was(service):
    focus = find_focus(service.get_room("Den"), "desk")
    assert (focus.seat, focus.eye_height) == ((200, 190), 115)  # 60 cm in front of the screen, 46 + 69


def test_a_seat_chair_puts_the_eyes_over_it(service):
    service.update_room("Den", furniture=[
        {"kind": "desk", "x": 200, "y": 150, "width": 140, "depth": 70},
        {"kind": "monitor-27", "x": 200, "y": 130, "width": 61, "depth": 20},
        {"kind": "chair", "x": 200, "y": 215, "width": 50, "depth": 50, "rotation": 180, "seat": 50},
        {"kind": "chair", "x": 350, "y": 350, "width": 50, "depth": 50},  # not marked: just a chair
    ])
    focus = find_focus(service.get_room("Den"), "desk")
    assert focus.seat == (200, 215) and focus.eye_height == 119 and focus.gaze == (0, -1)


def test_a_seat_chair_alone_looks_the_way_the_chair_faces(service):
    service.update_room("Den", furniture=[{"kind": "chair", "x": 100, "y": 100, "width": 50, "depth": 50, "seat": 46}])
    focus = find_focus(service.get_room("Den"), "desk")
    assert focus.seat == (100, 100) and focus.eye_height == 115 and focus.gaze == (0, 1)


def test_your_own_numbers_move_the_eyes(service):
    with using_body(Body(eye_sitting=80, eye_standing=170, screen_distance=70)):
        focus = find_focus(service.get_room("Den"), "desk")
    assert (focus.seat, focus.eye_height) == ((200, 200), 126)


def test_the_api_uses_your_saved_eye_height(service, db_path):
    # A lamp 70 cm past the screen at 180 cm is in view from eyes at 115 (31° up is past the 30° limit
    # only for lower eyes): from 115 it is 65 cm up over 130 cm, about 26.6°; from 96 it is 84 cm, about 32.9°.
    service.assign_light("Den", "2", x=200, y=60, elevation=180)
    web = TestClient(create_app(db_path, pairing_window=5))
    role = lambda: next(l for l in web.get("/api/rooms/Den").json()["lights"] if l["light_id"] == "2")["resolved_roles"]["desk"]
    assert role() == "view"
    assert web.patch("/api/preferences", json={"eye_sitting": 50}).status_code == 200
    assert role() != "view"


def test_the_cli_uses_your_saved_eye_height(db_path, monkeypatch):
    import pytest

    from myhuey import cli
    from myhuey.roles import current_body
    from myhuey.service import HueRoomService
    HueRoomService(db_path).update_preferences({"eye_sitting": 75})
    seen = []
    monkeypatch.setattr(cli, "handle_prefs", lambda args: seen.append(current_body().eye_sitting) or 0)
    with pytest.raises(SystemExit):
        cli.main(["--db", db_path, "prefs", "show"])
    assert seen == [75]
