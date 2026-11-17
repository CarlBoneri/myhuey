"""The suggester: mode + palette + clock + room layout → an ordinary scene of per-light overrides."""

from datetime import datetime

import pytest

from myhuey.models import Furniture, LayoutLight, Room
from myhuey.modes import MODES
from myhuey.palettes import by_id, lab, load
from myhuey.suggest import suggest

TABLE = {"archetype": "tableshade"}
STRIP = {"archetype": "huelightstrip"}
FLOOR = {"archetype": "floorshade"}
CEILING = {"archetype": "ceilinground"}
GRADIENT = {"archetype": "huelightstrip", "productname": "Hue gradient lightstrip"}

DESK_LAMP, BIAS_STRIP, VIEW_LAMP, FAR_LAMP, CEILING_LIGHT, GRADIENT_STRIP, BEHIND_LAMP = "t", "s", "v", "f", "c", "g", "b"


def _f(kind, x, y, width, depth):
    return Furniture.from_dict({"kind": kind, "x": x, "y": y, "width": width, "depth": depth})


def _light(light_id, x, y, product, **extra):
    return LayoutLight(light_id=light_id, label=light_id, x=x, y=y, product=product, **extra)


def _office(furniture=True):
    lights = [
        _light(DESK_LAMP, 260, 160, TABLE), _light(BIAS_STRIP, 200, 115, STRIP), _light(VIEW_LAMP, 200, 20, FLOOR),
        _light(FAR_LAMP, 390, 190, FLOOR), _light(CEILING_LIGHT, 100, 300, CEILING), _light(GRADIENT_STRIP, 10, 200, GRADIENT),
        _light(BEHIND_LAMP, 200, 350, FLOOR),
    ]
    stuff = [_f("desk", 200, 150, 140, 70), _f("monitor-27", 200, 130, 61, 20)] if furniture else []
    return Room(name="Office", outline=[[0, 0], [400, 0], [400, 400], [0, 400]], furniture=stuff, lights=lights)


def dt(hour, minute=0):
    return datetime(2026, 11, 15, hour, minute)


def _one(room, mode, at, **extra):
    return suggest(room, mode, at=at, wake="07:00", bed="23:00", count=extra.pop("count", 1), **extra)[0]


def _distance(first, second):
    a, b = lab(first), lab(second)
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def test_modes_hold_the_spec_values():
    assert MODES["code"].brightness == 0.8 and MODES["code"].bias and MODES["code"].color_strength == 0.6
    assert MODES["relax"].kelvin_offset == -500 and MODES["relax"].color_strength == 1.0 and MODES["relax"].bias
    assert MODES["read"].task_min_kelvin == 4000 and MODES["read"].task_brightness == 1.2
    assert MODES["study"].ambient_only and MODES["study"].brightness == 1.1


def test_code_at_night_keeps_desk_white_and_dim():
    overrides = _one(_office(), "code", dt(0, 30))["scene"].overrides
    assert overrides[DESK_LAMP]["white"] <= 2400 and overrides[DESK_LAMP]["brightness"] <= 25 * 0.8 + 0.1
    assert "colors" not in overrides[DESK_LAMP]
    assert overrides[BIAS_STRIP]["white"] and 10 <= overrides[BIAS_STRIP]["brightness"] <= 20
    assert "colors" in overrides[FAR_LAMP]


def test_code_at_noon_is_brighter_and_cooler_than_at_night():
    noon = _one(_office(), "code", dt(12))["scene"].overrides[DESK_LAMP]
    night = _one(_office(), "code", dt(0, 30))["scene"].overrides[DESK_LAMP]
    assert noon["white"] > night["white"] and noon["brightness"] > night["brightness"]


@pytest.mark.parametrize("hour", [20, 23, 2, 6])
def test_no_blue_heavy_palettes_from_three_hours_before_bed_until_wake(hour):
    for item in suggest(_office(), "relax", at=dt(hour, 15), wake="07:00", bed="23:00", count=6):
        assert "blue_heavy" not in item["palette"]["tags"]


