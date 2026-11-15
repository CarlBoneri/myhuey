# Suggested palettes — design

Date: 2026-11-15 · Status: draft for approval

## Intent

myhuey exists to reduce eye strain for coders. Suggested palettes give anyone, in any room, a
one-click lighting scene that looks good **and** is easy on the eyes. myhuey builds it from:

- the room's layout on the floor plan: furniture, screens, openings, and where each light sits
  (now including how high it is)
- the time of day, read from the clock against the user's wake time and bedtime
- what the user is doing: a **mode** (code, work, study, read, relax)
- a **palette**: a preset set of colors chosen from a library that ships with myhuey

A suggestion is a **snapshot**: a normal scene for right now, which the user previews,
tweaks, and saves like any other scene.

## Goals

1. Palette presets color the whole room, in any room, not just the office.
2. Modes sit on top of palettes and decide how the palette lands: brightness, white
   temperature, how strong the colors are, and which lights stay near white.
3. The clock is read automatically. "Code" at noon and "code" at 23:00 come out different.
4. Lights near the user's eyes and screen are handled for comfort. The task light stays
   white, the bias light stays dim, lights in the line of sight are dimmed and desaturated,
   and lights behind the seat avoid strong color.
5. Works the same from the web app and the CLI.

## Non-goals (this round)

- A live mode that re-applies over the day. The curve is a separate function so it can be
  reused later.
- User-defined modes. They come later, so built-in modes are data (a table), not code
  branches.
- Sun position or location. The anchor is the user's schedule only.
- The full glare report (roadmap step 2). This feature uses the same angle math in a
  simpler form.
- The screen eye-dropper. It's a separate, small feature with its own short design after
  this one.
- Any network call at runtime.

## Anti-goals (failure even if it works)

- Saturated color on a light near the screen or in the line of sight.
- Bright, blue-heavy light in the hours before bedtime.
- A suggestion that ignores a role the user pinned.
- Shipping palette data whose license doesn't allow it, or dropping the required
  attribution.

## Constraints

- Local-first. No accounts, no cloud services at runtime. Free, non-commercial GitHub
  release.
- Real-light demos and tests use the **Office** room only, and restore the light state
  afterward. Browser end-to-end tests run on a **copy** of the database on a second server.
  No pairing without the user present.
- Bridge traffic respects the `command_gap_ms` preference.
- Changes to the schema use the existing auto migration with a backup (next version after
  v3).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Python `suggest.py` produces an ordinary `Scene` made of per-light overrides. Exposed through the API and the CLI. | One implementation, pytest-able, CLI parity. A preview needs a round trip to the server (fast, it's local). |
| B | Suggester in the browser (TypeScript) | Instant previews, but no CLI, and the scene logic would exist in two languages. |
| C | A new "recipe" scene type that re-renders on every apply | Drifts toward the live mode the user declined, and adds a second scene kind everywhere. |

The user picked A.

## Design

### 1. Palette library

**Where the palettes come from.** A one-time build script, `scripts/build_palettes.py`.
It's a developer tool: not installed with the app and never run by it. It writes
`src/myhuey/data/palettes.json`, which ships in the package.

- **COLOURlovers** top palettes, through its API. The license is CC BY-NC-SA 3.0. Each entry
  keeps the title, creator username, and source URL for attribution.
- **The Met Open Access** public-domain (CC0) paintings, through its API. Palettes are
  pulled with the existing `palette.extract_theme` ("muted" and "deep" moods). Each entry
  keeps the object ID and title.
- **Licensing:** `src/myhuey/data/PALETTES_LICENSE.md` states that the COLOURlovers entries
  are CC BY-NC-SA 3.0, with attribution in the file, and that the Met entries are CC0. The
  README links to it.

**If COLOURlovers is unavailable** (the reviewer got HTTP 403): the script retries with a
plain client User-Agent and paging. If it still fails, the library is built from Met palettes
plus **generated** palettes. These are myhuey's own harmony rules in OKLab (analogous, warm
gradient, one accent over muted neutrals, split complementary at low chroma). Generated
palettes need no attribution and cover the `vivid` and `accent` tags that relax mode wants.
Generated palettes are included either way, for tag coverage. *(Builder-check call.)*

**Filtering for room light.** Each palette is converted to OKLab. The script drops:

- palettes with fewer than 3 usable colors after removing near-black (L < 0.25)
- palettes whose colors are neon (chroma above a cap)
- palettes with harsh complementary pairs at high chroma

Each palette is then tagged with derived properties: `warm`, `cool`, `muted`, `vivid`,
`analogous`, `accent` (one strong color in muted ones), and `blue_heavy`.

**Size.** The target is about 500–1,500 palettes, small enough to ship as plain JSON.

**Entry shape:**
```json
{"id": "cl-12345", "name": "...", "colors": ["#..", ...], "tags": ["warm","muted"],
 "source": "colourlovers", "credit": {"author": "...", "url": "..."}}
```

### 2. Time-of-day curve (`curve.py`, pure function)

