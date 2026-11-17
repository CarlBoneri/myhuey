"""Saved light groups: named sets of lights, app-wide (not part of any layout), each with an
optional saved look that puts the lights back the way they were in one tap.

A look maps a light ID to what that light showed: {"on": False} for a light that was off, or
{"on": True, "bri": 1-254} plus one of "xy", "ct" (mired, exactly as the bridge had it), or "gradient" ({"colors", "mode"}).
A light with a built-in effect running (candle, fire) also carries "effect": its name.
"""

from __future__ import annotations

from typing import Any, Iterable

MAX_GROUP_NAME = 60
MAX_GROUP_LIGHTS = 64


def clean_group_name(name: Any) -> str:
    text = str(name or "").strip()
    if not 1 <= len(text) <= MAX_GROUP_NAME:
        raise ValueError(f"A group name must be 1 to {MAX_GROUP_NAME} characters")
    return text


def clean_light_ids(ids: Any) -> list[str]:
    if not isinstance(ids, (list, tuple)):
        raise ValueError("A group needs a list of light IDs")
    cleaned: list[str] = []
    for item in ids:
        text = str(item).strip()
        if not text:
            raise ValueError("Light IDs cannot be blank")
        if text not in cleaned:
            cleaned.append(text)
    if not 1 <= len(cleaned) <= MAX_GROUP_LIGHTS:
        raise ValueError(f"A group takes 1 to {MAX_GROUP_LIGHTS} lights")
    return cleaned


def capture_look(raw: dict[str, Any], v2: dict[str, Any], ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    """What each light in `ids` shows right now, from the bridge's v1 lights and the v2 index.
    Lights the bridge does not have are left out."""
    look: dict[str, dict[str, Any]] = {}
    for light_id in ids:
        if light_id not in raw:
            continue
        state = raw[light_id].get("state") or {}
        if not state.get("on"):
            look[light_id] = {"on": False}
            continue
        entry: dict[str, Any] = {"on": True}
        if state.get("bri") is not None:
            entry["bri"] = int(state["bri"])
        gradient = ((v2.get(light_id) or {}).get("gradient")) or {}
        points = gradient.get("points") or []
        mode = state.get("colormode")
        if len(points) >= 2:
            entry["gradient"] = {"colors": list(points), "mode": gradient.get("mode")}
        elif mode in ("xy", "hs") and state.get("xy"):
            entry["xy"] = [float(value) for value in state["xy"]]
        elif mode == "ct" and state.get("ct"):
            entry["ct"] = int(state["ct"])
        running = ((v2.get(light_id) or {}).get("effect") or {}).get("current")
        if running and running != "no_effect":
            entry["effect"] = str(running)
        look[light_id] = entry
    return look


def look_commands(look: dict[str, dict[str, Any]], known: set[str]) -> tuple[list[dict[str, Any]], list[str]]:
    """The commands that put a look back, one per light the bridge still has, and the IDs skipped."""
    commands: list[dict[str, Any]] = []
    skipped: list[str] = []
    for light_id, entry in look.items():
        if light_id not in known:
            skipped.append(light_id)
            continue
        if not entry.get("on"):
            commands.append({"light_id": light_id, "v1": {"on": False}, "gradient": None})
            continue
        v1: dict[str, Any] = {"on": True}
        if entry.get("bri") is not None:
            v1["brightness"] = entry["bri"]
        if entry.get("xy"):
            v1["xy"] = tuple(entry["xy"])
        elif entry.get("ct"):
            v1["color_temp"] = entry["ct"]  # under 1000, so build_hue_state takes it as mired
        command = {"light_id": light_id, "v1": v1, "gradient": entry.get("gradient")}
        if entry.get("effect"):
            command["effect"] = entry["effect"]
        commands.append(command)
    return commands, skipped
