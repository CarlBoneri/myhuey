# Saved light groups (short design)

Status: approved in conversation 2026-11-15.

## Intent

The Lights tab can already pick several lights at once. A pick is lost as soon as you click
elsewhere, so the owner wants to save it as a named group in myhuey's own database. Clicking the
group later brings it back.

A group can also keep a saved **look**: each light's on/off, brightness and colour. One tap then
puts the lights back that way. This is the owner's evening and late-work case, and it works
across rooms, which scenes (one room each) can't do.

## Goals

- **Groups are app-wide.** They are stored in the main document under a `groups` key and survive
  switching layouts and sandboxes.
- **A group** has `id`, `name` and `lights` (light IDs), plus an optional `look`, which maps each
  light ID to its state:
  - `on`
  - `bri` (1–254)
  - one of `xy`, `kelvin` or `gradient` (`{colors, mode}`)
- **Lights tab:**
  - A Groups row of buttons. Clicking a group selects its lights; ▶ appears when the group has a
    look and applies it.
  - **"+ Save selection"** makes a group from the current pick (at least one light).
  - With a group selected, the side panel offers:
    - Save current look
    - Clear look
    - Rename
    - Delete (inline Yes/No)
    - Update lights to this selection (shown when the pick differs from the group)
- **Applying a look:**
  - Commands are sent one light at a time, paced by the `command_gap_ms` preference.
  - A light that fails is reported and the rest carry on.
  - Light IDs no longer on the bridge are skipped and reported.
- **API endpoints:**
  - `GET /api/groups` and `POST /api/groups` `{name, lights}`
  - `PATCH /api/groups/{id}` `{name?, lights?}` and `DELETE /api/groups/{id}`
  - `PUT /api/groups/{id}/look` captures the look from the bridge now; `DELETE /api/groups/{id}/look`
    clears it.
  - `POST /api/groups/{id}/apply` returns `{results, failed}`, like scene apply.
- **CLI:** `myhuey groups list | new --name N --lights 1,2 | rename | delete | save-look | apply`.
  - A group is addressed by name or ID.

## Non-goals and anti-goals

- Nothing is created on the Hue bridge.
- No schedules, and no groups on Home.
- A group must never be tied to a layout, and a sandbox header must never change which groups
  you see.

## Approaches

- **Chosen: a global key in the main document.** The storage code already treats every key
  except rooms, scenes and home as app-wide.
- **Rejected: browser storage.** The owner asked for the database, and it wouldn't reach the CLI
  or another browser.
- **Rejected: a separate SQLite table.** It would break JSON-file storage, which keeps everything
  in one document.

## Calls made by the builder

- **No schema version bump.** A missing `groups` key reads as an empty list, and older versions
  keep unknown keys when they save. Bumping the version would trigger migrations and backups for
  no gain.
- **Validation rules:**
  - Names are unique ignoring case and 1–60 characters.
  - The light list is 1–64 unique IDs.
  - Group IDs come from `models.new_id`.
  - An unknown group gives 404 (`GroupNotFound`); bad input gives 400.
- **What a look keeps from each light** (read as on/off, brightness, then colour):
  - On/off and brightness come from the bridge's v1 state.
  - Colour is kept as a 2+ point gradient (from v2) if the light has one; otherwise as `xy` when
    the colour mode is xy or hs; otherwise as `kelvin` when the colour mode is ct.
  - A light that is off keeps only `on: false`.
- **Applying a look:**
  - A light that was off is turned off.
  - Otherwise the light gets one v1 command with on, brightness and xy or kelvin.
  - A gradient light then also gets its gradient set.
- **Pure helpers** live in a new `light_groups.py`: validation, capture from raw state, and turning
  a look into commands.
