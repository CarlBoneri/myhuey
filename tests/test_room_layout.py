from myhuey.models import Room, LayoutLight
from myhuey.service import HueRoomService


def test_room_model_tracks_lights_and_layout():
    room = Room(name="Living Room", outline=[[0, 0], [450, 0], [450, 300], [0, 300]])
    room.add_light(LayoutLight(light_id="1", label="Lamp 1", x=50, y=80))
    room.add_light(LayoutLight(light_id="2", label="Sconces", x=200, y=90))

    assert room.name == "Living Room"
    assert (room.width, room.height) == (450, 300)
    assert len(room.lights) == 2
    assert room.get_light("1").label == "Lamp 1"
    assert room.get_light("2").x == 200


def test_hue_service_can_create_and_assign_lights_to_rooms(tmp_path):
    config_path = tmp_path / "rooms.json"
    service = HueRoomService(storage_path=str(config_path))
    service.add_room("Bedroom")
    service.add_room("Kitchen")
    service.assign_light("Bedroom", "1", x=120, y=90, label="Ceiling 1")
    service.assign_light("Bedroom", "2", x=300, y=150, label="Bedside")

    bedroom = service.get_room("Bedroom")
    assert bedroom.get_light("1").x == 120
    assert bedroom.get_light("2").label == "Bedside"
    assert service.get_room("Kitchen").name == "Kitchen"


def test_hue_service_builds_room_summary_for_web(tmp_path):
    config_path = tmp_path / "rooms.json"
    service = HueRoomService(storage_path=str(config_path))
    service.add_room("Office")
    service.assign_light("Office", "8", x=40, y=62, label="Desk lamp")

    summary = service.room_summary("Office")
    assert summary["name"] == "Office"
    assert summary["light_count"] == 1
    assert summary["lights"][0]["label"] == "Desk lamp"
