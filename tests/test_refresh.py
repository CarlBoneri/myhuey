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
