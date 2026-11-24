"""Desk sets and mounted lights.

A desk set is a group of pieces placed together from a desk design. Its members keep their
real room coordinates (so every reader of a room works unchanged) and carry the set's id; the
set moves as one. A light can be mounted on a screen's back: it takes its place, height, and
facing from the screen and is a bias light.

`settle` is run on every save, so the stored room always agrees with these rules.
"""

from __future__ import annotations

import math

from .models import Furniture, LayoutLight, Room


def _front(item: Furniture) -> tuple[float, float]:
    angle = math.radians(item.rotation)
    return -math.sin(angle), math.cos(angle)


def _r2(value: float) -> float:
    return round(value, 2)


def mount_spot(screen: Furniture) -> tuple[float, float, float, float]:
    """Where a light mounted on this screen sits: its back-face middle (x, y), middle height, and turn."""
    fx, fy = _front(screen)
    return (_r2(screen.x - fx * screen.depth / 2), _r2(screen.y - fy * screen.depth / 2),
            _r2(screen.elevation + screen.height / 2), screen.rotation)


def settle(room: Room) -> None:
    """Make the room agree with the set and mount rules, in place.

    A set whose base piece is gone dissolves; a member naming a set the room does not have
    leaves it. A mounted light sits on its screen's back as a bias light and belongs to the
    screen's set; a mount whose screen is gone is dropped and the light stays where it was.
    """
    pieces = {item.id: item for item in room.furniture}
    room.desk_sets = [entry for entry in room.desk_sets if entry["base"] in pieces]
    known = {entry["id"] for entry in room.desk_sets}
    for item in room.furniture:
        if item.set not in known:
            item.set = None
    for light in room.lights:
        if light.set not in known:
            light.set = None
        if light.mount is None:
            continue
        screen = pieces.get(light.mount["screen"])
        if screen is None:
            light.mount = None
            continue
        light.x, light.y, light.elevation, light.rotation = mount_spot(screen)
        light.role = "bias"
        light.set = screen.set


def find_set(room: Room, set_id: str) -> dict[str, str]:
    entry = next((entry for entry in room.desk_sets if entry["id"] == set_id), None)
    if entry is None:
        raise ValueError(f"'{room.name}' has no desk set '{set_id}'")
    return entry


def move_set(room: Room, set_id: str, x: float, y: float, rotation: float) -> None:
    """Move and turn a set as one piece, so its base lands at (x, y) turned to `rotation`."""
    entry = find_set(room, set_id)
    base = next(item for item in room.furniture if item.id == entry["base"])
    turn = (float(rotation) - base.rotation) % 360
    cos, sin = math.cos(math.radians(turn)), math.sin(math.radians(turn))
    ox, oy = base.x, base.y

    def carry(thing: Furniture | LayoutLight) -> None:
        dx, dy = thing.x - ox, thing.y - oy
        thing.x = _r2(float(x) + dx * cos - dy * sin)
        thing.y = _r2(float(y) + dx * sin + dy * cos)
        thing.rotation = round((thing.rotation + turn) % 360, 2)

    for item in room.furniture:
        if item.set == set_id:
            carry(item)
    for light in room.lights:
        if light.set == set_id:
            carry(light)
    settle(room)


def release_set(room: Room, set_id: str) -> None:
    """Dissolve a set: its pieces stay where they stand, no longer locked together."""
    find_set(room, set_id)
    room.desk_sets = [entry for entry in room.desk_sets if entry["id"] != set_id]
    settle(room)


# --- Desk designs: made once in desk-local cm, stamped into rooms -------------------------------
#
# A design is {id, name, items, lights}. Items are furniture dicts with a local `key`; the base
# desk sits at (0, 0) turned 0 (its front, the seat side, faces +y). Lights are
# {key, catalog, label, x, y, elevation, rotation, length, role, mount} with `catalog` a light
# catalog id and `mount` naming an item key. A design never holds a real bridge light id.

DESK_KINDS = ("desk", "desk-l", "desk-standing")
_LOCAL_SKIP = ("id", "set")


