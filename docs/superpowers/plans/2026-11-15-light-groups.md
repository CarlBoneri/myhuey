# Saved Light Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Named, app-wide light groups with an optional saved look, usable from the Lights tab, the API and the CLI.

**Architecture:**
- **`light_groups.py`:** pure helpers for validation, capturing a look and turning a look into commands.
- **Service methods** store the groups under the app-wide `groups` key and apply looks paced by `command_gap_ms`.
- **FastAPI endpoints and a CLI subcommand** sit on top of the service.
- **The Lights tab** gets a Groups row and a group panel.

**Tech Stack:** Python 3.11, FastAPI, pytest; React 19, zustand, vitest.

**Spec:** docs/superpowers/specs/2026-11-15-light-groups-design.md

## Global Constraints

- Groups never go through the layout header. The `groups` key is outside HOME_KEYS, so this holds automatically. Test it.
- Names are 1–60 characters and unique ignoring case. A group has 1–64 unique light IDs.
- An unknown group returns 404, with the message `Group '<key>' not found`.
- No schema bump.
- No network at runtime except the bridge.
- No AI attribution in commits.
- Gate after each task:
  - `.venv/bin/pytest -q`
  - `cd frontend && npx vitest run && npm run typecheck && npm run build`

## Review Focus

1. **A light in the look has since been removed from the bridge.** It is skipped and reported; the other lights are still applied.
2. **A light was off when the look was saved.** Apply turns it off and sends no colour.
3. **A gradient light.** The look keeps its points, and apply sets them after the v1 command.
4. **A sandbox header is present.** The same groups are listed, and saving one with the header does not land it in the sandbox record.
5. **Renaming a group to another group's name in a different case.** This returns 400.

---

### Task 1: Pure helpers (`src/myhuey/light_groups.py`, `tests/test_light_groups.py`)

**Interfaces:**
- `clean_group_name(name) -> str`
- `clean_light_ids(ids) -> list[str]`
- `capture_look(raw: dict[id, raw_light], v2: dict[id, info], ids) -> dict[id, state]`
- `look_commands(look, known_ids) -> list[{"light_id", "v1": dict, "gradient": {colors, mode}|None}]`, with unknown IDs returned separately as `(commands, skipped)`.

**Tests:**
- Name rules: blank, 61 characters, and trimming.
- Light IDs: deduplicated, and a list that is empty or longer than 64 is rejected.
- Capture of a light that is off.
- Capture of a light in xy mode.
- Capture of a light in hs mode, which is stored as xy.
- Capture of a light in ct mode, which is stored as kelvin.
- Capture of a gradient light with 3 points.
- A light that was off becomes `{on: False}` only.
- A light that was on gets `{on, brightness, xy|color_temp}`.
- A gradient light carries its gradient.
- Unknown IDs are skipped.

### Task 2: Service and errors

**Files:** `errors.py` (`GroupNotFound`), `service.py`.

**Service methods:**
- `groups()`
- `create_group(name, lights)`
- `update_group(key, name=None, lights=None)`
- `delete_group(key)`
- `save_group_look(key)`
- `clear_group_look(key)`
- `apply_group(key, pause=None) -> list[result]`

`key` is an ID or a name, ignoring case.

**Tests** (`tests/test_light_groups_service.py`, using the `fake_bridge` fixture):
- CRUD.
- Duplicate name in another case returns 400.
- `save_group_look` reads the bridge.
- `apply_group` sends PUTs in order and skips missing lights.
- Groups are shared across layouts (`using_layout(sandbox)` lists the same groups).

### Task 3: API and CLI

**Files:** `api.py` (endpoints, 404 mapping), `cli.py` (`groups` subcommand).

**Tests:**
- `tests/test_light_groups_api.py`: round trip, a stale layout header, 404, and the apply result shape.
- A CLI test for `groups new/list/apply`.

### Task 4: Lights tab

**Files:**
- `api.ts`: `groups`, `createGroup`, `updateGroup`, `deleteGroup`, `saveGroupLook`, `clearGroupLook`, `applyGroup`.
- `types.ts`: `LightGroup`.
- `lib/selection.ts`: `sameLights(a, b)`.
- `views/LightsView.tsx`.
- `styles.css`.

**Test:** `sameLights` ignores order and duplicates.

**UI:**
- A Groups row with a ▶ on groups that have a look, plus "+ Save selection" with an inline name field.
- Clicking a group selects its lights and makes it the current group.
- When a group is current, its panel sits above the group or single-light controls.

### Task 5: Browser check, then final review

- Browser check on a copy of the database at :8001, using Office lights only, with a snapshot taken first and restored afterwards.
- README: a CLI line and a Lights bullet.
- Final review.
