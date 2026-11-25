# Desk designer and mounted bias lights: design (2026-11-24)

## Why

Two problems the owner hits when planning a desk in MyHuey:

1. **Desk pieces drift.** The screens, lamps, and other things on a desk do not stay together.
   The 3D view carries "riders" when a desk moves, but it decides what rides by footprint: a
   screen on an arm past the desk's edge is left behind, and the 2D plan carries nothing.
2. **Bias lights draw wrong.** A Hue strip on the back of a screen is stored as a flat line at
   one height with a glow pool on the floor. In real life it loops around the back of the screen,
   faces the wall, and throws a halo past all four edges (owner's photos: a wall-arm TV with a
   gradient strip inset from the edges, framed by an even glow).

The owner's answer: an isolated **desk designer** to lay out a desk set once (desk, screens,
peripherals, lights), placed into any room as one piece whose contents are locked; plus lights
that can be **mounted on a screen's back** and show their halo. It must be general, for anyone's
desk, not tuned to the owner's.

## Goals

1. A library of **desk designs**, app-wide, made in a desk designer that is not tied to a room.
2. **Placing** a design in a room stamps a copy (the owner chose stamped over linked): a **desk
   set** whose members move and turn together on the plan and in 3D, and cannot be moved one by one.
3. A placed set can be **edited in the desk designer** (changes only that set), **saved as a new
   design**, or **released** (members become ordinary pieces where they stand).
4. A light can be **mounted on a screen** (in a set or not, so a TV on a wall works too). A
   mounted light takes its place, height, and facing from the screen, follows it, and is a bias light.
5. The 3D view draws a mounted light as a loop on the screen's back and its **halo on whatever
   surface is behind the screen**, sized by the gap; nothing close behind means no halo.
6. Peripherals in the catalog: laptop (closed), keyboard, speaker.
7. **Your eyes are your setting, not a desk's** (owner, 2026-11-24): sitting eye height (above the
   seat, default 69 cm), standing eye height (default 155 cm), and screen distance (default 60 cm),
   saved with the preferences on the server so the browser tracer and Python roles agree.
8. **Chair controls** (owner, 2026-11-24): a chair can be marked "I sit here" with a seat height
   (default 46 cm). With a seat chair, the eye sits over that chair at seat + sitting eye height
   (standing: standing eye height at the same spot); without one, as today (60 cm in front of the
   screens, seated eyes 46 + 69 = 115 cm, the current number). A chair added in the desk designer
   is the seat. Edited in the chair's inspector, the Studio posture panel (eyes shown as
   "seat + sitting eye"), and Settings.

## Non-goals

- Linked designs (a placed set following later edits of its design). Rejected: sandboxes are
  copies of the home, so a linked edit made in a sandbox would change the active home.
- Arms as objects. A screen on an arm is a screen placed where the arm holds it.
- Blinds, curtains, wall colour. A window behind a screen is treated as a surface like a wall.
- Halo physics beyond a falloff with distance (no bounce light, no colour mixing per segment).
- A CLI for desk designs (the API and the assistant tools cover it).
- The curved-desk shape.

## Anti-goals (a failure even if it works)

- A room with no desk sets and no mounted lights changes at all (saved data, glare, drawing).
- Placing or editing a desk set in a sandbox touches the active home.
- A design stores a real light's bridge ID (designs are for reuse and may be shared).
- Moving a set leaves a member behind, or a mounted light separated from its screen.

## Approaches considered

1. **Group membership on room items, absolute positions (picked).** Members keep their real room
   coordinates (so glare, roles, photo, and every reader work unchanged) and carry a `set` id; a
   move transforms all members rigidly. The library stores designs in desk-local coordinates.
2. **Nested set object holding local coordinates.** The room stores the set, and readers expand
   it into furniture. Cleaner on paper, but every reader of `room.furniture` (Python roles, setups,
   room text, glare, photo, 3D, plan) would need to expand sets first. Rejected: wide blast radius.
3. **Footprint riders, improved.** Widen the rider test to include overhangs. Rejected: still a
   guess, and the plan has no riders at all; the owner asked for locking.

## Data

- **App-wide `desks`** (beside `groups`, outside the layout keys, so every layout sees them):
  `{id, name, items: [...], lights: [...]}` in **desk-local cm**: the base desk sits at (0, 0)
  with rotation 0 (its front, the seat side, faces +y, like every piece). Items are furniture
  dicts with a local `key`; lights are `{key, catalog, label, x, y, elevation, rotation, length,
  mount}` where `catalog` is a light catalog id and `mount` is `{"screen": <item key>}` or null.
- **Room** gains `desk_sets: [{id, name, base}]` (`base` = the anchor furniture id). Old rooms
  load with `[]`.
- **Furniture** gains `set: str | null`. **LayoutLight** gains `set: str | null` and
  `mount: {"screen": <furniture id>} | null`. Old data loads with nulls.
- **Mount rules** (Python on every save, mirrored in TS for live previews): a mounted light sits
  at the screen's back-face middle, at the screen's middle height, turned like the screen, with
  role `bias`. A mount whose screen is gone is dropped and the light stays where it was. A set
  whose base is gone dissolves (members released).
- **Furniture** also gains `seat: float | null` (seat height in cm, 30–90): non-null means "I
  sit here". **Preferences** gain `eye_sitting` (69), `eye_standing` (155), `screen_distance` (60).
