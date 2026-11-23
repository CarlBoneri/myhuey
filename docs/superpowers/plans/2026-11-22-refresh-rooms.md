# Refresh Rooms from Hue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Refresh from Hue" action that previews, then applies, each MyHuey room's light list against the Hue room it is linked to, and adds Hue rooms MyHuey doesn't have.

**Architecture:** A pure planner (`src/myhuey/refresh.py`) turns the stored rooms plus the bridge's groups and lights into a list of per-room changes and a fingerprint. The service reads the bridge, returns that preview, and on apply recomputes it, refuses if the fingerprint differs, and saves every change in one write. The Plan view shows the preview in a panel with Cancel and Apply; the Room Designer lists lights marked as arrived.

**Tech Stack:** Python 3.11 (FastAPI, pytest, uv); React 19 + Vite + vitest (happy-dom + Testing Library, opt-in per file via `frontend/src/test/dom.ts`).

**Spec:** `docs/superpowers/specs/2026-11-22-refresh-rooms-design.md`

## Global Constraints

- Refresh only reads the bridge (`client.get_lights()`, `client.get_groups()`). It never writes to the bridge.
- Only `type == "Room"` groups count. Zones are ignored.
- Planned lights (`planned: true`) are never removed. MyHuey rooms with no Hue match are never changed.
- A room is matched by `hue_room` (the v1 group id) first, then by cleaned name (`str(name).strip().replace("/", "-")`, exact match). The id is stored on Apply.
- Arrivals: 60 cm apart, starting 40 cm inside the room's top-left bounds, wrapping to a new row 60 cm lower. They are marked `metadata.arrived = true`. Moving the light clears the mark.
- Apply saves in one write and refuses with HTTP 409 if the recomputed fingerprint differs from the one sent.
- No new MCP tool. The tool server's rules stay intact.
- `frontend/src/lib/commands.ts` keeps its one `TODO(human)`. Add none.
- Commits carry no AI attribution (no Co-Authored-By lines).
- Copy is plain words. The sketch from the design: `Office  + Desk strip (from Bedroom)  − Floor lamp (to Hallway)`, `Den  new room, 3 lights`, `Garage  not on the bridge, left alone`.
- Before each commit, run the suites for what the task touched: `uv run pytest -q`, `npm --prefix frontend test`, `npm --prefix frontend run typecheck`.

## Review Focus

1. A room renamed in MyHuey after it was linked is still matched by id. Refresh doesn't add a duplicate from Hue. (Task 1 test)
2. The bridge changes between the preview and Apply. Apply returns 409 and saves nothing. (Task 2 test)
3. A Hue room's cleaned name equals a MyHuey room that is linked to a different Hue room. The new room gets a free name ("Office 2"), and neither room is overwritten. (Task 1 test)
4. A light leaves a room for a brand-new Hue room. The new room's copy keeps the old label, product, and cut length, and the old room loses it. (Task 2 test)
5. A room whose outline doesn't start at 0,0, or a room narrower than 80 cm. Arrival spots stay inside the outline's bounds. (Task 1 test)

---

### Task 1: The refresh planner and the room link

**Files:**
- Modify: `src/myhuey/models.py` (`Room`: field, `from_dict`, `to_dict`)
- Create: `src/myhuey/refresh.py`
- Test: `tests/test_refresh.py`

**Interfaces:**
- Produces:
  - `Room.hue_room: str | None = None`. `from_dict` reads `data.get("hue_room")`; a blank or missing value becomes `None`, anything else becomes `str(...).strip()`. `to_dict` writes `"hue_room"`.
  - `refresh.hue_room_name(raw: object) -> str`: `str(raw or "").strip().replace("/", "-")`.
  - `@dataclass refresh.Move: light_id: str; label: str; other: str | None`. `other` is where the light came from (on an arrival) or went to (on a departure).
  - `@dataclass refresh.RoomChange: room: str; hue_room: str | None; status: str; arrive: list[Move]; leave: list[Move]; link: bool`. `status` is one of `"new"`, `"changed"`, `"unchanged"`, `"left_alone"`. `link` is True when Apply will store `hue_room` on the room (a name match not linked yet, or a new room).
  - `refresh.plan_refresh(rooms: list[dict], groups: dict[str, dict], lights: dict[str, dict]) -> list[RoomChange]`. `rooms` is the stored `config["rooms"]`. `groups` and `lights` are the bridge's v1 answers.
  - `refresh.fingerprint(changes: list[RoomChange]) -> str`: the first 16 hex characters of the sha256 of `json.dumps([asdict(c) for c in changes], sort_keys=True)`.
  - `refresh.arrival_spots(outline: list[list[float]], count: int) -> list[tuple[float, float]]`.

