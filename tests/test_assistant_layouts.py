"""The assistant's layout tools build only in a sandbox, never in the active home."""

import pytest
import requests

from myhuey.assistant import (
    WRITES_LAYOUT, Refused, add_room, check_layout, create_sandbox, get_room, open_in_app, place_light,
    remove_light, remove_room, set_furniture, set_openings, update_room,
)
from myhuey.errors import LayoutChanged, LayoutNotFound
from myhuey.layouts import using_layout
from myhuey.service import HueRoomService

from conftest import USERNAME


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


def _writers(service, box):
    id_ = box["id"]
    return {
        "add_room": lambda: add_room(service, id_, "New", width=300, depth=300, ceiling=260),
        "update_room": lambda: update_room(service, id_, "Den", ceiling=260),
        "remove_room": lambda: remove_room(service, id_, "Den"),
        "set_openings": lambda: set_openings(service, id_, "Den", []),
        "set_furniture": lambda: set_furniture(service, id_, "Den", []),
        "place_light": lambda: place_light(service, id_, "Den", 10, 10, catalog="go", length=50),
        "remove_light": lambda: remove_light(service, id_, "Den", "1"),
    }


@pytest.mark.parametrize("tool", WRITES_LAYOUT)
def test_a_sandbox_made_active_after_the_guard_is_never_written(service, monkeypatch, tool):
    """The guard passed; then the sandbox was made active. The service must refuse the write."""
    box = create_sandbox(service, copy_from="active")
    call = _writers(service, box)[tool]
    guard = service.sandbox_id

    def then_activate(layout_id):
        found = guard(layout_id)
        service.activate_layout(box["id"])
        return found

    monkeypatch.setattr(service, "sandbox_id", then_activate)
    before = service._load_active()["rooms"]
    with pytest.raises(LayoutChanged):
        call()
    assert service._load_active()["rooms"] == before


@pytest.mark.parametrize("tool", ["add_room", "place_light"])
def test_the_second_write_is_guarded_too(service, monkeypatch, tool):
    box = create_sandbox(service, copy_from="active")
    method = "update_room" if tool == "add_room" else "assign_light"
    original = getattr(service, method)

    def activating(*args, **kwargs):
        service.activate_layout(box["id"])
        return original(*args, **kwargs)

    monkeypatch.setattr(service, method, activating)
    with pytest.raises(LayoutChanged):
        _writers(service, box)[tool]()
    if tool == "add_room":
        assert service.get_room("New").ceiling != 260  # the follow-up write never reached the now-active home
    else:
        assert all(light.length is None for light in service.get_room("Den").lights)


def test_a_bad_ceiling_leaves_no_room_behind(service):
    box = create_sandbox(service)
    with pytest.raises(ValueError, match="ceiling must be between"):
        add_room(service, box["id"], "LowCeil", width=300, depth=300, ceiling="1m")
    assert create_sandbox_rooms(service, box) == []
    assert add_room(service, box["id"], "LowCeil", width=300, depth=300, ceiling="2.5m")["ceiling"] == 250


def test_a_bad_length_leaves_no_light_behind(service):
    box = create_sandbox(service, copy_from="active")
    with pytest.raises(ValueError, match="length"):
        place_light(service, box["id"], "Den", 10, 10, catalog="go", length="100m")
    assert [l["light_id"] for l in get_room(service, "Den", layout=box["id"])["lights"]] == ["1", "2", "3"]


def create_sandbox_rooms(service, box):
    with using_layout(box["id"]):
        return service.list_rooms()


def test_a_plain_layout_naming_the_active_one_still_reads_the_active_home(service):
    active = next(l for l in service.layouts() if l["active"])["id"]
    with using_layout(active):
        assert service.list_rooms() == ["Den"]
        service.update_room("Den", ceiling=250)
    assert service.get_room("Den").ceiling == 250


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


# A paired light as the bridge lists it, with the product fields the service stores for a placement.
STRIP_21 = {
    "21": {
        "name": "Desk strip", "type": "Extended color light", "productname": "Hue lightstrip plus", "modelid": "LCL001",
        "config": {"archetype": "huelightstrip"}, "state": {"on": True, "bri": 100, "xy": [0.4, 0.4], "reachable": True},
    },
}
STRIP_PRODUCT = {"archetype": "huelightstrip", "productname": "Hue lightstrip plus", "modelid": "LCL001"}


