"""The assistant's layout tools build only in a sandbox, never in the active home."""

import pytest

from myhuey.assistant import (
    WRITES_LAYOUT, Refused, add_room, check_layout, create_sandbox, get_room, open_in_app, place_light,
    remove_light, remove_room, set_furniture, set_openings, update_room,
)
from myhuey.errors import LayoutNotFound


def test_build_a_room_from_a_description(service):
    box = create_sandbox(service, "Office idea")
    room = add_room(service, box["id"], "Office", width="12ft", depth="14ft", ceiling="8ft", units="imperial")
    assert (room["width"], room["height"], room["ceiling"], room["units"]) == (365.76, 426.72, 243.84, "imperial")
    set_openings(service, box["id"], "Office", [{"kind": "window", "wall": 0, "offset": 100, "width": 90}])
    out = set_furniture(service, box["id"], "Office", [{"kind": "desk", "x": 183, "y": 45}, {"kind": "monitor-27", "x": 183, "y": 30}])
    desk, monitor = out["furniture"]
    assert (desk["width"], desk["depth"], desk["height"], desk["label"]) == (140, 70, 75, "Desk") and monitor["elevation"] == 75
    lamp = place_light(service, box["id"], "Office", 330, 60, catalog="floor-lamp")
    place_light(service, box["id"], "Office", 300, 80, light_id=lamp["light_id"])          # the same light again: it moves
    assert [(l["x"], l["y"]) for l in get_room(service, "Office", layout=box["id"])["lights"]] == [(300, 80)]
    assert check_layout(service, "Office", layout=box["id"])["ok"] is True
    assert service.list_rooms() == ["Den"]                                                 # the active home is untouched


def test_corrections_inside_the_sandbox(service):
    box = create_sandbox(service, copy_from="active")
    assert box["rooms"] == ["Den"]
    assert update_room(service, box["id"], "Den", width="12ft", depth="15ft")["height"] == 457.2
    assert remove_light(service, box["id"], "Den", "2")["removed"] == "2"
    assert remove_room(service, box["id"], "Den") == {"removed": "Den"}
    assert service.list_rooms() == ["Den"] and len(service.get_room("Den").lights) == 3


# Review Focus 1
@pytest.mark.parametrize("layout", [None, "", "ACTIVE-ID", "My home", "nope"])
def test_layout_writers_refuse_anything_but_a_sandbox(service, layout):
    active = next(l for l in service.layouts() if l["active"])
    layout = active["id"] if layout == "ACTIVE-ID" else active["name"] if layout == "My home" else layout
    calls = [lambda: add_room(service, layout, "X", width=300, depth=300), lambda: update_room(service, layout, "Den", ceiling=260),
             lambda: remove_room(service, layout, "Den"), lambda: set_furniture(service, layout, "Den", []),
             lambda: set_openings(service, layout, "Den", []), lambda: place_light(service, layout, "Den", 10, 10, catalog="go"),
             lambda: remove_light(service, layout, "Den", "1")]
    before = service.get_room("Den").to_dict()
    for call in calls:
        with pytest.raises((Refused, LayoutNotFound), match="create_sandbox|layout"):
            call()
    assert service.get_room("Den").to_dict() == before


def test_the_refusal_says_what_to_do(service):
    with pytest.raises(Refused, match="Call create_sandbox first, then pass its id as layout"):
        add_room(service, None, "X", width=300, depth=300)
    with pytest.raises(Refused, match="Call create_sandbox first"):
        add_room(service, "nope", "X", width=300, depth=300)


def test_a_sandbox_made_active_mid_call_is_not_written(service):
    box = create_sandbox(service, copy_from="active")
    service.activate_layout(box["id"])  # what the owner could do between the guard and the write
    before = service.get_room("Den").to_dict()
    with pytest.raises(Refused, match="create_sandbox"):
        update_room(service, box["id"], "Den", ceiling=260)
    assert service.get_room("Den").to_dict() == before


def test_every_writer_is_listed():
    assert WRITES_LAYOUT == ("add_room", "update_room", "remove_room", "set_openings", "set_furniture", "place_light", "remove_light")


# Review Focus 4
@pytest.mark.parametrize("width", ["big", -5, 0])
def test_bad_lengths_get_examples(service, width):
    box = create_sandbox(service)
    with pytest.raises(ValueError, match="12ft, 3.8m, or 380cm"):
        add_room(service, box["id"], "X", width=width, depth=300)


def test_lengths_as_people_write_them(service):
    box = create_sandbox(service)
    for index, width in enumerate(("12ft", "3.8m", "12' 6\"", 350, "350")):
        assert add_room(service, box["id"], f"R{index}", width=width, depth=300)["width"] > 300


def test_place_light_needs_one_of_light_or_catalog(service):
    box = create_sandbox(service, copy_from="active")
    for kwargs in ({}, {"light_id": "1", "catalog": "go"}):
        with pytest.raises(ValueError, match="light_id or catalog"):
            place_light(service, box["id"], "Den", 10, 10, **kwargs)
    with pytest.raises(ValueError, match="Unknown catalog item"):
        place_light(service, box["id"], "Den", 10, 10, catalog="disco-ball")
    with pytest.raises(ValueError, match="Unknown furniture kind 'throne'"):
        set_furniture(service, box["id"], "Den", [{"kind": "throne", "x": 10, "y": 10}])


def test_open_in_app_gives_a_link_and_says_whether_the_app_is_up(service, monkeypatch):
    box = create_sandbox(service, copy_from="active")
    monkeypatch.setattr("myhuey.assistant._app_answers", lambda url: False)
    result = open_in_app(service, box["id"], "Den", app_url="http://homeserver:8000/")
    assert result["url"] == f"http://homeserver:8000/?layout={box['id']}#/studio/room/Den/3d"
    assert result["answering"] is False and "myhuey serve" in result["note"] and "--app-url" in result["note"]
    monkeypatch.setattr("myhuey.assistant._app_answers", lambda url: True)
    assert open_in_app(service, box["id"], "Den")["answering"] is True


def test_nothing_reaches_the_bridge(service, session):
    box = create_sandbox(service, copy_from="active")
    update_room(service, box["id"], "Den", ceiling=260)
    set_furniture(service, box["id"], "Den", [])
    check_layout(service, "Den", layout=box["id"])
    assert session.calls == [] and session.clip_calls == []
