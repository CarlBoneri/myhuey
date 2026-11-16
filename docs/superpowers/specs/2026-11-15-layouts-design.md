# Saved layouts and sandboxes — design

Date: 2026-11-15 · Status: open questions answered; awaiting approval

## Intent

People should be able to try a different layout of their home safely: clear the rooms and
shapes and start fresh, or try a variation, without losing what works. One layout is
**Active**, the best one and the one the app runs on day to day. The others are
**sandboxes**: you open them to edit and you can preview them on the lights, but they never
take over the everyday controls until you choose **Make active**.

## Decided by the user

- Saved layouts, not a one-step undo.
- One layout is marked Active and the app runs on it: the home screen, room on/off, room
  dimmers, and the everyday Apply.
- A sandbox can still preview on the lights.
- Approach A: each layout is stored as its own document, and a request header picks which
  document the server reads and writes.
- **The home screen always uses Active** (answered 2026-11-15). It stays the everyday control
  panel: power, dimmers, and the room list. While a sandbox is open it is read-only for layout
  edits: Add a room, Import from Hue, and drag-to-arrange are disabled, with a note to edit in
  the sandbox. Tapping a room switches back to Active and opens that room.
- **Room power and brightness honour the layout like every other endpoint** (answered
  2026-11-15). In a sandbox they act on the sandbox room's lights, which are the same physical
  lights, so this works like a preview. Only the home screen's calls are sent without the
  header.
- **The everyday Apply is any Apply made with no sandbox open** (answered 2026-11-15): no
  header and no `--layout`. Inside a sandbox, the scenes screen shows the sandbox's scenes and
  Apply plays them on the lights, like a preview. There are no extra Active-only calls.

## Goals

1. Several named layouts. Each holds rooms (outlines, furniture, openings, placed and planned
   lights, photos and photo tags), scenes, and the home plan image settings.
2. **Start fresh** creates an empty layout and opens it as a sandbox. The Active layout is
   untouched.
3. **Duplicate** copies any layout (Active or a sandbox) into a new sandbox.
4. **Make active** promotes a sandbox. The layout that was Active becomes a sandbox. Nothing
   is lost.
5. **Rename** any layout. **Delete** any layout except the Active one.
6. Every screen (floor plan, room, photo, scenes, suggest, setups) works the same inside a
   sandbox.
7. CLI parity.

## Non-goals

- Merging two layouts.
- A version history inside a layout.
- Syncing layouts to the Hue bridge (roadmap step 3 will sync the Active one only).
- Sharing or exporting layouts. Export and import of the home is roadmap step 4, which may
  later include layouts.

## Anti-goals

- The home screen ever showing or acting on a sandbox.
- Any layout operation touching bridge pairing, pinned certificates, or preferences.
- A photo or plan image belonging to any layout being removed by upload cleanup.
- A half-finished Make active, where a crash leaves both or neither layout active.

## Data

- **Global data stays in the existing `config` document,** never copied into layouts:
  `bridge`, `preferences`, and `schema_version`.
- **Home data is per layout:** `rooms`, `scenes`, and `home` (the plan image settings).
- **The Active layout's home data stays where it is today,** in `config`, so every existing
  code path and migration keeps working unchanged. `config` gains
  `layout: {"id", "name"}`, the Active layout's identity. Documents without it are given
  `{"id": new, "name": "My home"}` on first use.
- **Each other layout is one record:**
  - SQLite storage: key `layout:<id>` in `app_state`.
  - JSON storage: file `<stem>.layout-<id>.json` next to the main file.
  - Contents: `{id, name, created, updated, schema_version, rooms, scenes, home}`.
- **Migrations:** a sandbox read is the global data merged with the layout's home data, passed
  through the existing `migrate()`. If it was upgraded, it's written back with a backup of
  the old record. Future schema bumps therefore upgrade sandboxes when they are opened.

## Choosing the layout per request

- **The service:** `HueRoomService` reads a context variable holding the open layout ID, set
  per request.
  - `_load()` returns `config` when the variable is empty or names the Active layout.
    Otherwise it returns `config` with `rooms`, `scenes`, and `home` replaced by the
    sandbox's.
  - `_save(config)` mirrors that. In a sandbox it writes `rooms`, `scenes`, and `home` to the
    layout record, and writes everything else (preferences, bridge) to `config`. A
    preference changed while a sandbox is open stays global.
- **The API:**
  - A middleware sets the variable from the `X-Myhuey-Layout` request header.
  - An unknown layout ID returns 404 ("That layout no longer exists").
  - Every endpoint honours the header, including room power (`POST /rooms/{room}/power`) and
    room brightness (`POST /rooms/{room}/brightness`). Keeping the home screen on Active is
    the web client's job: it sends those calls without the header.
- **The CLI:** a global `--layout NAME_OR_ID` option sets the same variable. Without it, the
  CLI works on Active.
- **Bridge writes from a sandbox are allowed:** Preview on lights, Apply on a sandbox scene,
  and direct light controls. The planned-light rules still apply.
- **Upload cleanup:** `referenced_images()` collects references from `config` **and every
  layout record**, so no layout's photos or plan image are ever pruned.

## Operations

These are service methods, each exposed in the API and the CLI.