def _clean_items(items: list[dict]) -> list[dict]:
    if not isinstance(items, list) or not items:
        raise ValueError("A desk design needs at least one piece")
    cleaned, keys = [], set()
    for index, raw in enumerate(items[:60]):
        if not isinstance(raw, dict):
            raise ValueError("Each piece of a desk design is an object")
        key = str(raw.get("key") or raw.get("id") or f"item{index}")[:40]
        if key in keys:
            raise ValueError(f"Two pieces share the key '{key}'")
        keys.add(key)
        piece = Furniture.from_dict({k: v for k, v in raw.items() if k not in _LOCAL_SKIP and k != "key"}).to_dict()
        cleaned.append({"key": key, **{k: v for k, v in piece.items() if k not in _LOCAL_SKIP}})
    return cleaned


def _clean_lights(lights: list[dict], keys: set[str]) -> list[dict]:
    from .catalog import CATALOG

    cleaned, seen = [], set()
    for index, raw in enumerate((lights or [])[:40]):
        if not isinstance(raw, dict):
            raise ValueError("Each light of a desk design is an object")
        catalog = raw.get("catalog")
        if catalog not in CATALOG:
            raise ValueError(f"A desk design's lights come from the light catalog; '{catalog}' is not in it")
        key = str(raw.get("key") or f"light{index}")[:40]
        if key in seen:
            raise ValueError(f"Two lights share the key '{key}'")
        seen.add(key)
        mount = raw.get("mount")
        if mount is not None and (not isinstance(mount, dict) or mount.get("screen") not in keys):
            raise ValueError(f"Light '{key}' is mounted on a piece the design does not have")
        light = LayoutLight.from_dict({"light_id": "local", "label": raw.get("label") or CATALOG[catalog].label,
                                       **{k: raw[k] for k in ("x", "y", "rotation", "length", "elevation", "role") if raw.get(k) is not None}})
        cleaned.append({"key": key, "catalog": catalog, "label": light.label, "x": light.x, "y": light.y, "rotation": light.rotation,
                        "length": light.length, "elevation": light.elevation, "role": light.role,
                        "mount": {"screen": mount["screen"]} if mount else None})
    return cleaned


def clean_design(name: str, items: list[dict], lights: list[dict]) -> tuple[str, list[dict], list[dict]]:
    """The name, pieces, and lights of a design, checked."""
    cleaned_name = " ".join(str(name or "").split())[:80]
    if not cleaned_name:
        raise ValueError("A desk design needs a name")
    pieces = _clean_items(items)
    return cleaned_name, pieces, _clean_lights(lights, {piece["key"] for piece in pieces})


def _base_key(items: list[dict]) -> str:
    return next((item["key"] for item in items if item["kind"] in DESK_KINDS), items[0]["key"])


def _to_room(x: float, y: float, rotation: float) -> callable:
    cos, sin = math.cos(math.radians(rotation)), math.sin(math.radians(rotation))

    def place(data: dict) -> dict:
        lx, ly = float(data.get("x") or 0), float(data.get("y") or 0)
        return {**data, "x": _r2(x + lx * cos - ly * sin), "y": _r2(y + lx * sin + ly * cos),
                "rotation": round((float(data.get("rotation") or 0) + rotation) % 360, 2)}

    return place


def stamp(room: Room, set_id: str, name: str, items: list[dict], lights: list[dict], *, x: float, y: float, rotation: float,
          keep_ids: bool = False) -> None:
    """Put a design's pieces and lights into the room as the set `set_id`, its local origin at (x, y) turned `rotation`.

    New pieces get new ids and new lights become planned catalog lights, unless `keep_ids` and an item
    or light carries its room `id` / `light_id` (editing a placed set)."""
    from .catalog import CATALOG
    from .models import new_id

    place = _to_room(float(x), float(y), float(rotation) % 360)
    ids: dict[str, str] = {}
    for item in items:
        ids[item["key"]] = str(item.get("id")) if keep_ids and item.get("id") else new_id()
    taken = {piece.id for piece in room.furniture}
    for key, value in list(ids.items()):
        if value in taken:
            ids[key] = new_id()
    for item in items:
        data = place({k: v for k, v in item.items() if k not in ("key", "id")})
        room.furniture.append(Furniture.from_dict({**data, "id": ids[item["key"]], "set": set_id}))
    room.desk_sets.append({"id": set_id, "name": name, "base": ids[_base_key(items)]})
    existing = {light.light_id: light for light in room.lights}
    for light in lights:
        data = place(light)
        mount = {"screen": ids[light["mount"]["screen"]]} if light.get("mount") else None
        light_id = light.get("light_id") if keep_ids else None
        if light_id and light_id in existing:
            current = existing[light_id]
            current.x, current.y, current.rotation = data["x"], data["y"], data["rotation"]
            current.elevation, current.length = light.get("elevation"), light.get("length")
            current.mount, current.set = mount, set_id
            continue
        item = CATALOG[light["catalog"]]
        room.lights.append(LayoutLight.from_dict({
            "light_id": f"planned-{new_id()}", "label": light.get("label") or item.label, "x": data["x"], "y": data["y"],
            "rotation": data["rotation"], "length": light.get("length"), "elevation": light.get("elevation"),
            "role": light.get("role") or "auto", "product": item.product(), "planned": True, "set": set_id, "mount": mount,
        }))
    settle(room)