The planner's rules (the spec leaves these to the plan):
- **Matching.** Walk the stored rooms in order.
  - A room with `hue_room` whose group exists and has `type == "Room"` matches that group. If the group is gone, the room is `left_alone`, with no fallback to its name.
  - A room without `hue_room` matches the first unclaimed Room group whose `hue_room_name` equals its name.
  - Each group is claimed at most once. A second room linked to an already claimed id is `left_alone`.
- **Real lights** in a room are its lights with `planned` false. Every comparison uses real lights only.
- **`arrive`:**
  - The ids in the group's `lights` that are not among the room's real lights.
  - `label`: the label from the first other stored room that holds the light as a real light. Failing that, the bridge's `lights[id]["name"]`. Failing that, `f"Light {id}"`.
  - `other`: the name of that holding room, else `None`.
- **`leave`:**
  - The room's real lights whose ids are not in the group's `lights`.
  - `label`: the stored label.
  - `other`: the Room group that now holds the light, given as the MyHuey name it will have (a matched room's name, or a new room's name), else `None`.
- **`status`:** `"changed"` if `arrive` or `leave` is non-empty, else `"unchanged"`.
- **New rooms.** Each unclaimed Room group with a non-empty cleaned name becomes `status="new"`, `link=True`.
  - Its `arrive` lists all its lights, by the same rules.
  - Its name is the cleaned name, or, if a stored room already has that name, the first free `"{name} 2"`, `"{name} 3"`, and so on.
- **Order:**
  - Stored rooms in stored order, `left_alone` ones included where they sit.
  - Then new rooms by numeric group id.
  - Inside each list, lights are sorted by numeric id, then by text.
- **Arrival spots.**
  - From the outline's bounds, start at `(min_x + 40, min_y + 40)` and step +60 in x while `x <= max_x - 40`.
  - Then wrap: x goes back to `min_x + 40`, y += 60.
  - A row always holds at least one spot, even in a room narrower than 80 cm.
  - Spots are rounded to 2 decimals.

- [ ] **Step 1: Write the failing tests** in `tests/test_refresh.py`. Build rooms as plain dicts, for example `{"name": "Office", "outline": [[0,0],[450,0],[450,300],[0,300]], "lights": [{"light_id": "1", "label": "Desk"}]}`.

