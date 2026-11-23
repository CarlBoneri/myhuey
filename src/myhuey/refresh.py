"""Plan a refresh of MyHuey's rooms against the bridge's Hue rooms. Pure: no bridge, no storage."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any

from .geometry import as_points, bounds


def hue_room_name(raw: object) -> str:
    return str(raw or "").strip().replace("/", "-")


@dataclass
class Move:
    light_id: str
    label: str
    other: str | None = None


@dataclass
class RoomChange:
    room: str
    hue_room: str | None
    status: str
    arrive: list[Move] = field(default_factory=list)
    leave: list[Move] = field(default_factory=list)
    link: bool = False


def _order(light_id: str) -> tuple[int, str]:
    text = str(light_id)
    return (int(text), "") if text.isdigit() else (10**9, text)


def _real_ids(room: dict) -> list[str]:
    return [str(l["light_id"]) for l in room.get("lights") or [] if l.get("light_id") and not l.get("planned")]


def plan_refresh(rooms: list[dict], groups: dict[str, dict], lights: dict[str, dict]) -> list[RoomChange]:
    room_groups = {str(gid): g for gid, g in groups.items() if g.get("type") == "Room"}
    claimed: set[str] = set()
    matched: dict[int, str] = {}  # stored room index -> group id
    for index, room in enumerate(rooms):
        link = room.get("hue_room")
        if link:
            link = str(link)
            if link in room_groups and link not in claimed:
                matched[index] = link
                claimed.add(link)
    for index, room in enumerate(rooms):
        if room.get("hue_room"):
            continue
        wanted = hue_room_name(room.get("name"))
        for gid in sorted(room_groups, key=_order):
            if gid not in claimed and hue_room_name(room_groups[gid].get("name")) == wanted:
                matched[index] = gid
                claimed.add(gid)
                break

    taken = {str(r.get("name")) for r in rooms}
    new_groups: list[tuple[str, str]] = []
    for gid in sorted(room_groups, key=_order):
        if gid in claimed:
            continue
        name = hue_room_name(room_groups[gid].get("name"))
        if not name:
            continue
        final, n = name, 2
        while final in taken:
            final, n = f"{name} {n}", n + 1
        taken.add(final)
        new_groups.append((gid, final))

    name_of_group = {gid: str(rooms[i].get("name")) for i, gid in matched.items()}
    name_of_group.update({gid: name for gid, name in new_groups})
    holder_of_light: dict[str, str] = {}
    for gid in sorted(name_of_group, key=_order):
        for lid in room_groups[gid].get("lights") or []:
            holder_of_light.setdefault(str(lid), name_of_group[gid])

    def arrival(lid: str, own: int | None) -> Move:
        for i, other in enumerate(rooms):
            if i == own:
                continue
            for light in other.get("lights") or []:
                if str(light.get("light_id")) == lid and not light.get("planned"):
                    return Move(lid, str(light.get("label") or f"Light {lid}"), str(other.get("name")))
        name = (lights.get(lid) or {}).get("name")
        return Move(lid, str(name) if name else f"Light {lid}", None)

    changes: list[RoomChange] = []
    for index, room in enumerate(rooms):
        name = str(room.get("name"))
        gid = matched.get(index)
        if gid is None:
            changes.append(RoomChange(name, room.get("hue_room") or None, "left_alone"))
            continue
        have = _real_ids(room)
        want = [str(l) for l in room_groups[gid].get("lights") or []]
        arrive = [arrival(l, index) for l in sorted(set(want) - set(have), key=_order)]
        labels = {
            str(l["light_id"]): str(l.get("label") or f"Light {l['light_id']}")
            for l in room.get("lights") or []
            if l.get("light_id") and not l.get("planned")
        }
        leave = [Move(l, labels[l], holder_of_light.get(l)) for l in sorted(set(have) - set(want), key=_order)]
        status = "changed" if arrive or leave else "unchanged"
        changes.append(RoomChange(name, gid, status, arrive, leave, link=str(room.get("hue_room") or "") != gid))
    for gid, name in new_groups:
        want = sorted({str(l) for l in room_groups[gid].get("lights") or []}, key=_order)
        changes.append(RoomChange(name, gid, "new", [arrival(l, None) for l in want], [], True))
    return changes


def fingerprint(changes: list[RoomChange]) -> str:
    text = json.dumps([asdict(c) for c in changes], sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def arrival_spots(outline: list[list[float]], count: int) -> list[tuple[float, float]]:
    min_x, min_y, max_x, _ = bounds(as_points(outline))
    spots: list[tuple[float, float]] = []
    x, y = min_x + 40, min_y + 40
    for _ in range(count):
        spots.append((round(x, 2), round(y, 2)))
        x += 60
        if x > max_x - 40:
            x, y = min_x + 40, y + 60
    return spots
