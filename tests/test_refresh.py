from myhuey.models import Room
from myhuey.refresh import arrival_spots, fingerprint, hue_room_name, plan_refresh

LIGHTS = {"1": {"name": "Light one"}, "2": {"name": "Light two"}, "3": {"name": "Light three"}}
OUTLINE = [[0, 0], [450, 0], [450, 300], [0, 300]]


def room(name, ids, hue_room=None, planned=()):
    lights = [{"light_id": i, "label": "Light two" if i == "2" else f"Label {i}"} for i in ids]
    lights += [{"light_id": p, "label": "Planned", "planned": True} for p in planned]
    data = {"name": name, "outline": OUTLINE, "lights": lights}
    if hue_room:
        data["hue_room"] = hue_room
    return data


def group(name, ids, kind="Room"):
    return {"name": name, "type": kind, "lights": ids}


def test_a_light_that_moved_rooms_leaves_one_and_arrives_in_the_other():
    rooms = [room("Office", ["1", "2"]), room("Hallway", [])]
    groups = {"1": group("Office", ["1"]), "4": group("Hallway", ["2"])}
    changes = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}
    assert changes["Office"].status == "changed"
    assert [(m.light_id, m.other) for m in changes["Office"].leave] == [("2", "Hallway")]
    assert [(m.light_id, m.label, m.other) for m in changes["Hallway"].arrive] == [("2", "Light two", "Office")]
    assert changes["Office"].link and changes["Office"].hue_room == "1"


def test_a_renamed_room_stays_matched_by_its_hue_id():
    rooms = [room("My office", ["1"], hue_room="1")]
    changes = plan_refresh(rooms, {"1": group("Office", ["1"])}, LIGHTS)
    assert [(c.room, c.status, c.link) for c in changes] == [("My office", "unchanged", False)]


def test_planned_lights_and_hand_drawn_rooms_are_left_alone():
    rooms = [room("Office", ["1"], planned=["catalog-9"]), room("Garage", ["7"])]
    changes = {c.room: c for c in plan_refresh(rooms, {"1": group("Office", ["1"])}, LIGHTS)}
    assert changes["Office"].leave == [] and changes["Office"].status == "unchanged"
    assert changes["Garage"].status == "left_alone"


def test_a_linked_room_whose_hue_room_is_gone_is_left_alone_not_rematched_by_name():
    rooms = [room("Office", ["1"], hue_room="9")]
    changes = plan_refresh(rooms, {"1": group("Office", ["1"])}, LIGHTS)
    assert [(c.room, c.status) for c in changes] == [("Office", "left_alone"), ("Office 2", "new")]


def test_zones_are_ignored_and_new_hue_rooms_are_listed_with_their_lights():
    groups = {"2": group("Zone", ["1"], "Zone"), "3": group("Porch/Yard", ["3", "1"])}
    changes = plan_refresh([], groups, LIGHTS)
    assert len(changes) == 1
    c = changes[0]
    assert (c.room, c.status, c.link, c.hue_room) == ("Porch-Yard", "new", True, "3")
    assert [(m.light_id, m.label, m.other) for m in c.arrive] == [("1", "Light one", None), ("3", "Light three", None)]


def test_a_new_hue_room_named_like_a_room_linked_elsewhere_gets_a_free_name():
    rooms = [room("Office", ["1"], hue_room="5")]
    groups = {"5": group("Study", ["1"]), "7": group("Office", ["3"])}
    changes = plan_refresh(rooms, groups, LIGHTS)
    assert [(c.room, c.status) for c in changes] == [("Office", "unchanged"), ("Office 2", "new")]


def test_a_second_room_linked_to_a_claimed_group_is_left_alone():
    rooms = [room("A", ["1"], hue_room="1"), room("B", ["1"], hue_room="1")]
    changes = plan_refresh(rooms, {"1": group("A", ["1"])}, LIGHTS)
    assert [c.status for c in changes] == ["unchanged", "left_alone"]


def test_a_departure_into_a_new_room_names_the_new_room():
    rooms = [room("Office", ["1", "3"])]
    groups = {"1": group("Office", ["1"]), "2": group("Den", ["3"])}
    changes = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}
    assert [(m.light_id, m.label, m.other) for m in changes["Office"].leave] == [("3", "Label 3", "Den")]


