# Light the room from where you are, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One "Light this room" panel in the Workbench and every Studio room view, whose presets stay under the room's glare limits, explain the time and glare choices, preview on screen, and try on the real lights with Undo.

**Architecture:** The browser turns the existing glare report into per-light limits and sends them with the suggest request; the server caps each suggestion and returns a plain-words guide. A new pair of routes captures a room's light state and puts it back (built on the saved light groups' capture and restore). The frontend gets one panel component (replacing `SuggestPanel`), a "showing" state the plan and 3D stage draw from, and a try bar with Keep and Undo whose "before" state is kept in the browser per room.

**Tech Stack:** Python 3.11+ (FastAPI, pytest), React 19 + TypeScript + zustand (vitest, happy-dom + React Testing Library via `frontend/src/test/dom.ts`).

**Spec:** `docs/superpowers/specs/2026-11-16-room-lighting-design.md` (read it, including "Answers from the builder check").

## Global Constraints

- Never start `myhuey serve`, never open a browser, never read or write `~/.myhuey`, never send anything to a Hue bridge (tests use the existing fake clients).
- Lights change only from a person's press: "Try on lights", "Keep" (no light change), "Undo". Showing a card never touches the lights.
- Planned lights are never sent to the bridge.
- Glare limits: reflection ≤ 18% and ≤ 2700 K; direct view ≤ 15%; edge of view ≤ 35% only in code and study (values come from `frontend/src/lib/glareMath.ts`; do not restate them elsewhere).
- Glare limits apply only to the desk presets `code`, `work`, `study`. `read` and `relax` ("Chill") get none.
- The relax preset's id stays `relax`; it is shown as "Chill"; `chill` is accepted as a name for it by the API, CLI and assistant tools.
- Keep the tool server's rules: only `apply_scene`, `room_power`, `room_dim` change lights; no tool returns the bridge key. Add no new MCP tool.
- No interface text under 12px; new text colours pass the existing contrast tests.
- Do not add any `TODO(human)` comment; `frontend/src/lib/commands.ts` keeps exactly one.
- Commit messages are plain sentences in the repo's style; never add Co-Authored-By or any AI attribution.
- Before each commit: `uv run pytest -q` (backend tasks), `npm --prefix frontend test` and `npm --prefix frontend run typecheck` (frontend tasks).

## Review Focus

1. **A suggestion whose preview, saved scene and applied result disagree** (anti-goal): the capped scene must be the one in `scene`, in `preview`, and the one saved and applied. Pinned in T1 (preview of a capped suggestion shows the capped level).
2. **Undo after the page was reloaded or the person left and came back:** the before-look must still be there within 12 hours, and gone after. Pinned in T3 (`tryLook` expiry) and T4 (bar reappears).
3. **Trying a second card while a try is open:** Undo must go back to the state before the first try, not the second. Pinned in T4.
4. **A desk preset in a room with no desk or screen:** no limits sent, `checked: false`, and the no-desk guide line, never a silent "all clear". Pinned in T1 and T3.
5. **The bridge not answering when Try is pressed:** the try is refused with a message and nothing is applied. Pinned in T4.

---

### Task T1: the server caps suggestions, explains them, and knows "Chill"

**Files:**
- Modify: `src/myhuey/suggest.py` (`suggest`, new `time_guide`, new `apply_caps`), `src/myhuey/modes.py` (relax title "Chill", `get_mode` alias), `src/myhuey/service.py` (`HueRoomService.suggest`), `src/myhuey/api.py` (`SuggestRequest`), `src/myhuey/cli.py` (suggest `--mode` choices), `src/myhuey/assistant.py` (`suggest` docstring and mode check)
- Test: `tests/test_suggest.py` (or the existing suggest test file; find it with `grep -l "def test_.*suggest" tests/*.py`)

**Interfaces:**
- Produces: `suggest(room, mode, *, at, wake, bed, palette_id=None, count=4, seed=0, glare: dict | None = None) -> list[dict]` where `glare = {"checked": bool, "caps": {light_id: {"brightness": float, "kelvin": int | None, "reason": "reflection" | "direct" | "peripheral"}}}`. Each item gains `"guide": {"time": str, "glare": list[str], "checked": bool}`.
- Produces: `time_guide(at: datetime, wake: str, bed: str) -> str`.
- Produces: `HueRoomService.suggest(..., glare: dict | None = None)`; `POST /api/rooms/{room}/suggest` body gains optional `glare`.
- Produces: `get_mode("chill")` returns the relax mode.

