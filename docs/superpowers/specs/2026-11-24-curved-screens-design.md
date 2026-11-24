# Curved and portrait screens: design (2026-11-24)

## Why

MyHuey exists to cut eye strain at a coding desk, and the glare check is how it does that: it
traces which lights bounce off a screen into your eyes. Today every screen is a flat landscape
rectangle, so the check is wrong for the owner's own desk:

- the main screen is a Samsung Odyssey G9: 49" 32:9, 1000R (the OLED G9 is 1800R), on an arm,
  centered, with a window behind it;
- the left screen is a flat Dell turned to portrait on an arm, angled in toward the seat.

A curved screen is a concave mirror facing you. Its wings angle inward, so a lamp off to your right
can reflect in the left wing (and the reverse). A flat model calls that lamp clear. The point of
this work is **glare warnings the owner can trust at this desk**; the 3D view showing the real
shape is a side effect, not the goal.

## Goals

1. A screen can carry a **curve** given as its R-rating (1000R = 1000 mm radius), or be flat.
2. A screen can be **portrait** (taller than wide).
3. A screen's **size** can be set from what a spec sheet says: diagonal and aspect ratio.
4. The glare check traces reflections off the curved surface, not a flat stand-in.
5. The 3D view draws curved screens curved, and portrait screens upright.
6. All of it is saved with the room, and the assistant tools can set it.

## Non-goals