def _office(service):
    box = create_sandbox(service, "Office idea")
    add_room(service, box["id"], "Office", width=400, depth=400)
    return box


def _office_lights(service, box):
    with using_layout(box["id"]):
        return service.get_room("Office").lights


@pytest.fixture
def no_discovery(monkeypatch):
    monkeypatch.setattr("myhuey.service.discover", lambda **kwargs: pytest.fail("place_light looked for the bridge"))


def test_a_paired_light_gets_its_name_and_product_from_the_bridge(service, fake_bridge, no_discovery):
    box = _office(service)
    session = fake_bridge(STRIP_21)
    placed = place_light(service, box["id"], "Office", 200, 100, light_id="21")
    assert (placed["label"], placed["product"], placed["planned"]) == ("Desk strip", STRIP_PRODUCT, False)
    assert "height_unknown" not in {problem["kind"] for problem in check_layout(service, "Office", layout=box["id"])["problems"]}
    assert place_light(service, box["id"], "Office", 210, 100, light_id="21", label="Strip")["label"] == "Strip"
    assert [call["method"] for call in session.calls] == ["GET"] and session.clip_calls == []  # the move asked nothing


def test_an_id_the_bridge_does_not_have_is_refused_and_nothing_is_written(service, fake_bridge, no_discovery):
    box = _office(service)
    session = fake_bridge(STRIP_21)
    with pytest.raises(Refused, match=r"Light 99 is not on the bridge\. Paired lights: 21 \(Desk strip\)\..*catalog"):
        place_light(service, box["id"], "Office", 200, 100, light_id="99")
    calls = len(session.calls)
    with pytest.raises(Refused) as refused:
        place_light(service, box["id"], "Office", 200, 100, light_id="planned-bogus0000")
    assert str(refused.value) == (
        "There is no planned light planned-bogus0000 in Office. Lights here: none. To plan a new one, pass catalog."
    )
    assert len(session.calls) == calls and _office_lights(service, box) == []


def test_without_a_bridge_only_a_light_placed_before_can_be_placed(db_path):
    service = HueRoomService(db_path)
    service.add_room("Den", 400, 400)
    service.assign_light("Den", "5", x=100, y=100, label="Reading lamp", product=STRIP_PRODUCT)
    box = _office(service)
    placed = place_light(service, box["id"], "Office", 200, 100, light_id="5")
    assert (placed["label"], placed["product"]) == ("Reading lamp", STRIP_PRODUCT)
    with pytest.raises(Refused) as refused:
        place_light(service, box["id"], "Office", 200, 100, light_id="6")
    assert str(refused.value) == "No bridge is paired, so light 6 cannot be checked. Plan it with catalog instead."
    assert [light.light_id for light in _office_lights(service, box)] == ["5"]


def test_a_silent_bridge_falls_back_to_a_light_placed_before(service, fake_bridge, no_discovery):
    service.set_bridge("10.0.0.77", USERNAME, "001788fffe000001")  # its ID is known, but it is not looked for
    service.assign_light("Den", "1", x=260, y=160, label="Desk lamp")
    box = _office(service)
    fake_bridge(requests.exceptions.ConnectTimeout("no answer"))
    placed = place_light(service, box["id"], "Office", 200, 100, light_id="1")
    assert (placed["label"], placed["product"]) == ("Desk lamp", service.get_room("Den").lights[0].product)
    with pytest.raises(Refused) as refused:
        place_light(service, box["id"], "Office", 200, 100, light_id="7")
    assert str(refused.value) == "The bridge is not answering, so light 7 cannot be checked. Plan it with catalog instead."
    assert [light.light_id for light in _office_lights(service, box)] == ["1"]


def test_moving_a_light_already_in_the_room_asks_the_bridge_nothing(service, session):
    box = create_sandbox(service, copy_from="active")
    place_light(service, box["id"], "Den", 100, 100, light_id="2")
    assert session.calls == [] and session.clip_calls == []
