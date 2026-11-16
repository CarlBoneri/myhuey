# MyHuey Schema v6: owner's spec (as pasted 2026-11-16)

> This is the owner's vision document, kept verbatim below. It was written without the repo in
> view: paths, model names, and test counts do not match the code. The plans under
> `docs/superpowers/plans/2026-11-16-glare-*.md` reconcile it with the repo and split it into
> four slices. Where a plan and this text disagree on a path or a name, the plan wins; where
> they disagree on behavior, raise it with the owner.

---

# Task: Implement MyHuey Schema `v6` — Parametric Furniture Assemblies, 3D Isometric Room Modeling & Specular Glare Ray-Tracer

You are working inside the `myhuey` repository (Python 3.11+ FastAPI/CLI backend + React/Vite TypeScript frontend in `frontend/`, compiled into `static/app`).

**Current Baseline:** API `rev 5`, Storage Schema `v5`, `pytest -q` (505 passing), `npm --prefix frontend test` (135 passing).
**Target Milestone:** API `rev 6`, Storage Schema `v6`, zero regressions on existing tests, full CLI/HTTP/UI parity.

---

## 1. Non-Negotiable Architectural Invariants
1. **Local-Only Execution:** All spatial math, solar azimuth calculations, and ray-tracing run locally in Python (`myhuey/spatial/`) and mirror deterministically in TypeScript (`frontend/src/lib/glareMath.ts`) so interactive 3D scrubbing runs at 60fps without network round-trips.
2. **Centimeter Canonical Units:** Persist all coordinates, dimensions, elevations, and offsets in `cm` inside SQLite (`~/.myhuey/myhuey.db`) and `.json` layout stores. Handle imperial (`ft`/`in`) and metric (`m`/`cm`) conversions exclusively in CLI parsers and UI formatters.
3. **Safe `v5` -> `v6` Migration:** Before upgrading any `v5` SQLite DB or JSON layout file, write a non-overwriting backup (`~/.myhuey/backups/myhuey.db.v5.bak`). Preserve atomic `Make active` layout transactions and `409 Conflict` optimistic locking on `X-Myhuey-Layout`.
4. **Full Parity:** Expose every new feature identically across Python domain functions, FastAPI endpoints, `myhuey` CLI subcommands, and the Studio React UI.

---

## 2. Backend Implementation Plan

### Step 2.1: Schema `v6` Models & Automatic Migration
- **Files:** `myhuey/models/schema.py`, `myhuey/storage/migrations.py`, `myhuey/storage/db.py`
- Bump `SCHEMA_VERSION = 6` and `API_REVISION = 6`.
- Extend Pydantic v2 models with backward-compatible defaults:
  - `SocketDefinition`: `id`, `label`, `local_offset_cm: tuple[float, float, float]`, `default_yaw_deg: float = 0.0`, `recommended_role: Literal["Bias", "Task", "View", "Ambient"] = "Ambient"`.
  - `FurnitureItemV6`: add `assembly_id: Optional[str] = None`, `parent_id: Optional[str] = None`, `socket_id: Optional[str] = None`, `elevation_cm: float = 0.0`, `seated_elevation_cm: Optional[float] = None`, `standing_elevation_cm: Optional[float] = None`, `tilt_deg: float = 0.0`, `is_display: bool = False`, `sockets: list[SocketDefinition] = []`.
  - `LightPlacementV6`: add `parent_id: Optional[str] = None`, `socket_id: Optional[str] = None`, `local_offset_cm: Optional[tuple[float, float, float]] = None`, `beam_angle_deg: float = 110.0`, `tilt_pitch_deg: float = 0.0`.
  - `SurfaceMaterialV6`: `surface_id`, `label`, `material_preset: Literal["matte_plaster", "concrete", "dark_hardwood", "glass_curtain", "acoustic_panel"]`, `reflectance: float` (`0.05..0.95`), `specular_gloss: float = 0.05`.
  - `RoomV6`: add `posture: Literal["seated", "standing"] = "seated"`, `seated_eye_z_cm: float = 118.0`, `standing_eye_z_cm: float = 160.0`, `surfaces: list[SurfaceMaterialV6] = []`.
- In `migrate_v5_to_v6`:
  - Backup `v5` files before mutating.
  - Populate default room `surfaces` (`wall:north/south/east/west` as `matte_plaster` `0.80`; `floor` as `dark_hardwood` `0.22`).
  - Flag `type in ("monitor", "tv", "display")` with `is_display = True`, `tilt_deg = -12.0`, and default `elevation_cm = 73.0` if `0`.
  - Infer `beam_angle_deg` from light product archetypes (`spot=45`, `play_bar=95`, `gradient_tube=110`, `lightstrip=120`, `bulb=160`).

