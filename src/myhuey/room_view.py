"""A room as the web app and the assistant tools see it."""

from __future__ import annotations

from typing import Any

from .models import Room
from .placement import resolved_elevation
from .roles import FOCUS_KINDS, find_focus, resolve_roles


def room_json(room: Room) -> dict[str, Any]:
    """A room as the app sees it: what is saved, plus each light's worked-out height and its
    role for each kind of focus ("desk", "read", "sofa")."""
    data = room.to_dict()
    roles = {kind: resolve_roles(room, find_focus(room, kind)) for kind in FOCUS_KINDS}
    for light, saved in zip(room.lights, data["lights"]):
        saved["resolved_elevation"] = resolved_elevation(light, room)
        saved["resolved_roles"] = {kind: roles[kind][light.light_id] for kind in FOCUS_KINDS}
    return data
