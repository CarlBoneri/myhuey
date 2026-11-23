"""Plan a refresh of MyHuey's rooms against the bridge's Hue rooms. Pure: no bridge, no storage."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any

from .geometry import as_points, bounds, point_in_polygon


def hue_room_name(raw: object) -> str:
    return str(raw or "").strip().replace("/", "-")


@dataclass
class Move:
    light_id: str
    label: str
    other: str | None = None
    # On an arrival: the room it comes from is left alone, so the light stays there too.
    also: bool = False


@dataclass
class RoomChange:
    room: str
    hue_room: str | None
    status: str
    arrive: list[Move] = field(default_factory=list)
    leave: list[Move] = field(default_factory=list)
    link: bool = False
    hue_name: str | None = None  # the Hue room's cleaned name; None when left alone


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
    # A room renamed before links existed: match it to the Hue room holding most of its lights.
    for index, room in enumerate(rooms):
        if index in matched or room.get("hue_room"):
            continue
        mine = set(_real_ids(room))
        shared = {
            gid: len(mine & {str(l) for l in g.get("lights") or []})
            for gid, g in room_groups.items()
            if gid not in claimed
        }
        best = max(shared.values(), default=0)
        winners = [gid for gid, n in shared.items() if n == best]
        if best and len(winners) == 1:
            matched[index] = winners[0]
            claimed.add(winners[0])

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
                    label = str(light.get("label") or f"Light {lid}")
                    return Move(lid, label, str(other.get("name")), also=i not in matched)
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
        link = str(room.get("hue_room") or "") != gid
        hue_name = hue_room_name(room_groups[gid].get("name"))
        changes.append(RoomChange(name, gid, status, arrive, leave, link=link, hue_name=hue_name))
    for gid, name in new_groups:
        want = sorted({str(l) for l in room_groups[gid].get("lights") or []}, key=_order)
        hue_name = hue_room_name(room_groups[gid].get("name"))
        changes.append(RoomChange(name, gid, "new", [arrival(l, None) for l in want], [], True, hue_name))
    return changes


def fingerprint(changes: list[RoomChange]) -> str:
    text = json.dumps([asdict(c) for c in changes], sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _grid_walk(outline: list[list[float]]):
    """Spots 60 cm apart from 40 cm inside the top-left of the bounds, row by row, without end."""
    min_x, min_y, max_x, _ = bounds(as_points(outline))
    x, y = min_x + 40, min_y + 40
    while True:
        yield (round(x, 2), round(y, 2))
        x += 60
        if x > max_x - 40:
            x, y = min_x + 40, y + 60


def arrival_spots(outline: list[list[float]], count: int) -> list[tuple[float, float]]:
    """Where arriving lights line up: the grid walk, skipping spots outside the room's outline.
    If the outline holds too few spots, the rest come from the walk unchecked."""
    polygon = as_points(outline)
    spots: list[tuple[float, float]] = []
    walk = _grid_walk(outline)
    for _ in range(count * 50):
        if len(spots) == count:
            return spots
        spot = next(walk)
        if point_in_polygon(spot, polygon):
            spots.append(spot)
    unchecked = _grid_walk(outline)
    while len(spots) < count:
        spot = next(unchecked)
        if spot not in spots:
            spots.append(spot)
    return spots