**Input:** clock time, `wake_time`, `bed_time`.
**Output:** a baseline white temperature in kelvin and a baseline brightness percentage.

| Point | Kelvin | Brightness |
|---|---|---|
| wake | 3000 | 60 |
| wake + 1 h | 5000 | 100 |
| through the day | 5000 | 100 |
| bed − 4 h | 5000 | 100 |
| bed − 2 h | 3000 | 70 |
| bed | 2400 | 40 |
| after bed, until wake | 2200 | 25 |

- Interpolation is linear in **mirek**, which is perceptually more even than kelvin, and
  linear in brightness.
- Times wrap around midnight. A bedtime of 02:00 with a wake time of 10:00 is valid.
- The curve takes an explicit time, so tests and the UI can ask "what about 22:00?".

### 3. Modes (`modes.py`, a data table)

A mode has:

- a **focus**: the furniture where the person sits and what they look at
- adjustments to the curve: a brightness multiplier, a kelvin offset, a minimum kelvin at
  the task light
- a **color strength** from 0 to 1: how much of the palette's color the ambient lights carry
- whether the bias light is on
- palette tag preferences

| Mode | Focus | Brightness | Kelvin | Other | Color strength | Prefers tags |
|---|---|---|---|---|---|---|
| code | desk + monitor | ×0.8 | 0 | bias on | 0.6 | muted, analogous |
| work | desk + monitor | ×1.0 | 0 | bias on | 0.5 | muted, analogous |
| study | desk | ×1.1 | 0 | palette color on ambient lights only | 0.35 | muted |
| read | armchair, bed, or desk | ×1.2 at task light | 0 | task light ≥ 4000 K | 0.4 | warm, muted |
| relax | sofa + TV, or none | ×0.7 | −500 | bias on (TV bias light; user decision 2026-11-15) | 1.0 | warm, vivid, accent |

Brightness is clamped to 1–100 and kelvin to 2000–6500. From 3 hours before bedtime until
wake time, palettes tagged `blue_heavy` are excluded.

### 4. Light elevation and roles

**New fields on the placed light (`LayoutLight`), in the schema bump:**

- `elevation`: cm from the floor to the light, or `null`, meaning automatic. *(Builder-check
  call: it's stored as null and worked out each time it's read, so a default never freezes.
  This is the same lesson as the preferences fix. A lamp moved onto a desk picks up the new
  height.)* The automatic value comes from the product's archetype through `shapes.py`:
  - ceiling, pendant, recessed: room ceiling (pendant: ceiling − 60)
  - floor lamp: 150
  - table or desk lamp: top of the furniture under it + 40, otherwise 115
  - light strip or gradient strip: top of the furniture under it, otherwise 0
  - unknown: 150

  The migration adds the field as null. The UI and CLI show the resolved value, marked
  "auto".
- `role`: one of `auto` (the default), `bias`, `task`, or `view`.

**Focus.** A function finds the focus for a mode in a room:

- **The seat point and the screen point.** For desk modes, the seat is 60 cm in front of the
  centroid of the monitors standing on the desk, looking toward them. With no monitor, it's
  the desk's front edge. For relax, it's the sofa or sectional center, looking at the TV.
  For read, it's an armchair, then a bed's head end, then the desk.
- **Eye height:** 115 cm seated, 155 cm at a standing desk, 105 cm on a sofa or bed.
- **No match:** there is no focus, and every light with role `auto` is ambient.

**Automatic roles** (when `role = auto`), using the light's position and elevation relative
to the eye and the gaze direction:

| Role | Rule | Treatment |
|---|---|---|
| bias | within about 50 cm behind the screen, roughly level with it | curve kelvin, 10–20% brightness, no saturation; on only if the mode wants a bias light |
| task | within about 120 cm of the seat, not in the line of sight | curve white at the mode's brightness |
| view | ahead of the eye, within about 40° of the gaze sideways and less than 30° above it, past the screen | palette color mixed toward white (at most a quarter of the color strength), brightness ×0.5 |
| behind | more than about 120° from the gaze, below about 200 cm | low brightness, little color (screen reflections) |
| ambient | everything else | palette color at full color strength, more saturated the farther from the seat |

The thresholds are named constants.

**Pinned roles** override the rule. A pinned role whose focus doesn't exist in the current
mode falls back to the ambient treatment, dim and low-color, without an error. The light keeps
its pin.

### 5. Assigning palette colors to lights

- **Order:** the palette's colors are ordered by OKLab lightness. Ambient lights are ordered
  by angle around the seat (or the room center), so neighboring lights get neighboring colors
  and the pattern wraps around the room.
- **Gradient lights** (light strips, gradient lights) get 2–5 consecutive palette colors
  along their length. Treated lights (bias, task, view, behind) get one color.
- **Mixing with white.** Mixing a palette color toward the curve's white is done in OKLab. The
  amount is the color strength scaled by the role and the distance.
- **Variety.** Each suggestion is deterministic for a given palette, mode, time, and seed.
  "Shuffle" changes the seed, which rotates the color order.

### 6. White temperature in scenes

