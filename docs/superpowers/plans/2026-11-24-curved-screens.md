# Curved and Portrait Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Screens can be curved (R-rating) and portrait, saved with the room, and the browser glare check traces reflections off the curved surface.

**Architecture:** Python stores two new optional fields (`curve`, `tilt`) on `Furniture`. A new
`frontend/src/lib/screen.ts` owns screen geometry (size from diagonal, arc, footprint, facets).
`glareMath.ts` turns a curved screen into 12 flat facets and runs the existing reflection test on
each, with a self-occlusion check. The 3D view draws the facets; the 2D plan draws an arc band.

**Tech Stack:** Python 3.11 dataclasses + FastAPI/pydantic, pytest; React + TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-curved-screens-design.md`

## Global Constraints

- Units: all stored lengths in cm; `curve` is stored in **mm** (as printed on the box: 1000 = 1000R).
- `curve`: `null` = flat; valid 500–10000. `tilt`: `null` = default (−12° monitors, 0 otherwise); valid −45..45.
- `curve` is rejected when `height > width` (no curved portrait).
- `width` = panel width along the arc; `height` = panel height; portrait is `height > width`.
- `(x, y)` = middle of the panel body; a curve never moves it. Wings reach forward by the sagitta.
- Facet count `FACETS = 12`. `SCREEN_MARGIN_CM` (8) applies only to the outer edges of the whole screen.
- Flat screens take exactly today's code path; existing glare snapshots must not change.
- Copy: catalog row `monitor-49` labelled `Super ultrawide 49"`, 32:9, default `curve` 1000.
- Commits: no AI co-author or attribution trailers. Work on branch `curved-screens`.
- Real-light / sandbox checks happen only in the **Office** room; never create test rooms.
- Before each commit: `uv run pytest -q` and `npm --prefix frontend test` pass.

## Review Focus

1. **A light exactly on a facet seam** should count once, not vanish or double up → test in Task 4.
2. **Dragging or rotating a curved screen** in the 2D plan should select and move it by its arc band, including the forward-reaching wings → test of `footprintOf` + `covers` in Task 2.
3. **A saved room with no `curve`/`tilt` keys** (every existing room) loads and re-saves without gaining non-null values → test in Task 1.
4. **Switching a curved screen to portrait in the UI** must clear the curve, not send a request the API rejects → test in Task 7.
5. **A very gentle curve (3800R) on a small screen** must trace almost exactly like flat (no numeric blow-up when sagitta ≈ 0) → test in Task 4.

---

### Task 1: Save `curve` and `tilt` (Python)

**Files:**
- Modify: `src/myhuey/models.py` (`Furniture`, `FURNITURE_HEIGHTS`, `FURNITURE_SIZES`)
- Modify: `src/myhuey/api.py:144-155` (`FurnitureItem`)
- Modify: `src/myhuey/assistant.py:531-561` (`set_furniture`)
- Modify: `src/myhuey/placement.py:26` (`covers`) and `src/myhuey/room_text.py:111` (`_corners`)
- Modify: `frontend/src/components/Shapes.tsx` `FURNITURE_CATALOG` (kept in step by `tests/test_assistant_read.py`)
- Create: `tests/test_curved_screens.py`

**Interfaces:**
- Produces: `Furniture.curve: float | None = None`, `Furniture.tilt: float | None = None`;
  `placement.footprint(item: Furniture) -> tuple[float, float, float, float]` returning
  `(cx, cy, width, depth)` of the plan footprint in room cm (same rotation as the item).

- [ ] **Step 1: Write failing tests** in `tests/test_curved_screens.py`:

```python
def test_old_room_loads_flat():
    item = Furniture.from_dict({"kind": "monitor-27", "width": 61, "depth": 20})
    assert item.curve is None and item.tilt is None
    assert "curve" in item.to_dict() and item.to_dict()["curve"] is None

def test_curve_and_tilt_round_trip():
    item = Furniture.from_dict({"kind": "monitor-49", "width": 119.8, "depth": 10, "height": 33.7, "curve": 1000, "tilt": -8})
    assert (item.curve, item.tilt) == (1000.0, -8.0)
    assert Furniture.from_dict(item.to_dict()) == item

@pytest.mark.parametrize("bad", [{"curve": 400}, {"curve": 20000}, {"tilt": 50}, {"tilt": -46}])
def test_ranges(bad): ...  # raises ValueError

def test_no_curved_portrait():
    with pytest.raises(ValueError, match="portrait"):
        Furniture.from_dict({"kind": "monitor-27", "width": 34, "height": 61, "curve": 1800})

def test_catalog_has_49():
    assert FURNITURE_SIZES["monitor-49"] == ('Super ultrawide 49"', 119.8, 12.0, "rect")
    assert FURNITURE_HEIGHTS["monitor-49"] == (75, 33.7)

def test_curved_footprint_reaches_forward():
    # 49" 1000R at rotation 0 faces +y. sagitta = 100cm*(1-cos(119.8/200)) = 17.4 cm
    cx, cy, w, d = footprint(Furniture.from_dict({"kind": "monitor-49", "x": 100, "y": 50, "width": 119.8, "depth": 10, "height": 33.7, "curve": 1000}))
    assert w == pytest.approx(112.8, abs=0.2)   # chord
    assert d == pytest.approx(27.4, abs=0.2)    # depth + sagitta
    assert cy == pytest.approx(50 + 17.4 / 2, abs=0.2) and cx == 100
    assert covers(item, 100 - 55, 50 + 17)       # a wing tip
    assert not covers(item, 100, 50 - 8)         # behind the body

def test_set_furniture_accepts_curve(sandbox_service): ...  # curve=1000, tilt=-5 stored
def test_api_accepts_curve(client): ...  # PUT furniture with curve, read back
```

- [ ] **Step 2: Run** `uv run pytest tests/test_curved_screens.py -q`. Expected: FAIL (no `curve` attribute, no `monitor-49`, no `footprint`).