def test_view_lights_are_mostly_white():
    item = _one(_office(), "code", dt(12))
    color = item["scene"].overrides[VIEW_LAMP]["colors"][0]
    white = item["white"]
    farthest = max(_distance(c, white) for c in item["palette"]["colors"])
    assert _distance(color, white) <= 0.25 * MODES["code"].color_strength * farthest + 0.01
    assert item["scene"].overrides[VIEW_LAMP]["brightness"] <= 50.1


def test_behind_lights_are_dim():
    overrides = _one(_office(), "work", dt(12))["scene"].overrides
    assert overrides[BEHIND_LAMP]["brightness"] <= 40.1


def test_gradient_lights_get_consecutive_palette_colors():
    item = _one(_office(), "relax", dt(12))
    gradient = item["scene"].overrides[GRADIENT_STRIP]
    assert 2 <= len(gradient["colors"]) <= 5
    assert gradient["mode"] == "interpolated_palette"


def test_relax_in_a_room_without_a_sofa_is_all_palette():
    item = _one(_office(), "relax", dt(12))
    assert all(role == "ambient" for role in item["roles"].values())
    assert all("colors" in override for override in item["scene"].overrides.values())


def test_room_without_lights_returns_empty_scenes():
    items = suggest(Room(name="Empty"), "code", at=dt(12), wake="07:00", bed="23:00", count=3)
    assert len(items) == 3 and all(item["scene"].overrides == {} for item in items)


def test_explicit_palette_id_is_used():
    chosen = load()[5]
    assert _one(_office(), "code", dt(12), palette_id=chosen.id)["palette"]["id"] == chosen.id


def test_unknown_palette_id_is_an_error():
    with pytest.raises(ValueError):
        _one(_office(), "code", dt(12), palette_id="nope")


def test_unknown_mode_is_an_error():
    with pytest.raises(ValueError):
        _one(_office(), "party", dt(12))


def test_seed_changes_color_order_but_not_palette():
    chosen = next(p for p in load() if len(set(p.colors)) >= 4)
    first = _one(_office(furniture=False), "relax", dt(12), palette_id=chosen.id, seed=0)
    second = _one(_office(furniture=False), "relax", dt(12), palette_id=chosen.id, seed=1)
    assert first["palette"]["id"] == second["palette"]["id"]
    assert first["scene"].overrides[FAR_LAMP]["colors"] != second["scene"].overrides[FAR_LAMP]["colors"]


def test_suggestions_have_distinct_palettes():
    items = suggest(_office(), "work", at=dt(12), wake="07:00", bed="23:00", count=6)
    assert len({item["palette"]["id"] for item in items}) == 6


def test_suggestions_prefer_the_mode_tags():
    items = suggest(_office(), "code", at=dt(12), wake="07:00", bed="23:00", count=4)
    assert all({"muted", "analogous"} & set(item["palette"]["tags"]) for item in items)


def test_study_puts_color_only_on_ambient_lights():
    item = _one(_office(), "study", dt(12))
    for light_id, role in item["roles"].items():
        assert ("colors" in item["scene"].overrides[light_id]) == (role == "ambient")


def test_read_task_light_at_least_4000k_during_the_day():
    overrides = _one(_office(), "read", dt(12))["scene"].overrides
    assert overrides[DESK_LAMP]["white"] >= 4000


def test_read_task_light_drops_the_4000k_floor_after_bedtime():
    overrides = _one(_office(), "read", dt(0, 30))["scene"].overrides
    assert overrides[DESK_LAMP]["white"] == 2700


def test_relax_keeps_the_tv_bias_light_dim_and_white():
    room = Room(name="Living", furniture=[_f("sofa", 200, 300, 213, 91), _f("tv", 200, 20, 145, 8)],
                lights=[_light("tvstrip", 200, 10, STRIP, elevation=100)])
    item = _one(room, "relax", dt(20))
    assert item["roles"]["tvstrip"] == "bias"
    override = item["scene"].overrides["tvstrip"]
    assert override["white"] == item["kelvin"] and 10 <= override["brightness"] <= 20


def test_bias_light_is_off_in_a_mode_without_bias():
    item = _one(_office(), "study", dt(12))
    assert item["roles"][BIAS_STRIP] == "bias"
    assert item["scene"].overrides[BIAS_STRIP] == {"on": False}