```python
def test_a_light_that_moved_rooms_leaves_one_and_arrives_in_the_other():
    rooms = [room("Office", ["1", "2"]), room("Hallway", [])]
    groups = {"1": {"name": "Office", "type": "Room", "lights": ["1"]},
              "4": {"name": "Hallway", "type": "Room", "lights": ["2"]}}
    changes = {c.room: c for c in plan_refresh(rooms, groups, LIGHTS)}
    assert changes["Office"].status == "changed"
    assert [(m.light_id, m.other) for m in changes["Office"].leave] == [("2", "Hallway")]
    assert [(m.light_id, m.label, m.other) for m in changes["Hallway"].arrive] == [("2", "Light two", "Office")]  # stored label carried
    assert changes["Office"].link and changes["Office"].hue_room == "1"

def test_a_renamed_room_stays_matched_by_its_hue_id():          # Review Focus 1
    rooms = [room("My office", ["1"], hue_room="1")]
    changes = plan_refresh(rooms, {"1": {"name": "Office", "type": "Room", "lights": ["1"]}}, LIGHTS)
    assert [(c.room, c.status, c.link) for c in changes] == [("My office", "unchanged", False)]

def test_planned_lights_and_hand_drawn_rooms_are_left_alone():
    rooms = [room("Office", ["1"], planned=["catalog-9"]), room("Garage", ["7"])]
    changes = {c.room: c for c in plan_refresh(rooms, {"1": {"name": "Office", "type": "Room", "lights": ["1"]}}, LIGHTS)}
    assert changes["Office"].leave == [] and changes["Office"].status == "unchanged"
    assert changes["Garage"].status == "left_alone"

def test_a_linked_room_whose_hue_room_is_gone_is_left_alone_not_rematched_by_name(): ...
def test_zones_are_ignored_and_new_hue_rooms_are_listed_with_their_lights(): ...  # "Porch/Yard" -> "Porch-Yard", status new, link True
def test_a_new_hue_room_named_like_a_room_linked_elsewhere_gets_a_free_name():   # Review Focus 3
    # stored "Office" linked to "5"; group "7" named "Office" -> new room "Office 2"
    ...
def test_fingerprint_changes_when_the_plan_changes_and_not_otherwise(): ...
def test_arrival_spots_start_inside_the_top_left_and_wrap():
    assert arrival_spots([[0,0],[200,0],[200,300],[0,300]], 4) == [(40, 40), (100, 40), (160, 40), (40, 100)]
def test_arrival_spots_stay_inside_an_offset_or_narrow_room():   # Review Focus 5
    assert arrival_spots([[100,50],[160,50],[160,400],[100,400]], 2) == [(140, 90), (140, 150)]
def test_room_keeps_its_hue_link_through_from_dict_and_to_dict(): ...  # blank -> None
```

Fill in the `...` bodies with the assertions their names state. `LIGHTS` is a small dict that gives light "2" the bridge name "Light two"; the `room()` helper stores label "Light two" for id "2".

- [ ] **Step 2: Run** `uv run pytest tests/test_refresh.py -q`. Expected: FAIL (`refresh` module not found).
- [ ] **Step 3: Implement** `Room.hue_room` and `src/myhuey/refresh.py` per the Interfaces block. `refresh.py` imports nothing from `service.py`.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass (models round-trip tests elsewhere still pass with the new key).
- [ ] **Step 5: Commit** `feat: plan a refresh of rooms against the Hue rooms, and link a room to its Hue room`

---

### Task 2: Preview and apply in the service, the API, and the CLI

**Files:**
- Modify: `src/myhuey/errors.py` (add `RefreshChanged`)
- Modify: `src/myhuey/service.py` (`refresh_preview`, `refresh_rooms`, `import_rooms`, `assign_light`)
- Modify: `src/myhuey/api.py` (routes, 409 mapping, `API_REVISION = 6`)
- Modify: `src/myhuey/cli.py` (`room refresh [--apply]`)
- Test: `tests/test_refresh_service.py`; extend `tests/test_api.py` (the route list near line 35, if it enumerates routes) and `tests/test_cli.py`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `errors.RefreshChanged(HueError)`, with the message `"The Hue rooms changed since the preview. Look again before applying."`. `api._status_for` maps it to 409.
  - `HueRoomService.refresh_preview() -> dict`: `{"rooms": [asdict(change) ...], "fingerprint": str}`. Reads the bridge, writes nothing.
  - `HueRoomService.refresh_rooms(fingerprint: str) -> dict`: the same shape, describing what was applied. It raises `RefreshChanged` when the recomputed fingerprint differs, and then saves nothing.
  - `GET /api/rooms/refresh` returns the preview. `POST /api/rooms/refresh` takes body `{"fingerprint": str}` (pydantic, `min_length=1`, `max_length=64`) and returns what was applied. Both are declared **before** `/api/rooms/{room_name}`, so "refresh" is not read as a room name.
  - CLI `myhuey room refresh` prints the preview. `--apply` previews, then applies with that fingerprint, and prints `Applied.`