| Operation | Service method | API | CLI |
|---|---|---|---|
| List | `layouts()` → `[{id, name, active, rooms: n, scenes: n, updated}]`, Active first | `GET /api/layouts` | `myhuey layouts list` |
| Start fresh | `new_layout(name, from_layout=None)` → empty rooms and scenes, `home.plan` copied from Active (the same plan image is usually the one you trace again) | `POST /api/layouts {name}` | `myhuey layouts new NAME` |
| Duplicate | `new_layout(name, from_layout=id)` → a deep copy of that layout's home data | `POST /api/layouts {name, from}` | `myhuey layouts duplicate ID --name NAME` |
| Rename | `rename_layout(id, name)` | `PATCH /api/layouts/{id}` | `myhuey layouts rename ID --name NAME` |
| Make active | `activate_layout(id)`, below | `POST /api/layouts/{id}/activate` | `myhuey layouts activate ID` |
| Delete | `delete_layout(id)` → refused for the Active layout; prunes uploads afterwards | `DELETE /api/layouts/{id}` | `myhuey layouts delete ID` |

- **Names:** 1–60 characters, unique, case-insensitive. Starting fresh without a name gives
  "Layout N".
- **Make active:** in one SQLite transaction (or one write per file, with a temporary file
  and rename for JSON storage):
  1. The Active layout's `rooms`, `scenes`, and `home` go into a new `layout:<old id>`
     record.
  2. The chosen sandbox's data goes into `config`, along with `config.layout` = its identity.
  3. The chosen sandbox's record is deleted.

  The planned and real lights in the new Active layout are used as they are.

## Web app

- **Which layout is open:** the API client sends `X-Myhuey-Layout` on every request while a
  sandbox is open, except for calls marked Active-only: the home screen's room list, room
  power, and dimmers, which go without it. The open layout ID is kept in the store and in `localStorage` (a per-viewer
  convenience; if it's missing or stale, the app falls back to Active).
- **An app-wide banner while a sandbox is open:** "Sandbox: *name*, not active · Make active ·
  Back to Active".
- **Floor plan screen:** a **Layouts** panel lists the layouts with the Active badge, plus
  *Open*, *Duplicate*, *Rename*, and *Delete* (with confirmation) for each, and *Start fresh*.
- **Home screen:** always shows the Active layout, from a separate `activeRooms` list in the
  store. While a sandbox is open, a note says so and links back to the sandbox; Add a room,
  Import from Hue, and drag-to-arrange are disabled; tapping a room switches to Active and
  opens it. Power and dimmers keep working on Active.
- **Switching layout** reloads rooms, scenes, and the plan in the store. Screens re-render
  from the store as they do now.

## Testing

- **pytest:**
  - The Active document and ID are created on first use.
  - Start fresh leaves Active untouched and the new layout empty.
  - Duplicate makes a deep copy, so editing the copy leaves the original alone.
  - Sandbox reads and writes stay in the sandbox, and preferences changed in a sandbox stay
    global.
  - Room power and brightness honour the header (act on the sandbox room's lights).
  - Make active swaps both ways, keeps everything, and is atomic (simulate a failure partway
    and check that both states are intact).
  - Delete is refused for Active.
  - Unique names.
  - Upload cleanup keeps files referenced only by a sandbox.
  - A sandbox written at an older schema is migrated when it's opened.
  - The header middleware: an unknown ID gives 404.
  - The CLI `--layout` option and the `layouts` subcommands.
- **vitest:**
  - The API client adds the header only when a sandbox is open and the call isn't marked
    Active-only.
  - The home screen reads `activeRooms`, disables layout edits while a sandbox is open, and
    tapping a room switches back to Active.
- **Browser check:** on a copy of the database, Office only. Start fresh, draw a room, check
  the home screen still shows the real rooms, Preview on lights (restoring the Office light
  state afterwards), Make active, then switch back.

## Left to the builder

- The exact layout of the Layouts panel and banner, within the existing styles.
- The JSON-storage file naming and the atomic write details.
- How the store resets screen state (selection, open panels) when the layout changes.

## Open questions

None. The builder check's three questions (home screen in a sandbox, the room dimmer in a
sandbox, what "everyday Apply" means) were answered on 2026-11-15 with the recommendations;
the answers are under "Decided by the user".

## Added during the build (2026-11-15)

The user approved this spec and asked for two more changes in the same branch.

### Dark and light mode

- A new app preference `theme`: `"dark"` (the default, today's look), `"light"`, or
  `"system"` (follows the operating system). Like every preference it's global, shared with
  the CLI (`myhuey prefs`), and never copied into layouts.
- The rail gets a sun/moon button that flips between dark and light. The Bridge settings
  page offers all three.
- The page sets `data-theme` on `<html>`. Colours come from CSS tokens on `:root`, with a
  light set under `[data-theme="light"]` and under `[data-theme="system"]` when the operating
  system prefers light. Hard-coded panel, rail, and stage colours become tokens.
- The last theme is cached in `localStorage` (a per-viewer convenience) so the page doesn't
  flash dark before the preferences load.

### See-through room shapes on the floor plan

- Room shapes on the floor plan screen are drawn over the plan image with a fill opacity
  instead of a solid fill, so you can trace through them.
- The plan settings gain `room_opacity` (0–1, default 0.4), next to the image's `opacity`. It
  belongs to the plan image settings, so it's per layout like the rest of `home`. The plan
  panel gets a **Room fill** slider (0–100%).
- The home screen and the room page keep solid rooms. They draw no plan image.