- [ ] **Step 3: Implement.**
  - `Furniture`: add `curve` and `tilt` fields after `height`. Parse with `_num`; `None`/`""` stay `None`. Errors: `"A screen's curve must be between 500R and 10000R"`, `"A screen's tilt must be between -45° and 45°"`, `"A portrait screen cannot be curved"`.
  - `FURNITURE_SIZES["monitor-49"] = ('Super ultrawide 49"', 119.8, 12.0, "rect")`, `FURNITURE_HEIGHTS["monitor-49"] = (75, 33.7)`, matching row in `FURNITURE_CATALOG`.
  - `set_furniture`: when `kind == "monitor-49"` and the item gives no `curve`, store `1000`. Copy `curve` and `tilt` through when given.
  - `FurnitureItem`: `curve: float | None = Field(None, ge=500, le=10000)`, `tilt: float | None = Field(None, ge=-45, le=45)`.
  - `placement.footprint`: flat → `(x, y, width, depth)`. Curved: `R = curve / 10` (mm to cm), `half = width / (2R)`, chord `2R·sin(half)`, sagitta `R·(1−cos(half))`, depth `depth + sagitta`, center moved forward (along the item's front, `(-sin θ, cos θ)`) by `sagitta / 2`. `covers` and `room_text._corners` use it.

- [ ] **Step 4: Run** `uv run pytest -q`. Expected: all pass, including `test_assistant_read.py` catalog parity.

- [ ] **Step 5: Commit** `feat: save screen curve and tilt; add 49-inch super ultrawide`

---

### Task 2: Screen geometry module (TS)

**Files:**
- Modify: `frontend/src/types.ts:86-89` (`Furniture.curve?: number | null`, `tilt?: number | null`; replace the "Not saved yet" comment)
- Create: `frontend/src/lib/screen.ts`, `frontend/src/lib/screen.test.ts`
- Modify: `frontend/src/lib/rig.ts:17` (`covers` uses `footprintOf`), `frontend/src/lib/photo.ts:21` (same)

**Interfaces:**
- Produces (all in `screen.ts`):
  - `ASPECTS: { label: string; w: number; h: number }[]` = 16:9, 16:10, 21:9, 32:9
  - `sizeFromDiagonal(inches: number, w: number, h: number): { width: number; height: number }` (cm, 1 decimal)
  - `diagonalOf(item: Furniture): number` (inches, 1 decimal)
  - `isCurved(item: Furniture): boolean` (`!!item.curve && item.width >= (item.height ?? 0)`)
  - `arcOf(item: Furniture): { radius: number; angle: number; chord: number; sagitta: number }` (cm, radians; flat → radius `Infinity`, sagitta 0, chord = width)
  - `footprintOf(item: Furniture): { x: number; y: number; width: number; depth: number }`. Same numbers as Python `footprint`.
  - `screenSummary(item: Furniture): string`, e.g. `49" 32:9 · 1000R`, `27" portrait`, `27" 16:9`
  - `CURVES = [null, 1000, 1500, 1800, 2300, 3800]`

- [ ] **Step 1: Write failing tests** in `screen.test.ts`:
  - `sizeFromDiagonal(49, 32, 9)` → `{ width: 119.8, height: 33.7 }`; `sizeFromDiagonal(27, 16, 9)` → `{ width: 59.8, height: 33.6 }`
  - `arcOf` on the 49" 1000R → chord ≈ 112.8, sagitta ≈ 17.4 (±0.2), matching Task 1
  - `footprintOf` same numbers as Task 1; flat item returns its own x/y/width/depth exactly
  - `covers` from `rig.ts` true at a wing tip, false behind the body (same points as Task 1)
  - `isCurved` false for portrait even if `curve` is set; `screenSummary` gives the three strings above
- [ ] **Step 2: Run** `npm --prefix frontend test -- screen`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `screen.ts`; switch `rig.covers` and `photo.covers` to transform into the footprint frame.
- [ ] **Step 4: Run** `npm --prefix frontend test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: screen geometry (size, arc, footprint) in the frontend`

---

### Task 3: Fix current glare results before changing geometry

**Files:** Modify `frontend/src/lib/glareMath.test.ts`

- [ ] **Step 1:** Add `describe('flat screens stay as they were')` with `toMatchSnapshot()` on `trace(r)` for every room the file already builds (the `room(...)` calls in the `traceGlare` block), plus one new office room: two flat `monitor-27` side by side on a desk, a bias strip behind, a lamp at each side, a ceiling light, and a floor lamp behind the seat.
- [ ] **Step 2: Run** `npm --prefix frontend test -- glareMath`. Expected: PASS, snapshot file written.
- [ ] **Step 3: Commit** `test: record flat-screen glare results` (include the `__snapshots__` file).

---

### Task 4: Curved screens in the glare tracer

**Files:** Modify `frontend/src/lib/glareMath.ts`, `frontend/src/lib/glareMath.test.ts`

**Interfaces:**
- Consumes: `arcOf`, `isCurved` from Task 2.
- Produces:
  - `Display` gains `facet: number` (0 for flat) and `uMin: number; uMax: number` (in-plane bounds along `u`, margin already included). The existing `width` stays for drawing.
  - `facetsOf(item: Furniture): Display[]`: flat → `[displayOf(item)]` with `uMin = -width/2 - SCREEN_MARGIN_CM`, `uMax = +width/2 + SCREEN_MARGIN_CM`; curved → `FACETS` (= 12) displays.
  - `GlareScene.displays` = `furniture.filter(isDisplay).flatMap(facetsOf)`; curved screens are left out of `boxes`.

- [ ] **Step 1: Write failing tests** (new `describe('curved screens')`, using a 49" 1000R screen at (200, 100), rotation 0, tilt 0, elevation 75, height 33.7):
  - `facetsOf` returns 12; every facet normal, extended backward, passes within 0.5 cm of the axis of curvature at `(200, 101 + 100, *)` (the center of curvature is R in front of the panel middle); adjacent facets share an edge (corners equal to 0.01 cm).
  - Only the outer facets carry the 8 cm margin: `facets[0].uMin` includes it, `facets[0].uMax` does not; the reverse for `facets[11]`.
  - **Wing reflection:** a lamp at `(300, 150, 110)` → `screen_reflection` with the 1000R screen; the same lamp with `curve: null` → not `screen_reflection`. *(The builder checks these coordinates by hand when the test is first run; adjust the lamp, not the code, if 1000R geometry puts the bounce elsewhere, and leave a one-line comment with the angle.)*
  - **Self-occlusion:** a lamp just past the right wing tip, at the depth of the panel middle → no reflection off the left wing.
  - **Seam:** a lamp placed so its bounce lands exactly on the 6|7 seam → status `screen_reflection`, `hazards.length === 1`.
  - **Gentle curve:** a 24" 3800R screen gives the same statuses as flat for every lamp in the Task 3 office room.
  - Task 3 snapshots unchanged.
- [ ] **Step 2: Run** `npm --prefix frontend test -- glareMath`. Expected: new tests FAIL, snapshots PASS.
- [ ] **Step 3: Implement.**
  - In `reflection()`, replace the symmetric width check with `uMin <= dot(offset, u) <= uMax`.
  - Self-occlusion: a hit on facet *k* is dropped if `point→hit` or `hit→eye` crosses another facet of the same screen. Add `crossesQuad(a: Vec3, b: Vec3, d: Display): boolean`, a segment-against-rectangle test using `d.center`, `d.normal`, `d.u`, `d.v`, its half-width and `height/2`, with no margin.
  - Curved screens become occluders for other screens' rays and direct-view rays through `crossesQuad` on their facets. Flat screens stay boxes.
  - `behindScreen`: true if behind any facet of the screen within the existing limits.
  - Hazard de-dup stays keyed on `display` = furniture id, so a seam counts once.
  - **Learn by Doing point:** the facet loop in `facetsOf` (center, normal, `u` of facet *i*) is the one piece left as `TODO(human)` for the owner to write. The builder writes the surrounding function, the tests, and the margin handling.
- [ ] **Step 4: Run** `npm --prefix frontend test`. Expected: all pass; snapshots unchanged.
- [ ] **Step 5: Commit** `feat: trace glare off curved screens as facets`

---

### Task 5: Draw curved screens in 3D

**Files:** Modify `frontend/src/components/Room3DStage.tsx:295-303`; test in the existing `Room3DStage`/`Studio3D` test file.

- [ ] **Step 1: Test:** render the stage with a 1000R screen and assert 12 polygons inside `[data-screen="<id>"]`; a flat screen still renders 1.
- [ ] **Step 2: Implement:** replace `scene.displays.find(...)` with `filter(d => d.id === item.id)` and draw one polygon per facet with `displayCorners`, keeping the `front` class per facet. Add `data-screen={item.id}` on the `<g>`.
- [ ] **Step 3: Run** `npm --prefix frontend test`; **Commit** `feat: draw curved screens in the 3D view`

---

### Task 6: Draw curved screens on the 2D plan

**Files:** Modify `frontend/src/components/Shapes.tsx:87` (`FurnitureShape`); check that `PlanCanvas.tsx` hit-testing and the selection outline use `footprintOf`.

- [ ] **Step 1: Test** (`Shapes.test.tsx` or the existing plan test): a curved screen renders a `path` with class `furniture-screen-arc` and no `rect`; a flat monitor still renders its `rect`.
- [ ] **Step 2: Implement:** for `isCurved(item)`, draw a band between two concentric arcs, radius R (front face) and R + depth (back), spanning `±angle/2`, centered so the panel middle is at local `(0, depth/2)` (body center at the origin, front toward +y). The label stays at the origin.
- [ ] **Step 3: Run** tests; **Commit** `feat: curved screens on the room plan`

---

### Task 7: Screen panel in the inspector

**Files:** Modify `frontend/src/views/RoomDesigner.tsx:456-477` (furniture inspector) and `frontend/src/components/Studio3D.tsx:296` (list row); create `frontend/src/components/ScreenFields.tsx` + test.

**Interfaces:**
- `ScreenFields({ item, onChange }: { item: Furniture; onChange: (next: Furniture) => void })`. The caller does `updateLocalFurniture(next); void commitFurniture()`.

- [ ] **Step 1: Write failing tests** (`ScreenFields.test.tsx`):
  - Typing diagonal 49 with aspect 32:9 calls `onChange` with `width 119.8, height 33.7`.
  - Clicking **Portrait** on a curved 27" calls `onChange` with width/height swapped **and `curve: null`**; the curve control is disabled while portrait.
  - Choosing 1800R sets `curve: 1800`; choosing Flat sets `curve: null`.
  - The tilt slider (−45..45, default shown −12 for monitors) sets `tilt`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement** with the existing `Segmented`, `Slider`, `Field` components. Diagonal is in inches in every unit system (label `Diagonal (in)`). Curve options are `CURVES` plus `Custom…` (a number field, 500–10000). In `RoomDesigner`, render `<ScreenFields>` under the furniture fields when `isDisplay(selectedFurniture)`. In `Studio3D`, the list row uses `screenSummary(item)`.
- [ ] **Step 4: Run** all tests; **Commit** `feat: screen size, orientation, curve and tilt in the inspector`

---

### Task 8: Assistant docs and the owner's desk

**Files:** Modify `skills/myhuey-room-layout/SKILL.md` (catalog list line 41 gets `"monitor-49"`; one line: `curve` in mm R, `tilt` in degrees, no curved portrait); `skills/myhuey-basics/SKILL.md` (one line on curved screens near line 63).

- [ ] **Step 1:** Edit the two skills; run `uv run pytest -q` (the MCP `guide` tests read them).
- [ ] **Step 2: Build** `npm --prefix frontend run build`. Expected: success.
- [ ] **Step 3: Real-desk check** (Office only): `create_sandbox` from the active home; in the **Office** room of that sandbox, `set_furniture` with the G9 (`monitor-49`, 1000R) in the middle of the desk and a flat portrait screen at the left (width ≈ 33.6, height ≈ 59.8, rotated toward the seat). Open it in the app (`open_in_app`), go to the 3D tab, and confirm that curved facets draw and a lamp to the right of the seat shows a reflection in the G9's left wing. Ask the owner to compare the warnings with what they see on their real screens. Close any 8001 test-server tab afterwards.
- [ ] **Step 4:** One-off, not committed: trace the owner's saved Office room on `main` and on this branch, and diff the reports. Expected: identical, because nothing is curved yet.
- [ ] **Step 5: Commit** `docs: curved screens in the assistant skills`
