# Assistant Skills and MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `myhuey mcp` gives any AI assistant tools to read the home, design a scene, and build a room layout in a sandbox, and a `skills/` folder teaches it how, so a person can describe a light theme or a layout in plain words and get it.

**Architecture:** Tool functions are plain Python over `HueRoomService` in `assistant.py` (rules such as "sandbox only" live there), with the room drawing and layout checks as pure functions in `room_text.py`. `mcp_server.py` only registers those functions with the MCP SDK and turns expected errors into messages the model can read. Skills are Markdown files in `skills/`; a loader serves the same text through a `guide` tool and MCP prompts.

**Tech Stack:** Python 3.11+, the existing service layer, argparse, pytest; the official `mcp` SDK pinned at 2.3.0 (`MCPServer`, not 1.x's `FastMCP`); React and vitest for one small web-app change.

**Spec:** `docs/superpowers/specs/2026-11-16-assistant-skills-design.md`. Read its "Checked against `mcp` 2.3.0" section before Task 6.

## Global Constraints

- Branch: work on `feat/room-3d-view` (it holds the Help page and Settings this extends).
- MyHuey ships and calls no language model. No API key field, no account, no request to the internet.
- Tool inputs and outputs are centimetres in plan coordinates (x right, y down from the room's origin), heights off the floor. A length argument may be a number (cm) or a string with a unit (`"12ft"`, `"3.8m"`, `"380cm"`); a string that is only digits is cm.
- Layout-writing tools refuse the active layout. Only `apply_scene`, `room_power`, and `room_dim` send anything to the bridge. No tool returns the bridge username or the raw document.
- No tool deletes from the active layout, deletes a scene, deletes a layout, activates a sandbox, or touches pairing.
- `myhuey mcp` writes nothing to stdout except protocol messages.
- One new dependency, pinned exactly: `mcp==2.3.0`.
- Tests use a temporary database (`db_path` fixture) and the fake bridge from `tests/conftest.py`. Never create rooms in the owner's real database; real-light checks only in the Office, restoring the lights afterwards.
- Baseline to keep green: `uv run pytest -q` 515 passed; `npm --prefix frontend test` 456 passed.
- Commits: conventional prefixes, **no AI co-author or attribution trailer**.

## Review Focus

1. A layout-writing tool given the active layout (by name, by id, or with no layout at all), or a layout that does not exist: refused with a sentence that says to call `create_sandbox` first. Nothing is written. (Task 4)
2. A scene naming a light that is not in the room, or with a colour that is not a colour: an error that names the light and the value; nothing saved, nothing sent. (Task 3)
3. `apply_scene`, `room_power`, `room_dim`, and `list_lights` with no bridge paired or a bridge that does not answer: a plain sentence, never a traceback; planned lights are skipped and reported as planned. (Tasks 1, 3)
4. Lengths as people write them: `"12ft"`, `"3.8m"`, `"12' 6\""`, `350`, `"350"` work; `"big"`, `-5`, and `0` give a message with examples. (Task 4)
5. Nothing but protocol on stdout, and service errors reach the model as their own message: a `LayoutChanged` raised mid-call (the app activated a sandbox) arrives as a readable tool error. (Task 6)

---

### Task 1: Tool foundations and the reading tools

**Files:**
- Create: `src/myhuey/assistant.py`, `src/myhuey/room_view.py`
- Modify: `src/myhuey/api.py` (import `room_json` from `room_view.py` instead of defining it), `src/myhuey/models.py` (`FURNITURE_SIZES`)
- Test: `tests/test_assistant_read.py`

**Interfaces:**
- Produces, in `models.py`: `FURNITURE_SIZES: dict[str, tuple[str, float, float, str]]`, kind → (label, width, depth, shape), the same rows as `FURNITURE_CATALOG` in `frontend/src/components/Shapes.tsx`.
- Produces, in `room_view.py`: `room_json(room: Room) -> dict` moved unchanged from `api.py`.
- Produces, in `assistant.py`:
  - `class Refused(ValueError)` for "this tool will not do that" answers.
  - `in_layout(service, layout: str | None)`: a context manager that opens the named layout (name or id, through `service.resolve_layout` and `service.sandbox_id`) for the block; `None` is the active layout.
  - `cm(value: float | int | str, what: str) -> float`: the length rule from Global Constraints; raises `ValueError(f'{what}: cannot read "{value}". Use a number of centimetres, or a length such as 12ft, 3.8m, or 380cm.')`; values `<= 0` raise the same message.
  - `list_rooms(service, layout=None) -> list[dict]`: `name, width, depth, ceiling, units, lights, has_desk, has_screen`.
  - `get_room(service, room, layout=None) -> dict`: `room_json(room)` without `photo`.
  - `list_lights(service) -> dict`: `{"bridge": "ok" | "not paired" | "not answering", "detail": str, "lights": [{"id", "name", "on", "brightness" (percent), "color", "kelvin", "reachable", "product", "rooms": [names]}]}`.
  - `list_scenes(service, room=None, layout=None) -> list[dict]`: `id, name, room, lights` (count of overrides).
  - `list_layouts(service) -> list[dict]`: `id, name, active, rooms, scenes`.
  - `catalog() -> dict`: `{"furniture": [{"kind", "label", "width", "depth", "shape", "elevation", "height"}], "lights": [CatalogItem.to_dict()]}`.
  - `suggest(service, room, mode, at=None, layout=None) -> list[dict]`: per suggestion `name, kelvin, roles, lights` where `lights` is the scene's overrides.

- [ ] **Step 1: Write the failing tests** in `tests/test_assistant_read.py`. Fixture `service`: as in `tests/test_suggest_api_cli.py` (room "Den" 400 × 400 with a desk, a `monitor-27`, lights "1", "2", "3"), plus `fake_bridge(LIGHTS)` where a test needs the bridge.

```python
def test_list_and_get_room(service):
    (den,) = list_rooms(service)
    assert den == {"name": "Den", "width": 400, "depth": 400, "ceiling": 244.0, "units": ANY, "lights": 3, "has_desk": True, "has_screen": True}
    room = get_room(service, "den")                       # names are matched ignoring case
    assert "photo" not in room and room["lights"][0]["resolved_roles"]["desk"] in ("task", "bias", "view", "behind", "ambient")
    with pytest.raises(RoomNotFound): get_room(service, "Garage")

def test_catalog_matches_the_web_app():
    rows = re.findall(r"\{ kind: '([\w-]+)', label: '([^']+)', width: (\d+), depth: (\d+)(?:, shape: '(\w+)')? \}", Path("frontend/src/components/Shapes.tsx").read_text())
    assert {kind: (label, float(w), float(d), shape or "rect") for kind, label, w, d, shape in rows} == FURNITURE_SIZES
    desk = next(item for item in catalog()["furniture"] if item["kind"] == "desk")
    assert desk == {"kind": "desk", "label": "Desk", "width": 140.0, "depth": 70.0, "shape": "rect", "elevation": 0, "height": 75}
    assert {item["id"] for item in catalog()["lights"]} >= {"gradient-strip", "desk-lamp"}

@pytest.mark.parametrize("value, expected", [(350, 350), ("350", 350), ("12ft", 365.76), ("3.8m", 380), ("12' 6\"", 381)])
def test_cm_reads_lengths(value, expected): assert cm(value, "Width") == pytest.approx(expected)

@pytest.mark.parametrize("value", ["big", -5, 0, "", None])
def test_cm_refuses_nonsense(value):
    with pytest.raises(ValueError, match="Use a number of centimetres, or a length such as 12ft"): cm(value, "Width")

def test_lights_with_no_bridge_or_a_silent_one(db_path, fake_bridge):       # Review Focus 3
    assert list_lights(HueRoomService(db_path)) == {"bridge": "not paired", "detail": ANY, "lights": []}
    # paired, bridge raising BridgeUnreachable: {"bridge": "not answering", ...}; paired and answering: 3 lights,
    # brightness as a percent, and "rooms": ["Den"] for light "1".

def test_layout_scope_and_secrets(service):
    sandbox = service.new_layout("Try")
    with in_layout(service, "try"): service.add_room("Loft", 300, 300)
    assert [r["name"] for r in list_rooms(service)] == ["Den"]
    assert {r["name"] for r in list_rooms(service, layout=sandbox["id"])} == {"Loft"}
    with pytest.raises(LayoutNotFound): list_rooms(service, layout="nope")
    assert USERNAME not in json.dumps([list_rooms(service), get_room(service, "Den"), list_layouts(service), list_scenes(service), catalog()])

def test_suggest_returns_overrides_per_light(service):
    first = suggest(service, "Den", "code", at="14:00")[0]
    assert set(first["lights"]) == {"1", "2", "3"} and first["kelvin"] > 2000
```

- [ ] **Step 2: Run** `uv run pytest tests/test_assistant_read.py -q`. Expected: FAIL (`No module named 'myhuey.assistant'`).
- [ ] **Step 3: Implement.** Move `room_json` to `room_view.py`. Room names resolve ignoring case through one helper, `_room_name(service, room) -> str`, which raises `RoomNotFound` with the rooms that exist. `list_lights` catches `BridgeNotConfigured` and `BridgeUnreachable`/`HueError` and reports them in `bridge` and `detail`.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass (515 + new).
- [ ] **Step 5: Commit** `feat: assistant tools that read the home`.

---

### Task 2: A text drawing of a room, and layout checks

**Files:**
- Create: `src/myhuey/room_text.py`
- Modify: `src/myhuey/assistant.py`
- Test: `tests/test_room_text.py`

**Interfaces:**
- Consumes: `placement.covers`, `placement.resolved_elevation`, `geometry.point_in_polygon`, `roles.find_focus`, `roles._front`.
- Produces, in `room_text.py`:
  - `draw_room(room: Room, cell: float | None = None) -> dict`: `{"drawing": str, "cm_per_column": float, "cm_per_row": float, "legend": [{"mark", "what", "name", "x", "y"}], "openings": [str]}`.
  - `layout_problems(room: Room) -> list[dict]`: each `{"kind", "item", "message"}`, `kind` one of `outside`, `overlap`, `screen_off_desk`, `screen_faces_wall`, `no_seat`, `height_unknown`.
- Produces, in `assistant.py`: `describe_room(service, room, layout=None) -> dict` and `check_layout(service, room, layout=None) -> dict` (`{"ok": bool, "problems": [...]}`).

**The drawing (the signature and test do not determine it):** a column is `cell` cm wide and a row is `2 * cell` cm tall, because characters are about twice as tall as wide. `cell` defaults to the smallest of 5, 10, 20, 25, 50, 100 that fits the room's bounding box in 72 columns. Each character is decided by the point at its cell's centre: outside the outline is a space; inside is `.`; a piece of furniture covering the point is its letter (`A`, `B`, … in the room's furniture order; rugs are skipped); the cell containing a light's centre is that light's lowercase letter (`a`, `b`, … in order), drawn over anything else. Trailing spaces are stripped from each row. Doors and windows are not drawn; `openings` lists them as sentences ("Window on wall 0 (north side), 100 cm from its start, 90 cm wide, sill 90 cm, top 210 cm").

**The checks:**
- `outside`: a light's centre, or a furniture piece's centre or any corner, more than 2 cm outside the outline.
- `overlap`: two non-rug pieces whose height ranges overlap and where one covers the other's centre or a corner.
- `screen_off_desk`: a monitor or TV whose centre no desk covers (TVs only when the room has a desk).
- `screen_faces_wall`: a monitor whose seat point (its centre plus 60 cm along its front) is outside the outline.
- `no_seat`: `find_focus(room, "desk")` is `None`.
- `height_unknown`: a light with no height set whose product gives no default (its `resolved_elevation` is `placement.UNKNOWN_CM` and its archetype is in none of `placement`'s sets).

- [ ] **Step 1: Write the failing tests** in `tests/test_room_text.py`:

```python
def _room(furniture=(), lights=(), outline=((0, 0), (200, 0), (200, 100), (0, 100))):
    return Room.from_dict({"name": "R", "outline": [list(p) for p in outline], "furniture": list(furniture),
                           "lights": [{"light_id": i, "label": i, "x": x, "y": y, **more} for i, x, y, more in lights]})

def test_draws_furniture_and_lights_to_scale():
    desk = {"id": "d", "kind": "desk", "label": "Desk", "x": 100, "y": 35, "width": 100, "depth": 40}
    result = draw_room(_room([desk], [("9", 100, 90, {})]), cell=10)
    assert result["drawing"].split("\n") == [
        "....................",
        ".....AAAAAAAAAA.....",
        ".....AAAAAAAAAA.....",
        "....................",
        "..........a.........",
    ]
    assert (result["cm_per_column"], result["cm_per_row"]) == (10, 20)
    assert result["legend"] == [{"mark": "A", "what": "desk", "name": "Desk", "x": 100, "y": 35},
                                {"mark": "a", "what": "light", "name": "9", "x": 100, "y": 90}]

def test_l_shaped_room_leaves_the_notch_blank_and_picks_a_cell_that_fits():
    room = _room(outline=((0, 0), (400, 0), (400, 200), (200, 200), (200, 400), (0, 400)))
    result = draw_room(room)
    rows = result["drawing"].split("\n")
    assert max(len(row) for row in rows) <= 72 and result["cm_per_column"] == 10
    assert rows[-1] == "." * 20            # the bottom rows are only the left half; trailing blanks stripped

def test_openings_are_listed_in_words():
    room = Room.from_dict({"name": "R", "openings": [{"kind": "window", "edge": 0, "offset": 100, "width": 90}]})
    assert draw_room(room)["openings"] == ["Window on wall 0 (north side), 100 cm from its start, 90 cm wide, sill 90 cm, top 210 cm"]

def test_each_problem_kind_is_reported_with_its_item():
    desk = {"id": "d", "kind": "desk", "label": "Desk", "x": 100, "y": 50, "width": 100, "depth": 40}
    cases = {
        "outside": _room([{**desk, "x": 190}]),
        "overlap": _room([desk, {**desk, "id": "d2", "x": 120}]),
        "screen_off_desk": _room([desk, {"id": "m", "kind": "monitor-27", "x": 20, "y": 80, "width": 61, "depth": 20}]),
        "screen_faces_wall": _room([desk, {"id": "m", "kind": "monitor-27", "x": 100, "y": 60, "width": 61, "depth": 20}]),   # seat at y = 120, past the wall
        "no_seat": _room([{"id": "s", "kind": "bookshelf", "x": 50, "y": 50, "width": 90, "depth": 30}]),
        "height_unknown": _room([desk], [("1", 20, 20, {"product": {"archetype": "mystery"}})]),
    }
    for kind, room in cases.items():
        assert kind in {p["kind"] for p in layout_problems(room)}, kind
        assert all(p["message"] and "item" in p for p in layout_problems(room))

def test_a_sound_room_has_no_problems():
    desk = {"id": "d", "kind": "desk", "label": "Desk", "x": 100, "y": 30, "width": 100, "depth": 40}
    monitor = {"id": "m", "kind": "monitor-27", "x": 100, "y": 20, "width": 61, "depth": 20}       # on the desk; seat at y = 80, inside
    assert layout_problems(_room([desk, monitor], [("1", 100, 12, {"elevation": 75})])) == []
```

- [ ] **Step 2: Run** `uv run pytest tests/test_room_text.py -q`. Expected: FAIL (`No module named 'myhuey.room_text'`).
- [ ] **Step 3: Implement `room_text.py`** and the two thin functions in `assistant.py`. Wall sides in opening sentences come from the wall's outward direction ("north" is toward smaller y).
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: a text drawing of a room and layout checks for assistants`.

---

### Task 3: Scene tools

**Files:**
- Modify: `src/myhuey/assistant.py`
- Test: `tests/test_assistant_scenes.py`

**Interfaces:**
- Consumes: `service.preview_scene`, `service.save_scene`, `service.get_scene`, `service.apply_scene_object`, `service.set_room_power`, `service.set_room_brightness`; `scenes.Scene.from_dict`.
- Produces, in `assistant.py` (`lights` is `{light_id: {"colors": [hex, ...] | "white": kelvin, "brightness": 1-100, "on": bool}}`; `others` is `"keep"` or `"off"`):
  - `preview_scene(service, room, name, lights, others="keep", layout=None) -> dict`: `{"scene": {"name", "room"}, "lights": [{"id", "name", "on", "color", "kelvin", "brightness", "gradient", "planned", "changed": bool}], "saved": False, "sent": False}`.
  - `save_scene(service, room, name, lights, others="keep", scene_id=None, layout=None) -> dict`: `{"id", "name", "room", "saved": True, "sent": False}`.
  - `apply_scene(service, scene=None, room=None, name=None, lights=None, others="keep", layout=None) -> dict`: a saved scene by id or name in `scene`, or an unsaved one from `room`/`name`/`lights`. `{"scene", "room", "sent": True, "lights": [{"id", "name", "applied": bool, "planned": bool, "error"?: str}], "failed": int}`.
  - `room_power(service, room, on, layout=None) -> dict`, `room_dim(service, room, percent, layout=None) -> dict`: `{"room", "lights": [{"id", "name", "ok", "error"?}], "failed": int}`.
  - `CHANGES_LIGHTS = ("apply_scene", "room_power", "room_dim")`.

- [ ] **Step 1: Write the failing tests** (fixture `service` from Task 1 with `fake_bridge(LIGHTS)`; the returned session records calls):

```python
THEME = {"1": {"white": 2700, "brightness": 30}, "3": {"colors": ["#14b8a6"], "brightness": 15}}

def test_preview_shows_every_light_and_changes_nothing(service, session):
    result = preview_scene(service, "Den", "Calm", THEME)
    by = {light["id"]: light for light in result["lights"]}
    assert (by["1"]["kelvin"], by["1"]["brightness"], by["1"]["changed"]) == (2700, 30.0, True)
    assert by["3"]["color"] == "#14b8a6" and by["2"]["changed"] is False        # not mentioned: kept as it is
    assert (result["saved"], result["sent"]) == (False, False)
    assert service.scenes() == [] and session.calls == []

def test_others_off_turns_the_rest_off(service):
    by = {l["id"]: l for l in preview_scene(service, "Den", "Calm", THEME, others="off")["lights"]}
    assert by["2"]["on"] is False

def test_save_then_replace_by_id(service, session):
    saved = save_scene(service, "Den", "Calm", THEME)
    again = save_scene(service, "Den", "Calmer", THEME, scene_id=saved["id"])
    assert again["id"] == saved["id"] and [s.name for s in service.scenes()] == ["Calmer"] and session.calls == []

def test_apply_sends_and_reports_each_light(service, session):
    result = apply_scene(service, room="Den", name="Calm", lights=THEME)
    assert result["sent"] is True and result["failed"] == 0
    assert {l["id"] for l in result["lights"] if l["applied"]} == {"1", "3"}
    saved = save_scene(service, "Den", "Calm", THEME)
    assert apply_scene(service, scene="calm")["scene"] == "Calm" and apply_scene(service, scene=saved["id"])["failed"] == 0

# Review Focus 2
@pytest.mark.parametrize("lights, words", [
    ({"99": {"white": 2700}}, 'light "99" is not in Den'),
    ({"1": {"colors": ["teal"]}}, 'light "1"'),
    ({"1": {"white": 9000}}, 'light "1"'),
    ({"1": {"brightness": 400, "white": 2700}}, 'light "1"'),
    ({}, "no lights"),
])
def test_a_bad_scene_names_the_light_and_saves_nothing(service, session, lights, words):
    for call in (preview_scene, save_scene):
        with pytest.raises(ValueError, match=re.escape(words)): call(service, "Den", "Bad", lights)
    assert service.scenes() == [] and session.calls == []

# Review Focus 3
def test_apply_without_a_bridge_says_so(db_path):
    service = HueRoomService(db_path); service.add_room("Den", 400, 400); service.assign_light("Den", "1", x=100, y=100)
    with pytest.raises(BridgeNotConfigured): apply_scene(service, room="Den", name="Calm", lights={"1": {"white": 2700, "brightness": 30}})
def test_planned_lights_are_previewed_and_never_sent(service, session):
    planned = service.add_planned_light("Den", "desk-lamp", x=100, y=100)
    result = apply_scene(service, room="Den", name="Calm", lights={planned.light_id: {"white": 3000, "brightness": 40}})
    (light,) = [l for l in result["lights"] if l["id"] == planned.light_id]
    assert light["planned"] is True and light["applied"] is False and result["failed"] == 0
def test_power_and_dim(service, session):
    assert room_power(service, "Den", False)["failed"] == 0
    assert room_dim(service, "Den", 30)["room"] == "Den"
    with pytest.raises(ValueError): room_dim(service, "Den", 0)
```

- [ ] **Step 2: Run** `uv run pytest tests/test_assistant_scenes.py -q`. Expected: FAIL (`cannot import name 'preview_scene'`).
- [ ] **Step 3: Implement.** One private `_scene(service, room, name, lights, others, scene_id)` builds the `Scene` (`base_mode` `"keep"` or `"off"`, `overrides` from `lights`), after checking each light id is in the room and catching the override's own `ValueError` to prefix it with `light "<id>": `. An empty `lights` with `others="keep"` raises `ValueError("This scene has no lights. Give at least one light a colour or a white.")`. `apply_scene` requires exactly one of `scene` or (`room` and `lights`).
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: assistant tools to preview, save, and apply a scene`.

---

### Task 4: Layout tools, in a sandbox only

**Files:**
- Modify: `src/myhuey/assistant.py`, `frontend/src/lib/layout.ts`, `frontend/src/store.ts` (`load`), `frontend/src/lib/layout.test.ts`
- Test: `tests/test_assistant_layouts.py`

**Interfaces:**
- Consumes: `service.new_layout`, `service.add_room`, `service.update_room`, `service.remove_room`, `service.assign_light`, `service.add_planned_light`, `service.remove_light`; Task 1 `in_layout`, `cm`, `FURNITURE_SIZES`; Task 2 `check_layout`.
- Produces, in `assistant.py` (every one takes `layout` first and runs inside `sandbox(service, layout)`):
  - `sandbox(service, layout)`: like `in_layout`, but raises `Refused("Layouts are built in a sandbox, never in the active home. Call create_sandbox first, then pass its id as layout.")` when `layout` is missing or is the active layout.
  - `create_sandbox(service, name=None, copy_from=None) -> dict`: `copy_from` is `None` (empty), `"active"`, or a layout name or id. `{"id", "name", "rooms": [names]}`.
  - `add_room(service, layout, name, width=None, depth=None, outline=None, ceiling=None, units=None) -> dict` (the `get_room` shape).
  - `update_room(service, layout, room, width=None, depth=None, outline=None, ceiling=None) -> dict`.
  - `remove_room(service, layout, room) -> dict`: `{"removed": name}`.
  - `set_openings(service, layout, room, openings: list[dict]) -> dict`: each `{"kind": "door" | "window", "wall": int, "offset", "width", "sill"?, "top"?}`.
  - `set_furniture(service, layout, room, furniture: list[dict]) -> dict`: each `{"kind", "x", "y", "rotation"?, "label"?, "width"?, "depth"?, "elevation"?, "height"?}`; missing width, depth, shape, and label come from `FURNITURE_SIZES`.
  - `place_light(service, layout, room, x, y, light_id=None, catalog=None, rotation=None, height=None, length=None, role=None, label=None) -> dict`: exactly one of `light_id` (a paired light, or an id already placed, which moves it) and `catalog`.
  - `remove_light(service, layout, room, light_id) -> dict`.
  - `open_in_app(service, layout, room, app_url="http://127.0.0.1:8000") -> dict`: `{"url": f"{app_url}/?layout={id}#/studio/room/{quoted room}/3d", "answering": bool, "note": str}`; `_app_answers(app_url) -> bool` does the two-second health check.
  - `WRITES_LAYOUT`: the tuple of the seven layout-writing tool names (everything above except `create_sandbox` and `open_in_app`).
  - Returns: `add_room`, `update_room`, `set_openings`, and `set_furniture` return the room in the `get_room` shape; `place_light` returns the light's placement (`LayoutLight.to_dict()`, so it has `light_id`); `remove_light` returns `{"removed": light_id}`. Two pieces count as overlapping in `check_layout` only when their height ranges truly overlap, so a monitor standing on a desk is fine.
- Produces, TS: `layoutFromUrl(search: string): string | null` in `lib/layout.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/test_assistant_layouts.py`:

```python
def test_build_a_room_from_a_description(service):
    box = create_sandbox(service, "Office idea")
    room = add_room(service, box["id"], "Office", width="12ft", depth="14ft", ceiling="8ft", units="imperial")
    assert (room["width"], room["height"], room["ceiling"], room["units"]) == (365.76, 426.72, 243.84, "imperial")
    set_openings(service, box["id"], "Office", [{"kind": "window", "wall": 0, "offset": 100, "width": 90}])
    out = set_furniture(service, box["id"], "Office", [{"kind": "desk", "x": 183, "y": 45}, {"kind": "monitor-27", "x": 183, "y": 30}])
    desk, monitor = out["furniture"]
    assert (desk["width"], desk["depth"], desk["height"], desk["label"]) == (140, 70, 75, "Desk") and monitor["elevation"] == 75
    lamp = place_light(service, box["id"], "Office", 330, 60, catalog="floor-lamp")
    place_light(service, box["id"], "Office", 300, 80, light_id=lamp["light_id"])          # the same light again: it moves
    assert [(l["x"], l["y"]) for l in get_room(service, "Office", layout=box["id"])["lights"]] == [(300, 80)]
    assert check_layout(service, "Office", layout=box["id"])["ok"] is True
    assert service.list_rooms() == ["Den"]                                                 # the active home is untouched

def test_corrections_inside_the_sandbox(service):
    box = create_sandbox(service, copy_from="active")
    assert box["rooms"] == ["Den"]
    assert update_room(service, box["id"], "Den", width="12ft", depth="15ft")["height"] == 457.2
    assert remove_light(service, box["id"], "Den", "2")["removed"] == "2"
    assert remove_room(service, box["id"], "Den") == {"removed": "Den"}
    assert service.list_rooms() == ["Den"] and len(service.get_room("Den").lights) == 3

# Review Focus 1
@pytest.mark.parametrize("layout", [None, "", "ACTIVE-ID", "My home", "nope"])
def test_layout_writers_refuse_anything_but_a_sandbox(service, layout):
    active = next(l for l in service.layouts() if l["active"])
    layout = active["id"] if layout == "ACTIVE-ID" else active["name"] if layout == "My home" else layout
    calls = [lambda: add_room(service, layout, "X", width=300, depth=300), lambda: update_room(service, layout, "Den", ceiling=260),
             lambda: remove_room(service, layout, "Den"), lambda: set_furniture(service, layout, "Den", []),
             lambda: set_openings(service, layout, "Den", []), lambda: place_light(service, layout, "Den", 10, 10, catalog="go"),
             lambda: remove_light(service, layout, "Den", "1")]
    before = service.get_room("Den").to_dict()
    for call in calls:
        with pytest.raises((Refused, LayoutNotFound), match="create_sandbox|layout"): call()
    assert service.get_room("Den").to_dict() == before
def test_the_refusal_says_what_to_do(service):
    with pytest.raises(Refused, match="Call create_sandbox first, then pass its id as layout"): add_room(service, None, "X", width=300, depth=300)

# Review Focus 4
@pytest.mark.parametrize("width", ["big", -5, 0])
def test_bad_lengths_get_examples(service, width):
    box = create_sandbox(service)
    with pytest.raises(ValueError, match="12ft, 3.8m, or 380cm"): add_room(service, box["id"], "X", width=width, depth=300)

def test_place_light_needs_one_of_light_or_catalog(service):
    box = create_sandbox(service, copy_from="active")
    for kwargs in ({}, {"light_id": "1", "catalog": "go"}):
        with pytest.raises(ValueError, match="light_id or catalog"): place_light(service, box["id"], "Den", 10, 10, **kwargs)
    with pytest.raises(ValueError, match="Unknown catalog item"): place_light(service, box["id"], "Den", 10, 10, catalog="disco-ball")
    with pytest.raises(ValueError, match="Unknown furniture kind 'throne'"): set_furniture(service, box["id"], "Den", [{"kind": "throne", "x": 10, "y": 10}])

def test_open_in_app_gives_a_link_and_says_whether_the_app_is_up(service, monkeypatch):
    box = create_sandbox(service, copy_from="active")
    monkeypatch.setattr("myhuey.assistant._app_answers", lambda url: False)
    result = open_in_app(service, box["id"], "Den", app_url="http://homeserver:8000/")
    assert result["url"] == f"http://homeserver:8000/?layout={box['id']}#/studio/room/Den/3d"
    assert result["answering"] is False and "myhuey serve" in result["note"] and "--app-url" in result["note"]

def test_nothing_reaches_the_bridge(service, session):
    box = create_sandbox(service, copy_from="active")
    update_room(service, box["id"], "Den", ceiling=260); set_furniture(service, box["id"], "Den", []); check_layout(service, "Den", layout=box["id"])
    assert session.calls == [] and session.clip_calls == []
```

In `frontend/src/lib/layout.test.ts` add:

```ts
it('reads a sandbox to open from the address, and ignores junk', () => {
  expect(layoutFromUrl('?layout=ab12cd34ef56')).toBe('ab12cd34ef56');
  expect(layoutFromUrl('?v=3&layout=ab12')).toBe('ab12');
  for (const search of ['', '?layout=', '?layout=../x', '?other=1']) expect(layoutFromUrl(search)).toBeNull();
});
```

- [ ] **Step 2: Run** `uv run pytest tests/test_assistant_layouts.py -q` and `npm --prefix frontend test -- layout`. Expected: FAIL (missing names).
- [ ] **Step 3: Implement the tools.** `set_furniture` raises `ValueError(f"Unknown furniture kind '{kind}'. See catalog.")` for a kind not in `FURNITURE_SIZES` (so a typo cannot become a 60 cm "custom" box). `set_openings` maps `wall` to the model's `edge`. `update_room` with `width`/`depth` stretches the outline as the API does. A room name is trimmed and capped as `service.add_room` does.
- [ ] **Step 4: Implement the web-app side.** `layoutFromUrl` accepts only `[A-Za-z0-9_-]{1,64}`. In `store.ts` `load()`, after the first load, if `layoutFromUrl(location.search)` is set, call `openLayout(id)` and remove the parameter with `history.replaceState` (keeping the hash). A sandbox that no longer exists falls through the existing "layout gone" handling.
- [ ] **Step 5: Run** `uv run pytest -q`, `npm --prefix frontend test`, `npm --prefix frontend run typecheck`. Expected: all pass, no type errors.
- [ ] **Step 6: Commit** `feat: assistant tools that build a room layout in a sandbox`.

---

### Task 5: The skills, and the loader that serves them

**Files:**
- Create: `skills/README.md`, `skills/myhuey-basics/SKILL.md`, `skills/myhuey-light-theme/SKILL.md`, `skills/myhuey-room-layout/SKILL.md`, `src/myhuey/skills.py`
- Modify: `src/myhuey/assistant.py` (`guide`, `TOOLS`), `pyproject.toml` (ship `skills/` in the wheel as `myhuey/skills`)
- Test: `tests/test_skills.py`

**Interfaces:**
- Produces, in `skills.py`: `TOPICS = ("myhuey-basics", "myhuey-light-theme", "myhuey-room-layout")`; `skill(topic) -> dict` (`{"name", "description", "body"}`, front matter parsed, body without it); `prompt_text(job: str, request: str) -> str` = basics body + `"\n\n"` + that job's body + `"\n\nRequest: " + request`.
- Produces, in `assistant.py`: `guide(topic: str | None = None) -> dict`: without a topic `{"topics": [{"topic", "description"}]}`; with one `{"topic", "text"}`. An unknown topic raises `ValueError` listing the topics. And `TOOLS: dict[str, Callable]`, every tool function by name, in the order of the spec's tables with `guide` first.

**What each skill must say** (wording is the implementer's; each under 200 lines, front matter `name` and `description`):
- `myhuey-basics`: coordinates and units with one worked example (a 365 × 427 cm room, a desk centred on the north wall); furniture faces +y at rotation 0 and turns clockwise; the five roles and that `get_room` reports them per light; the eye-comfort rules as five numbered rules (near-white by the eyes and screen; a bias light behind a screen stays at 10 to 20 percent; less colour and less brightness in view or behind the chair; colour to the rest of the room, more the farther from the seat; warmer and dimmer toward bedtime, 2700 K or below in the last three hours); the hard limits (sandbox only; three tools change real lights; nothing deletes from the active home; a person activates a sandbox in the app).
- `myhuey-light-theme`: the steps in the spec, with one complete worked example from request to `preview_scene` arguments; ask before `apply_scene` or `save_scene`; planned lights are previewed and never sent.
- `myhuey-room-layout`: the steps in the spec; restate the room with numbers and ask only for what is missing and matters; always finish with `describe_room`, `check_layout`, and `open_in_app`; never claim the layout is active.

- [ ] **Step 1: Write the failing tests** in `tests/test_skills.py`:

```python
def test_every_skill_has_front_matter_and_fits():
    for topic in TOPICS:
        item = skill(topic)
        assert item["name"] == topic and len(item["description"]) > 30 and not item["body"].startswith("---")
        assert len(item["body"].splitlines()) < 200

def test_skills_only_name_tools_that_exist():
    for topic in TOPICS:
        named = set(re.findall(r"`([a-z]+(?:_[a-z]+)+)`", skill(topic)["body"])) - ALLOWED_WORDS     # every backticked snake_case word
        assert named <= set(TOOLS), f"{topic} names {named - set(TOOLS)}"
    assert {"preview_scene", "apply_scene", "suggest"} <= set(re.findall(r"`([a-z_]+)`", skill("myhuey-light-theme")["body"]))
    assert {"create_sandbox", "check_layout", "describe_room", "open_in_app"} <= set(re.findall(r"`([a-z_]+)`", skill("myhuey-room-layout")["body"]))

def test_the_hard_limits_are_in_the_basics():
    body = skill("myhuey-basics")["body"].lower()
    for phrase in ("sandbox", "apply_scene", "room_power", "room_dim", "never"): assert phrase in body

def test_guide_and_prompts_are_the_files_word_for_word():
    assert [item["topic"] for item in guide()["topics"]] == list(TOPICS)
    for topic in TOPICS: assert guide(topic)["text"] == skill(topic)["body"]
    assert prompt_text("myhuey-light-theme", "warm and dim in the office") == \
        skill("myhuey-basics")["body"] + "\n\n" + skill("myhuey-light-theme")["body"] + "\n\nRequest: warm and dim in the office"
    with pytest.raises(ValueError, match="myhuey-basics, myhuey-light-theme, myhuey-room-layout"): guide("cooking")

def test_tools_are_complete_and_described():
    assert list(TOOLS)[0] == "guide" and set(CHANGES_LIGHTS) | set(WRITES_LAYOUT) <= set(TOOLS) and len(TOOLS) == 24
    for name, tool in TOOLS.items():
        assert tool.__doc__ and len(tool.__doc__.strip().splitlines()[0]) > 20, name
    for name in CHANGES_LIGHTS: assert TOOLS[name].__doc__.strip().startswith("Changes the real lights.")
```

`ALLOWED_WORDS` is a short set in the test for backticked snake_case words that are not tools (argument names such as `light_id`, `copy_from`, `app_url`).

- [ ] **Step 2: Run** `uv run pytest tests/test_skills.py -q`. Expected: FAIL (`No module named 'myhuey.skills'`).
- [ ] **Step 3: Write the three skills and `skills/README.md`**, then `skills.py`: it finds the folder at `importlib.resources.files("myhuey") / "skills"` when that exists, else the repo's `skills/`. Give every tool function a docstring whose first line says what it does in one sentence (it becomes the tool's description); the three in `CHANGES_LIGHTS` begin "Changes the real lights."
- [ ] **Step 4: Package it.** In `pyproject.toml` add `[tool.hatch.build.targets.wheel.force-include]` mapping `"skills" = "myhuey/skills"`. Verify: `uv build --wheel -o <scratch dir>` then list the wheel and confirm `myhuey/skills/myhuey-basics/SKILL.md` is in it.
- [ ] **Step 5: Run** `uv run pytest -q`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: skills that teach an assistant to design scenes and layouts`.

---

### Task 6: The MCP server and `myhuey mcp`

**Files:**
- Create: `src/myhuey/mcp_server.py`
- Modify: `src/myhuey/cli.py`, `pyproject.toml` (`mcp==2.3.0` in `dependencies`), `uv.lock` (`uv lock`)
- Test: `tests/test_mcp_server.py`

**Interfaces:**
- Consumes: `assistant.TOOLS`, `CHANGES_LIGHTS`, `Refused`; `skills.prompt_text`.
- Produces: `mcp_server.INSTRUCTIONS: str`; `build_server(service: HueRoomService, app_url: str = "http://127.0.0.1:8000") -> MCPServer`; `run(db: str | None, app_url: str) -> None` (stdio); CLI `myhuey mcp [--app-url URL] [--list]`.

- [ ] **Step 1: Write the failing tests** (async tests run with `asyncio.run` inside plain test functions; no new test plugin):

```python
def _call(server, name, arguments):
    async def go():
        async with Client(server) as client:
            return await client.call_tool(name, arguments)
    return asyncio.run(go())

def test_every_tool_and_prompt_is_listed_without_the_service_argument(service):
    async def go():
        async with Client(build_server(service)) as client:
            return (await client.list_tools()).tools, (await client.list_prompts()).prompts, client.instructions
    tools, prompts, instructions = asyncio.run(go())
    assert [tool.name for tool in tools] == list(TOOLS)
    for tool in tools:
        assert tool.description and "service" not in tool.input_schema.get("properties", {}), tool.name
    place = next(tool for tool in tools if tool.name == "place_light")
    assert {"layout", "room", "x", "y"} <= set(place.input_schema["required"]) and "app_url" not in str(next(t for t in tools if t.name == "open_in_app").input_schema)
    assert {p.name for p in prompts} == {"design_light_theme", "design_room_layout"}
    assert instructions == INSTRUCTIONS and "guide" in INSTRUCTIONS and "sandbox" in INSTRUCTIONS

def test_a_call_round_trips(service):
    result = _call(build_server(service), "list_rooms", {})
    assert result.is_error is False and json.loads(result.content[0].text)[0]["name"] == "Den"
    async def prompt():
        async with Client(build_server(service)) as client:
            return (await client.get_prompt("design_light_theme", {"request": "calm"})).messages[0].content.text
    text = asyncio.run(prompt())
    assert text.endswith("Request: calm") and text.startswith(skill("myhuey-basics")["body"][:40])

# Review Focus 5
@pytest.mark.parametrize("name, arguments, words", [
    ("get_room", {"room": "Garage"}, "Garage"),
    ("add_room", {"layout": None, "name": "X", "width": 300, "depth": 300}, "Call create_sandbox first"),
    ("preview_scene", {"room": "Den", "name": "Bad", "lights": {"99": {"white": 2700}}}, 'light "99" is not in Den'),
])
def test_expected_failures_reach_the_model_as_their_own_words(service, name, arguments, words):
    result = _call(build_server(service), name, arguments)
    assert result.is_error is True and words in result.content[0].text and "Traceback" not in result.content[0].text
def test_a_layout_swapped_mid_call_is_a_readable_error(service, monkeypatch):
    box = service.new_layout("Try")                      # made first: only the tool's own save is swapped out
    monkeypatch.setattr(service, "_save", lambda config: (_ for _ in ()).throw(LayoutChanged()))
    result = _call(build_server(service), "add_room", {"layout": box["id"], "name": "X", "width": 300, "depth": 300})
    assert result.is_error is True and str(LayoutChanged()) in result.content[0].text
def test_nothing_is_printed_to_stdout(service, capsys):
    _call(build_server(service), "list_rooms", {}); _call(build_server(service), "catalog", {})
    assert capsys.readouterr().out == ""

def test_cli_lists_the_tools(db_path, capsys):
    main(["--db", db_path, "mcp", "--list"])
    out = capsys.readouterr().out
    assert out.count("\n") == len(TOOLS) and "apply_scene" in out and "Changes the real lights." in out
```

The attribute names on SDK objects (`input_schema`, `is_error`, `instructions`) are as version 2.3.0 spells them; if one differs, use the SDK's spelling and keep the assertion.

- [ ] **Step 2: Run** `uv run pytest tests/test_mcp_server.py -q`. Expected: FAIL (`No module named 'mcp'`).
- [ ] **Step 3: Add the dependency.** `mcp==2.3.0` in `[project] dependencies`, then `uv lock` and `uv sync --extra dev`.
- [ ] **Step 4: Implement `mcp_server.py`.** For each tool, register a wrapper that binds `service` (and, for `open_in_app`, `app_url`), keeps the function's name, docstring, and the rest of its signature and type hints so the SDK builds the schema from them, and turns `HueError` and `ValueError` (which covers `Refused`) into `mcp.server.mcpserver.exceptions.ToolError(str(exc))`. If the SDK's schema builder ignores a wrapper's `__signature__`, write the bound functions out explicitly instead; the test above decides. The tools in neither `CHANGES_LIGHTS` nor `WRITES_LAYOUT`, other than `create_sandbox`, `save_scene`, and `open_in_app`, are marked read-only in their annotations. `INSTRUCTIONS` is the paragraph the spec describes. Logging goes to stderr.
- [ ] **Step 5: Add the CLI command.** `mcp` subparser with `--app-url` (default `http://127.0.0.1:8000`) and `--list`. `--list` prints one line per tool: the name padded to 18, then the first line of its docstring. Without it, `run(args.db, args.app_url)`. The global `--layout` option is ignored here (each tool takes its own). Nothing else is printed.
- [ ] **Step 6: Run** `uv run pytest -q`. Expected: all pass. Then by hand: `printf '' | uv run myhuey --db <scratch>/m.db mcp` exits cleanly with empty stdout.
- [ ] **Step 7: Commit** `feat: myhuey mcp, a tool server for AI assistants`.

---

### Task 7: Wiring and words

**Files:**
- Create: `.mcp.json`, `AGENTS.md`, `.claude/skills/myhuey-basics`, `.claude/skills/myhuey-light-theme`, `.claude/skills/myhuey-room-layout` (symlinks to `../../skills/<name>`)
- Modify: `README.md`, `frontend/src/lib/helpDocs.ts`, `frontend/src/lib/helpDocs.test.ts`, `frontend/src/views/SettingsView.tsx`
- Test: `tests/test_assistant_wiring.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `.mcp.json` = `{"mcpServers": {"myhuey": {"command": "uv", "args": ["run", "myhuey", "mcp"]}}}`; a Help topic with id `assistant` titled "Your assistant"; `MCP_CONFIG` (the same JSON as a string) exported from `helpDocs.ts` and shown with a Copy button in Settings' "Command line" panel.

- [ ] **Step 1: Write the failing tests.** `tests/test_assistant_wiring.py`:

```python
def test_project_config_starts_the_server():
    config = json.loads(Path(".mcp.json").read_text())
    assert config == {"mcpServers": {"myhuey": {"command": "uv", "args": ["run", "myhuey", "mcp"]}}}
def test_claude_code_finds_the_skills():
    for topic in TOPICS:
        link = Path(".claude/skills") / topic
        assert link.is_symlink() and (link / "SKILL.md").read_text() == (Path("skills") / topic / "SKILL.md").read_text()
def test_other_agents_are_pointed_at_them():
    text = Path("AGENTS.md").read_text()
    assert "skills/" in text and "myhuey mcp" in text and len(text.splitlines()) < 40
def test_readme_covers_setup_ssh_and_examples():
    text = Path("README.md").read_text()
    for words in ("## Use it from your assistant", '"command": "uv"', "ssh", "--app-url", "myhuey mcp --list"): assert words in text
```

In `helpDocs.test.ts`: the `assistant` topic exists, `searchHelp('mcp')[0].id` and `searchHelp('assistant')[0].id` are `'assistant'`, and `JSON.parse(MCP_CONFIG).mcpServers.myhuey.args` equals `['run', 'myhuey', 'mcp']`.

- [ ] **Step 2: Run** `uv run pytest tests/test_assistant_wiring.py -q` and `npm --prefix frontend test -- helpDocs`. Expected: FAIL.
- [ ] **Step 3: Write them.** README section after "Command line": what it is in two sentences (MyHuey has no AI of its own; your assistant gets tools and skills); the config for Claude Code (already in `.mcp.json`), and the equivalent snippet for Claude Desktop, Cursor, and VS Code; the SSH form with `--app-url`; what the assistant can and cannot do (the hard limits); two example requests, one per job. The Help topic says the same in the app's voice, with the config and limits. In Settings, the "Command line" panel gains a line "Use it from your assistant" with `MCP_CONFIG` in a code block and a Copy button (the same clipboard call the Workflows drawer uses). `AGENTS.md`: three short paragraphs. Check `.claude/` is not ignored by `.gitignore` before adding the symlinks.
- [ ] **Step 4: Run everything.** `uv run pytest -q`, `npm --prefix frontend test`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`. Expected: all pass and a clean build.
- [ ] **Step 5: Try it for real, on a copy.** `cp ~/.myhuey/myhuey.db <scratch>/assistant.db`, then drive the server with a short script using `mcp.Client(StdioServerParameters(command="uv", args=["run", "myhuey", "--db", "<scratch>/assistant.db", "mcp"]))`: `guide`, `list_rooms`, `get_room` Office, `describe_room` Office, `suggest` Office code, `preview_scene` for Office with two lights, `create_sandbox`, `add_room`, `set_furniture`, `place_light`, `check_layout`, `open_in_app`. Confirm each returns sensible content and that the copy's active layout is unchanged. Do not call `apply_scene`, `room_power`, or `room_dim`: the copy holds the real bridge key.
- [ ] **Step 6: Commit** `feat: wire the skills and tool server into the repo, README, and help`.
