# Refresh rooms from Hue — design

Approved 2026-11-22 (short design; the owner approved the proposal in chat).

## Why

After a remodel, bulbs move between rooms in the Hue app, but MyHuey's rooms keep their old
light lists. "Import from Hue" only adds rooms MyHuey doesn't have, and it matches rooms by name,
so a room renamed in MyHuey would be imported a second time. The owner wants one action that pulls
the Hue rooms and puts each light in the room it now belongs to.

## Goals

- One action, **Refresh from Hue**, that brings every MyHuey room linked to a Hue room back in line
  with that Hue room's lights, and adds Hue rooms MyHuey doesn't have yet.
- Show what will change before anything is saved; save only on **Apply**.
- Lights that arrive are easy to find and place; lights that stayed don't move.

## Non-goals

- Changing anything on the bridge. Refresh only reads the bridge.
- Redrawing walls, furniture, or photos (a fuller "remodel" reset may come later).
- An assistant (MCP) tool. Assistants never edit the active home.
- Syncing Hue zones, or renaming lights from their Hue names.

## Anti-goals (it fails even if it "works" when…)

- A light is removed or added without the person having seen it in the preview.
- Planned lights (not bought yet) or hand-drawn rooms with no Hue match get touched.
- A renamed room is duplicated.

## Approaches

1. **Refresh with a preview, in the open layout (chosen).** Read the bridge, show a per-room list of
   arrivals and departures, apply in one save. Works the same in the active home or a sandbox.
2. Refresh only inside a new sandbox copy. Safer against mistakes but heavy for a small change, and
   the preview already guards against surprises.
3. Additive only (never remove lights). Leaves the old room wrong after a remodel, which is the
   problem being solved.

## The design

- **Link.** A MyHuey room gets an optional `hue_room` (the bridge's room id, v1 group id). A room is
  matched by `hue_room` first, then by name (the cleaned name Import uses, `/` → `-`), and the id is
  stored on Apply. After that a rename doesn't break the link. Import also stores it.
- **Preview** (bridge reads only). For each Hue room (type `Room`):
  - matched room: `arrive` = Hue lights not in the MyHuey room; `leave` = real (not planned) MyHuey
    lights not in the Hue room. Each line names where the light came from / went to (the other
    room's MyHuey name, else its Hue name, else nothing).
  - no match: a **new** room, added with its lights on a grid, as Import does today.
  - MyHuey rooms with no Hue match (or whose linked Hue room is gone) are listed as **left alone**.
- **Apply** recomputes from the bridge, refuses if the result differs from the preview the person saw
  (a fingerprint of the change list), then saves everything in one write.
  - Arrivals line up just inside the room's top wall, 60 cm apart, wrapping to a new row. They carry
    the label, product, and cut length from the room they left (or the Hue name and product if they
    weren't placed anywhere); position, rotation, height, and role start fresh (`auto`). They are
    marked `metadata.arrived = true`; moving the light clears the mark.
  - Departures are removed with their photo tags. Scenes are left as they are (they colour lights by
    where they sit; a per-light setting for a light that left is simply unused).
- **Where it shows.** The Plan view's "Import from Hue" button becomes "Refresh from Hue" and opens a
  preview panel with Cancel and Apply. The Room Designer lists lights marked as arrived ("New from
  Hue: drag into place"). CLI: `myhuey room refresh` prints the preview; `--apply` applies it. The
  Setup wizard keeps its first-time Import.

## Left to the builder

Exact copy, panel layout, and the fingerprint's form, within the above.

## As built

- Matching runs in three passes. Rooms linked by `hue_room` claim their Hue rooms first, then
  unlinked rooms match by cleaned name. Last, an unlinked room still unmatched takes the unclaimed
  Hue room that holds the most of its real lights: at least one shared light, and a tie links
  nothing. That catches a room renamed before links existed, so it isn't duplicated.
- An arrival's label, product, and cut length come from the rooms as they were loaded before the
  apply, so a light removed earlier in the same apply still carries them.
- A light that arrives from a room left alone also stays there, since rooms left alone are never
  changed. The preview says so: `+ Desk strip (also in Garage)`, and `Move.also` is true.
- Each change carries `hue_name`, the Hue room's name. When a room is linked this time under a
  different name, the panel and the CLI show it: `Family room (Hue: Den)`.
- `myhuey room refresh --apply` with nothing new or changed and nothing to link prints the preview
  and applies nothing.
- Arrival spots walk the same grid but skip points outside the room's outline, so an L-shaped room
  doesn't get lights in its notch. If the outline holds too few, the rest fall back to the grid.
- The bridge is read before the rooms are loaded, to keep the window for overwriting another edit
  small. Opening another layout drops a held preview.