def test_pinned_bias_without_a_screen_is_dim_and_low_color():
    room = _office(furniture=False)
    room.lights.append(_light("pinned", 50, 50, FLOOR, role="bias"))
    item = _one(room, "code", dt(12))
    override = item["scene"].overrides["pinned"]
    assert override["brightness"] <= 30.1 and override.get("on") is not False


def test_scene_origin_and_name_are_set():
    item = _one(_office(), "code", dt(22, 40))
    scene = item["scene"]
    assert scene.origin == {"mode": "code", "palette_id": item["palette"]["id"], "palette_name": item["palette"]["name"], "at": "22:40"}
    assert scene.name == f"Code · {item['palette']['name']}"
    assert scene.room == "Office"


def test_explicit_blue_palette_is_still_honored_at_night():
    blue = next(p for p in load() if "blue_heavy" in p.tags)
    assert _one(_office(), "relax", dt(23, 30), palette_id=blue.id)["palette"]["id"] == blue.id
    assert by_id(blue.id) == blue


@pytest.mark.parametrize("mode", ["code", "study", "relax"])
def test_shuffling_reaches_far_into_the_library(mode):
    seen = {item["palette"]["id"] for seed in range(40)
            for item in suggest(_office(), mode, at=dt(12), wake="07:00", bed="23:00", count=4, seed=seed)}
    assert len(seen) > 60
    assert any(palette_id.startswith("met-") for palette_id in seen)


def test_gradient_lights_in_view_or_behind_get_one_color():
    room = _office()
    room.lights += [_light("gview", 210, 20, GRADIENT, elevation=100), _light("gbehind", 210, 350, GRADIENT, elevation=50)]
    item = _one(room, "code", dt(12))
    assert item["roles"]["gview"] == "view" and item["roles"]["gbehind"] == "behind"
    for light_id in ("gview", "gbehind"):
        override = item["scene"].overrides[light_id]
        assert len(override["colors"]) == 1 and "mode" not in override


@pytest.mark.parametrize("pinned", ["task", "view"])
def test_pinned_task_or_view_without_a_focus_is_dim_and_low_color(pinned):
    room = _office(furniture=False)  # no desk, so code mode has no focus
    room.lights.append(_light("pinned", 50, 50, FLOOR, role=pinned))
    item = _one(room, "code", dt(12))
    level = 100 * MODES["code"].brightness
    override = item["scene"].overrides["pinned"]
    assert item["roles"]["pinned"] == pinned
    assert "white" not in override and len(override["colors"]) == 1
    assert override["brightness"] <= level * 0.3 + 0.1
    assert room.lights[-1].role == pinned  # the pin stays


def test_palette_id_with_count_gives_different_rotations():
    chosen = next(p for p in load() if len(set(p.colors)) >= 4)
    items = suggest(_office(furniture=False), "relax", at=dt(12), wake="07:00", bed="23:00", palette_id=chosen.id, count=3)
    assert len(items) == 3 and all(item["palette"]["id"] == chosen.id for item in items)
    sets = [repr(sorted(item["scene"].overrides.items())) for item in items]
    assert len(set(sets)) == 3


def test_palette_id_count_is_capped_at_its_colors():
    chosen = next(p for p in load() if len(set(p.colors)) >= 3)
    items = suggest(_office(), "code", at=dt(12), wake="07:00", bed="23:00", palette_id=chosen.id, count=20)
    assert len(items) == len(chosen.colors)


# --- glare caps, guide lines, Chill ---

def _cap(brightness, reason, kelvin=None):
    return {"brightness": brightness, "kelvin": kelvin, "reason": reason}


def test_caps_hold_lights_under_their_glare_limit():
    room = _office()
    plain = _one(room, "code", dt(12))["scene"].overrides
    glare = {"checked": True, "caps": {VIEW_LAMP: _cap(15, "direct")}}
    for item in suggest(room, "code", at=dt(12), wake="07:00", bed="23:00", glare=glare):
        capped = item["scene"].overrides[VIEW_LAMP]
        assert capped["brightness"] <= 15
    first = _one(room, "code", dt(12), glare=glare)["scene"].overrides[VIEW_LAMP]
    assert len(first.get("colors", [])) == len(plain[VIEW_LAMP].get("colors", []))


