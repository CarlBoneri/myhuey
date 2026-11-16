"""The assistant's scene tools: preview and save send nothing; apply, power, and dim do."""

import re

import pytest

from myhuey.assistant import CHANGES_LIGHTS, apply_scene, preview_scene, room_dim, room_power, save_scene
from myhuey.errors import BridgeNotConfigured
from myhuey.service import HueRoomService

THEME = {"1": {"white": 2700, "brightness": 30}, "3": {"colors": ["#14b8a6"], "brightness": 15}}


def test_preview_shows_every_light_and_changes_nothing(service, session):
    result = preview_scene(service, "Den", "Calm", THEME)
    by = {light["id"]: light for light in result["lights"]}
    assert (by["1"]["kelvin"], by["1"]["brightness"], by["1"]["changed"]) == (2700, 30.0, True)
    assert by["3"]["color"] == "#14b8a6" and by["2"]["changed"] is False  # not mentioned: kept as it is
    assert (result["saved"], result["sent"]) == (False, False)
    assert service.scenes() == [] and session.calls == []


def test_others_off_turns_the_rest_off(service):
    by = {light["id"]: light for light in preview_scene(service, "Den", "Calm", THEME, others="off")["lights"]}
    assert by["2"]["on"] is False and by["2"]["changed"] is True


def test_save_then_replace_by_id(service, session):
    saved = save_scene(service, "Den", "Calm", THEME)
    again = save_scene(service, "Den", "Calmer", THEME, scene_id=saved["id"])
    assert again["id"] == saved["id"] and [s.name for s in service.scenes()] == ["Calmer"] and session.calls == []
    assert saved["saved"] is True and saved["sent"] is False


def test_apply_sends_and_reports_each_light(service, session):
    result = apply_scene(service, room="Den", name="Calm", lights=THEME)
    assert result["sent"] is True and result["failed"] == 0
    assert {light["id"] for light in result["lights"] if light["applied"]} == {"1", "3"}
    saved = save_scene(service, "Den", "Calm", THEME)
    assert apply_scene(service, scene="calm")["scene"] == "Calm" and apply_scene(service, scene=saved["id"])["failed"] == 0


def test_apply_needs_a_saved_scene_or_a_whole_unsaved_one(service, session):
    for arguments in ({}, {"scene": "x", "room": "Den"}, {"room": "Den", "name": "Calm"}):
        with pytest.raises(ValueError, match="either"):
            apply_scene(service, **arguments)
    assert session.calls == []


# Review Focus 2
@pytest.mark.parametrize("lights, words", [
    ({"99": {"white": 2700}}, 'light "99" is not in Den'),
    ({"1": {"colors": ["teal"]}}, 'light "1"'),
    ({"1": {"white": 9000}}, 'light "1"'),
    ({"1": {"brightness": 400, "white": 2700}}, 'light "1"'),
    ({}, "no lights"),
])
def test_a_bad_scene_names_the_light_and_saves_nothing(service, session, lights, words):
    for call in (preview_scene, save_scene):
        with pytest.raises(ValueError, match=re.escape(words)):
            call(service, "Den", "Bad", lights)
    with pytest.raises(ValueError, match=re.escape(words)):
        apply_scene(service, room="Den", name="Bad", lights=lights)
    assert service.scenes() == [] and session.calls == []


def test_a_bad_colour_and_brightness_say_the_value(service):
    with pytest.raises(ValueError, match="teal"):
        preview_scene(service, "Den", "Bad", {"1": {"colors": ["teal"]}})
    with pytest.raises(ValueError, match="400"):
        preview_scene(service, "Den", "Bad", {"1": {"brightness": 400, "white": 2700}})


# Review Focus 3
def test_apply_without_a_bridge_says_so(db_path):
    service = HueRoomService(db_path)
    service.add_room("Den", 400, 400)
    service.assign_light("Den", "1", x=100, y=100)
    with pytest.raises(BridgeNotConfigured):
        apply_scene(service, room="Den", name="Calm", lights={"1": {"white": 2700, "brightness": 30}})
    with pytest.raises(BridgeNotConfigured):
        room_power(service, "Den", False)
    with pytest.raises(BridgeNotConfigured):
        room_dim(service, "Den", 30)


def test_planned_lights_are_previewed_and_never_sent(service, session):
    planned = service.add_planned_light("Den", "desk-lamp", x=100, y=100)
    result = apply_scene(service, room="Den", name="Calm", lights={planned.light_id: {"white": 3000, "brightness": 40}})
    (light,) = [item for item in result["lights"] if item["id"] == planned.light_id]
    assert light["planned"] is True and light["applied"] is False and result["failed"] == 0


def test_power_and_dim(service, session):
    assert room_power(service, "Den", False)["failed"] == 0
    assert room_dim(service, "Den", 30)["room"] == "Den"
    with pytest.raises(ValueError):
        room_dim(service, "Den", 0)


def test_only_these_tools_change_lights():
    assert CHANGES_LIGHTS == ("apply_scene", "room_power", "room_dim")