What Apply does, all inside one `_load()` … `_save(config)`:
- **Matched `changed` rooms:**
  - Remove the `leave` lights, and pop their `light:{id}` photo tags.
  - Append each `arrive` light at the next `arrival_spots` spot.
  - An arrival copies `label` (from the Move), plus `product` and `length` from the first stored record of that light elsewhere in the layout. If there is no stored record, `product` is `_product(raw)` from the bridge and `length` is `None`.
  - Everything else is default: rotation 0, `elevation` None, role `"auto"`, `planned` false, `on` true, brightness 255, `metadata {"arrived": True}`.
  - Build each light through `LayoutLight.from_dict` so it is validated.
- **Links:** a room with `link` true gets `hue_room` set.
- **`new` rooms:**
  - Built with the same defaults as `add_room`: units from the `default_units` preference, the default rectangle, the next grid spot from `_GRID_COLUMNS` / `_GRID_CELL_CM` counting rooms already in `config`.
  - Their lights go on Import's grid: `x=75 + (i % 4) * 100`, `y=75 + (i // 4) * 75`, copying label, product, and length as above, with no `arrived` mark.
  - Factor a small helper shared with `add_room` if that keeps the defaults in one place.
- `import_rooms` sets `hue_room` on the rooms it adds.
- `assign_light`: when the light already exists and the new `x` or `y` differs from the stored one, drop `metadata["arrived"]`. This applies when `metadata` was not passed explicitly.

CLI output, one line per room that isn't `unchanged`:
- `Office: + Desk strip (from Bedroom), − Floor lamp (to Hallway)`. Leave out the parentheses when `other` is None.
- `Den: new room, 3 lights`
- `Garage: not on the bridge, left alone`
- If no room is `new` or `changed`, print `Rooms already match Hue.`

- [ ] **Step 1: Write the failing tests.** Use `fake_bridge(LIGHTS_ANSWER, GROUPS_ANSWER)` from `tests/conftest.py`. It replays answers in call order, so check whether `get_lights` or `get_groups` is called first. Use `HueRoomService(db_path).set_bridge("10.0.0.77", USERNAME)` as `tests/test_api.py` does.

```python
def test_apply_moves_a_light_between_rooms_in_one_save_and_marks_it_arrived(): ...
    # Office loses "2" (and its photo tag), Hallway gains it at (40, 40) with metadata {"arrived": True},
    # label/product/length carried from Office; Office.hue_room == "1" afterwards
def test_apply_refuses_when_the_bridge_changed_since_the_preview_and_saves_nothing():   # Review Focus 2
    # preview, then the fake answers a different GROUPS; refresh_rooms(old) raises RefreshChanged; rooms unchanged
def test_a_light_that_moves_into_a_new_hue_room_keeps_its_label_product_and_length():  # Review Focus 4
def test_refresh_preview_never_writes_to_the_bridge():
    # every recorded call in session.calls and session.clip_calls is a GET
def test_moving_an_arrived_light_clears_its_mark_and_other_edits_keep_it(): ...
def test_import_links_the_rooms_it_adds(): ...
def test_refresh_routes_preview_then_apply_and_409_on_a_stale_fingerprint(web, db_path, fake_bridge): ...
def test_cli_room_refresh_prints_the_preview_and_applies_with_apply(...): ...
```

- [ ] **Step 2: Run** `uv run pytest tests/test_refresh_service.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block. Bump `API_REVISION` to 6.
- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass, including `tests/test_mcp_server.py` unchanged (no new tool).
- [ ] **Step 5: Commit** `feat: preview and apply a refresh of rooms from Hue (service, API, CLI)`

---

### Task 3: Refresh from Hue in the app

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`
- Create: `frontend/src/components/RefreshRoomsPanel.tsx`, `frontend/src/components/RefreshRoomsPanel.test.tsx`
- Modify: `frontend/src/views/PlanView.tsx` (the button near "Import from Hue", the panel)
- Modify: `frontend/src/views/RoomDesigner.tsx` (the "New from Hue" panel), plus a test in `frontend/src/views/RoomDesigner.test.tsx`
- Modify: `frontend/src/lib/helpDocs.ts` (the line that says "import the rooms you already have in the Hue app")

