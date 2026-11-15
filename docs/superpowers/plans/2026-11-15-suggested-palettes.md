# Suggested Palettes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click, eye-comfortable scene suggestions for any room, built from palette presets, a mode (code/work/study/read/relax), the clock against the user's schedule, and where each light sits (including height).

**Architecture:** Pure Python modules (curve, roles, palette library, modes, suggester) produce an ordinary `Scene` of per-light overrides. The service, API and CLI expose suggest / palettes / apply-unsaved. The React app adds a Suggest panel, light Height and Role fields, and wake/bed settings. Scenes gain a kelvin `white` override that `apply_scene` sends as `ct`.

**Tech Stack:** Python 3 (FastAPI, pytest), React + TypeScript (Vite, vitest), Hue v1/v2 APIs.

**Spec:** `docs/superpowers/specs/2026-11-15-suggested-palettes-design.md`

## Global Constraints

- Local-first: no network calls at runtime. Only `scripts/build_palettes.py` (a developer tool, not packaged) touches the network.
- Real-light checks use the **Office** room only and restore light state afterwards. Browser e2e uses a **copy** of the DB on a second server. No pairing.
- Kelvin range 2000–6500. Brightness 1–100. Mirek is sent to the bridge clamped to the light's range, otherwise 153–500.
- Default `wake_time` "07:00", `bed_time` "23:00", in 15-minute steps.
- Schema goes to **v4** through the existing migration chain, with a backup.
- Monitor/TV furniture: the screen faces +y at rotation 0, rotated clockwise. Facing vector = `(-sin θ, cos θ)` in plan coordinates (y down).
- Every CLI feature has an API equivalent and vice versa (the existing parity rule).
- Commit after each task on branch `feat/suggested-palettes`, with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.

## Review Focus

1. **Bedtime after midnight** (bed "01:30", wake "09:00"): the curve wraps; 00:30 is in the wind-down, not "after bed". → Task 2 test `test_curve_wraps_past_midnight`.
2. **A room with lights but no furniture or no placed lights at all**: the suggester returns ambient-only scenes; zero lights returns suggestions with empty overrides, not an error. → Task 6 tests.
3. **A white-ambiance bulb (has `ct`, no `xy`) and a color bulb without `ct`**: the first gets `ct`, the second gets `xy` from the kelvin. Neither errors. → Task 3 test.
4. **Old saved preferences that store every default**: reading still works, and changing one key saves only that key. → Task 1 test.
5. **A pinned bias light in a mode with no screen in focus**: dim, low-color ambient, with the pin kept. → Task 5 test.

---

### Task 1: Preferences — wake/bed times, and save only what the user set

**Files:**
- Modify: `src/myhuey/preferences.py`, `src/myhuey/service.py:241-246`
- Test: `tests/test_preferences_schedule.py`

**Interfaces:**
- Produces: preference keys `wake_time` and `bed_time` (strings "HH:MM"); `HueRoomService.preferences()` still returns the fully merged dict.

