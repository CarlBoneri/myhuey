# Glare Engine, Slice 1: Schema v6, Posture, Glare Checker and Auto-Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room can say whether you sit or stand, and MyHuey can tell which lights reflect in your screens or sit in your line of sight, show it on the plan, cap them in suggestions, and dim them on request, from Python, HTTP, CLI, and the Studio.

**Architecture:** Two new flat modules beside `roles.py`: `posture.py` (lift a sit/stand desk and what is on it) and `glare.py` (build a numeric `GlareScene` from a room, then trace it). Only the tracer is ported to TypeScript; the server sends the scene, the page re-traces while you drag. One generated vector file is asserted by both test suites so the two tracers cannot drift.

**Tech Stack:** Python 3.11 dataclasses (the saved document is plain dicts, not Pydantic), FastAPI, argparse, SQLite single-document storage; React 19, zustand, SVG (no WebGL), vitest in a `node` environment.

**Spec:** `docs/superpowers/specs/2026-11-16-glare-engine-v6-spec.md`. This plan covers slice 1 of 4. Later slices, each its own plan: 2) furniture rigs, sockets, and surfaces; 3) the 3D view and plan zoom; 4) sun through windows (needs a location and plan north).

## Spec reconciliation (what the spec says vs. what this repo has)

| Spec | Repo | This plan |
|---|---|---|
| `myhuey/models/schema.py`, `storage/`, `spatial/`, `api/routes_spatial.py`, `cli/` packages | flat modules under `src/myhuey/` | `models.py`, `migrations.py`, `posture.py`, `glare.py`, routes in `api.py`, actions in `cli.py` |
| Pydantic `FurnitureItemV6` etc., `_cm`/`_deg` suffixes | dataclasses with `from_dict`/`to_dict`; `elevation`, `height`, `rotation` | add fields to the existing dataclasses, same naming style |
| Backup at `~/.myhuey/backups/myhuey.db.v5.bak` | `storage._write_backup` (`config_backup_v5` row, or `<stem>.v5.backup.json`) and `layout_store.backup_layout` for sandboxes; both never overwrite | keep the existing mechanism; it already runs before any save |
| Eye 118 / 160 cm, desk 73 / 114 cm | `roles.EYE_SEATED = 115`, `EYE_STANDING = 155`, desk 75, standing desk 110 (pinned by tests) | keep the repo's values as defaults; all are per-room or per-desk editable |
| Eye from "primary chair, or 65 cm in front of desk" | `roles.find_focus` (seat 60 cm from the screens) drives every suggestion | reuse `find_focus` so the checker and suggestions agree on where you sit |
| `GET …/glare?time=HH:MM`, `--time` | time only matters for the sun (slice 4) | no time parameter yet |
| `myhuey room posture <ROOM> <seated\|standing>` | `myhuey room <action> --name <ROOM>` | `room posture --name X --posture standing`, `room glare --name X [--mode code] [--fix]` |
| Sockets, assemblies, surfaces, beam angle | none | slice 2; not in the v6 document yet (fields with defaults need no version bump, as light groups showed) |
| Three.js, jsdom, 505/135 tests | no 3D library, vitest `node` env, 515/186 tests | slice 3; this slice draws on the existing SVG plan |

## Global Constraints

- Every length stored is centimeters; `units.parse_length` / `format_length` convert at the CLI, `LengthInput` in the UI.
- Plan coordinates: x right, y down, z up from the floor. Furniture fronts face +y at rotation 0 and turn clockwise (`roles._front`).
- All glare math runs locally: no network calls in `glare.py`, `posture.py`, or `glareMath.ts`.
- `CURRENT_VERSION = 6` (`migrations.py`), `API_REVISION = 6` (`api.py`), `API_VERSION = 6` (`frontend/src/api.ts`).
- Baseline to keep green: `uv run pytest -q` 515 passed; `npm --prefix frontend test` 186 passed. If an existing test's expected value changes because a light in its fixture now counts as a screen reflection, say so in the commit message; change nothing else in old tests.
- Nothing is ever sent to the bridge for a `planned` light. Bridge writes go through `@_one_bridge_write` and are paced with `self._command_gap()`.
- Every save goes through `HueRoomService._save`, which already raises `LayoutChanged` (HTTP 409) on a Make-active race.
- Commits: conventional prefixes (`feat:`, `fix:`, `docs:`), **no AI co-author or attribution trailer**.
- Real-light checks only in the Office room; never create test rooms on the owner's database.

## Review Focus

