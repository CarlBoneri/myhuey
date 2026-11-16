"""Saved light groups: the pure parts (names, light lists, looks)."""

import pytest

from myhuey.light_groups import capture_look, clean_group_name, clean_light_ids, look_commands


def test_group_names_are_trimmed_and_limited():
    assert clean_group_name("  Desk lamps ") == "Desk lamps"
    for bad in ("", "   ", "x" * 61, None):
        with pytest.raises(ValueError):
            clean_group_name(bad)


def test_light_lists_are_deduplicated_and_bounded():
    assert clean_light_ids(["2", 5, "2", " 7 "]) == ["2", "5", "7"]
    for bad in ([], [""], [str(i) for i in range(65)], "2", None):
        with pytest.raises(ValueError):
            clean_light_ids(bad)


RAW = {
    "1": {"state": {"on": False, "bri": 80, "xy": [0.3, 0.3], "colormode": "xy"}},
    "2": {"state": {"on": True, "bri": 120, "xy": [0.5, 0.41], "colormode": "xy"}},
    "3": {"state": {"on": True, "bri": 60, "xy": [0.6, 0.35], "hue": 1000, "sat": 200, "colormode": "hs"}},
    "4": {"state": {"on": True, "bri": 200, "ct": 370, "xy": [0.45, 0.4], "colormode": "ct"}},
    "5": {"state": {"on": True, "bri": 90, "xy": [0.4, 0.4], "colormode": "xy"}},
    "6": {"state": {"on": True, "bri": 40}},
}
V2 = {"5": {"gradient": {"points": ["#ff0000", "#00ff00", "#0000ff"], "mode": "segmented_palette"}}, "2": {"gradient": {"points": [], "mode": "x"}}}


def test_a_look_keeps_each_light_as_it_is_shown():
    look = capture_look(RAW, V2, ["1", "2", "3", "4", "5", "6"])
    assert look["1"] == {"on": False}
    assert look["2"] == {"on": True, "bri": 120, "xy": [0.5, 0.41]}
    assert look["3"] == {"on": True, "bri": 60, "xy": [0.6, 0.35]}
    assert look["4"] == {"on": True, "bri": 200, "ct": 370}
    assert look["5"] == {"on": True, "bri": 90, "gradient": {"colors": ["#ff0000", "#00ff00", "#0000ff"], "mode": "segmented_palette"}}
    assert look["6"] == {"on": True, "bri": 40}


def test_capture_leaves_out_lights_the_bridge_does_not_have():
    assert set(capture_look(RAW, V2, ["2", "99"])) == {"2"}


def test_a_look_becomes_one_command_per_light_and_skips_missing_ones():
    look = {
        "1": {"on": False},
        "2": {"on": True, "bri": 120, "xy": [0.5, 0.41]},
        "4": {"on": True, "bri": 200, "ct": 370},
        "5": {"on": True, "bri": 90, "gradient": {"colors": ["#ff0000", "#0000ff"], "mode": "segmented_palette"}},
        "99": {"on": True, "bri": 10},
    }
    commands, skipped = look_commands(look, {"1", "2", "4", "5"})
    assert skipped == ["99"]
    assert commands == [
        {"light_id": "1", "v1": {"on": False}, "gradient": None},
        {"light_id": "2", "v1": {"on": True, "brightness": 120, "xy": (0.5, 0.41)}, "gradient": None},
        {"light_id": "4", "v1": {"on": True, "brightness": 200, "color_temp": 370}, "gradient": None},
        {"light_id": "5", "v1": {"on": True, "brightness": 90}, "gradient": {"colors": ["#ff0000", "#0000ff"], "mode": "segmented_palette"}},
    ]
