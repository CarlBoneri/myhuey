# Photo-driven setup, scenario 1 — design

Date: 2026-11-15 · Status: approved by the user in conversation ("nothing wrong, complete the build")

## Intent

myhuey's mission is less eye strain for coders. A real photo of the room is where people
judge glare and bias light best, because they can see it. Scenario 1 (Hue lights already
installed): tag the lights, desk, monitors, and windows on a photo of the room. The tags
link to the floor plan, and suggestions are drawn back onto the photo as a soft glow at each
light, with the role it plays, so the user can judge a scene on their real room.

Scenario 2 (no Hue yet; "planned" catalog lights placed on the photo, plus generated setups)
is a later project. Nothing here may block it.

## Decisions

**Decided by the user**
- Scenario 1 first.
- Option C for mapping. Tag in both places now: the photo links to plan items by ID and
  never moves them. A four-floor-corner perspective transform comes with scenario 2; the
  data model reserves room for it.
- Tagging as played back: lights, furniture, and openings can be tagged. Height presets
  live on the photo. Schema v5. One photo per room for now.

**My calls** (the user handed these over)
- **Glow:** rendered without AI, as an SVG layer over the photo.
  - Each lit light is a radial gradient in its color, blended with `mix-blend-mode: screen`.
  - The radius grows with brightness and the marker's scale.
  - Gradient-capable lights get one blob per gradient color along the marker's rotation.
  - A black multiply layer darkens the photo to the scene's overall level, so a dim
    night scene looks dim.
- **The photo as the glare view:** the Photo tab gets the Suggest panel. The selected card
  is drawn on the photo, with a small role badge at each light (bias, task, view, behind),
  so view and behind lights (glare and reflection risks) stand out. This is the first
  piece of roadmap step 2; a second photo from the chair stays with step 2.
- **Height presets** are worked out in the browser from the plan and saved through the
  existing light placement endpoint (`elevation`):
  - **Floor:** 0.
  - **Desk top:** the desk under the light, or else the nearest desk: its elevation plus
    its height.
  - **Eye level:** 155 cm with a standing desk in the room, otherwise 115.
  - **Ceiling:** the room's ceiling.
  - **Auto:** clears the value.
- **CLI:** `room tags --name R` lists the tags. `room tag --name R --item light:26 --x 0.4
  --y 0.6` adds or moves one, and `room untag --name R --item ...` removes one. Dragging
  on the photo counts as drawing, which the user's CLI exception covers. Tags still have
  CLI parity for setting and listing them.

## Data (schema v5)

- `RoomPhoto.placements` becomes `RoomPhoto.tags`, a dict from a key to a spot.
  - Keys: `light:<light_id>`, `furniture:<id>`, or `opening:<id>`.
  - Spots: `{x, y}` as 0–1 fractions, plus `rotation` and `scale` (defaults 0 and 1).
- `RoomPhoto.floor_transform: None`, reserved for the scenario 2 homography.
- **Migration v4→v5:** each `placements[id]` becomes `tags["light:" + id]`, and
  `floor_transform` is set to None. A backup is written as usual.
- **Validation:** the kind must be light, furniture, or opening, and the ID must exist in
  the room. Removing a light, furniture piece, or opening drops its tag.
- **API**
  - `PUT /api/rooms/{room}/photo/tags {tags}` replaces the set of tags.
  - `PUT /photo/placements` stays as a compatibility alias that rewrites only the light
    tags.

## UI

- **Photo tab tray:** "On the plan, not on the photo", grouped as Lights, Furniture, and
  Windows & doors. Each item can be dragged onto the photo, or "Place in the middle".
- **Markers:** lights keep their Hue icon. Furniture and openings get a labeled outline pin.
- **Selected light:** the existing controls plus a Height row of presets: Floor, Desk top,
  Eye level, Ceiling, Auto.
- **Suggest on the photo:** the Photo tab gets a Suggest button and panel, the same
  component as on the plan. Choosing a card ("Show on photo") renders its preview as
  glow, with role badges. Live glow still shows when no suggestion is selected.

## Non-goals

- Planned lights.
- The perspective transform.
- Creating plan items from the photo.
- Several photos per room.
- AI.
- Network at runtime.

## Testing

- **pytest:** migration v4→v5; tag validation; tags dropped when an item is removed; the
  placements alias; the CLI tag commands.
- **vitest:**
  - height presets
  - the glow layout: color, radius from brightness, gradient blobs along rotation, and
    nothing drawn for lights that are off
  - the darkening level
- **Browser check:** a database copy on a second server, Office only.