- **Peripherals**: `laptop` (31 × 22, 2 high), `keyboard` (44 × 14, 3 high), `speaker`
  (12 × 15, 20 high) in `FURNITURE_SIZES`, `FURNITURE_HEIGHTS`, and `FURNITURE_CATALOG`. A
  closed laptop is not a screen.

## Behaviour

- **Place** (`place_desk(room, design, x, y, rotation)`): new set id; every item gets a new
  furniture id; every light becomes a new planned light (`planned-<hex>`) from its catalog id;
  mounts are mapped to the new screen ids. The base is the design's first desk kind, else its
  first item. Works in the active home from the app, and only in sandboxes from the assistant tools.
- **Move**: on the plan and in 3D, dragging any member moves the set; the base's rotate handle
  turns it. Members' inspectors show "Part of <set> · Edit in desk designer · Save as design ·
  Release" instead of position fields. A mounted light follows its screen everywhere.
- **Edit a placed set**: the designer opens it in desk-local coordinates; Apply replaces the
  set's members (ids kept where they came from the room; new lights planned; a real light removed
  from the set is released, not removed from the room).
- **Save as design**: real lights become catalog lights by `product.catalog` or by archetype
  (reverse map of `catalog.py`); a light that maps to nothing is left out and the reply says so.
- **Halo** (`lib/halo.ts`): from the screen's back-face middle, cast along its back direction to
  the room outline. Gap `g`; no halo past 150 cm. On that wall: the screen's rectangle grown by
  `spread = 10 + 0.9·g` on each side, centred at the screen's height, clipped to floor and
  ceiling, opacity `0.55·(1 − g/150)`, in the light's live colour, drawn soft and behind furniture.
- **Glare**: a mounted light is role `bias`, which the tracer already treats as a bias light.

## UI

- New Studio view **Desk designer** (`#/studio/desks`, `#/studio/desks/<design>`, and
  `#/studio/room/<room>/set/<set>` for a placed set) with its own tab "Studio · Desks".
- Layout like the room designer: a stage with Plan / 3D toggle (a preview bench 300 × 220 cm
  with a wall behind the desk at an adjustable gap, preview only), and a sidebar: designs list
  (open, new, delete with confirm), name, the selected piece (position, size, Screen fields,
  mount for lights), furniture and light catalogs, Save / Save as new / Place in room.
- Room designer: a "Desk sets" panel to place a design at the room's middle; the set panel on
  members; a "Mounted on" choice in a light's inspector listing the room's screens.
- Plan: a mounted light draws as a bar across its screen's back, the screen's width.

## Assistant

Two tools: `desk_designs` (list) and `place_desk` (sandbox only, like every layout write). One
line each in `myhuey-room-layout` and `myhuey-basics`.

## Tests

Python: model round-trips with old data; mount resolution (follows, dropped when the screen goes,
forces bias); place (ids, mapping, sandbox rule for the tools); release; set dissolves without
its base; save-as-design never stores a real id. TS: halo geometry (wall, window edge, too far,
clipping); set moves carry members and mounted lights; designer and room designer flows.

## Builder check answers (my calls, on the owner's "build full feature on auto")

1. **The lock is the app's; the server keeps data consistent.** Every room save re-places
   mounted lights from their screens, drops mounts whose screen is gone, and dissolves sets whose
   base is gone. Moving a set is **one server call** (`move_desk_set(room, set, x, y, rotation)`),
   so a failure cannot leave a light behind. `update_room(furniture=...)` may rewrite mounted
   lights' geometry in the same save. The assistant's `set_furniture` passes `id`, `set`, and
   `seat` through when given, so a rewrite that keeps ids keeps sets.
2. **The halo lands on the room outline only** (walls and windows). Furniture behind a screen
   neither catches nor blocks it. Possible follow-up.
3. **Mounting keeps the strip's stored `length`.** The loop is drawn around the screen's back,
   inset 6 cm: a full loop when the strip is long enough, otherwise a U open at the bottom. For
   the glare check, a mounted light is one point at its mount (it is behind the screen and pinned
   bias), not points spread along its length.
4. **Joining a set**: by placing a design, or by editing the placed set in the desk designer
   (which adds catalog furniture and lights). Real lights enter as planned lights swapped later
   (`swap_planned_light` keeps `set` and `mount`). Mounting a light on a set's screen makes it a
   member. No bridge-light tray in the designer.
5. **Locked on a member in the room**: position, rotation, height off the floor, size, and the
   screen's shape, curve and tilt, and a light's mount. Label and light controls (on, colour,
   brightness) stay editable. Python does not refuse member edits; the inspector hides them.
6. **Standing**: in a set whose base is a sit-stand desk, every member at or above the desk's top
   rises with it, arm-mounted screens included (the chair stays). Pieces outside sets keep today's
   footprint riders.
7. **Saved data may gain null or empty keys** (`set`, `mount`, `seat`, `desk_sets`), as `curve`
   and `tilt` did; no schema bump. "Nothing changes" means behaviour and results.
8. See 1: one call per set move.

## Left to the builder

Exact component split of the desk designer; drawing order and softness of the halo; whether
the designer reuses `PlanCanvas` and `Room3DStage` directly on a synthetic room (preferred).
