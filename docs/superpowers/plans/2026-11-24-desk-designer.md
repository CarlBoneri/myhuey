# Desk Designer, Mounted Bias Lights, Eyes and Chair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desk designs made in an isolated designer and stamped into rooms as locked desk sets; lights mounted on a screen's back with a halo on the surface behind; eye heights as a personal setting; a chair you sit in.

**Architecture:** Members of a placed set keep absolute room coordinates plus a `set` id (every existing reader works unchanged); Python settles mounts and sets on every save and moves a set in one call; the browser mirrors the same rules for live previews. Designs live app-wide (beside `groups`) in desk-local coordinates.

**Tech Stack:** Python 3 dataclasses + FastAPI + MCP server; React + TypeScript + Vitest (happy-dom component tests).

**Spec:** `docs/superpowers/specs/2026-11-24-desk-designer-design.md`

## Global Constraints

- Branch `desk-designer`. No AI co-author or attribution trailers on commits (owner's standing rule).
- Real-light and demo work only in the **Office** room; layouts built by the assistant tools only in sandboxes.
- Rooms with no sets, no mounts, and no seat chair keep every result (glare snapshots in `glareMath.test.ts` stay unchanged; seated eyes 115 = 46 + 69, standing 155, distance 60).
- A design never stores a real bridge light id.
- Run `uv run pytest -q` and `npm --prefix frontend test` before every commit; `tsc --noEmit -p frontend` clean.

## Review Focus

1. **Deleting a screen that carries a mounted light**: the light stays where it was, its mount is dropped, nothing else moves → test in Task 2.
2. **Placing the same design twice in one room**: two sets, all ids distinct, mounts point at their own set's screens → test in Task 3.
3. **Placing a design through the assistant in a sandbox**: the active home is unchanged; on the active home the tool refuses → test in Task 3.
4. **A seat chair with no screens or desk in the room**: the eye sits over the chair looking the chair's way; no crash → test in Task 4 (Python) and Task 6 (TS).
5. **Saving a placed set that holds a real light as a design**: the design has a catalog id and no `light_id`; an unmappable light is left out and reported → test in Task 3.

---

### Task 1: Saved fields, peripherals, and body preferences (Python + catalog)

**Files:** Modify `src/myhuey/models.py` (Furniture, LayoutLight, Room, FURNITURE_SIZES/HEIGHTS), `src/myhuey/preferences.py`, `src/myhuey/api.py` (FurnitureItem, light body), `frontend/src/components/Shapes.tsx` (FURNITURE_CATALOG). Test: `tests/test_desk_sets.py` (new).

**Interfaces — Produces:**
- `Furniture.set: str | None = None`, `Furniture.seat: float | None = None` (30–90, "A chair's seat height must be between 30 and 90 cm").
- `LayoutLight.set: str | None = None`, `LayoutLight.mount: dict | None = None` (`{"screen": str}` only; anything else → ValueError "A mount names the screen it is on").
- `Room.desk_sets: list[dict]` of `{"id", "name", "base"}` (default `[]`).
- Peripherals: `laptop` ("Laptop (closed)", 31, 22, rect; heights (75, 2)), `keyboard` ("Keyboard", 44, 14; (75, 3)), `speaker` ("Speaker", 12, 15; (75, 20)).
- Preferences `eye_sitting` (69, ints 50–90), `eye_standing` (155, ints 100–200), `screen_distance` (60, ints 30–150); `_valid` accepts a `range` as allowed; the error says "a whole number from A to B".

- [ ] Step 1: tests — old room/light/furniture dicts load with `set None, seat None, mount None, desk_sets []`; round trip with values; seat range; bad mount; peripherals in both catalogs (existing parity test covers TS); preference ranges accept 69 and refuse 49 and 69.5.
- [ ] Step 2: run, expect FAIL. Step 3: implement. Step 4: `uv run pytest -q` PASS.
- [ ] Step 5: commit `feat: desk set, mount and seat fields; peripherals; eye preferences`

### Task 2: Mounts and sets stay consistent on save; moving and releasing a set

**Files:** Create `src/myhuey/desks.py`; modify `src/myhuey/service.py` (update_room, assign_light, new move/release), `src/myhuey/api.py`, `src/myhuey/assistant.py` (set_furniture passes `id`, `set`, `seat`). Test: `tests/test_desk_sets.py`.

**Interfaces — Produces:**
- `desks.settle(room: Room) -> None`: for each mounted light whose screen exists: x, y = the screen's back-face middle (`screen.x - front.x*depth/2`, same for y), `elevation = screen.elevation + screen.height/2`, `rotation = screen.rotation`, `role = "bias"`, and `set = screen.set` when the screen is in a set; a mount whose screen is gone is set to None (light stays). A `desk_sets` entry whose base is gone is removed and its members' `set` cleared. Members whose set id has no entry get `set` cleared.
- `desks.move_set(room, set_id, x, y, rotation) -> None`: rigid move of every member (furniture and lights) so the base lands at (x, y, rotation), then `settle`.
- Service: `move_desk_set(room_name, set_id, x, y, rotation) -> Room`, `release_desk_set(room_name, set_id) -> Room`; `update_room` and `assign_light` call `settle` before saving; `assign_light(..., mount=...)` with "keep" default.
- API: `PATCH /api/rooms/{room}/sets/{set_id}` `{x, y, rotation}`; `DELETE /api/rooms/{room}/sets/{set_id}` (release; pieces stay); light placement body accepts `mount`.

- [ ] Step 1: tests — mounted light follows its screen through `update_room`; role forced bias; screen removed → mount None and light unmoved (Focus 1); set with base removed dissolves; `move_desk_set` carries furniture, a set light, and a mounted light rigidly (turn 90°); release clears `set` and the entry; `set_furniture` keeps `id`/`set` when given.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS.
- [ ] Step 5: commit `feat: mounted lights follow their screens; move and release desk sets`

### Task 3: Desk design library, placing, editing, saving as design; assistant tools

**Files:** Modify `src/myhuey/desks.py`, `src/myhuey/service.py`, `src/myhuey/api.py`, `src/myhuey/assistant.py` (+ TOOLS), `skills/myhuey-room-layout/SKILL.md`, `skills/myhuey-basics/SKILL.md`. Test: `tests/test_desk_designs.py` (new).

**Interfaces — Produces:**
- Design shape: `{id, name, items: [furniture dict + "key"], lights: [{key, catalog, label, x, y, elevation, rotation, length, role, mount: {"screen": item key} | null}]}`, desk-local (base at origin, rotation 0).
- Service: `desks() -> list`, `create_desk(name, items, lights) -> dict`, `update_desk(id, *, name=None, items=None, lights=None) -> dict`, `delete_desk(id)`, `place_desk(room, design_id, x, y, rotation=0) -> dict` (returns `{"set": id, "room": room dict}`), `apply_desk_set(room, set_id, items, lights) -> Room` (body in desk-local coordinates; items/lights may carry their room `id`/`light_id` to keep them; real lights left out are released, planned ones left out are removed), `desk_from_set(room, set_id, name) -> {"design": dict, "skipped": [labels]}`.
- Names unique case-insensitively ("A desk design named 'X' already exists"); app-wide key `desks`.
- Catalog mapping for save-as: `product.catalog`, else the catalog item whose archetype matches `product.archetype`, else skipped.
- API: `GET/POST /api/desks`, `PATCH/DELETE /api/desks/{id}`, `POST /api/rooms/{room}/desks` `{design, x, y, rotation}`, `PUT /api/rooms/{room}/sets/{set_id}` `{items, lights}`, `POST /api/rooms/{room}/sets/{set_id}/design` `{name}`.
- Tools: `desk_designs()` and `place_desk(layout, room, design, x, y, rotation=0)` (sandbox only via the existing strict layout rule).

- [ ] Step 1: tests — create/list/rename/delete; duplicate name refused; place maps ids, mounts, planned lights, base = first desk kind; place twice → distinct (Focus 2); apply keeps ids, releases a dropped real light, removes a dropped planned light; save-as maps a real `huelightstriptv` light to `play-gradient-tv`, never stores `light_id`, reports an unmappable one (Focus 5); `place_desk` tool refuses the active home and works in a sandbox while the active home stays unchanged (Focus 3).
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS (incl. the guide/skill tests).
- [ ] Step 5: commit `feat: desk design library, placing and editing desk sets, assistant tools`

### Task 4: Seat chair and personal eye heights in Python roles

**Files:** Modify `src/myhuey/roles.py`, `src/myhuey/service.py` (pass body), callers in `room_view.py`, `suggest.py`, `setups.py`, `room_text.py` only where they call `find_focus`. Test: `tests/test_seat_and_eyes.py` (new).

**Interfaces — Produces:** `Body(eye_sitting=69, eye_standing=155, screen_distance=60)`; `find_focus(room, kind, body: Body | None = None)`; seat chair = a furniture item with `seat` set (nearest to the screens' middle when several). With a seat chair, the desk focus seat is the chair's (x, y), eye = `seat + eye_sitting` (standing desk: `eye_standing`), gaze toward the screens' middle (or the chair's front with no screens). Without one, today's math with `screen_distance` and `46 + eye_sitting`. Service builds `Body` from preferences.

- [ ] Step 1: tests — defaults give today's focus exactly; a seat chair moves the seat and eye height (seat 50 → 119); a seat chair alone works (Focus 4); preference change reaches `get_room` roles.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `feat: sit where your chair is, at your own eye height`

### Task 5: Browser data, client, set moves and standing (TS)

**Files:** Modify `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/lib/rig.ts`; create `frontend/src/lib/desks.ts` + test; extend `rig.test.ts`.

**Interfaces — Produces:** types for `set`, `seat`, `mount`, `desk_sets`, `DeskDesign`, preferences `eye_sitting/eye_standing/screen_distance`; api: `desks, createDesk, updateDesk, deleteDesk, placeDesk, moveDeskSet, releaseDeskSet, applyDeskSet, deskFromSet`. `desks.ts`: `settle(room): Room` (mirror of Python), `setOf(room, id): DeskSet | null` (by furniture id or light id), `moveSet(room, setId, dx, dy, turn): Room`, `toLocal(room, setId): {items, lights}`, `fromLocal(...)`. `moveRig` moves the whole set when the piece is a member, and carries mounted lights of any moved screen; `posedRoom` raises set members at or above a sit-stand base's top (chair stays).

- [ ] Step 1: tests — settle parity cases from Task 2; moveSet rigid with turn; moveRig on a member moves the set; standing raises an arm screen off the desk edge in a set, not outside one; toLocal/fromLocal round trip.
- [ ] Step 2–4 RED/GREEN. Step 5: commit `feat: desk sets move as one in the browser`

### Task 6: Seat and eyes in the glare tracer (TS)

**Files:** Modify `frontend/src/lib/glareMath.ts` (`seatOf`, `glareScene`), `frontend/src/lib/photo.ts` (eye preset), `frontend/src/lib/roomGlare.ts` and other `glareScene`/`seatOf` callers to pass the body from preferences. Test: `glareMath.test.ts`, `photo.test.ts`.

**Interfaces — Produces:** `Body` type + `DEFAULT_BODY`; `seatOf(room, posture, body = DEFAULT_BODY)`; `glareScene(room, posture, mode, lengthOf, body = DEFAULT_BODY)`; a mounted light is one point at its mount.

- [ ] Step 1: tests — snapshots unchanged; seat chair moves the eye (Python parity values); seat chair alone (Focus 4); a mounted 2 m strip is `bias_ok` with one point.
- [ ] Steps 2–4. Step 5: commit `feat: the glare check sits in your chair at your eye height`

### Task 7: Halo and mounted loop in 3D

**Files:** Create `frontend/src/lib/halo.ts` + test; modify `frontend/src/components/Room3DStage.tsx`, `frontend/src/styles.css`; extend `Room3DStage.test.tsx`.

**Interfaces — Produces:** `haloOf(room, screen: Furniture): { corners: Vec3[]; gap: number; opacity: number } | null` (cast from the back-face middle along −front to the outline; null past `HALO_REACH_CM = 150`; spread `10 + 0.9·gap`; opacity `0.55·(1 − gap/150)`; clipped to 0 and the ceiling); `loopOf(screen, length): Vec3[]` (inset 6 cm, full loop or a U open at the bottom). The stage draws halos after back walls (`data-halo`, soft via an SVG blur filter, light's live colour, only when lit) and mounted lights as their loop.

- [ ] Step 1: tests — wall 20 cm behind gives the expected corners/opacity; a turned screen hits the right wall; 200 cm gap → null; clipping at the floor; loop vs U by length; stage renders one `[data-halo]` for a lit mounted light and none when off.
- [ ] Steps 2–4. Step 5: commit `feat: mounted bias lights halo the wall behind their screen`

### Task 8: Room designer: sets, mounts, chair controls, placing designs

**Files:** Modify `frontend/src/views/RoomDesigner.tsx`, `frontend/src/components/Shapes.tsx` (mounted light bar), `frontend/src/components/Room3DStage.tsx` (set drag commits once), create `frontend/src/components/DeskSetPanel.tsx`, `frontend/src/components/ChairFields.tsx`; tests in `RoomDesigner.test.tsx` and new component tests.

**Interfaces — Consumes:** Task 5 api/desks. **Produces:** dragging a member on the plan previews `moveSet` and commits with one `api.moveDeskSet`; members' inspector shows `DeskSetPanel` (Edit in desk designer → `#/studio/room/<room>/set/<set>`, Save as design (name prompt), Release) instead of geometry fields; chair inspector `ChairFields` (I sit here toggle → `seat` 46 or null, seat height LengthInput 30–90); light inspector "Mounted on" select of the room's screens (and None); a "Desk sets" panel lists designs with Place (room middle).

- [ ] Step 1: tests — dragging a member saves one `moveDeskSet` call; member inspector hides Width/Depth and shows Release; mounting calls the light save with `mount`; I sit here saves `seat: 46`; Place calls `placeDesk` with the room middle.
- [ ] Steps 2–4. Step 5: commit `feat: desk sets, mounts and chair controls in the room designer`

### Task 9: Your eyes in the Studio and Settings

**Files:** Modify `frontend/src/components/Studio3D.tsx` (posture panel), `frontend/src/views/SettingsView.tsx`; tests in `Studio3D.test.tsx`, Settings test if present.

**Produces:** posture options keep their labels with the live numbers (seated from the seat chair when there is one: "eyes 3'9" = seat 1'6" + 2'3""), plus LengthInputs "Sitting eye height", "Standing eye height", "Screen distance" saving preferences; Settings has the same three under "You".

- [ ] Steps 1–4 (tests: label shows preference values; editing saves `eye_sitting`). Step 5: commit `feat: set your own eye heights`

### Task 10: The desk designer view

**Files:** Modify `frontend/src/lib/router.ts`, `frontend/src/lib/tabs.ts`, `frontend/src/App.tsx`; create `frontend/src/views/DeskDesigner.tsx` + test.

**Interfaces — Produces:** routes `{ view: 'desks'; design?: string }` (`#/studio/desks[/<id>]`) and `{ view: 'desk-set'; room: string; set: string }` (`#/studio/room/<room>/set/<set>`); tab id `desks` "Studio · Desks". The view builds a synthetic bench room (300 × 220, wall behind the desk at an adjustable preview gap) and reuses `PlanCanvas`/`FurnitureShape`/`LightSilhouette` and `Room3DStage`; sidebar: designs list (open, new, delete with confirm), name, selected piece (position, size, `ScreenFields`, `ChairFields`, mount select), furniture catalog (desks, screens, peripherals, chair), light catalog, Save / Save as new / Place in room (room select). For a placed set: Apply and Cancel.

- [ ] Step 1: tests — routes parse/format; new design → add desk + 49" + chair → Save calls `createDesk` with local coordinates; open placed set → Apply calls `applyDeskSet` with kept ids; Place in room calls `placeDesk`.
- [ ] Steps 2–4. Step 5: commit `feat: the desk designer`

### Task 11: Help, build, real-room check

**Files:** `frontend/src/lib/helpDocs.ts` (one paragraph), README feature list line if one exists.

- [ ] Step 1: help text; `npm --prefix frontend run build`; restart the app server.
- [ ] Step 2: in the "G9 desk check" sandbox, Office: create a design (desk, G9 1000R, portrait Dell, chair as seat, gradient strip mounted on the G9), place it at the desk, trace glare; compare with the earlier report; read back the room.
- [ ] Step 3: commit `docs: desk designer help`