### Step 2.2: Spatial Kinematics, Glare Ray-Tracer & Parametric Presets
Create `myhuey/spatial/` with three pure, deterministic modules:
1. `myhuey/spatial/kinematics.py`:
   - `resolve_furniture_z(item, posture)` resolving `seated_elevation_cm` (`73 cm`) vs `standing_elevation_cm` (`114 cm`).
   - Forward 2D/3D rigid-body transform computing world `(x_cm, y_cm, z_cm, rotation_deg)` for all socket-bound child monitors and lights whenever a parent desk moves, rotates, resizes, or switches posture:
     - $X_w = X_p + dx\cos\theta_p - dy\sin\theta_p$
     - $Y_w = Y_p + dx\sin\theta_p + dy\cos\theta_p$
     - $Z_w = Z_p + dz$
   - Dragging a bound child light without `Alt` detaches `parent_id`/`socket_id`; holding `Alt` applies inverse rotation $R(-\theta_p)$ to update `local_offset_cm`.
2. `myhuey/spatial/glare_tracer.py`:
   - `audit_room_glare(room, time_hhmm, latitude=41.88, longitude=-87.63) -> GlareAuditReport`:
     - Compute eye coordinate $E$ from primary chair (or $65\text{ cm}$ in front of primary desk) at `seated_eye_z_cm` or `standing_eye_z_cm`.
     - For every `is_display == True` surface, compute center $M$, tilted unit normal $\vec{n}$, and screen bounds $(W_m, H_m)$.
     - **Specular Screen Reflection Check:** Mirror each active light $L_i$ across the display plane ($L'_i = L_i - 2((L_i - M)\cdot\vec{n})\vec{n}$), intersect segment $\overline{E L'_i}$ with the display plane at $P_{\text{hit}}$, and verify bounds ($|s_u| \le W_m/2 + 8\text{ cm}$, $|s_v| \le H_m/2 + 8\text{ cm}$) and line-of-sight occlusion against opaque furniture OBBs (pillars/bookshelves). Flag unoccluded hits as `screen_reflection` with bounce path `[L_i, P_hit, E]`, recommended brightness cap (`<= 18%`), and Kelvin cap (`<= 2700 K`).
     - **Direct FOV Cone Check:** Compute gaze angle $\alpha$ between $\vec{g} = \text{normalize}(M_{\text{primary}} - E)$ and $\vec{l}_i = \text{normalize}(L_i - E)$. Classify rear monitor lights ($<35\text{ cm}$) as `bias_ok`, $\alpha < 30^\circ$ as `direct_fov` (cap `15%`), $30^\circ \le \alpha \le 65^\circ$ as `peripheral_warn` (cap `35%` in `Code`/`Study`), else `clear`.
     - **Solar Azimuth Window Projection:** Compute NOAA solar elevation/azimuth for `time_hhmm` and test sunbeam intersection through window `(sill_height, top_height)` bounds onto display faces (`WINDOW_SOLAR_GLARE`).
3. `myhuey/spatial/presets.py`:
   - Parametric rig generators (`dual-coding-desk`, `twin-bookshelf-wall`) creating parent furniture, child displays, and sockets (`rear_vesa_halo`, `under_front_lip`, `left_wing`, `right_wing`).

### Step 2.3: Eye-Comfort Engine, HTTP API & CLI Parity
- Update `myhuey/suggestions/engine.py` to clamp `screen_reflection` lights (`<= 18%`, `2400–2700 K`), boost fixtures near low-reflectance surfaces (`reflectance < 0.30` by `+20%` up to `85%`), and cap fixtures near `glass_curtain` after sunset (`<= 45%`).
- Add FastAPI routes (`myhuey/api/routes_spatial.py`, honoring `X-Myhuey-Layout`):
  - `POST /api/rooms/{room}/posture` (`{"posture": "seated" | "standing"}`)
  - `GET /api/rooms/{room}/glare` (`?time=HH:MM&mode=code`)
  - `POST /api/rooms/{room}/glare/mitigate` (`{"apply_to_bridge": bool, "mode": "code"}`)
  - `POST /api/rooms/{room}/assemblies`
  - `PATCH /api/rooms/{room}/furniture/{id}/sockets`
  - `PUT /api/rooms/{room}/surfaces`
- Add CLI subcommands (`myhuey/cli/`):
  - `myhuey room posture <ROOM> <seated|standing>`
  - `myhuey room glare <ROOM> [--time HH:MM] [--fix]`
  - `myhuey assembly add <ROOM> --template <NAME> --x <LEN> --y <LEN> [--width <LEN>] [--rotate <DEG>]`
  - `myhuey assembly bind <ROOM> --furniture <ID> --socket <SOCKET_ID> --light <LIGHT_ID>`
  - `myhuey room surface <ROOM> --surface <SURFACE_ID> --material <PRESET>`

