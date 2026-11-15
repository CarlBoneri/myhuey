# Photo-driven setup, scenario 2: planned lights and generated setups — design

Date: 2026-11-15 · Status: the user said "build it". The choices below are mine unless marked
as the user's.

## Intent

Some people don't own Hue lights yet, or want to add more. They should be able to plan a
setup on their room before buying anything:
- place catalog lights on the photo or the plan
- ask myhuey for setups that are easy on the eyes, such as "a gradient strip behind the
  monitor and a floor lamp to your left", and see the scenes each setup enables
- once a real light is paired, swap the planned light for it.

The mission is unchanged: less eye strain for coders.

## Decided by the user (earlier in the conversation)

- Planned lights get roles, heights, and suggestions. Apply and sync skip them, and a later
  step swaps a planned light for a real one once it's paired.
- The floor plan stays the source of truth. The photo is input and output.
- Option B, the four-floor-corner perspective transform, arrives with scenario 2.
- No AI, local-first, no runtime network.

## Design (my calls)

### Catalog

`catalog.py` lists the products you can plan with. Each has an `id`, a `label`, an
`archetype` and `productname` (so `light_profile` and the suggester treat it like the real
product), a `kind` (bias, task, side, or ambient: what it's good for), a `color` capability,
and a default height rule.

| id | product | color |
|---|---|---|
| gradient-strip | Gradient lightstrip | gradient |
| play-gradient-tv | Play gradient strip for a TV | gradient |
| play-bar | Play light bar | color |
| floor-lamp | Floor lamp (Signe gradient) | gradient |
| floor-shade | Floor lamp with a shade, color bulb | color |
| table-lamp | Table lamp | color |
| desk-lamp | Flexible desk lamp, white ambiance | white |
| go | Go portable lamp | color |
| ceiling | Ceiling light, white ambiance | white |
| wall-washer | Wall washer | gradient |
| spot | Floor or ground spot | color |

The color capability is one of `gradient`, `color`, or `white` (white ambiance only). It's
the catalog's own fact: real lights still report their abilities through the bridge.

API: `GET /api/catalog`. CLI: `myhuey catalog`.

### Planned lights

A planned light is a `LayoutLight` with `planned: true`, an ID `planned-<hex>`, and
`product = {archetype, productname, catalog: <id>}`.
- **Schema:** no version bump. The new field defaults to false, so older documents read
  unchanged.
- **Create:** `POST /api/rooms/{room}/planned-lights {catalog, x, y, label?, rotation?,
  elevation?}`. CLI: `room plan-light --name R --catalog floor-lamp --x 100 --y 80`.
- **Move, height, role:** the existing placement endpoint works for them.
- **Skipped by everything that writes to the bridge:**
  - `_apply` (scenes and suggestion previews): the result says `planned: true` and
    `applied: false`, with no error.
  - room power and room brightness
  - `_remember_products`, which never matches them anyway
  - Hue sync (roadmap step 3) must skip them too.
- **Swap:** `POST /api/rooms/{room}/planned-lights/{id}/swap {light_id}` turns a planned
  light into a real one.
  - It keeps position, rotation, height, role, label, and the photo tag (`light:planned-x`
    becomes `light:<real>`).
  - The product becomes empty, and the next `lights()` refresh fills it in from the bridge.
  - It's refused if that real light is already placed in the room.
  - CLI: `room swap --name R --light-id planned-ab12 --real 26`.
- **Suggester:**
  - Planned lights take part like real ones.
  - A planned light whose catalog color is `white` gets a `white` override instead of
    palette colors, at the same brightness.
  - Real lights are unchanged: their color ability is only known from the bridge, and apply
    already gives white-only bulbs the nearest white.

### Generated setups

`setups.py`: `generate_setups(room) -> list[Setup]`, built from the desk focus.
- **With no desk focus:** one "ambient only" setup with two corner lights, plus the hint
  "Add a desk and monitor on the plan for desk setups".
- **Building blocks:** each block places one catalog light relative to the seat (S), gaze
  (g), left vector (l = (g.y, −g.x)), screen (M), and room outline:
  - **bias:** gradient strip 12 cm behind the screen centroid along g, at the screen's mid
    height.
  - **side lamp (left or right):** floor lamp 90 cm from the seat along ±l, then 20 cm back
    along −g, keeping it beside the seat: outside the view cone and not behind. "Left" is
    used if it lands inside the room, otherwise the right.
  - **desk lamp:** desk lamp on the desk, 35 cm along ±l from the screen centroid, with an
    automatic height (on the desk).
  - **corner wash:** wall washer in the room corner farthest from the gaze line that isn't
    behind the seat (angle from gaze < 110°). If none, the farthest corner off to the side.
    Pulled 25 cm toward the centroid.
- **Points outside the room outline** are pulled toward the seat until they fit. A block
  that still doesn't fit is dropped.
- **Setups (in order):**
  1. "Bias light": bias
  2. "Bias + side lamp": bias and a side lamp
  3. "Bias + desk lamp": bias and a desk lamp
  4. "Full desk": bias, a side lamp, and a corner wash
- **For each setup:** run `suggest()` on a copy of the room with the setup's planned lights
  added, for the modes code, work, read, and relax, at the current time, one card each. The
  setup reports each light's role in each mode and a one-line summary per mode.
- **Each setup lists its lights** as `{catalog, label, x, y, elevation, rotation, why}`, where
  `why` is a short reason ("behind your monitor: bias light cuts the contrast between screen
  and wall").
- **API and CLI:** `GET /api/rooms/{room}/setups`. `POST /api/rooms/{room}/setups/apply
  {index}` adds that setup's lights as planned lights. CLI: `myhuey setups --room R [--add N]`.

### Photo-to-floor mapping (option B)

- `RoomPhoto.floor_transform = {"photo": [[u, v] × 4], "plan": [[x, y] × 4]}`. The photo
  points are 0–1 fractions, and the plan points are room cm, usually outline corners. The
  model validates this: four points each, inside 0–1, with no three photo points in a line.
- **API:** `PUT /api/rooms/{room}/photo/floor {photo, plan}`, and `DELETE` to clear it. CLI:
  `room floor --name R --photo "u,v;u,v;u,v;u,v" --plan "x,y;..."`.
- **The homography:** a 4-point DLT solved in TypeScript (`lib/homography.ts`, unit-tested
  round trip). It maps photo → plan when a catalog light is dropped on the photo, and plan
  → photo so a planned light placed on the plan, or added by a setup, gets a photo tag
  automatically.
  - A drop is read as the light's floor point: for a lamp that's its base, for a strip the
    floor under it.
  - The height comes from the catalog default, adjustable with the photo height presets.
- **Calibration UI on the Photo tab:** "Map the floor" asks for four floor points on the
  photo, then, for each, which plan corner it is, picked from a mini plan with numbered
  corners. Without a mapping, a catalog light dropped on the photo is placed at the room
  centroid on the plan, and a hint offers "Map the floor" so drops land where they belong.

### UI

- **Plan (room view):**
  - Planned lights are drawn as dashed ghosts with a "planned" label.
  - Light details for a planned light show "Planned: <catalog label>", height, role, a
    "Swap for a real light" select of the room's unplaced bridge lights, and Remove.
  - The plan's sidebar gets a "Plan lights" panel with the catalog (drag or click to add)
    and a "Suggest setups" list. Each setup card shows a mini room with the proposed lights,
    the reason for each, a role and summary row per mode, and "Add to plan".
- **Photo tab:** a catalog tray ("Plan a light") whose items are dragged onto the photo, the
  "Map the floor" calibration, and planned lights drawn with a dashed marker.
- **Suggest panel:** works unchanged, because planned lights are just lights. "Preview on
  lights" skips them, and the toast says how many were planned.

## Non-goals

- Buying links or prices.
- Lens-distortion correction.
- Heights from the photo beyond the presets.
- Several photos per room.
- Hue sync (step 3).
- Creating furniture from the photo.

## Testing

- **pytest:**
  - the catalog shape
  - planned create, move, swap, and remove, plus tag renaming
  - apply, power, and brightness skip planned lights (the fake bridge gets no PUT for them)
  - the suggester gives white-capability planned lights white
  - the setup generator: positions relative to the seat; left versus right when the wall is
    near; the bias block behind the screen; no setups without a desk focus; every setup's
    lights inside the outline; and side lamps never in view or behind
  - floor-transform validation
  - the API and the CLI
- **vitest:** the homography (a known square-to-trapezoid case and round trips) and helpers.
- **Browser check:** a database copy, Office only. Map the floor, drop a floor lamp on the
  photo, generate setups, add one, show a suggestion on the photo, and swap a planned light
  for a real one on the copy.