- [ ] **Step 1: Write failing tests**
```python
def test_schedule_defaults(service):  # HueRoomService on db_path
    p = service.preferences()
    assert p["wake_time"] == "07:00" and p["bed_time"] == "23:00"

def test_times_are_quarter_hours(service):
    service.update_preferences({"bed_time": "01:45"})
    with pytest.raises(ValueError): service.update_preferences({"bed_time": "01:50"})

def test_only_changed_keys_are_saved(service):
    service.update_preferences({"poll_seconds": 10})
    assert service._load()["preferences"] == {"poll_seconds": 10}

def test_legacy_full_dict_still_reads_and_updates(service):
    cfg = service._load(); cfg["preferences"] = {"poll_seconds": 5, "command_gap_ms": 100}; service._save(cfg)
    service.update_preferences({"wake_time": "06:30"})
    assert service.preferences()["wake_time"] == "06:30"
```
- [ ] **Step 2:** Run `pytest tests/test_preferences_schedule.py -v`. Expected: FAIL.
- [ ] **Step 3:** Add `QUARTER_HOURS = tuple(f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 15, 30, 45))` and the two keys to `PREFERENCES`. Change `update_preferences` to save `{**valid saved entries, **changes}` (drop invalid or unknown saved keys; don't merge in defaults).
- [ ] **Step 4:** Run `pytest -q`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: wake and bed time preferences; save only preferences the user set`.

### Task 2: Time-of-day curve

**Files:**
- Create: `src/myhuey/curve.py`
- Test: `tests/test_curve.py`

**Interfaces:**
- Produces: `baseline(at: datetime.time, wake: str, bed: str) -> tuple[int, float]` returning (kelvin, brightness %), and `minutes_until_bed(at: time, wake: str, bed: str) -> int | None` (None once in the after-bed stretch, which runs until wake).

- [ ] **Step 1: Write failing tests** (wake "07:00", bed "23:00" unless stated):
```python
def test_points():
    assert baseline(time(7, 0), W, B) == (3000, 60)
    assert baseline(time(12, 0), W, B) == (5000, 100)
    assert baseline(time(21, 0), W, B) == (3000, 70)
    assert baseline(time(23, 0), W, B) == (2400, 40)
    assert baseline(time(3, 0), W, B) == (2200, 25)

def test_interpolates_in_mirek():   # 07:30 sits halfway in mirek between 3000 K and 5000 K
    k, _ = baseline(time(7, 30), W, B)
    assert k == round(1e6 / ((1e6/3000 + 1e6/5000) / 2))  # 3750

def test_curve_wraps_past_midnight():
    assert baseline(time(0, 30), "09:00", "01:30")[0] < 3000          # wind-down, not after-bed
    assert baseline(time(2, 0), "09:00", "01:30") == (2200, 25)

def test_minutes_until_bed():
    assert minutes_until_bed(time(21, 0), W, B) == 120
    assert minutes_until_bed(time(1, 0), W, B) is None
```
- [ ] **Step 2:** Run `pytest tests/test_curve.py -v`. Expected: FAIL (no module).
- [ ] **Step 3:** Implement with the spec's anchor table as (offset in minutes from wake or bed, K, %). Convert times to minutes since wake, modulo 1440. If bed − 4 h would come before wake + 1 h (a short day), clamp so the anchors stay in order. Interpolate kelvin linearly in mirek, round to int; brightness linearly.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: time-of-day white and brightness curve`.

### Task 3: White temperature in scenes, and applying an unsaved scene

**Files:**
- Modify: `src/myhuey/scenes.py` (`_override`, `_apply_override`, `Scene` gains `origin`), `src/myhuey/service.py:768-822`
- Test: `tests/test_scene_white.py`

**Interfaces:**
- Produces:
  - override key `white: int` (2000–6500)
  - evaluate result keys `color_temp: int | None`
  - `Scene.origin: dict | None` (`{"mode", "palette_id", "palette_name", "at"}`), round-tripped by `to_dict`/`from_dict`
  - `HueRoomService.apply_scene_object(scene: Scene, *, pause: float | None = None) -> list[dict]`; `apply_scene(key)` becomes a lookup followed by `apply_scene_object`

- [ ] **Step 1: Write failing tests**
```python
def test_white_override_validates():
    with pytest.raises(ValueError): Scene.from_dict({"name": "x", "room": "Den", "overrides": {"1": {"white": 9000}}})

def test_evaluate_reports_color_temp(service):  # Den fixture as in tests/test_scenes.py
    s = Scene.from_dict({"name": "w", "room": "Den", "overrides": {"1": {"white": 2700, "brightness": 40}}})
    r = {x["light_id"]: x for x in service.preview_scene(s)}["1"]
    assert r["on"] and r["color_temp"] == 2700 and r["brightness"] == 40 and r["color"].startswith("#")

def test_apply_sends_ct_to_ct_lights_and_xy_to_color_only_lights(service, fake_bridge):
    raw = {"1": {"name": "A", "state": {"on": True, "bri": 10, "ct": 300}},
           "5": {"name": "B", "state": {"on": True, "bri": 10, "xy": [0.3, 0.3]}}}
    session = fake_bridge(raw, [{"success": {}}])
    s = Scene.from_dict({"name": "w", "room": "Den", "overrides": {"1": {"white": 2500}, "5": {"white": 2500}}})
    service.apply_scene_object(s)
    puts = {c["url"].split("/")[-2]: c["json"] for c in session.calls if c["method"] == "PUT"}
    assert puts["1"]["ct"] == 400 and "xy" not in puts["1"]
    assert "xy" in puts["5"] and "ct" not in puts["5"]

def test_origin_round_trips():
    o = {"mode": "code", "palette_id": "gen-1", "palette_name": "Dusk", "at": "22:40"}
    assert Scene.from_dict({"name": "x", "room": "Den", "origin": o}).to_dict()["origin"] == o
```
(Adjust the fake call shapes to match `tests/conftest.py`. Strip 5 has no v2 gradient in this test.)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** In `_apply_override`, a `white` sets `on`, `color_temp`, `color = rgb_to_hex(color_temperature_to_rgb(k))`, `xy` from that rgb, and `gradient = None` (unless `colors` were also given). In `apply_scene_object`, when `result["color_temp"]` is set and the state has `ct`, send `ct = clamp(mired, ct_min, ct_max)` (from the light's `capabilities.control.ct` when present, else 153–500) instead of `xy`. Pass through `set_light_color` (add a `ct` kwarg if it doesn't exist; check `hue.py`). Validate `origin` as a small dict of strings.
- [ ] **Step 4:** Run `pytest -q`. Expected: all pass, including the existing `test_scenes.py`.
- [ ] **Step 5:** Commit `feat: kelvin white in scene overrides; apply unsaved scenes`.

### Task 4: Light elevation and pinned role (schema v4)

**Files:**
- Modify: `src/myhuey/models.py` (`LayoutLight`), `src/myhuey/migrations.py`, `src/myhuey/service.py` (`assign_light`), `src/myhuey/api.py` (`LightPlacement`, `place_light`), `src/myhuey/cli.py` (room assign flags)
- Create: `src/myhuey/placement.py`
- Test: `tests/test_light_elevation.py`

**Interfaces:**
- Produces:
  - `LayoutLight.elevation: float | None` (None = auto), `LayoutLight.role: str` in `ROLES_PINNABLE = ("auto", "bias", "task", "view")`
  - `placement.resolved_elevation(light: LayoutLight, room: Room) -> float`
  - `assign_light(..., elevation: float | str | None = None, role: str | None = None)`, where None = keep, `"auto"` = clear to None
  - room JSON from the API includes `resolved_elevation` per light

- [ ] **Step 1: Write failing tests**
```python
def test_v3_document_migrates_to_v4_with_auto_fields(): ...  # light gains elevation None, role "auto"; schema_version 4

@pytest.mark.parametrize("archetype,furniture,expected", [
    ("ceilinground", None, 244), ("pendantround", None, 184), ("recessedceiling", None, 244),
    ("floorshade", None, 150), ("tableshade", None, 115), ("tableshade", "desk", 115),   # desk top 75 + 40
    ("huelightstrip", None, 0), ("huelightstrip", "desk", 75), (None, None, 150)])
def test_resolved_elevation(archetype, furniture, expected): ...
# A light is "on" a furniture piece when its center is inside the piece's footprint (honor
# rotation and ellipse shape). Use the topmost piece (elevation + height).

def test_explicit_elevation_wins_and_auto_clears(service):
    service.assign_light("Den", "1", elevation=90); assert service.get_room("Den").lights[0].elevation == 90
    service.assign_light("Den", "1", elevation="auto"); assert service.get_room("Den").lights[0].elevation is None

def test_role_must_be_pinnable(service):
    with pytest.raises(ValueError): service.assign_light("Den", "1", role="ambient")

def test_cli_assign_accepts_elevation_and_role(...): ...  # `room assign Den --light-id 1 --elevation 120 --role bias`
```
Elevation is accepted in the range 0–1000 cm. The CLI parses `--elevation` with the room's units (`parse_length`) or the word `auto`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Archetype groups:
  - ceiling: `ceilinground`, `ceilingsquare`, `recessedceiling`, `singlespot`, `doublespot`
  - pendant: `pendantround`, `pendantlong`
  - floor: `floorshade`, `floorlantern`, `huesigne`
  - table: `tableshade`, `tablewash`, `flexiblelamp`, `huego`, `hueiris`, `huebloom`
  - strip: `huelightstrip`, `huelightstriptv`, `hueplay`, `huetube`, `hueplaywallwasher`

  Everything else is unknown (150 cm). Read the archetype from `light.product.get("archetype")`. `_v3_to_v4` sets the defaults and bumps `CURRENT_VERSION` to 4. Update the migrations module docstring.
- [ ] **Step 4:** Run `pytest -q`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: light elevation (auto by product) and pinned roles, schema v4`.

### Task 5: Focus and roles

**Files:**
- Create: `src/myhuey/roles.py`
- Test: `tests/test_roles.py`

**Interfaces:**
- Consumes: `placement.resolved_elevation`
- Produces:
  - `Focus` dataclass: `seat: Point`, `gaze: Point` (a unit vector), `eye_height: float`, `screen: Point | None`, `screen_height: float | None`
  - `find_focus(room: Room, kind: str) -> Focus | None`, where kind is in `("desk", "sofa", "read")`
  - `resolve_roles(room: Room, focus: Focus | None) -> dict[str, str]` mapping light_id to `bias|task|view|behind|ambient`
  - constants `BIAS_BEHIND_CM = 50`, `TASK_RADIUS_CM = 120`, `VIEW_HALF_ANGLE = 40`, `VIEW_MAX_ELEVATION_ANGLE = 30`, `BEHIND_ANGLE = 120`, `BEHIND_MAX_HEIGHT = 200`

- [ ] **Step 1: Write failing tests.** Build rooms in code: a desk at (200, 100) with a monitor-27 at (200, 80), rotation 0, so the screen faces +y and the seat is about (200, 140).
```python
def test_desk_focus_sits_in_front_of_monitors(): f = find_focus(room, "desk"); assert f.seat == approx((200, 140)); assert f.gaze == approx((0, -1)); assert f.eye_height == 115
def test_standing_desk_raises_the_eye(): ... == 155
def test_desk_without_monitor_uses_desk_front(): ...
def test_sofa_focus_looks_at_tv(): ...; eye 105
def test_read_prefers_armchair_then_bed_then_desk(): ...
def test_no_focus_furniture_returns_none(): assert find_focus(empty_room, "desk") is None
def test_strip_behind_monitor_is_bias(): ...            # strip at (200, 60), elevation auto → on no furniture → 0? place it on the desk: resolved 75
def test_lamp_beside_the_seat_is_task(): ...
def test_floor_lamp_past_the_screen_is_view_but_ceiling_light_there_is_ambient(): ...
def test_floor_lamp_behind_chair_is_behind_but_ceiling_light_is_not(): ...
def test_far_corner_light_is_ambient(): ...
def test_pinned_role_overrides_geometry(): ...
def test_without_focus_everything_unpinned_is_ambient(): ...
```
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The screen is a monitor or TV whose footprint is within 30 cm of the desk's footprint (desk focus) or the TV (sofa focus); several monitors use their centroid. The seat is 60 cm along the screen-facing vector from the screen centroid (sofa: the sofa center). Gaze points from the seat toward the screen (no screen: the reverse of the desk's front normal).

  Rules, evaluated in this order (pinned roles bypass them):
  1. **bias:** the point is behind the screen plane by 0–50 cm and within the screen's half-width + 30 cm sideways
  2. **task:** horizontal distance to the seat ≤ 120 and not view
  3. **view:** the horizontal angle from the gaze is ≤ 40°, the vertical angle above the eye is < 30°, and the point is farther than the screen
  4. **behind:** the angle from the gaze is ≥ 120° and the elevation is < 200
  5. **ambient:** everything else

  Note that view is checked before task for points ahead.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: find where the user sits and give each light a role`.

### Task 6: Palette library and the suggester

**Files:**
- Create: `src/myhuey/palettes.py` (library: load, tag, generate, filter), `src/myhuey/modes.py` (data table), `src/myhuey/suggest.py`
- Create: `src/myhuey/data/__init__.py`, `src/myhuey/data/palettes.json` (seeded with the generated palettes in this task; real sources are added in Task 7)
- Modify: `pyproject.toml` (package data includes `data/*.json`, `data/*.md`)
- Test: `tests/test_palettes.py`, `tests/test_suggest.py`

**Interfaces:**
- Consumes: `curve.baseline`, `curve.minutes_until_bed`, `roles.find_focus`, `roles.resolve_roles`, `palette.rgb_to_oklab`
- Produces:
  - `palettes.Palette` (id, name, colors, tags, source, credit), `palettes.load() -> list[Palette]` (cached), `palettes.tag(colors) -> list[str]`, `palettes.usable(colors) -> bool`, `palettes.generate(seed: int, count: int) -> list[Palette]`, `palettes.search(tag: str | None, q: str | None) -> list[Palette]`
  - `modes.MODES: dict[str, Mode]`, `Mode(focus, brightness, kelvin_offset, task_min_kelvin, color_strength, bias, ambient_only, prefers)`, holding the spec's table values exactly
  - `suggest.suggest(room, mode: str, *, at: datetime, wake: str, bed: str, palette_id: str | None = None, count: int = 4, seed: int = 0) -> list[dict]`, where each item is `{"scene": Scene (unsaved; name "<Mode> · <palette name>"), "palette": Palette dict, "roles": {light_id: role}}`

- [ ] **Step 1: Write failing palette tests**
```python
def test_tags():  assert "warm" in tag(["#c8553d", "#f28f3b", "#ffd5c2"]); assert "blue_heavy" in tag(["#1d3557", "#457b9d", "#a8dadc"])
def test_unusable_palettes_are_rejected(): assert not usable(["#000000", "#050505", "#ff00ff"])  # <3 usable after near-black / neon removal
def test_generate_is_deterministic_and_usable(): a = generate(1, 20); assert a == generate(1, 20) and all(usable(p.colors) for p in a)
def test_generated_cover_relax_tags(): tags = {t for p in generate(0, 200) for t in p.tags}; assert {"vivid", "accent", "warm", "muted"} <= tags
def test_load_reads_packaged_json(): assert len(load()) >= 100 and all(p.credit or p.source == "generated" for p in load())
```
OKLab thresholds (named constants): near-black L < 0.25; neon chroma > 0.30; a "harsh complement" is two colors with chroma > 0.15 and hue difference within 180° ± 25°. Tags:
- warm or cool: the mean hue angle of chromatic colors lies in the warm or cool half
- muted: mean C < 0.08
- vivid: mean C > 0.14
- analogous: hue spread < 60°
- accent: exactly one color with C > 0.12, the rest < 0.07
- blue_heavy: ≥ 40% of colors have hue in 220–290° with C > 0.05

`generate` uses the four harmony rules in the spec (analogous, warm gradient, accent over muted neutrals, split complementary at low chroma). Each palette gets id `gen-<n>` and a readable name built from a word list (for example "Ember Analogous 12").
- [ ] **Step 2: Write failing suggester tests** (Office-like room built in code, with monitor and desk as in Task 5, plus a ceiling light, a far floor lamp, a strip on the monitor, and a desk lamp):
```python
def test_code_at_night_keeps_desk_white_and_dim():  # at 23:30, bed 23:00
    s = suggest(room, "code", at=dt(23, 30), wake="07:00", bed="23:00", seed=0)[0]
    o = s["scene"].overrides
    assert o[DESK_LAMP]["white"] <= 2400 and o[DESK_LAMP]["brightness"] <= 25 * 0.8 + 0.1
    assert o[BIAS_STRIP]["white"] and 10 <= o[BIAS_STRIP]["brightness"] <= 20
    assert "colors" in o[FAR_LAMP]

def test_no_blue_heavy_palettes_from_three_hours_before_bed_until_wake():
    for h in (20, 23, 2, 6): assert all("blue_heavy" not in x["palette"]["tags"] for x in suggest(room, "relax", at=dt(h, 15), wake="07:00", bed="23:00", count=6))

def test_view_lights_are_desaturated(): ...  # the view light's color has OKLab chroma ≤ 0.25 × color_strength × that palette color's chroma (+ε)
def test_gradient_lights_get_consecutive_palette_colors(): ...
def test_relax_in_a_room_without_tv_is_all_palette(): ...
def test_room_without_lights_returns_empty_scenes(): ...
def test_explicit_palette_id_is_used(): ...
def test_seed_changes_color_order_but_not_palette(): ...
def test_suggestions_have_distinct_palettes(): ...
def test_study_puts_color_only_on_ambient_lights(): ...
def test_read_task_light_at_least_4000k(): ...
def test_bias_off_when_mode_has_no_bias(): ...   # relax: a bias-role light is treated as ambient and dim
def test_pinned_bias_without_screen_is_dim_low_color(): ...
def test_scene_origin_is_set(): ...
```
- [ ] **Step 3:** Run `pytest tests/test_palettes.py tests/test_suggest.py -v`. Expected: FAIL.
- [ ] **Step 4:** Implement `palettes.py` and `modes.py`, and write `data/palettes.json` from `generate(0, 300)` with a one-off `python -c`. Then implement `suggest.py`:
  1. `(k, b) = baseline(at)`, then apply the mode's multiplier and kelvin offset, then clamp.
  2. Find the focus for the mode, falling back to None, and resolve the roles.
  3. Choose palettes: an explicit id, or the candidates scored by how many of `mode.prefers` tags they share. Drop `blue_heavy` when `minutes_until_bed` is ≤ 180 or None. Take the top 40 and pick `count` of them deterministically from `random.Random(seed)`, without repeating.
  4. Build overrides per role:
     - task: `white = max(k, task_min_kelvin)`, brightness b
     - bias: if the mode has a bias light, `white = k` with brightness clamped to 10–20 (b × 0.2); otherwise ambient-dim
     - view: palette color mixed toward white(k) in OKLab by `1 − 0.25 × color_strength`, brightness b × 0.5
     - behind: white(k) at b × 0.4, at most 10% color
     - ambient: palette color mixed toward white by `1 − color_strength × distance factor`, where the distance factor = `clamp(distance / 300, 0.5, 1)`. With `ambient_only`, only ambient lights carry color.
  5. Order ambient lights by angle around the seat (or the room centroid). Gradient-capable lights get `colors` of 2–5 consecutive palette colors, and `mode` `interpolated_palette`.
  6. Set `Scene.origin`.
- [ ] **Step 5:** Run `pytest -q`. Expected: all pass.
- [ ] **Step 6:** Commit `feat: palette library, modes, and the scene suggester`.

### Task 7: Build the real palette library

**Files:**
- Create: `scripts/build_palettes.py`, `src/myhuey/data/PALETTES_LICENSE.md`
- Modify: `src/myhuey/data/palettes.json` (regenerated), `README.md` (a credits line linking the license)
- Test: `tests/test_palettes.py` (add `test_every_colourlovers_entry_has_author_and_url`, `test_license_file_ships`)

- [ ] **Step 1:** Write the two tests. Run them. The license test is expected to FAIL.
- [ ] **Step 2:** Write the script (requests + Pillow, `--out`, `--limit-cl 600`, `--limit-met 400`, `--generated 300`), with a `User-Agent: myhuey-palette-builder` header and a 1 s gap between requests.
  - **COLOURlovers:** `GET https://www.colourlovers.com/api/palettes/top?format=json&numResults=100&resultOffset=N`. Keep `title`, `userName`, `url`, and `colors`. On HTTP 403 or another error, log it and continue without COLOURlovers.
  - **The Met:** `GET https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&isPublicDomain=true&q=painting&departmentId=11`, then fetch each object's `primaryImageSmall` to a temporary directory. Run `extract_theme(path, 5, mood)` for moods "muted" and "deep". Keep the object ID, title, and `objectURL`.
  - Filter everything with `usable`, tag it with `tag`, de-duplicate by OKLab distance, append `generate(0, N)`, and write sorted JSON.
- [ ] **Step 3:** Run `python scripts/build_palettes.py --out src/myhuey/data/palettes.json`. Record how many entries came from each source. Write PALETTES_LICENSE.md: the COLOURlovers entries are CC BY-NC-SA 3.0 with credit in each entry, the Met entries are CC0, and the generated entries are the project's own.
- [ ] **Step 4:** Run `pytest -q`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: ship a palette library from COLOURlovers, The Met, and generated harmonies`.

### Task 8: Service, API, and CLI for suggestions and palettes

**Files:**
- Modify: `src/myhuey/service.py`, `src/myhuey/api.py`, `src/myhuey/cli.py`
- Test: `tests/test_suggest_api_cli.py`

**Interfaces:**
- Produces:
  - `HueRoomService.suggest(room_name, mode, *, at: str | None = None, palette_id=None, count=4, seed=0) -> list[dict]`, where `at` is "HH:MM" and defaults to now; each item adds `preview` (from `evaluate`)
  - `POST /api/rooms/{room}/suggest` with body `{mode, at?, palette_id?, count? 1–6, seed?}`, returning the list with scenes as dicts
  - `POST /api/rooms/{room}/suggest/apply` with body = a scene dict, returning the apply results
  - `GET /api/palettes?tag=&q=&limit=` returning palette dicts
  - CLI `myhuey suggest ROOM --mode M [--at HH:MM] [--palette ID] [--count N] [--seed N] [--save NAME] [--apply]` and `myhuey palettes [--tag T] [--search Q] [--limit N]`
  - room JSON lights include `resolved_elevation` and `resolved_role` (the role for the "desk" focus, used for the "Auto (task)" label)

- [ ] **Step 1: Write failing tests:**
  - the suggest endpoint returns `count` items with a preview, and nothing is written to the DB or the bridge (assert no `PUT` calls)
  - an unknown mode gives 400
  - an unknown room gives 404
  - suggest/apply sends to the fake bridge
  - palettes filters by tag
  - the CLI `suggest Den --mode code --at 22:00 --save "Late"` creates a scene with `origin.mode == "code"`
  - the CLI `palettes --tag warm` prints palettes
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, following the existing patterns (Pydantic `Body` models, `_status_for`, `print(json.dumps(...))` for the CLI).
- [ ] **Step 4:** Run `pytest -q`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: suggest and palettes in the API and CLI`.

### Task 9: Web app — Suggest panel, light Height/Role, schedule settings

**Files:**
- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/views/RoomView.tsx`, `frontend/src/views/SettingsView.tsx`, `frontend/src/views/SceneEditor.tsx` (origin label and palette credit), `frontend/src/styles.css`
- Create: `frontend/src/components/SuggestPanel.tsx`, `frontend/src/lib/suggest.ts` (pure helpers: time formatting, card label, credit text)
- Test: `frontend/src/lib/suggest.test.ts`

**Interfaces:**
- Consumes: the Task 8 endpoints and the room JSON fields.

- [ ] **Step 1:** Write failing vitest tests:
  - `cardTitle({mode: "code", palette: {name: "Dusk"}})` returns "Code · Dusk"
  - `creditText` covers a COLOURlovers entry ("by user"), a Met entry ("from <title>, The Met"), and a generated entry (empty)
  - `nowHHMM(new Date(2026, 0, 1, 9, 5))` returns "09:05"
- [ ] **Step 2:** Run `npm test --prefix frontend`. Expected: FAIL.
- [ ] **Step 3:** Implement the helpers, then the UI:
  - **Suggest panel:** a **Suggest** button on the room view opens it. It has mode chips, a time field ("now" or editable), and 3–6 cards. Each card renders the room with the preview colors (reuse the existing plan and light rendering) and a palette strip, with actions *Preview on lights*, *Save as scene* (prompts for a name inline, defaulting to the card title, never a browser dialog), and *Shuffle* (seed + 1). There's also a *Browse palettes* list with a tag filter and search, which sets `palette_id`.
  - **Light details:** a Height field (shows the resolved value with "auto", and editing sets a number; "Auto" resets) and a Role select (Auto (resolved_role) / Bias / Task / View).
  - **Settings:** wake time and bedtime selects in 15-minute steps.
  - **Scene editor:** shows the "Suggested: …" origin label and the palette credit.
- [ ] **Step 4:** Run `npm test --prefix frontend && npm run typecheck --prefix frontend && npm run build --prefix frontend`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: suggest panel, light height and role, schedule settings in the web app`.

### Task 10: End-to-end verification

- [ ] **Step 1:** Run `pytest -q` and the frontend tests, typecheck, and build. Expected: all green.
- [ ] **Step 2:** Copy the real DB (`~/.myhuey`) to a temporary directory. Start a second server on another port with `MYHUEY_HOME` (or the storage path flag) pointing at the copy. In Chrome, open `#/room/Office`, open Suggest, switch modes, shuffle, save a scene, and set one light's height and role. Check the console for errors. Stop the server and delete the copy.
- [ ] **Step 3:** Real lights in the **Office** only. Record the Office lights' states, apply one suggestion with *Preview on lights* for "code" at the current time, confirm visually and from the returned results, then restore the recorded states.
- [ ] **Step 4:** Update `README.md` with a short "Suggested scenes" section (modes, schedule, height and role). Commit `docs: suggested scenes in the README`.