1. A room with no desk, screen, or seat for the mode: the audit returns `eye: null`, every light `clear`, and the CLI says no seat was found. No exception. (Task 3, Task 5)
2. A long lightstrip whose middle is harmless but whose end reflects in the screen: flagged, because strips are sampled along their length. (Task 3)
3. A light exactly at the eye, or a ray parallel to the screen plane: zero-length vector and zero denominator give `clear`, never `ZeroDivisionError` or `NaN`. (Task 3, Task 6)
4. A monitor turned away from the seat (the owner's Office 27" sits at 120°): the eye is behind its plane, so it produces no reflection hazard and no `NaN` in the JSON. (Task 3)
5. Auto-fix never brightens: a light already below its cap, a light that is off, and a planned light get nothing sent; one failing light does not stop the rest. (Task 4)

---

### Task 1: Schema v6 fields and migration

**Files:**
- Modify: `src/myhuey/models.py` (`Furniture`, `Room`), `src/myhuey/migrations.py`, `src/myhuey/api.py` (`API_REVISION`, `FurnitureItem`, `RoomUpdate`), `src/myhuey/service.py` (`update_room` passes the new room fields through)
- Modify: `frontend/src/api.ts` (`API_VERSION = 6`, `updateRoom` change type), `frontend/src/types.ts`
- Test: `tests/test_migration_v6.py`

**Interfaces:**
- Produces, `Furniture`: `display: bool` (default `kind.startswith("monitor") or kind == "tv"`), `tilt: float` degrees in `[-45, 45]` (negative leans the top away from the viewer; default `-12.0` when `display`, else `0.0`), `standing_height: float | None` (the piece's height when the room is in standing posture; `0 < h <= 1000`; `None` = it does not move).
- Produces, `Room`: `posture: str` in `POSTURES = ("seated", "standing")` default `"seated"`, `seated_eye: float = 115.0`, `standing_eye: float = 155.0` (each `80 <= v <= 220`, else `ValueError("Eye height must be between 0.8 m and 2.2 m")`). All in `to_dict`.
- Produces, TS: `Furniture.display?: boolean; tilt?: number; standing_height?: number | null`; `Room.posture: 'seated' | 'standing'; seated_eye: number; standing_eye: number`; `export type Posture`.

- [ ] **Step 1: Write the failing tests** in `tests/test_migration_v6.py` (reuse the helpers style of `tests/test_migration_v3.py`):

```python
def _v5():
    return {"schema_version": 5, "bridge": {}, "scenes": [{"id": "s1", "name": "Dusk", "room": "Office"}],
            "groups": [{"id": "g1", "name": "Desk", "lights": ["1"]}], "home": {"plan": None},
            "rooms": [{"name": "Office", "x": 0, "y": 0, "units": "imperial", "outline": SQUARE, "ceiling": 244.0,
                       "openings": [], "photo": None,
                       "lights": [{"light_id": "1", "label": "Lamp", "x": 10, "y": 10}],
                       "furniture": [
                           {"id": "d1", "kind": "desk", "label": "Desk", "x": 200, "y": 150, "width": 140, "depth": 70},
                           {"id": "m1", "kind": "monitor-27", "label": "27", "x": 200, "y": 130, "width": 61, "depth": 20, "elevation": 0},
                           {"id": "t1", "kind": "tv", "label": "TV", "x": 50, "y": 20, "width": 120, "depth": 8, "elevation": 60}]}]}

def test_v5_to_v6_adds_posture_and_displays():
    upgraded, start = migrate(_v5())
    room = upgraded["rooms"][0]
    desk, monitor, tv = room["furniture"]
    assert (start, upgraded["schema_version"]) == (5, 6)
    assert (room["posture"], room["seated_eye"], room["standing_eye"]) == ("seated", 115.0, 155.0)
    assert (desk["display"], desk["tilt"], desk["standing_height"]) == (False, 0.0, None)
    assert (monitor["display"], monitor["tilt"], monitor["elevation"]) == (True, -12.0, 75)
    assert (tv["display"], tv["elevation"]) == (True, 60)
    assert upgraded["scenes"] == _v5()["scenes"] and upgraded["groups"] == _v5()["groups"]
    assert room["lights"][0]["light_id"] == "1"
    Room.from_dict(room)

def test_migration_is_idempotent_and_keeps_user_values():
    doc = _v5(); doc["rooms"][0]["furniture"][1]["tilt"] = -5.0
    once, _ = migrate(doc); twice, start = migrate(copy.deepcopy(once))
    assert once == twice and start == 6 and once["rooms"][0]["furniture"][1]["tilt"] == -5.0

@pytest.mark.parametrize("name", ["home.db", "home.json"])
def test_load_backs_up_v5_once(tmp_path, name):
    path = tmp_path / name
    save_config(_v5(), path)                      # written as v5
    assert load_config(path)["schema_version"] == 6
    assert load_backup(5, path)["schema_version"] == 5
    load_config(path)                             # a second load never rewrites the backup
    assert "posture" not in load_backup(5, path)["rooms"][0]

def test_sandbox_layout_upgrades_with_its_own_backup(tmp_path): ...
    # Build a service on a v6 db, create a sandbox (service.new_layout), rewrite its stored record with
    # schema_version 5 and a room lacking "posture" (layout_store.load_layout/save_layout), then read rooms
    # inside `using_layout(sandbox_id)`: the room has posture "seated" and the row
    # f"layout_backup:{sandbox_id}:v5" exists in app_state.

def test_furniture_validation():
    with pytest.raises(ValueError): Furniture.from_dict({"kind": "desk", "x": 0, "y": 0, "tilt": 60})
    with pytest.raises(ValueError): Room.from_dict({"name": "R", "posture": "lying"})
    assert Furniture.from_dict({"kind": "monitor-24", "x": 0, "y": 0}).tilt == -12.0
```

- [ ] **Step 2: Run** `uv run pytest tests/test_migration_v6.py -q`. Expected: FAIL (`schema_version` is 5, `KeyError: 'posture'`).
- [ ] **Step 3: Implement.** `_v5_to_v6(config)` in `migrations.py` uses `setdefault` for every new key (so user values survive), sets a display's `elevation` to `FURNITURE_HEIGHTS.get(kind, (75, 0))[0]` only when it is missing or `0`, and registers as `_STEPS[5]`. Update the module docstring with a "Version 6" sentence. Extend `Furniture.from_dict` / `Room.from_dict` / `Room.to_dict` per Interfaces. In `api.py` add `display: bool | None`, `tilt: float | None = Field(None, ge=-45, le=45)`, `standing_height: float | None = Field(None, gt=0, le=1000)` to `FurnitureItem`; `seated_eye`, `standing_eye` (`ge=80, le=220`) to `RoomUpdate`, passed through `update_room`.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass (515 + new). Then `npm --prefix frontend run typecheck`: no errors.
- [ ] **Step 5: Commit** `feat: schema v6 with room posture, eye heights, and display tilt`.

---

### Task 2: Posture

**Files:**
- Create: `src/myhuey/posture.py`
- Modify: `src/myhuey/roles.py` (`_desk_focus`), `src/myhuey/suggest.py` and `src/myhuey/setups.py` (work on `posed(room)`), `src/myhuey/service.py`, `frontend/src/lib/photo.ts` (`heightPreset('eye')`)
- Test: `tests/test_posture.py`, one case added to `frontend/src/lib/photo.test.ts`

**Interfaces:**
- Consumes: Task 1 fields; `placement.covers(item, x, y)`.
- Produces: `posture.posed(room: Room) -> Room`; `posture.eye_height(room: Room, desk: Furniture | None = None) -> float`; `HueRoomService.set_posture(room_name: str, posture: str) -> Room`.

- [ ] **Step 1: Write the failing tests** in `tests/test_posture.py`:

```python
def _room(posture="seated", standing_height=110.0, desk_kind="desk"):
    return Room.from_dict({"name": "R", "outline": [[0, 0], [400, 0], [400, 400], [0, 400]], "posture": posture,
        "furniture": [
            {"id": "d", "kind": desk_kind, "x": 200, "y": 150, "width": 140, "depth": 70, "height": 75, "standing_height": standing_height},
            {"id": "m", "kind": "monitor-27", "x": 200, "y": 130, "width": 61, "depth": 20, "elevation": 75},
            {"id": "b", "kind": "bookshelf", "x": 30, "y": 30, "width": 40, "depth": 30}],
        "lights": [{"light_id": "on", "label": "", "x": 240, "y": 160, "elevation": 80},
                   {"light_id": "under", "label": "", "x": 200, "y": 150, "elevation": 20},
                   {"light_id": "far", "label": "", "x": 380, "y": 380, "elevation": 80}]})

def test_seated_room_is_returned_untouched():
    room = _room(); assert posed(room) is room

def test_standing_lifts_the_desk_and_what_sits_on_it():
    room = _room("standing"); up = posed(room)
    by = {i.id: i for i in up.furniture}
    assert by["d"].height == 110 and by["m"].elevation == 110 and by["b"].elevation == 0
    assert [up.get_light(k).elevation for k in ("on", "under", "far")] == [115, 20, 80]
    assert room.furniture[0].height == 75          # the stored room is not changed

def test_desk_without_standing_height_does_not_move():
    assert posed(_room("standing", standing_height=None)).furniture[1].elevation == 75

def test_eye_height():
    assert eye_height(_room()) == 115 and eye_height(_room("standing")) == 155
    fixed = _room(desk_kind="desk-standing", standing_height=None)
    assert eye_height(fixed, fixed.furniture[0]) == 155   # a fixed-height standing desk: you stand

def test_set_posture_saves_and_rejects(service):       # service fixture as in tests/test_suggest_api_cli.py
    assert service.set_posture("Den", "standing").posture == "standing"
    assert service.get_room("Den").posture == "standing"
    with pytest.raises(ValueError): service.set_posture("Den", "prone")
```

- [ ] **Step 2: Run** `uv run pytest tests/test_posture.py -q`. Expected: FAIL (`No module named 'myhuey.posture'`).
- [ ] **Step 3: Implement `posture.py`.** `posed` returns `room` itself unless `room.posture == "standing"` and some furniture has `standing_height`; otherwise a `copy.deepcopy`. For each piece with `standing_height`: `delta = standing_height - height`, `old_top = elevation + height`; set its `height`; add `delta` to the `elevation` of every other piece, and of every light with an explicit `elevation`, whose center it `covers` and whose elevation is `>= old_top - 1`. (Lights on automatic height follow by themselves through `placement.resolved_elevation`.) `eye_height` returns `room.standing_eye` when `room.posture == "standing"` or when `desk` is a `desk-standing` with no `standing_height`, else `room.seated_eye`.
- [ ] **Step 4: Wire it in.** `roles._desk_focus`: `eye = eye_height(room, desk)`. `suggest.suggest` and `setups.generate_setups`: `room = posed(room)` first. `photo.ts` `heightPreset('eye')`: standing when `room.posture === 'standing'` or the old desk-standing rule, returning `room.standing_eye ?? 155` / `room.seated_eye ?? 115`; add a test for a seated-kind desk in a standing room returning the room's `standing_eye`.
- [ ] **Step 5: Run** `uv run pytest -q` and `npm --prefix frontend test`. Expected: all pass, including `tests/test_roles.py::…eye_height == 155` unchanged.
- [ ] **Step 6: Commit** `feat: sit or stand posture lifts a height-adjustable desk and what is on it`.

---

### Task 3: The glare tracer (pure Python)

**Files:**
- Create: `src/myhuey/glare.py`
- Test: `tests/test_glare.py`

**Interfaces:**
- Consumes: `posture.posed`, `roles.find_focus`, `modes.get_mode`, `placement.resolved_elevation`, `geometry.sample_along`, `scenes.placed_profile` (for a light's physical length; read how `suggest.py` uses it).
- Produces:
  - `glare.scene_of(room: Room, mode: str = "code") -> dict`, the `GlareScene`:
    `{"mode": str, "eye": [x, y, z] | None, "target": [x, y, z] | None, "displays": [{"id", "center": [3], "normal": [3], "u": [3], "v": [3], "width", "height"}], "lights": [{"light_id", "label", "points": [[x, y, z], ...], "pinned_bias": bool}], "boxes": [{"id", "x", "y", "rotation", "width", "depth", "z0", "z1", "display": bool}]}`
  - `glare.trace(scene: dict) -> dict`: `{"lights": [{"light_id", "label", "status", "angle": float | None, "cap": {"brightness": int, "kelvin": int | None} | None, "hazards": [{"kind", "display": id | None, "path": [[3], ...]}]}], "hazards": int}`
  - `glare.audit(room: Room, mode: str = "code") -> dict`: `{"room": name, "mode", "posture", "scene": scene, **trace(scene)}`
  - `glare.clamp_overrides(overrides: dict[str, dict], lights: list[dict]) -> dict[str, dict]`
  - Constants: `STATUSES = ("screen_reflection", "direct_fov", "peripheral_warn", "bias_ok", "clear")` (worst first), `SCREEN_MARGIN_CM = 8.0`, `BIAS_BEHIND_CM = 35.0`, `BIAS_SIDE_CM = 30.0`, `DIRECT_DEG = 30.0`, `PERIPHERAL_DEG = 65.0`, `REFLECTION_CAP = (18, 2700)`, `REFLECTION_MIN_KELVIN = 2400`, `DIRECT_CAP = 15`, `PERIPHERAL_CAP = 35`, `PERIPHERAL_MODES = ("code", "study")`, `STRIP_SAMPLES = 5`, `BOX_SHRINK_CM = 0.5`.

**The algorithm (the signature and tests do not determine it):**

`scene_of`, on `posed(room)`:
- `focus = find_focus(room, get_mode(mode).focus)`. `eye = [seat.x, seat.y, focus.eye_height]`; `target = [screen.x, screen.y, screen_height]` when the focus has a screen, else the eye plus 100 cm along the gaze at eye height. No focus: both `None`.
- Each `display` furniture piece, with `f = (-sin r, cos r)` for rotation `r` and `τ = radians(-tilt)`: `center = (x + f.x·depth/2, y + f.y·depth/2, elevation + height/2)`, `u = (cos r, sin r, 0)`, `normal = (f.x cos τ, f.y cos τ, sin τ)`, `v = (-f.x sin τ, -f.y sin τ, cos τ)`; `width`/`height` are the furniture's.
- Each light: z is `resolved_elevation`; `points` is the center alone, or `STRIP_SAMPLES` points from `sample_along(center, rotation, length, 5)` when the light has a length over 30 cm. `pinned_bias = light.role == "bias"`.
- `boxes`: every furniture piece except `kind == "rug"`, as its bounding box (ellipses too), `z0 = elevation`, `z1 = elevation + height`.

`trace`, per light, per point `L`, with eye `E` (if `eye` is `None`: every light `clear`, `angle None`):
1. **Reflection**, per display `(M, n, u, v, W, H)`: skip unless `(L−M)·n > 0` and `(E−M)·n > 0`. `L' = L − 2((L−M)·n)n`; `den = (L'−E)·n`, skip if `abs(den) < 1e-9`; `t = ((M−E)·n)/den`, skip unless `0 < t < 1`; `P = E + t(L'−E)`; hit when `abs((P−M)·u) <= W/2 + 8` and `abs((P−M)·v) <= H/2 + 8` and neither segment `L→P` nor `P→E` is blocked by a box other than that display's own. Hazard `{"kind": "screen_reflection", "display": id, "path": [L, P, E]}`.
2. **Bias**: `pinned_bias`, or for some display `-35 <= (L−M)·n < 0` and `abs((L−M)·u) <= W/2 + 30`.
3. **Direct**: `α` = angle between `target − E` and `L − E` (a zero-length `L − E` gives `clear`). If `E→L` is blocked by any box (displays included), it is not direct. `α < 30` → `direct_fov`; `30 <= α <= 65` → `peripheral_warn`; hazards carry `"display": None, "path": [L, E]`.
4. Point status: reflection, else bias, else direct, else peripheral, else clear. The light's `status` is its worst point's (order of `STATUSES`); `angle` is the smallest `α` over its points, rounded to 1 decimal; `hazards` holds at most one per (kind, display): the first point that hit. All coordinates rounded to 2 decimals. Round everywhere with one private helper, `_round(x, places) = floor(x * 10**places + 0.5) / 10**places`, not the built-in `round`: Task 6 ports it to TypeScript and the two must agree on halves and never produce `-0.0`.
5. `cap`: reflection `{"brightness": 18, "kelvin": 2700}`; direct `{"brightness": 15, "kelvin": None}`; peripheral `{"brightness": 35, "kelvin": None}` only when `scene["mode"]` is in `PERIPHERAL_MODES`; otherwise `None`. Top-level `hazards` counts lights with a cap.

Segment-versus-box: move the segment into the box's frame (translate by `-(x, y)`, rotate by `-rotation`), shrink the box by `BOX_SHRINK_CM` on every side (so a strip lying on a desk is not blocked by the desk it sits on), then a slab test over x, y, and z.

`clamp_overrides`: for each light with a `cap` whose override is not `{"on": False}`: `brightness = min(brightness, cap.brightness)`; when `cap.kelvin`: drop `colors` and `mode`, set `white = min(max(existing white or 2700, 2400), 2700)`. Returns a new dict.

- [ ] **Step 1: Write the failing tests** in `tests/test_glare.py`. One screen, tilt 0, so the numbers can be checked by hand: the screen plane is `y = 101`, its center `(200, 101, 95)`, the seat `(200, 160)`, the eye `(200, 160, 115)`.

```python
def _room(lights, extra=(), tilt=0.0, rotation=0.0):
    return Room.from_dict({"name": "R", "outline": [[0, 0], [400, 0], [400, 400], [0, 400]],
        "furniture": [{"id": "m", "kind": "monitor-27", "x": 200, "y": 100, "width": 60, "depth": 2,
                       "elevation": 75, "height": 40, "tilt": tilt, "rotation": rotation}, *extra],
        "lights": [{"light_id": k, "label": k, "x": x, "y": y, "elevation": z, **more} for k, (x, y, z, more) in lights.items()]})

def _status(room, mode="code"):
    return {light["light_id"]: light["status"] for light in audit(room, mode)["lights"]}

def test_scene_geometry():
    scene = scene_of(_room({}))
    assert scene["eye"] == [200, 160, 115] and scene["target"] == [200, 100, 95]
    assert scene["displays"][0]["center"] == [200, 101, 95] and scene["displays"][0]["normal"] == [0, 1, 0]
    tilted = scene_of(_room({}, tilt=-12))["displays"][0]["normal"]
    assert tilted == pytest.approx([0, 0.97815, 0.20791], abs=1e-4)

def test_light_behind_the_seat_reflects_in_the_screen():
    report = audit(_room({"back": (200, 300, 115, {})}))
    (light,) = report["lights"]
    assert light["status"] == "screen_reflection" and light["cap"] == {"brightness": 18, "kelvin": 2700}
    assert light["hazards"][0]["path"] == [[200, 300, 115], [200, 101, 115], [200, 160, 115]]
    assert report["hazards"] == 1

def test_ceiling_light_behind_the_seat_misses_an_upright_screen():
    assert _status(_room({"ceiling": (200, 300, 240, {})})) == {"ceiling": "clear"}   # bounce lands 48.6 cm above center

def test_pillar_between_light_and_screen_clears_it():
    pillar = {"id": "p", "kind": "pillar-square", "x": 200, "y": 230, "width": 30, "depth": 30}
    assert _status(_room({"back": (200, 300, 115, {})}, extra=[pillar])) == {"back": "clear"}

def test_direct_and_peripheral_and_bias():
    room = _room({"ahead": (230, 20, 130, {}),      # 27.2 degrees off the gaze, above the screen's top edge
                  "side": (330, 60, 130, {}),       # 56.8 degrees
                  "halo": (200, 90, 95, {}),        # 11 cm behind the screen
                  "hidden": (200, 20, 100, {}),     # straight ahead but behind the monitor itself
                  "pinned": (330, 60, 130, {"role": "bias"})})
    assert _status(room) == {"ahead": "direct_fov", "side": "peripheral_warn", "halo": "bias_ok",
                             "hidden": "clear", "pinned": "bias_ok"}
    caps = {l["light_id"]: l["cap"] for l in audit(room, "code")["lights"]}
    assert caps["ahead"] == {"brightness": 15, "kelvin": None} and caps["side"] == {"brightness": 35, "kelvin": None}
    relax = {l["light_id"]: l for l in audit(room, "work")["lights"]}
    assert relax["side"]["status"] == "peripheral_warn" and relax["side"]["cap"] is None

# Review Focus
def test_no_seat_means_everything_clear():
    room = Room.from_dict({"name": "E", "lights": [{"light_id": "1", "label": "", "x": 10, "y": 10}]})
    report = audit(room)
    assert report["scene"]["eye"] is None and report["lights"][0]["status"] == "clear" and report["hazards"] == 0

def test_strip_is_flagged_when_only_its_end_reflects():
    # A 300 cm strip along x, centered at (400, 300, 115): its samples sit at x = 250, 325, 400, 475, 550.
    # The x = 250 end bounces 11.4 cm right of the screen's center (a hit); the center bounces 45.7 cm right (a miss).
    assert _status(_room({"bulb": (400, 300, 115, {})})) == {"bulb": "clear"}
    assert _status(_room({"strip": (400, 300, 115, {"length": 300, "rotation": 0})})) == {"strip": "screen_reflection"}

def test_degenerate_rays_do_not_raise_or_emit_nan():
    report = audit(_room({"at_eye": (200, 160, 115, {}), "in_plane": (300, 101, 95, {})}))
    assert "NaN" not in json.dumps(report) and all(l["status"] in STATUSES for l in report["lights"])

def test_screen_turned_away_from_the_seat_reflects_nothing():
    # rotation 180: the screen faces -y, so find_focus seats the user at (200, 40) and the light at y = 300
    # is behind the screen's back.
    report = audit(_room({"back": (200, 300, 180, {})}, rotation=180))
    assert report["scene"]["eye"] == [200, 40, 115]
    assert not [h for h in report["lights"][0]["hazards"] if h["kind"] == "screen_reflection"]
    assert "NaN" not in json.dumps(report)

def test_clamp_overrides():
    lights = [{"light_id": "a", "cap": {"brightness": 18, "kelvin": 2700}}, {"light_id": "b", "cap": {"brightness": 15, "kelvin": None}},
              {"light_id": "c", "cap": None}, {"light_id": "d", "cap": {"brightness": 18, "kelvin": 2700}}]
    before = {"a": {"colors": ["#3366ff"], "mode": "interpolated_palette", "brightness": 60.0},
              "b": {"colors": ["#3366ff"], "brightness": 10.0}, "c": {"white": 4000, "brightness": 80.0}, "d": {"on": False}}
    assert clamp_overrides(before, lights) == {"a": {"white": 2700, "brightness": 18}, "b": {"colors": ["#3366ff"], "brightness": 10.0},
                                               "c": {"white": 4000, "brightness": 80.0}, "d": {"on": False}}
```

If a hand-checked vector disagrees with the code, recheck the hand calculation before changing an assertion.

- [ ] **Step 2: Run** `uv run pytest tests/test_glare.py -q`. Expected: FAIL (`No module named 'myhuey.glare'`).
- [ ] **Step 3: Implement `glare.py`** per Interfaces and the algorithm. Plain tuples and a few private vector helpers (`_sub`, `_dot`, `_scale`, `_norm`); no numpy. Module docstring in the style of `roles.py`: what a reflection, a direct light, and a bias light are, and the coordinate convention.
- [ ] **Step 4: Run** `uv run pytest tests/test_glare.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: glare tracer for screen reflections and lights in the line of sight`.

---

### Task 4: Service, suggestions, and auto-fix

**Files:**
- Modify: `src/myhuey/service.py`, `src/myhuey/suggest.py`
- Test: `tests/test_glare_service.py`

**Interfaces:**
- Consumes: `glare.audit`, `glare.clamp_overrides`.
- Produces: `HueRoomService.glare(room_name: str, mode: str = "code") -> dict` (the audit); `HueRoomService.mitigate_glare(room_name: str, mode: str = "code", *, apply: bool = False, pause: float | None = None) -> dict` returning `{"caps": [{"light_id", "label", "status", "brightness": int, "kelvin": int | None}], "results": [{"light_id", "label", "ok": bool, "sent": dict, "error"?: str}]}`. Each suggestion from `suggest.suggest` gains `"glare": {light_id: status}` for lights that were capped.

- [ ] **Step 1: Write the failing tests** (fixture: the `service` of `tests/test_suggest_api_cli.py` with the monitor given `"tilt": 0`, plus a table lamp `"4"` at `x=200, y=330, elevation=115`: the screen plane is `y = 140`, the eye `(200, 190, 115)`, so lamp 4 bounces off the screen 20 cm above its center and lamps 1 to 3 do not reflect; use `FakeSession` from `conftest.py` the way `tests/test_room_controls.py` does for bridge answers):

```python
def test_suggestions_cap_a_reflecting_light(service):
    for item in service.suggest("Den", "code", at="14:00"):
        override = item["scene"]["overrides"]["4"]
        assert override["brightness"] <= 18 and 2400 <= override["white"] <= 2700 and "colors" not in override
        assert item["glare"] == {"4": "screen_reflection"}

def test_mitigate_dry_run_lists_caps_and_sends_nothing(service, session):
    result = service.mitigate_glare("Den")
    assert result["caps"] == [{"light_id": "4", "label": ANY, "status": "screen_reflection", "brightness": 18, "kelvin": 2700}]
    assert result["results"] == [] and session.calls == []

def test_mitigate_dims_and_warms_only_what_exceeds_the_cap(service, session):
    # bridge: "4" on, bri 254, ct 250 (4000 K), colormode ct
    result = service.mitigate_glare("Den", apply=True)
    assert result["results"] == [{"light_id": "4", "label": ANY, "ok": True, "sent": {"bri": 46, "ct": 370}}]

# Review Focus 5
def test_mitigate_never_brightens_and_skips_off_and_planned(service, session): ...
    # "4" on at bri 20 with ct 400 -> nothing sent, results == []; "4" off -> nothing sent;
    # a planned light placed at the reflecting spot appears in caps but never in results.
def test_one_failing_light_does_not_stop_the_rest(service, session): ...
    # two reflecting lights, the first PUT raises HueError: results[0]["ok"] is False with "error", results[1]["ok"] is True.
```

- [ ] **Step 2: Run** `uv run pytest tests/test_glare_service.py -q`. Expected: FAIL (`AttributeError: … 'glare'`).
- [ ] **Step 3: Implement.** In `suggest.suggest`: `report = audit(room, mode)` once (after `posed`), then for each palette `overrides = clamp_overrides(overrides, report["lights"])` and the `"glare"` map. `mitigate_glare`: dry run needs no bridge. With `apply`, decorate the sending path with `@_one_bridge_write` (as `set_room_brightness` does), read `client.get_lights()` once, and for each capped, real, lit light send one `client.set_light_state(light_id, sent)` where `sent` holds `"bri": max(1, round(cap * 2.54))` only if the live `bri` is higher, and `"ct": _mirek_for(2700, raw)` only if the cap has a kelvin, the live `colormode` is `"ct"`, and the live `ct` is cooler (smaller). Empty `sent`: skip the light. Pace with `self.sleep(pause)`.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass. If an older suggestion test now sees a capped light, confirm with `service.glare(...)` that the fixture's light really reflects, update that expected value, and name the test in the commit message.
- [ ] **Step 5: Commit** `feat: suggestions cap lights that reflect in the screen, and glare auto-fix dims them`.

---

### Task 5: HTTP API and CLI

**Files:**
- Modify: `src/myhuey/api.py`, `src/myhuey/cli.py`, `README.md` (CLI table, API table, a short "Glare check" section after "Eye-comfort suggestions")
- Test: `tests/test_glare_api_cli.py`

**Interfaces:**
- Consumes: Task 2 `set_posture`; Task 4 `glare`, `mitigate_glare`.
- Produces:
  - `POST /api/rooms/{room_name}/posture` body `{"posture": "seated" | "standing"}` → `room_json(room)`
  - `GET /api/rooms/{room_name}/glare?mode=code` → the audit
  - `POST /api/rooms/{room_name}/glare/mitigate` body `{"apply_to_bridge": bool = false, "mode": str = "code"}` → `{"caps", "results", "failed": int}`
  - `myhuey room posture --name R --posture seated|standing`; `myhuey room glare --name R [--mode code] [--fix]`; `myhuey furniture add … [--tilt DEG] [--standing-height LEN]`

- [ ] **Step 1: Write the failing tests** (TestClient and `main([...])` with `capsys`, as in `tests/test_suggest_api_cli.py`; for the 409, copy the race setup from the Make-active test in `tests/test_layouts_api.py`):

```python
def test_posture_endpoint(client):
    assert client.post("/api/rooms/Den/posture", json={"posture": "standing"}).json()["posture"] == "standing"
    assert client.post("/api/rooms/Den/posture", json={"posture": "prone"}).status_code == 422
    assert client.post("/api/rooms/Nope/posture", json={"posture": "seated"}).status_code == 404

def test_glare_endpoint_and_mitigate_dry_run(client):
    body = client.get("/api/rooms/Den/glare?mode=code").json()
    assert body["hazards"] == 1 and body["scene"]["eye"] and body["lights"][-1]["status"] == "screen_reflection"
    assert client.get("/api/rooms/Den/glare?mode=dance").status_code == 400
    fix = client.post("/api/rooms/Den/glare/mitigate", json={}).json()
    assert fix["results"] == [] and fix["failed"] == 0 and fix["caps"][0]["brightness"] == 18

def test_posture_is_per_layout_and_409_on_make_active_race(client, service): ...
    # With X-Myhuey-Layout: <sandbox>, posture "standing" changes the sandbox only (Active stays "seated").
    # A save that loaded before activate_layout and lands after it answers 409.

def test_cli_posture_and_glare(service_db, capsys):
    main(["--db", db, "room", "posture", "--name", "Den", "--posture", "standing"])
    assert "standing" in capsys.readouterr().out
    main(["--db", db, "room", "glare", "--name", "Den"])
    out = capsys.readouterr().out
    assert "screen_reflection" in out and "18%" in out and "2700 K" in out and "1 light needs attention" in out

def test_cli_glare_with_no_seat_says_so(empty_room_db, capsys):          # Review Focus 1
    main(["--db", db, "room", "glare", "--name", "Empty"])
    assert "No seat found" in capsys.readouterr().out

def test_cli_glare_fix_reports_what_was_sent(service_db, capsys): ...
    # bridge as in Task 4: output names the light and "46" / "2700 K"; exit code 1 when a light failed.
```

- [ ] **Step 2: Run** `uv run pytest tests/test_glare_api_cli.py -q`. Expected: FAIL (404 / argparse "invalid choice: 'posture'").
- [ ] **Step 3: Implement.** Request models `PostureRequest(Body)` with `posture: Literal["seated", "standing"]` and `MitigateRequest(Body)`; `mode` is validated by `get_mode` (its `ValueError` already maps to 400). CLI: add `"posture"` and `"glare"` to the `room` action choices with `--posture`, `--mode`, `--fix`; one line per light: label, status, angle, cap as `≤ 18%` and `≤ 2700 K`. `--tilt` and `--standing-height` (through `parse_length`) on `furniture add`.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: glare check and posture over HTTP and the CLI`.

---

### Task 6: TypeScript tracer and shared vectors

**Files:**
- Create: `frontend/src/lib/glareMath.ts`, `frontend/src/lib/glareMath.test.ts`, `scripts/build_glare_vectors.py`, `tests/data/glare_vectors.json`, `tests/test_glare_vectors.py`
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`

**Interfaces:**
- Consumes: Task 3 `scene_of`, `trace`; Task 5 routes.
- Produces (TS): types `GlareScene`, `GlareLight`, `GlareReport`, `GlareStatus`, `GlareAudit = GlareReport & { room: string; mode: string; posture: Posture; scene: GlareScene }`; `traceGlare(scene: GlareScene): GlareReport`; `moveLight(scene: GlareScene, lightId: string, dx: number, dy: number): GlareScene` (shifts every point of that light; returns a new scene); `api.setPosture(name, posture)`, `api.glare(name, mode)`, `api.mitigateGlare(name, mode, apply)`.
- Produces (vectors): `tests/data/glare_vectors.json` = `[{"name": str, "scene": GlareScene, "expected": trace(scene)}]`.

- [ ] **Step 1: Write `scripts/build_glare_vectors.py`**: builds the rooms from `tests/test_glare.py` (import its `_room` cases; add a tilted-screen case at `tilt=-12`, a rotated-screen case at `rotation=30`, a 2 m strip, and the no-seat room), writes `[{name, scene, expected}]` with `json.dumps(..., indent=1, sort_keys=True)`. Run it: `uv run python scripts/build_glare_vectors.py`.
- [ ] **Step 2: Write `tests/test_glare_vectors.py`**: the file on disk equals what the script would write now (so a tracer change without regenerating fails), and there are at least 8 cases covering every status.
- [ ] **Step 3: Write the failing TS test** in `glareMath.test.ts` (read the JSON with `node:fs` as `frontend/src/lib/themeCss.test.ts` does):

```ts
describe('traceGlare matches the Python tracer', () => {
  for (const item of vectors) it(item.name, () => expect(traceGlare(item.scene)).toEqual(item.expected));
});
it('moveLight shifts a copy and leaves the scene alone', () => {
  const scene = vectors.find((v) => v.name === 'reflection')!.scene;
  const moved = moveLight(scene, 'back', 200, 0);
  expect(scene.lights[0].points[0]).toEqual([200, 300, 115]);
  expect(moved.lights[0].points[0]).toEqual([400, 300, 115]);
  expect(traceGlare(moved).lights[0].status).toBe('clear');   // bounce lands 45.7 cm right of center, past 30 + 8
});
it('every coordinate it reports is a finite number', () => {   // Review Focus 3
  for (const item of vectors)
    for (const light of traceGlare(item.scene).lights)
      for (const hazard of light.hazards) expect(hazard.path.flat().every(Number.isFinite)).toBe(true);
});
```

- [ ] **Step 4: Run** `npm --prefix frontend test -- glareMath`. Expected: FAIL (cannot resolve `./glareMath`).
- [ ] **Step 5: Implement `glareMath.ts`** as a line-for-line port of `glare.trace` (same constants, same order of checks, and the same `_round` rule from Task 3). Add the three `api` methods; `mitigateGlare` and `glare` take the usual trailing `activeOnly = false`.
- [ ] **Step 6: Run** `uv run pytest -q` and `npm --prefix frontend test` and `npm --prefix frontend run typecheck`. Expected: all pass, no type errors.
- [ ] **Step 7: Commit** `feat: glare tracer in the browser, checked against the Python tracer's vectors`.

---

### Task 7: Studio UI

**Files:**
- Create: `frontend/src/components/GlarePanel.tsx`, `frontend/src/components/GlareOverlay.tsx`, `frontend/src/lib/glareView.ts`, `frontend/src/lib/glareView.test.ts`
- Modify: `frontend/src/views/RoomDesigner.tsx` (room panel: posture; furniture panel: tilt and standing height; plan stage: overlay; side column: glare panel), `frontend/src/styles.css`, `README.md` (Studio section)

**Interfaces:**
- Consumes: Task 6 `traceGlare`, `moveLight`, `api.glare`, `api.setPosture`, `api.mitigateGlare`.
- Produces (`glareView.ts`, pure): `STATUS_LABELS: Record<GlareStatus, string>` = `{ screen_reflection: 'Reflects in the screen', direct_fov: 'In your line of sight', peripheral_warn: 'At the edge of your view', bias_ok: 'Bias light', clear: 'Clear' }`; `statusTone(status): 'danger' | 'warn' | 'ok' | 'muted'`; `capText(cap): string` (`'Keep at 18% or less, 2700 K or warmer'`, `'Keep at 15% or less'`, `''`); `rays(report): { lightId: string; tone: 'danger' | 'warn'; points: Pt[] }[]` (each hazard's path dropped to plan x, y); `summary(report): string` (`'No glare found'`, `'1 light needs attention'`, `'3 lights need attention'`).

- [ ] **Step 1: Write the failing tests** in `glareView.test.ts`: `capText` for the three caps above; `summary` for 0, 1, 3; `rays` on the `reflection` vector returns one danger ray `[[200, 300], [200, 101], [200, 160]]`; `statusTone` maps reflection and direct to `danger`, peripheral to `warn`, bias to `ok`, clear to `muted`.
- [ ] **Step 2: Run** `npm --prefix frontend test -- glareView`. Expected: FAIL.
- [ ] **Step 3: Implement `glareView.ts`; run the test; expected PASS.**
- [ ] **Step 4: Build the components.**
  - `GlarePanel({ room, audit, mode, onMode, onFix })`: a `Panel title="Glare check"` with a mode `Segmented` (Code, Work, Study, Read, Relax from `MODE_LABELS`), `summary(report)`, one row per light that is not `clear` (label, a badge with `STATUS_LABELS` in `statusTone`, the angle, `capText`), and a "Dim these lights" button that calls `api.mitigateGlare(room.name, mode, true)` and toasts how many lights changed. Disable the button, with the same hint `SuggestPanel` uses for Preview on lights, wherever that panel disables sending to the lights (read how it treats an open sandbox and follow it). When `audit.scene.eye` is null: "Add a desk or a screen and MyHuey can check for glare from where you sit."
  - `GlareOverlay({ report, scene })`: inside the plan SVG (it uses `usePlan()` for `cmPerPx` like `OpeningsLayer`): an eye marker at `scene.eye`, a polyline per `rays(report)` entry (`stroke: var(--danger)` or `var(--warn)`, dashed, `vector-effect: non-scaling-stroke`, `aria-hidden`), and a ring in the status tone around each flagged light.
  - `RoomDesigner`: load `api.glare(room.name, mode)` when the room or mode changes and after each save; while a light is being dragged, show `traceGlare(moveLight(audit.scene, id, dx, dy))` so rays follow the pointer without a request. Room panel: `Segmented label="Posture"` (Seated, Standing) → `api.setPosture` then refresh. Furniture panel: for a `display`, a tilt number input (−45 to 45, step 1, hint "Negative leans the top back"); for desks, a `LengthInput label="Height when standing"` that can be cleared.
  - Colors come from existing theme tokens; check the badge text against `frontend/src/lib/themeCss.test.ts`'s contrast rule (4.5:1 in every theme) and add the new tone classes to that test's list if it enumerates classes.
- [ ] **Step 5: Verify.** `npm --prefix frontend test`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`: all clean. Then by hand, on a **copy** of the database (`cp ~/.myhuey/myhuey.db <scratch>/glare.db; myhuey --db <scratch>/glare.db serve --port 8001`): open `#/studio/room/Office`, confirm the panel lists the Office lights, drag a light and watch the rays move, toggle posture, and confirm the 27" at 120° produces no reflection ray. Do not press "Dim these lights" on the copy unless the owner asks: it writes to the real bridge.
- [ ] **Step 6: Commit** `feat: glare check on the room plan, with posture and screen tilt` (include `static/app` only if `git ls-files static` shows it is tracked), then `docs: glare check, posture, and screen tilt in the README`.