---

## 3. Frontend Implementation Plan (`frontend/src/`)

### Step 3.1: Deterministic Spatial Math Port
- Create `frontend/src/lib/glareMath.ts` porting `kinematics.py` and `glare_tracer.py` verbatim in TypeScript so 3D posture toggles, desk/monitor drags, and solar time scrubbing update at 60fps before debouncing API `PATCH` calls.

### Step 3.2: Studio 3D Isometric Cutaway & Desk POV Viewport (With Interactive Zoom)
- Extend the Studio Room Designer view switcher from `[Plan] [Photo]` to `[Plan] [3D] [Photo]`.
- Build `frontend/src/components/studio/Studio3DViewport.tsx`:
  - **Camera Modes:**
    1. `Isometric Cutaway`: Orbit (`yaw`, `pitch`) + **Interactive Zoom (`45%` to `240%`)** via non-passive mouse-wheel / trackpad pinch (`e.preventDefault()`), floating HUD `[ - ] [ 100% ] [ + ] [ Fit ] [ Desk Close-Up ]`, `Zoom` slider, and `=` / `-` / `0` keyboard shortcuts. Keep stroke widths and hit targets screen-space constant across zoom levels.
    2. `Desk Eye-Level POV`: Locks camera to `(eye_x, eye_y, eye_z)` aimed at primary monitor center with pointer-drag head-look (`±55°` yaw, `±30°` pitch).
  - **3D Scene & Light Placement:**
    - Render extruded room walls (`ceiling_height_cm`), translucent window portals, pillars, parametric desk + tilted monitors, and true-shape Hue fixtures (`strips`, `bars`, `tubes`, `bulbs`) with vertical Z-drop lines and elevation readouts (`cm`).
    - Clicking any 3D light selects it for inline `X / Y / Z` coordinate nudging, socket binding/detaching, and brightness/Kelvin tuning.
  - **Glare Overlays:** Render monitor reflection frustums, animated red/amber bounce rays (`L_i -> P_hit -> E`), and directional window sunbeams when solar elevation $> 0^\circ$.
- Also ensure the **2D Floor Plan** viewport supports cursor-anchored wheel/pinch zoom (`screenToWorld` / `worldToScreen`), `Space`+drag pan, dynamic scale ruler, and `[ - ] 100% [ + ] [ Fit ]` HUD controls.

### Step 3.3: Parametric Assembly & Glare Inspector
- Build `frontend/src/components/studio/AssemblyInspectorPanel.tsx`:
  - `Seated (73 cm)` / `Standing (114 cm)` posture toggle.
  - Desk `X`, `Y`, `Yaw`, `Width`, and `Monitor Tilt` sliders.
  - Socket matrix (`rear_vesa_halo`, `under_front_lip`, `left_wing`, `right_wing`) with bound fixture pills, `[Bind / Detach]` controls, and per-light `glare_status` badges.
  - Glare hazard list + `[Auto-Mitigate Glare (--fix)]` button wired to `POST /api/rooms/{room}/glare/mitigate`.

---

## 4. Verification & Acceptance Criteria
1. **Backend Tests (`pytest -q`):**
   - `tests/test_migration_v6.py`: Verify `v5` SQLite & multi-file JSON upgrade to `v6`, create `.v5.bak` safely, and preserve all rooms, lights, scenes, and groups.
   - `tests/test_kinematics.py`: Verify desk rotation and `seated` <-> `standing` posture toggle transform all socket-bound child lights accurately (`< 0.01 cm` error) and drag-detach works.
   - `tests/test_glare_tracer.py`: Verify `screen_reflection` detection, pillar/bookshelf occlusion clearing, `bias_ok` rear-monitor classification, and solar window beam hits.
   - `tests/test_api_spatial.py` & `tests/test_cli_spatial.py`: Verify all new HTTP endpoints, `X-Myhuey-Layout` sandbox isolation (`409` on active layout race), and CLI commands.
2. **Frontend Tests & Build:**
   - Add unit tests in `frontend/src/lib/__tests__/glareMath.test.ts` verifying identical results against Python test vectors.
   - Ensure `npm --prefix frontend test` passes all existing 135 tests + new tests (mock/guard WebGL context in `jsdom`).
   - Run `npm --prefix frontend run build` cleanly into `static/app` with zero TypeScript errors.

Start by inspecting `myhuey/models/schema.py`, `myhuey/storage/migrations.py`, and `frontend/package.json` so your implementation aligns cleanly with existing module conventions and React/Three.js versions.