def test_reflection_cap_makes_one_warm_white():
    glare = {"checked": True, "caps": {GRADIENT_STRIP: _cap(18, "reflection", 2700)}}
    override = _one(_office(), "code", dt(12), glare=glare)["scene"].overrides[GRADIENT_STRIP]
    assert override["white"] <= 2700 and override["brightness"] <= 18
    assert "colors" not in override and "mode" not in override


def test_cap_wins_over_role_and_unknown_ids_are_ignored():
    glare = {"checked": True, "caps": {DESK_LAMP: _cap(15, "direct"), "nope": _cap(10, "direct")}}
    item = _one(_office(), "code", dt(12), glare=glare)
    assert item["scene"].overrides[DESK_LAMP]["brightness"] <= 15
    assert "nope" not in item["scene"].overrides
    assert item["guide"]["glare"] == ["t held at 15%: it sits in your view of the screen."]


def test_caps_are_ignored_for_read_and_chill():
    glare = {"checked": True, "caps": {VIEW_LAMP: _cap(5, "direct")}}
    for mode in ("read", "relax"):
        plain = _one(_office(), mode, dt(12))["scene"].overrides
        item = _one(_office(), mode, dt(12), glare=glare)
        assert item["scene"].overrides == plain
        assert item["guide"]["checked"] is False
        assert item["guide"]["glare"] == ["Glare is checked for the desk presets (Code, Work, Study)."]


def test_no_desk_says_so():
    item = _one(_office(), "code", dt(12), glare={"checked": False, "caps": {}})
    assert item["guide"]["glare"] == ["No desk with a screen in this room, so glare was not checked. Add one in the Room plan."]
    assert item["guide"]["checked"] is False


def test_checked_with_nothing_to_cap():
    item = _one(_office(), "code", dt(12), glare={"checked": True, "caps": {}})
    assert item["guide"]["glare"] == ["No light would glare at the desk."] and item["guide"]["checked"] is True


def test_glare_lines_name_the_light_and_why():
    room = _office()
    caps = {VIEW_LAMP: _cap(15, "direct"), GRADIENT_STRIP: _cap(18, "reflection", 2700), FAR_LAMP: _cap(35, "peripheral")}
    lines = _one(room, "code", dt(12), glare={"checked": True, "caps": caps})["guide"]["glare"]
    assert "v held at 15%: it sits in your view of the screen." in lines
    assert "g held at 18%, warm white: it would reflect in the screen." in lines
    assert "f held at 35%: it sits at the edge of your view." in lines


def test_no_glare_means_no_guide_lines():
    item = _one(_office(), "code", dt(12))
    assert item["guide"]["glare"] == [] and item["guide"]["checked"] is False


def test_time_guide():
    from myhuey.suggest import time_guide

    assert time_guide(dt(8, 10), "07:00", "23:00").startswith("Morning, 1 h 10 after waking")
    assert time_guide(dt(21, 40), "07:00", "23:00") == "21:40, 1 h 20 before bed: warm whites, no blue palettes."
    assert time_guide(dt(23, 30), "07:00", "23:00").startswith("Past bedtime")
    midday = time_guide(dt(13, 5), "07:00", "23:00")
    assert "13:05" in midday and "follow your day" in midday


def test_chill_is_relax():
    from myhuey.modes import get_mode

    assert get_mode("chill") is get_mode("relax") and MODES["relax"].title == "Chill"
    assert _one(_office(), "chill", dt(20))["scene"].name.startswith("Chill")


def test_a_light_already_under_its_cap_gets_no_line():
    room = _office()
    low = _one(room, "code", dt(12))["scene"].overrides[VIEW_LAMP]["brightness"]
    easy = {"checked": True, "caps": {VIEW_LAMP: _cap(low + 20, "direct")}}
    item = _one(room, "code", dt(12), glare=easy)
    assert item["guide"]["glare"] == ["No light would glare at the desk."]
    assert item["scene"].overrides[VIEW_LAMP]["brightness"] == low
    tight = {"checked": True, "caps": {VIEW_LAMP: _cap(low - 5, "direct")}}
    line = _one(room, "code", dt(12), glare=tight)["guide"]["glare"]
    assert line == [f"v held at {low - 5:g}%: it sits in your view of the screen."]