def test_an_arriving_light_with_no_name_is_called_light_id():
    changes = plan_refresh([], {"1": group("Den", ["8"])}, {})
    assert changes[0].arrive[0].label == "Light 8"


def test_fingerprint_changes_when_the_plan_changes_and_not_otherwise():
    groups = {"1": group("Office", ["1"])}
    a = fingerprint(plan_refresh([room("Office", ["1"])], groups, LIGHTS))
    assert a == fingerprint(plan_refresh([room("Office", ["1"])], groups, LIGHTS))
    assert len(a) == 16
    assert a != fingerprint(plan_refresh([room("Office", ["1", "2"])], groups, LIGHTS))


def test_arrival_spots_start_inside_the_top_left_and_wrap():
    assert arrival_spots([[0, 0], [200, 0], [200, 300], [0, 300]], 4) == [(40, 40), (100, 40), (160, 40), (40, 100)]


def test_arrival_spots_stay_inside_an_offset_or_narrow_room():
    assert arrival_spots([[100, 50], [160, 50], [160, 400], [100, 400]], 2) == [(140, 90), (140, 150)]


def test_hue_room_name_cleans_slashes_and_blanks():
    assert hue_room_name(" A/B ") == "A-B" and hue_room_name(None) == ""


def test_room_keeps_its_hue_link_through_from_dict_and_to_dict():
    assert Room.from_dict({"name": "A", "hue_room": " 4 "}).to_dict()["hue_room"] == "4"
    assert Room.from_dict({"name": "A", "hue_room": "  "}).hue_room is None
    assert Room.from_dict({"name": "A"}).to_dict()["hue_room"] is None


def test_linked_rooms_claim_their_groups_before_name_matches():
    rooms = [room("Office", ["1"]), room("Study", ["2"], hue_room="1")]
    groups = {"1": group("Office", ["2"]), "5": group("Other", ["1"])}
    changes = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}
    assert changes["Study"].hue_room == "1" and changes["Study"].status == "unchanged"
    # Office can't take group 1 by name; the shared-light pass then finds its light in group 5.
    assert (changes["Office"].hue_room, changes["Office"].hue_name, changes["Office"].status) == ("5", "Other", "unchanged")
    assert [c.room for c in plan_refresh(rooms, groups, LIGHTS)] == ["Office", "Study"]


def test_an_arrival_takes_the_stored_label_not_the_bridge_name():
    rooms = [room("Office", ["2"]), room("Hallway", [])]
    lights = {"2": {"name": "Bridge name"}}
    groups = {"1": group("Office", []), "4": group("Hallway", ["2"])}
    hallway = {c.room: c for c in plan_refresh(rooms, groups, lights)}["Hallway"]
    assert [m.label for m in hallway.arrive] == ["Light two"]


def test_a_planned_light_in_another_room_does_not_supply_the_label():
    rooms = [room("Office", [], planned=["2"]), room("Hallway", [])]
    lights = {"2": {"name": "Bridge name"}}
    groups = {"4": group("Hallway", ["2"])}
    hallway = {c.room: c for c in plan_refresh(rooms, groups, lights)}["Hallway"]
    assert [(m.label, m.other) for m in hallway.arrive] == [("Bridge name", None)]


def test_a_stored_light_with_no_id_is_skipped():
    rooms = [{"name": "Office", "outline": OUTLINE, "lights": [{"label": "x"}, {"light_id": "1", "label": "a"}]}]
    changes = plan_refresh(rooms, {"1": group("Office", ["1"])}, LIGHTS)
    assert changes[0].status == "unchanged"


def test_an_arrival_from_a_room_left_alone_is_marked_also():
    # Garage has no Hue match, so it keeps the light: the light ends up in both rooms.
    rooms = [room("Garage", ["2"]), room("Hallway", [])]
    groups = {"4": group("Hallway", ["2"])}
    hallway = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}["Hallway"]
    assert [(m.light_id, m.other, m.also) for m in hallway.arrive] == [("2", "Garage", True)]


def test_an_arrival_from_a_matched_room_is_a_move_not_also():
    rooms = [room("Office", ["1", "2"]), room("Hallway", [])]
    groups = {"1": group("Office", ["1"]), "4": group("Hallway", ["2"])}
    hallway = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}["Hallway"]
    assert [(m.other, m.also) for m in hallway.arrive] == [("Office", False)]
    unplaced = plan_refresh([], {"4": group("Hallway", ["3"])}, LIGHTS)[0]
    assert [(m.other, m.also) for m in unplaced.arrive] == [(None, False)]