- A light override gains an optional `white`: kelvin, 2000–6500. It's validated in
  `scenes._override`.
- `evaluate()` reports `color_temp` and a display `color` (the kelvin converted to hex) for
  white overrides.
- `apply_scene` sends `ct` (mirek, clamped to the light's own range when the bridge reports
  one, else 153–500) to lights that support `ct`. A color light without `ct` gets `xy` from
  the kelvin. This also fixes white-only bulbs, which today only change brightness in scenes.

### 7. Suggester (`suggest.py`)

```python
suggest(room, mode, *, at: datetime, palette_id: str | None = None,
        count: int = 4, seed: int = 0, prefs) -> list[Suggestion]
```

- Without a `palette_id`, it picks `count` palettes that fit the mode's tags, using a
  variety rule so the suggestions differ.
- Each `Suggestion` holds:
  - an unsaved `Scene` made of per-light overrides
  - its preview, from `evaluate()`
  - metadata: `mode`, `palette_id`, `at`, `seed`, and each light's resolved role
- The scene stores its origin, `{"mode", "palette_id", "at"}`, in a new optional
  `Scene.origin` field. The editor shows "Suggested: code · <palette> · 22:40". After the
  user edits the scene, the origin is kept only as a label.

### 8. Preferences: wake and bed times, and the fix

- **New preferences:** `wake_time` (default `"07:00"`) and `bed_time` (default `"23:00"`),
  as `"HH:MM"` strings in 15-minute steps. That fits the existing allowed-values tuple
  pattern.
- **The fix (a deferred review issue):** `update_preferences` currently saves every
  default as if the user had chosen it. It will save only keys the user set. Defaults are
  merged in when read, so a better default later reaches everyone who never changed it.
  Existing saved preferences that equal today's defaults are left as they are; nothing is
  migrated.

### 9. Interfaces

- **API**
  - `POST /api/rooms/{room}/suggest {mode, at?, palette_id?, count?, seed?}`: suggestions.
    A preview only, so no write and no bridge traffic.
  - `GET /api/palettes?tag=&q=`: browse the library.
  - Saving uses the existing scene create endpoint.
- **CLI**
  - `myhuey suggest ROOM --mode code [--at 22:00] [--palette ID] [--count N] [--seed N] [--save NAME] [--apply]`
  - `myhuey palettes [--tag warm] [--search text]`
  - `myhuey room assign ... --elevation CM|auto --role auto|bias|task|view` (placement already
    goes through `room assign`)
- **Preview on lights** *(builder-check call)*: a new service path,
  `apply_scene_object(scene)`, applies an unsaved scene through the same `_one_bridge_write`
  and `command_gap_ms` flow, via `POST /api/rooms/{room}/suggest/apply` with the suggestion's
  scene body. The lights are **left as the preview set them**, with no automatic restore. The
  user can apply another card or a saved scene. CLI `--apply` works without `--save`.
  - preferences `wake_time` and `bed_time` through the existing preference commands
- **Web app**
  - A **Suggest** button on the room view opens a panel with:
    - the mode chips (code, work, study, read, relax)
    - the time ("now", editable to preview another time)
    - 3–6 suggestion cards, each a small plan render with the lights' colors and the
      palette strip, with actions *Preview on lights*, *Save as scene*, and *Shuffle*
    - *Browse palettes* (search, tags) to choose a specific palette
  - Light details gain **Height** and **Role** (Auto shows what it resolved to, for example
    "Auto (task)").
  - Settings gain wake time and bedtime.
  - The palette credit appears on the card and in the scene editor.

## Testing

- pytest:
  - curve points and midnight wrap
  - focus detection for each furniture combination
  - the role rules, including elevation cases (ceiling vs. floor lamp in the line of sight)
  - pinned roles override the rules
  - mode adjustments and clamps
  - assigning colors to gradient lights
  - white overrides from validation through to the `ct` sent
  - the preferences fix
  - the migration
  - the CLI commands
- vitest for any pure TypeScript added (for example, card preview rendering helpers).
- A browser end-to-end check on a copy of the database, using the Office room only.
- One real-light check in the Office, restoring the light state afterward.

## Decided by the user

- Snapshot, not live.
- Palettes color the whole room in any room. Modes sit on top: code, work, study, read,
  relax. User-defined modes come later.
- Time of day comes from the clock, anchored to the user's schedule. No sun.
- Lights get a height.
- Roles are hidden in the math by default. Bias, task, and view can be set per light as
  input.
- Approach A.
- Fix the preferences default-freezing issue as part of this work.
- The palette library comes from licensed sources (COLOURlovers CC BY-NC-SA and the Met
  CC0), stored in the repo. Adobe Color is not used.

## Left to the builder

- Exact role thresholds and mixing amounts within the stated ranges.
- How the facing direction of monitors and TVs is read from furniture rotation. Check the
  convention in `Shapes.tsx` and `PlanCanvas.tsx`.
- Palette filtering thresholds and the tag rules.
- The card visual design, within the existing styles.
- How many Met paintings to sample, and which departments to use.