**Interfaces:**
- Consumes: the API from Task 2.
- Produces:
  - Types: `Room.hue_room?: string | null`; `RefreshMove { light_id: string; label: string; other: string | null }`; `RoomRefresh { room: string; hue_room: string | null; status: 'new' | 'changed' | 'unchanged' | 'left_alone'; arrive: RefreshMove[]; leave: RefreshMove[]; link: boolean }`; `RefreshPlan { rooms: RoomRefresh[]; fingerprint: string }`.
  - `api.refreshPreview(): Promise<RefreshPlan>` (GET `/api/rooms/refresh`). `api.refreshApply(fingerprint: string): Promise<RefreshPlan>` (POST, json `{ fingerprint }`). Keep `api.importRooms`, because the Setup wizard still uses it.
  - `RefreshRoomsPanel({ plan, busy, onCancel, onApply }: { plan: RefreshPlan; busy: boolean; onCancel: () => void; onApply: () => void })`.

The panel (`Panel` from `components/ui.tsx`, title "Refresh from Hue"):
- **Each `changed` room:** its name, then one line per arrival `+ {label} (from {other})` and one per departure `− {label} (to {other})`.
  - Use U+2212 for the minus.
  - Drop the parentheses when `other` is null.
  - Give each line an `aria-label` in words, such as "Desk strip arrives from Bedroom".
- **Each `new` room:** `{room}: new room, {n} lights` (`1 light` when there is one).
- **Each `left_alone` room:** `{room}: not on the bridge, left alone`.
- **`unchanged` rooms:** one line, `{n} rooms already match` (`1 room already matches`).
- **Nothing `new` or `changed`:**
  - Show "Your rooms already match Hue." and a single **Done** button.
  - Done calls `onApply` when any room has `link` true, otherwise `onCancel`.
- **Otherwise:** **Cancel** and **Apply** (primary). Both are disabled while `busy`.

PlanView:
- The "Import from Hue" button becomes **Refresh from Hue**, with lucide `RefreshCw`, under the same `setup?.configured` condition.
- On click it fetches the preview and shows `RefreshRoomsPanel` first in the sidebar, in place of the "Add a room" panel, while a plan is held.
- **Apply:**
  1. Calls `refreshApply(plan.fingerprint)`.
  2. Toasts `Refreshed {names of new/changed rooms joined by ", "}`, or `Rooms linked to Hue.` when only links were stored.
  3. Calls `refreshRooms()` and clears the plan.
- **Apply failure:**
  - Toast the message.
  - If the error's status is 409, fetch a fresh preview and show it.
  - Check how `call` surfaces the status, in `api.ts`.
- **Cancel:** clears the plan.

RoomDesigner:
- When the open room has lights with `metadata.arrived === true`, show a Panel titled "New from Hue".
- It holds the hint `Drag these into place.` and one button per light, with its label, that selects that light the way clicking it on the plan does.

- [ ] **Step 1: Write the failing tests.**
  - `RefreshRoomsPanel.test.tsx` (import `../test/dom`):
    - renders the arrival and departure lines with and without `other`;
    - renders the new-room count, singular and plural;
    - renders the left-alone line;
    - renders the unchanged count;
    - Apply calls `onApply`;
    - Apply is disabled while `busy`;
    - the already-match state shows Done, which calls `onApply` when a room has `link` and `onCancel` when none does.
  - `RoomDesigner.test.tsx`: a room with one arrived light shows "New from Hue". Pressing the light's button selects it.
- [ ] **Step 2: Run** `npm --prefix frontend test -- RefreshRoomsPanel RoomDesigner`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, the API calls, the panel, PlanView, RoomDesigner, and the help line (for example "draw the room, or bring in the rooms you already have in the Hue app with Refresh from Hue").
- [ ] **Step 4: Run** `npm --prefix frontend test` and `npm --prefix frontend run typecheck`. Expected: all pass, no type errors. Run `grep -c "TODO(human)" frontend/src/lib/commands.ts`. Expected: `1`.
- [ ] **Step 5: Commit** `feat: Refresh from Hue on the floor plan, and a list of lights new from Hue in the room designer`
