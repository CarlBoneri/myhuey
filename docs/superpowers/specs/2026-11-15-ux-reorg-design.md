# Reorganise the app around what people do with it

Status: approved in conversation 2026-11-15 ("A and build on auto").

## Intent

Today the tabs don't each own a job. Two screens are titled "Floor plan". Room editing is split
across Home, Plan and the room page. Light controls live in four places. The eye-comfort
suggestions, which are the point of the app, sit behind a button on a setup screen.

The owner's day-to-day use is short. They open the app and get to a room (usually the Office).
They turn it on or off, dim it, or switch it to evening or late-work lighting that's easy on the
eyes. Now and then they set up layouts and make scenes from images or colours. It's a free, open
source app, so the layout has to make sense to a stranger with any number of rooms.

## Goals

- **Home is for control.** It has two containers:
  - **Quick settings:** one row per room with on/off and a brightness slider.
  - **Rooms:** square tiles, each showing on/off, brightness and the room's live colours as chips.
- **Each tile has a small vertical ⋮ menu** that opens quick settings for that room:
  - Eye-comfort suggestions for the current time, with a mode picker (Code/Work/Study/Read/Relax).
  - The room's saved scenes.
  - One tap applies a suggestion or scene to the real lights.
- **Clicking a tile opens the room's workbench.** The workbench is for using and tuning one room:
  - Room power and dimmer.
  - Every light with its own controls.
  - The room's scenes, with Apply.
  - The full suggestions panel.
  - No shape, furniture or placement editing.
- **Studio is for building.** It holds:
  - The whole-home floor plan with layouts and sandboxes.
  - Plan image, scale, trace and draw.
  - Moving and reshaping rooms.
  - Adding a room by size, and importing rooms from Hue.
  - The room designer (outline, furniture, doors and windows, light placement).
  - The room photo, with lights pinned on it and suggestions shown on the photo.
- **The rail has four tabs:** Home, Studio, Scenes, Settings.
  - Settings holds the bridge, preferences, the CLI sheet and the full light list ("Lights" section).
- **Trace hover tells you why a spot won't trace.** When it would leak, sit on a wall or be too
  small, the hint says so before you click. A click on such a spot changes the hint and raises no
  toast.

## Non-goals

- Backend or storage changes. The existing endpoints and the `X-Myhuey-Layout` header already do
  everything needed.
- A real 3-D view. "3-D" here means the existing photo work.
- New scene-making features, and any change to the scene editor's insides.
- Visual restyling beyond what the new screens need.

## Anti-goals

- **The daily job taking more than two taps.** From opening the app: tap ⋮, then tap a suggestion.
- **A sandbox ever changing what Home controls.** Home and its ⋮ menu always act on the Active
  layout.
- **Breaking old links.** Hashes like `#/plan`, `#/plan/Office`, `#/room/Office/photo` and
  `#/lights` keep working.

## Approaches considered

- **A. Re-cut the screens around the new map (chosen).**
  - Home is rebuilt.
  - The room page splits into a workbench (use) and a designer under Studio (build).
  - Plan becomes Studio and absorbs Add-a-room and Import.
  - Lights moves under Settings.
  - Existing components are moved, not rewritten.
- **B. Rename and shuffle only.** This was rejected because room editing would stay split, which
  is the core complaint.
- **C. A fresh front-end shell.** This was rejected because it's the most cost for no gain the
  owner asked for.

## Decisions

### Routes

| Hash | Screen |
|------|--------|
| `#/` | Home |
| `#/room/<room>` | Workbench |
| `#/studio` | Studio, whole plan |
| `#/studio/plan/<room>` | Studio, whole plan, that room selected for reshaping |
| `#/studio/room/<room>` | Room designer, plan |
| `#/studio/room/<room>/photo` | Room designer, photo |
| `#/scenes`, `#/scenes/<id>` | Unchanged |
| `#/settings` | Settings: bridge and preferences |
| `#/settings/lights` | Settings: every light |
| `#/setup` | Unchanged |

Legacy redirects:

| Old hash | Goes to |
|----------|---------|
| `#/plan` | `#/studio` |
| `#/plan/<room>` | `#/studio/plan/<room>` |
| `#/room/<room>/photo` | `#/studio/room/<room>/photo` |
| `#/lights` | `#/settings/lights` |

### Home

- Home always shows the Active layout (`activeRooms` while a sandbox is open).
- Every call from Home and the ⋮ menu is Active-only. The API client gains an `activeOnly`
  argument on `scenes`, `suggest`, `applySuggestion` and `applyScene`.
- **My call:** clicking a tile while a sandbox is open first switches back to Active, as the room
  link does today.

### ⋮ menu

- **Suggestions:** it fetches `suggest(room, {mode, count: 3})` for "now" when opened, and again
  when the mode changes.
- **Mode:** the mode is remembered per browser in `localStorage` key `myhuey.quickMode`, defaulting
  to `code`. Unknown or blocked storage falls back to `code`.
- **Scenes:** the menu lists the room's saved scenes, from `scenes()` filtered by `scene.room`.
- **Applying:** a tap applies the choice and closes the menu, with a toast on the result.
- **Closing:** Escape or a click outside closes it.
- **Footer:** "Open workbench" and "Design in Studio".

### Tile state

The tile summary is a pure helper, `roomSummary(room, lights)`, which returns:
- `known`: how many of the room's lights the bridge reports.
- `on`: how many of those are on.
- `brightness`: the existing `roomBrightness`, or null when all are off.
- `chips`: up to 5 distinct live colours.

### Studio inspector

When nothing is selected or pending, the inspector shows:
- An **Add a room** panel (name, width, depth, with Import from Hue).
- **Layouts**, Trace or Draw, and Plan image, as today.

### Room designer

- The designer is today's room plan and photo tabs, minus the dimmer, the Suggest button on the
  plan tab and the Scenes chip panel.
- Renaming a room keeps you in the designer.
- "Reshape on the floor plan" goes to `#/studio/plan/<room>`.
- The designer's header has "Open workbench".

### Workbench

- **Main column:** room power (all on/off), the room dimmer and a grid of the room's light cards
  (the LightsView card).
- **Inspector:** the selected light's controls, the room's scenes with Apply and Edit, and the
  suggestions panel (always open).
- The header has "Design in Studio".
- **My call:** an empty room (no lights placed) shows a hint linking to the designer.

### Trace hint

- `traceHint(result)` returns the message for a failed trace, or null.
- Hover sets the stage hint from it.
- A click on a failing spot sets the same hint and raises no toast.
- "Upload a plan" stays as it is, since Trace is disabled without a plan.

## Left to the builder

CSS for tiles and the menu (reuse existing tokens; it must work in light and dark), component file
names, and the exact copy of hints.