def test_a_room_renamed_before_links_is_matched_by_its_shared_lights():
    rooms = [room("Family room", ["1", "2"])]
    groups = {"3": group("Den", ["1", "2", "3"]), "5": group("Porch", ["7"])}
    changes = plan_refresh(rooms, groups, LIGHTS)
    assert [(c.room, c.status, c.hue_room, c.hue_name, c.link) for c in changes] == [
        ("Family room", "changed", "3", "Den", True),
        ("Porch", "new", "5", "Porch", True),
    ]
    assert [m.light_id for m in changes[0].arrive] == ["3"]


def test_shared_light_matching_links_the_group_holding_the_most_lights():
    rooms = [room("Family room", ["1", "2", "3"])]
    groups = {"3": group("Den", ["1"]), "5": group("Lounge", ["2", "3"])}
    changes = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}
    assert (changes["Family room"].hue_room, changes["Family room"].hue_name) == ("5", "Lounge")
    assert changes["Den"].status == "new"


def test_a_tie_between_groups_links_nothing():
    rooms = [room("Family room", ["1", "2"])]
    groups = {"3": group("Den", ["1"]), "5": group("Lounge", ["2"])}
    changes = plan_refresh(rooms, groups, LIGHTS)
    assert [(c.room, c.status, c.hue_name) for c in changes] == [
        ("Family room", "left_alone", None), ("Den", "new", "Den"), ("Lounge", "new", "Lounge"),
    ]


def test_a_room_with_no_shared_lights_stays_left_alone():
    rooms = [room("Garage", ["7"])]
    changes = plan_refresh(rooms, {"3": group("Den", ["1"])}, LIGHTS)
    assert [(c.room, c.status) for c in changes] == [("Garage", "left_alone"), ("Den", "new")]


def test_shared_light_matching_does_not_take_a_group_claimed_by_id_or_name():
    rooms = [room("Office", ["1"]), room("Study", ["2"], hue_room="4"), room("Family room", ["1", "2"])]
    groups = {"1": group("Office", ["1"]), "4": group("Den", ["2"])}
    changes = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}
    assert changes["Office"].hue_room == "1" and changes["Study"].hue_room == "4"
    assert changes["Family room"].status == "left_alone"


def test_shared_light_matching_skips_a_linked_room_and_a_group_already_taken_in_the_pass():
    rooms = [room("A", ["1", "2"]), room("B", ["1", "2"]), room("Gone", ["3"], hue_room="9")]
    groups = {"3": group("Den", ["1", "2"]), "5": group("Lounge", ["3"])}
    changes = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}
    assert changes["A"].hue_room == "3"
    assert changes["B"].status == "left_alone"
    assert changes["Gone"].status == "left_alone"  # a broken link is not rematched by lights either
    assert changes["Lounge"].status == "new"


def test_hue_name_is_the_cleaned_hue_name_and_none_when_left_alone():
    rooms = [room("Office", ["1"], hue_room="1"), room("Garage", [])]
    groups = {"1": group("Work/Play", ["1"]), "2": group("Garage", ["3"]), "7": group("Garage", ["2"])}
    rooms[1]["hue_room"] = "8"
    changes = plan_refresh(rooms, groups, LIGHTS)
    assert [(c.room, c.hue_name) for c in changes] == [
        ("Office", "Work-Play"), ("Garage", None), ("Garage 2", "Garage"), ("Garage 3", "Garage"),
    ]


def test_arrival_spots_skip_the_notch_of_an_l_shaped_room():
    # 300 x 300 with the top-right 180 x 180 cut away.
    outline = [[0, 0], [120, 0], [120, 180], [300, 180], [300, 300], [0, 300]]
    # Rows at y 40, 100 and 160 only fit x 40 and 100; the row at y 220 is full width.
    assert arrival_spots(outline, 9) == [
        (40, 40), (100, 40), (40, 100), (100, 100), (40, 160), (100, 160), (40, 220), (100, 220), (160, 220),
    ]


def test_arrival_spots_in_a_room_too_small_for_them_fall_back_to_the_bounding_box_walk():
    outline = [[0, 0], [100, 0], [100, 100], [0, 100]]
    assert arrival_spots(outline, 3) == [(40, 40), (40, 100), (40, 160)]