def to_local(room: Room, set_id: str) -> dict:
    """A placed set in desk-local coordinates (base at the origin, turned 0), keeping room ids."""
    entry = find_set(room, set_id)
    base = next(item for item in room.furniture if item.id == entry["base"])
    cos, sin = math.cos(math.radians(-base.rotation)), math.sin(math.radians(-base.rotation))

    def local(thing: Furniture | LayoutLight) -> tuple[float, float, float]:
        dx, dy = thing.x - base.x, thing.y - base.y
        return _r2(dx * cos - dy * sin), _r2(dx * sin + dy * cos), round((thing.rotation - base.rotation) % 360, 2)

    items = []
    for item in room.furniture:
        if item.set == set_id:
            x, y, rotation = local(item)
            items.append({**{k: v for k, v in item.to_dict().items() if k != "set"}, "key": item.id, "x": x, "y": y, "rotation": rotation})
    lights = []
    for light in room.lights:
        if light.set == set_id:
            x, y, rotation = local(light)
            lights.append({"key": light.light_id, "light_id": light.light_id, "catalog": catalog_of(light), "label": light.label,
                           "x": x, "y": y, "rotation": rotation, "length": light.length, "elevation": light.elevation, "role": light.role,
                           "planned": light.planned, "mount": dict(light.mount) if light.mount else None})
    return {"set": set_id, "name": entry["name"], "items": items, "lights": lights}


def catalog_of(light: LayoutLight) -> str | None:
    """The catalog id a light stands for: its own, else the catalog item with its archetype."""
    from .catalog import CATALOG

    own = light.product.get("catalog")
    if own in CATALOG:
        return own
    archetype = light.product.get("archetype")
    return next((item.id for item in CATALOG.values() if archetype and item.archetype == archetype), None)


def apply_local(room: Room, set_id: str, items: list[dict], lights: list[dict]) -> None:
    """Replace a placed set's members with an edited local version, in place, where the set stands.

    Pieces and lights that carry their room id keep it. A real light left out is released (it stays
    in the room); a planned light left out is removed."""
    entry = find_set(room, set_id)
    base = next(item for item in room.furniture if item.id == entry["base"])
    anchor = (base.x, base.y, base.rotation)
    for item in items:
        item.setdefault("key", item.get("id") or "")
    keys = {str(item.get("key")) for item in items}
    cleaned_items = _clean_items([{**item, "key": item.get("key")} for item in items])
    for cleaned, raw in zip(cleaned_items, items):
        if raw.get("id"):
            cleaned["id"] = raw["id"]
    checked = []
    for light in lights:
        # A light already in the room is placed again as it is; only a new one needs a catalog id.
        catalog = light.get("catalog") or ("play-bar" if light.get("light_id") else None)
        checked.append({**_clean_lights([{**light, "catalog": catalog}], keys)[0], "light_id": light.get("light_id")})
    wanted = {light.get("light_id") for light in lights if light.get("light_id")}
    room.furniture = [item for item in room.furniture if item.set != set_id]
    kept = []
    for light in room.lights:
        if light.set != set_id or light.light_id in wanted:
            kept.append(light)
        elif not light.planned:
            light.set, light.mount = None, None
            kept.append(light)
    room.lights = kept
    room.desk_sets = [e for e in room.desk_sets if e["id"] != set_id]
    stamp(room, set_id, entry["name"], cleaned_items, checked, x=anchor[0], y=anchor[1], rotation=anchor[2], keep_ids=True)