- The curved desk edge. A separate shape project; it barely affects glare.
- Window and sun glare on the screen (that's the v6 solar slice).
- Exact curved-surface optics (see Approaches).
- Anti-glare coatings, matte vs glossy, screen brightness.
- Making the Python roles and setup suggestions (`roles.py`, `setups.py`) aware of curves.
  Until a follow-up fixes them, they can suggest a lamp spot that the new check flags on a tight
  curve. That follow-up goes on the backlog.
- Python port of the glare tracer. Glare stays in the browser, as today
  (`frontend/src/lib/glareMath.ts`); Python only stores the new fields and passes caps through.

## Anti-goals (a failure even if it works)

- Existing rooms change their glare results. Every existing monitor must trace exactly as before:
  no curve unless someone sets one. Current glare tests pass unchanged.
- A curved screen that still reports a side lamp as clear when the lamp visibly reflects in a wing.
- Facet seams showing up as false hits or false misses (a light reflecting exactly on the line
  between two strips must not vanish or double-count beyond the existing de-duplication).

## Approaches considered

1. **Curved screen as N flat strips (picked by the owner).** At trace time a curved screen
   becomes ~12 narrow flat facets along its arc. The existing `reflection()` test runs on each,
   unchanged. The 3D view draws the same facets. Reuses tested code; error is well inside the 8 cm
   margin the check already allows.
2. **Exact ray-cylinder reflection.** Solve for the point on the cylinder where angle in equals
   angle out. Precise on paper, but new numeric code that is harder to test, and the precision
   vanishes inside the 8 cm margin. Rejected.
3. **Catalog presets only** ("49-inch 1800R"). Cannot match any other monitor and does not solve
   portrait. Rejected as the mechanism; one preset is still added for convenience (below).

## Data

`Furniture` (Python `src/myhuey/models.py`, API `FurnitureItem` in `src/myhuey/api.py`, TS
`frontend/src/types.ts`) gains:

| field | type | meaning |
|---|---|---|
| `curve` | `number \| null` | Curve radius in **mm**, as printed on the box (1000, 1500, 1800, 2300, 3800). `null` = flat. Valid range 500–10000. |
| `tilt` | `number \| null` | Already in TS, "not saved yet". Now saved. Degrees; negative leans back. `null` = default (−12° for monitors, 0 otherwise). Range −45..45. |

- `width` stays the **panel's own width** (along the arc for a curved screen): what diagonal ×
  aspect gives and what a spec sheet calls the screen width. `height` is the panel height.
  Portrait is simply `height > width`; no separate orientation field. *(My call: one source of
  truth, nothing to keep in sync.)*
- `depth` keeps meaning the body thickness. For a curved screen the plan footprint is derived:
  chord `c = 2R·sin(w / 2R)` wide, `depth + sagitta` deep where `sagitta = R·(1 − cos(w / 2R))`.
  The 2D plan and `covers()` use the derived footprint for curved screens.
- **Anchor** *(my call)*: `(x, y)` stays the middle of the panel body, as today, so the screen's
  center does not move when a curve is set or changed. The wings reach forward by `sagitta` past
  the current footprint, so the derived footprint sits off center toward the front. `covers()`,
  the 2D drawing, and the `room_text` overlap checks use that off-center footprint.
- **Curved + portrait** *(my call)*: not allowed. The UI disables the curve control for a
  portrait screen, and the API rejects `curve` when `height > width`. The owner's portrait screen
  is flat.
- New fields are optional with `null` defaults, so old rooms load unchanged. No schema migration
  is needed; check `migrations.py` and only bump if a version test requires it.
- `set_furniture` (assistant tool), the CLI where it takes furniture, and the HTTP API accept
  `curve` and `tilt`. The `myhuey-room-layout` skill and `guide` text mention them in one line each.

## Geometry (frontend/src/lib/glareMath.ts)

- `displayOf(item)` returns **`Display[]`** (one for flat, `N = 12` facets for curved), or a new
  `facetsOf(item)` is added beside it; the builder picks the cleaner signature. Callers
  (`glareScene`, `Room3DStage`) are updated.
- The arc's center of curvature sits `R` in front of the screen's front-face middle, on the tilted
  normal. Facet `i` spans arc angle `[θ_i, θ_{i+1}]` across `w / R` total; its center is on the arc,
  its normal points at the axis of curvature (tilt applied as today), its `width` is its chord.
- **Margins:** the 8 cm `SCREEN_MARGIN_CM` applies only at the outer edges of the whole screen.
  Inner facet edges get zero margin, so neighbours tile without overlap. Implement by giving each
  facet a `[uMin, uMax]` bound instead of a symmetric half-width, or equivalent.
- **Seams:** a hit exactly on a shared edge may land on both facets; the existing de-dup (same kind
  + same display) keys on the **screen id**, not the facet, so it still counts once. Facets carry
  `id` = the furniture id and a separate `facet` index.
- **Bias check** (`behindScreen`): true if the point is behind any facet within the same limits.
- **Occlusion** *(my call: the anti-goal wins)*: a curved screen can block light from reaching
  its own other wing. A bounce off facet *k* is dropped when either leg, light→hit or hit→eye,
  crosses any other facet of the same screen. This is a segment-against-quad test on the facets,
  not a box. For blocking rays to **other** objects, a curved screen is its facets, so the hollow
  in front of it stays empty. Flat screens keep today's box and the `except` rule.
- **Seat** (`seatOf`): unchanged: 60 cm in front of the screens' mean center. Portrait screens use
  their real `height` for the target point (already the case).
- Flat screens go through exactly the current code path. *(My call)*: before any geometry
  change, add snapshot tests that record the full `traceGlare` report for the rooms that
  `glareMath.test.ts` already builds, plus one office-style room with two flat screens. Those
  snapshots must not change. Also run the report once against the owner's saved Office room before
  and after; that check is a one-off and is not committed.

## UI

- **Studio 3D sidebar, "Room items":** selecting a screen opens a **Screen** panel:
  - Size: diagonal (inches; metric rooms show inches too, since screens are sold that way) and
    aspect (16:9, 16:10, 21:9, 32:9, custom W×H). Sets `width`/`height`.
  - Orientation: Landscape / Portrait segmented control (swaps width and height).
  - Curve: Flat, 1000R, 1500R, 1800R, 2300R, 3800R, custom number.
  - Height off the desk/floor (`elevation`) and tilt, since arms move both.
  - Edits commit like other room edits (same save path and undo behavior as a light change).
- The list row reads e.g. `screen · 49" 32:9 · 1800R` or `screen · 27" portrait`.
- 3D: a curved screen draws as its facet polygons (back faces hidden as today). Portrait just works
  from width/height.
- 2D plan: curved screens draw as an arc band (chord + sagitta), not a rectangle.
- Catalog: add `monitor-49` (`Super ultrawide 49"`, 32:9, 1000R default, matching the Odyssey G9) in both
  `FURNITURE_SIZES` and `FURNITURE_CATALOG` (a test keeps them in step), and its row in
  `FURNITURE_HEIGHTS`. Existing catalog monitors stay flat.

## Tests

- Unit (TS): facet geometry (chord, sagitta, normals converge on the axis); a lamp to the right
  reflects in the left wing of a 1000R screen and not in a flat one of the same size; a lamp
  centered behind the seat reflects in the middle facet; seam hit counted once; flat rooms
  unchanged (snapshot of the current fixtures).
- Python: `curve`/`tilt` round-trip, validation ranges, old room dicts load with `null`s,
  `set_furniture` accepts them.
- Run `uv run pytest -q` and `npm --prefix frontend test`.
- Real-desk check: build the owner's desk in a sandbox of the **Office** room (never a new test
  room): a 1000R G9 in the middle and a flat portrait screen at the left, angled in. Confirm that a
  lamp on the right of the seat shows in the G9's left wing when it should. Then compare the
  warnings with what the owner actually sees reflected in the screens.

## Left to the builder

- Facet count (12 is the starting point; fewer is fine if tests show no difference).
- Exact component split for the Screen panel and arc drawing in the 2D plan.
- Whether diagonal/aspect are stored or only derived in the UI (stored data is width/height).