- [ ] **Step 1: Write the failing tests.**
  - `test_caps_hold_lights_under_their_glare_limit`: a room with a desk, a monitor and a light placed in view; `suggest(..., mode="code", glare={"checked": True, "caps": {"L": {"brightness": 15, "kelvin": None, "reason": "direct"}}})`; every item's `scene.overrides["L"]["brightness"] <= 15`, and the item's colors for "L" are unchanged in count (direct keeps colors).
  - `test_reflection_cap_makes_one_warm_white`: same with `{"brightness": 18, "kelvin": 2700, "reason": "reflection"}` on a gradient light; its override has `white <= 2700`, `brightness <= 18`, and no `colors` or `mode`.
  - `test_preview_matches_the_capped_scene` (via `HueRoomService.suggest` with the fake client): the item's `preview` entry for "L" has brightness at or under the cap.
  - `test_caps_are_ignored_for_read_and_chill`: `mode="relax"` with caps → overrides unchanged from a call without caps; `guide.checked` is False and `guide.glare == ["Glare is checked for the desk presets (Code, Work, Study)."]`.
  - `test_no_desk_says_so`: `mode="code"`, `glare={"checked": False, "caps": {}}` → `guide.glare == ["No desk with a screen in this room, so glare was not checked. Add one in the Room plan."]`, `checked` False.
  - `test_checked_with_nothing_to_cap`: `glare={"checked": True, "caps": {}}` → `guide.glare == ["No light would glare at the desk."]`, `checked` True.
  - `test_glare_lines_name_the_light_and_why`: direct → `"<label> held at 15%: it sits in your view of the screen."`; reflection → `"<label> held at 18%, warm white: it would reflect in the screen."`; peripheral → `"<label> held at 35%: it sits at the edge of your view."` (label = the light's name in the room, as `evaluate` labels it).
  - `test_time_guide`: wake 07:00, bed 23:00 — `08:10` → starts with `"Morning, 1 h 10 after waking"`; `21:40` → `"21:40, 1 h 20 before bed: warm whites, no blue palettes"`; `23:30` → starts with `"Past bedtime"`; a midday time names the time and says whites follow the day (exact midday wording is the builder's).
  - `test_chill_is_relax`: `get_mode("chill") is get_mode("relax")`; the relax mode's title is "Chill"; the CLI accepts `--mode chill`.
  - A call with no `glare` returns the same overrides as today (regression) and `guide.checked` False with the no-glare-requested line omitted (`guide.glare == []`).
- [ ] **Step 2:** run them, see them fail.
- [ ] **Step 3: Implement.** Apply caps after `_overrides` builds each scene, only for `code`, `work`, `study`; a reflection cap replaces the override with `{"white": min(kelvin, cap.kelvin), "brightness": min(...)}`; direct and peripheral cap `brightness` only. Ignore cap entries for light IDs not in the room. The cap wins over the light's role. `time_guide` uses the existing wake/bed math in `curve.py` and the night window in `suggest.py` (do not duplicate constants). `guide.time` is `time_guide(at, wake, bed)`.
- [ ] **Step 4:** `uv run pytest -q` passes.
- [ ] **Step 5: Commit** `feat: presets stay under the glare limits the app sends, explain their time and glare choices, and relax is called Chill`

### Task T2: capture a room's lights and put them back

**Files:**
- Modify: `src/myhuey/light_groups.py` (`capture_look` records an effect; `look_commands` carries it), `src/myhuey/service.py` (new `capture_room_look`, new `apply_room_look`; `apply_group` reuses the shared per-light loop), `src/myhuey/api.py` (two routes)
- Test: the existing light-groups test file (`grep -l "capture_look\|apply_group" tests/*.py`)

**Interfaces:**
- Produces: `HueRoomService.capture_room_look(room_name: str) -> {"look": dict, "skipped": list[str], "at": str}` — the room's lights that are on the bridge and not planned; `skipped` = the room's light IDs left out (planned or not on the bridge); `at` = "HH:MM" now.
- Produces: `HueRoomService.apply_room_look(room_name: str, look: dict) -> list[dict]` — per-light results like `apply_group`'s; only IDs that are in the room are applied (others are reported as skipped).
- Produces: `POST /api/rooms/{room}/look` → capture; `POST /api/rooms/{room}/look/apply` body `{"look": {...}}` → results. Both follow the layout header like the other room routes.
- Look entries may carry `"effect": "<name>"` when the v2 index reports a running effect.

- [ ] **Step 1: Write the failing tests** (with the fake bridge the group tests use):
  - capture leaves out planned lights and lights the bridge lacks, and lists them in `skipped`;
  - capture records `"effect": "candle"` for a light whose v2 effect status is candle;
  - apply restores on/bri/xy/ct/gradient as `apply_group` does; for an entry with `effect`, it starts that effect; for an entry without one, on a light that currently has an effect running, it stops the effect (`no_effect`) before setting colors;
  - apply ignores IDs not in the room (reported, not sent);
  - `apply_group` behaves as before (existing tests pass).
- [ ] **Step 2:** see them fail.
- [ ] **Step 3: Implement**, moving `apply_group`'s per-light loop into one private helper both use. Keep `@_one_bridge_write` on the writer.
- [ ] **Step 4:** `uv run pytest -q` passes.
- [ ] **Step 5: Commit** `feat: a room's lights can be captured and put back, effects included`

### Task T3: the browser's glare limits, the try record, and the API calls

**Files:**
- Create: `frontend/src/lib/glareLimits.ts`, `frontend/src/lib/tryLook.ts`
- Modify: `frontend/src/api.ts` (suggest gains `glare`; `captureLook`, `applyLook`), `frontend/src/types.ts` (`Suggestion.guide`, `RoomLook`), `frontend/src/lib/suggest.ts` (`MODE_LABELS.relax = 'Chill'`)
- Test: `frontend/src/lib/glareLimits.test.ts`, `frontend/src/lib/tryLook.test.ts`

**Interfaces:**
- Produces: `glareModeFor(mode: string): 'code' | 'work' | 'study' | null` (null for read and relax).
- Produces: `glareLimits(report: GlareReport, hasDesk: boolean): { checked: boolean; caps: Record<string, { brightness: number; kelvin: number | null; reason: 'reflection' | 'direct' | 'peripheral' }> }` — from each light's status and cap in the report (`screen_reflection` → reflection with kelvin 2700, `direct_fov` → direct, `peripheral_warn` → peripheral; `bias_ok` and `clear` → none). `checked` is false when the room has no desk with a screen (the scene's eye is missing; see `Studio3D.tsx`'s `scene.eye`).
- Produces: `overLimit(report: GlareReport, shown: Record<string, { on: boolean; brightness: number }>): string[]` — IDs whose shown level (percent) is above their cap; off lights never count.
- Produces: `tryLook` — `saveTry(room: string, record: TryRecord): void`, `loadTry(room: string, now?: number): TryRecord | null` (null after 12 hours, or when storage throws), `clearTry(room: string): void`, with `TryRecord = { at: number; look: RoomLook; skipped: string[]; title: string; layout: string | null; capturedAt: string }`. Every storage access in try/catch.
- Produces: `api.suggest(room, { ..., glare? })`, `api.captureLook(room): Promise<{ look: RoomLook; skipped: string[]; at: string }>`, `api.applyLook(room, look): Promise<LightResult[]>` (follow how other room calls pass the layout header).

- [ ] **Step 1: Write the failing tests:** `glareModeFor` for all five ids; `glareLimits` maps each status; `checked` false with no desk; `overLimit` counts only lit lights above cap; `loadTry` returns the record within 12 h and null after (pass `now`); `loadTry` survives throwing storage; `MODE_LABELS.relax === 'Chill'`.
- [ ] **Step 2:** see them fail. **Step 3:** implement. **Step 4:** frontend tests and typecheck pass.
- [ ] **Step 5: Commit** `feat: the browser turns the glare check into limits, remembers a try per room, and calls Chill by its name`

### Task T4: the "Light this room" panel with a try bar

**Files:**
- Create: `frontend/src/components/RoomLighting.tsx` (panel + try bar), replacing `frontend/src/components/SuggestPanel.tsx` (delete it once nothing imports it)
- Modify: `frontend/src/views/RoomWorkbench.tsx` (use the panel), `frontend/src/views/PhotoView.tsx` (its Suggest button opens this panel; "Show on photo" keeps working), `frontend/src/styles.css`
- Test: `frontend/src/components/RoomLighting.test.tsx` (happy-dom; mock `../api`)

**Interfaces:**
- Consumes: T3's `glareLimits`, `glareModeFor`, `tryLook`, api calls; `roomGlare` from `lib/roomGlare.ts` and the posture from `useUi`.
- Produces: `RoomLighting({ room, onShow?, shownId?, onClose? })` — the photo view passes `onShow`/`shownId` as it does to `SuggestPanel` today.
- Produces: `useUi` state `showing: { room: string; title: string; results: SceneResult[] } | null` and `setShowing(next)` (used by T5).

Behaviour to pin with tests (each an `it`):
- the request sends `glare` from `glareLimits` only for code/work/study, and no `glare` for read/chill;
- each card shows the guide's time line and every glare line; the panel header shows the first card's time line once;
- choosing a card sets `showing` for that room with the card's `preview`; choosing it again or pressing "Show live" clears it; nothing calls `applySuggestion`/`applyLook` on choosing;
- "Try on lights": calls `captureLook`, saves a try record, then `applySuggestion`; the bar reads "Trying <title> on <room> · Keep · Undo" and, in a sandbox, adds "(as drawn in sandbox <name>)"; with skipped lights it adds "<n> planned lights skipped";
- a second "Try" while the bar shows does not capture again (Undo goes back to the first state);
- "Undo" calls `applyLook` with the first captured look, clears the record and the bar, and says "Put back how <room> was at <capturedAt>";
- "Keep" clears the record and the bar without any light call;
- if `captureLook` rejects, nothing is applied and the panel shows the error ("The bridge did not answer, so nothing was changed.");
- on mount with a saved record under 12 h old, the bar shows "You tried a scene on <room> at <HH:MM> · Keep · Undo";
- "Save as scene" still works as in `SuggestPanel`.
Mode labels come from `MODE_LABELS`; the time picker stays ("Now" + quarter hours).

- [ ] Steps: failing tests → implement → `npm --prefix frontend test` + typecheck → commit `feat: one panel lights a room: glare-aware presets that explain themselves, shown before they are tried, tried with Keep and Undo`

### Task T5: the plan and 3D view show what is being shown

**Files:**
- Create: `frontend/src/lib/shownLights.ts`
- Modify: `frontend/src/components/Room3DStage.tsx`, `frontend/src/components/Studio3D.tsx` (badge and glare table), `frontend/src/views/RoomDesigner.tsx` (the plan's lights and the stage), `frontend/src/components/Shapes.tsx` only if the plan's light drawing needs a colour/brightness input, `frontend/src/styles.css`
- Test: `frontend/src/lib/shownLights.test.ts`, CSS-text test if a new rule matters

**Interfaces:**
- Consumes: `useUi().showing` (T4), `overLimit` (T3).
- Produces: `shownLights(live: Record<string, BridgeLight>, showing: SceneResult[] | null): Record<string, BridgeLight>` — the live lights with each shown result laid over (on, brightness as the bridge's 1-254, xy or colour); lights not in the results keep their live state. Pure.

Behaviour:
- while `showing` is set for this room, the plan and the 3D stage draw lights from `shownLights(...)`; a label on the stage reads "Showing: <title> (not on your lights)" with a "Show live" button that clears it;
- the badge reads "<n> over the limit · <m> to watch" from `overLimit(report, shown)` and the report's hazard count, for live or shown; the glare table adds each light's shown level next to its limit and marks "over" rows;
- `showing` clears when the room changes or the panel closes.
Tests: `shownLights` merges and leaves others alone; brightness 50% → bri 127; an off result turns the light off; a badge-text helper (export it from `shownLights.ts` or `glareLimits.ts`) gives "0 over the limit · 3 to watch".

- [ ] Steps: failing tests → implement → tests + typecheck → commit `feat: the plan and the 3D view draw the scene being shown, and the glare badge counts what is over its limit`

### Task T6: a "Light" button in the Studio, and help

**Files:**
- Modify: `frontend/src/views/RoomDesigner.tsx` (Studio header children on room views: a "Light" toggle beside "Open workbench" that opens `RoomLighting` — in the sidebar for Room plan and Photo, and in the 3D screen's inspector column or a drawer in the work area like Workflows; builder's call, but it must not cover the 3D view's controls), `frontend/src/lib/helpDocs.ts` (the scenes/suggestions topic explains the panel, glare limits for desk presets, Try/Keep/Undo, Chill)
- Test: `frontend/src/components/StudioHead.test.tsx` or a new focused test, `frontend/src/lib/helpDocs.test.ts` if it pins topics

Behaviour: the "Light" button appears on every room view (Room plan, 3D, Photo), not on Home plan; pressing it opens the panel for the room on screen; its state survives switching between room views; `aria-pressed` reflects open/closed.

- [ ] Steps: failing tests → implement → tests + typecheck → commit `feat: a Light button in the Studio opens the lighting panel on every room view`
