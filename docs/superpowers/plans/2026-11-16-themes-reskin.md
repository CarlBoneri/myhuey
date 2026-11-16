# Themes and Re-skin (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Seven code-editor themes (Neon default), a flat IDE background with Warp-style glass blocks, JetBrains Mono, a Reduce transparency preference, and IDE touches (path-bar headings, bracketed segmented controls), with every existing feature intact.

**Architecture:**
- **Themes are CSS custom-property blocks** keyed by `data-theme="<id>"` on `<html>`.
- **`lib/theme.ts`** resolves the preferences to a theme id and works out what the rail toggle writes.
- **The backend preferences** grow the new keys.
- **Glass** is a small set of tokens and a few shared rules on panel-like elements.
- **Reduce transparency** is `data-transparency="reduced"` on `<html>`.

**Tech Stack:** React 19, Vite, vitest (node env), FastAPI preferences, CSS.

**Spec:** docs/superpowers/specs/2026-11-16-ide-workbench-design.md (Phase 1)

## Global Constraints

- **Theme ids:** `neon` (default), `monokai`, `dracula`, `nord`, `graphite` (today's dark values), `solarized-light`, `light` (today's light values).
- **Neon values** are exactly as in the spec's table.
- **Legacy values:** stored `dark` reads as `neon`; stored `light` stays `light`.
- **New preferences:**
  - `theme_dark` (dark ids, default `neon`)
  - `theme_light` (light ids, default `light`)
  - `reduce_transparency` (`auto` | `on` | `off`, default `auto`; `auto` follows `prefers-reduced-transparency`)
- **Text rules:** text tokens `--text`, `--text-2`, `--text-3` must be hex and reach at least 4.5:1 against both `--bg` and `--bg-2` in every theme. Palette (non-text) tokens keep their source values.
- **Font:** `@fontsource-variable/jetbrains-mono@5.3.0`, pinned exactly and bundled. No text under 12px.
- **No glass** (`backdrop-filter`) on `.stage`, `.plan-canvas`, or photo and scene canvases.
- **Light colours are real:** chips and glows that show a light's colour never take theme colours.
- No AI attribution in commits.
- **Gate:** `.venv/bin/pytest -q` and `cd frontend && npx vitest run && npm run typecheck && npm run build`.

## Review Focus

1. **A stored legacy preference (`theme: "dark"`) or an unknown theme id.** It must show Neon, not a blank or unstyled page. Tested in Tasks 1 and 2.
2. **System mode when the OS switches dark/light while the app is open.** It must follow live. Tested in Task 1 via `resolveTheme`; the existing `followSystemTheme` keeps listening.
3. **The rail toggle from an explicit theme.** The choice is never lost. Tested in Task 1.
4. **Reduce transparency on.** No `backdrop-filter` anywhere, and panels are solid. Tested in Task 4 (CSS rule test).
5. **A light theme with glass.** Text stays readable. The contrast test in Task 3 covers each light theme.

---

### Task 1: Theme model (`frontend/src/lib/theme.ts`)

**Interfaces:**
- `type ThemeId = 'neon'|'monokai'|'dracula'|'nord'|'graphite'|'solarized-light'|'light'`
- `type Theme = ThemeId | 'system'`
- `THEMES: { id: ThemeId; label: string; kind: 'dark'|'light' }[]`, in the order above, with labels `Neon`, `Monokai`, `Dracula`, `Nord`, `Graphite`, `Solarized Light`, `Light`
- `normalizeTheme(value: unknown): Theme`: `'dark'` and unknown values become `'neon'`; `'light'` and `'system'` stay as they are.
- `resolveTheme(prefs: { theme: string; theme_dark?: string; theme_light?: string }, systemDark: boolean): ThemeId`
- `themeToggle(prefs, systemDark): Partial<{ theme: Theme; theme_dark: ThemeId; theme_light: ThemeId }>`: the spec's rail rule.
- `applyTheme(prefs)`: sets `data-theme` and caches the preferences JSON under `myhuey.theme`.
- `readCachedTheme(): { theme: Theme; theme_dark: ThemeId; theme_light: ThemeId }`
- `followSystemTheme(prefs)`: unchanged behaviour, new argument.

- [ ] **Step 1: Rewrite `lib/theme.test.ts`** with these tests:
  - `normalizeTheme('dark') === 'neon'`, `normalizeTheme('bogus') === 'neon'`, `normalizeTheme('light') === 'light'`.
  - `resolveTheme({theme:'system', theme_dark:'dracula', theme_light:'solarized-light'}, true) === 'dracula'`, and `=== 'solarized-light'` when `systemDark` is false.
  - `resolveTheme({theme:'monokai'}, false) === 'monokai'`.
  - `themeToggle({theme:'monokai', theme_dark:'neon', theme_light:'light'}, true)` deep-equals `{theme:'light', theme_dark:'monokai'}`.
  - `themeToggle({theme:'light', theme_dark:'monokai', theme_light:'light'}, true)` deep-equals `{theme:'monokai', theme_light:'light'}`.
  - `themeToggle({theme:'system', theme_dark:'nord', theme_light:'light'}, true)` deep-equals `{theme:'light'}`.
  - A cached-value round trip with `localStorage` stubbed, including blocked storage, which returns the defaults.
- [ ] **Step 2: Run** `npx vitest run src/lib/theme.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then update the callers in `main.tsx` and `App.tsx`. The rail button calls `setPreferences(themeToggle(prefs, systemPrefersDark()))`, and its icon shows the kind of the theme it would switch to.
- [ ] **Step 4: Run the gate**, then commit with the message `feat: seven editor themes in the theme model, with a toggle that never loses your choice`.

### Task 2: Preferences

**Files:** `src/myhuey/preferences.py`, `tests/test_theme_preference.py`, `frontend/src/types.ts` (`Preferences`), `frontend/src/store.ts` (`DEFAULT_PREFERENCES`).

- [ ] **Step 1: Write the pytest cases.**
  - `theme` accepts all 7 ids and `system`.
  - A saved `"dark"` merges to `"neon"`; a saved `"bogus"` merges to `"neon"`.
  - `theme_dark` rejects `light`; `theme_light` rejects `neon`.
  - `reduce_transparency` defaults to `"auto"` and accepts `on` and `off`.
  - `myhuey prefs set --key theme --value dracula` works.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add the choices. `merged()` maps a legacy `dark` to `neon` before validating.
- [ ] **Step 4: Run the gate** (types and defaults updated), then commit with the message `feat: theme, per-mode theme, and reduce-transparency preferences`.

### Task 3: Token sets and contrast

**Files:**
- Create `frontend/src/lib/contrast.ts`: `contrastRatio(a: string, b: string): number`, WCAG relative luminance, hex only.
- `lib/themeCss.test.ts`
- `styles.css`

- [ ] **Step 1: Write the tests.**
  - `contrastRatio('#000000', '#ffffff')` rounds to 21, and `contrastRatio('#5c6370', '#1f1f23')` is below 3.
  - New `themeCss` tests parse the `:root` block plus every `:root[data-theme="<id>"]` block. For each of the 7 ids:
    - It defines every token in `REQUIRED_TOKENS`: the current `:root` list plus `--ansi-red`, `--ansi-green`, `--ansi-yellow`, `--ansi-blue`, `--ansi-magenta`, `--ansi-cyan`, `--glass-bg`, `--glass-border`, `--glass-highlight`, `--glass-blur`, `--glow-lit`, `--selection`.
    - `--text`, `--text-2` and `--text-3` are hex and reach at least 4.5 against `--bg` and `--bg-2`.
  - Replace the old "defines every light token once" test with "graphite keeps today's dark values" (`--bg: #0b0a12`) and "light keeps today's light values" (`--bg: #f6f5fb`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Write the CSS.**
  - `:root` holds the Neon tokens: Neon background `#1f1f23`, `--bg-2: #19191c`, accent `#5a7dff`, ANSI tokens from the spec's table.
  - `--text-3` is a passing grey. Bright black `#5c6370` is used only for `--hairline`, `--border-strong` and similar.
  - `color-scheme: dark`.
  - One block per other theme, using its canonical palette. Text greys are adjusted until they pass.
  - Graphite and Light copy today's two blocks, with any failing text grey adjusted.
- [ ] **Step 4: Run the gate**, then commit with the message `feat: token sets for seven themes, with readable text in each`.

### Task 4: Flat background, glass blocks, font, reduce transparency

**Files:** `frontend/package.json` (add `@fontsource-variable/jetbrains-mono` at `5.3.0`), `main.tsx` (import it), `App.tsx`, `styles.css`, `lib/themeCss.test.ts`, `lib/theme.ts`.

**Interfaces:** `applyTransparency(setting: 'auto'|'on'|'off')` in `lib/theme.ts` sets `data-transparency="reduced"` when `on`, or when `auto` and `matchMedia('(prefers-reduced-transparency: reduce)')` matches; otherwise it removes the attribute.

- [ ] **Step 1: Write the tests.**
  - A CSS test: the `:root[data-transparency="reduced"]` block sets `--glass-blur: 0px`, and the rule `:root[data-transparency="reduced"] *` (or an equivalent) sets `backdrop-filter: none`.
  - `.stage`, `.plan-canvas` and `.photo-stage` contain no `backdrop-filter`.
  - `--font` begins with `'JetBrains Mono Variable'`.
  - A theme test: `applyTransparency` sets and removes the attribute, using a stubbed `document` and `matchMedia`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The App's `.backdrop` glows are dropped, giving a flat `--bg`.
  - Panel-like surfaces use the glass tokens: background `var(--glass-bg)`, `backdrop-filter: blur(var(--glass-blur)) saturate(160%)`, a 1px `var(--glass-border)` border, a `var(--glass-highlight)` inset top line, and a 10–12px radius. These are `.panel`, `.rail`, `.room-tile`, `.quick-menu`, `.toast`, `.sandbox-banner`, `.light-card`, `.suggest-card` and `.stage-hint`.
  - Lit tiles and lit light cards glow with `var(--glow-lit)`.
  - Base font size is 13px, with JetBrains Mono everywhere.
  - App applies `applyTransparency(preferences.reduce_transparency)`.
- [ ] **Step 4: Run the gate**, then commit with the message `feat: flat editor background, glass blocks, JetBrains Mono, and reduce transparency`.

### Task 5: IDE touches and Settings

**Files:** `styles.css`, `views/SettingsView.tsx`, `lib/themeCss.test.ts`.

- [ ] **Step 1: Write the CSS tests.**
  - `.page-head .eyebrow::before` has content `"~ / "`.
  - `.page-head h1::after` includes `▌`.
  - `.segmented button::before` and `::after` add `[ ` and ` ]`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Path bar** (CSS only, keeping the existing links in the eyebrow): `.page-head > div` is one line; `.eyebrow` is lowercase; `h1` is 15px, lowercase, with a ` / ` before it and a blinking `▌` after. Blinking stops under `prefers-reduced-motion`.
  - **Segmented options** get brackets.
  - **The Settings "Look" group:**
    - a Theme select listing System plus the 7 themes
    - when the theme is System, "Dark theme" and "Light theme" selects
    - Reduce transparency as Auto / On / Off
    - each theme option shows six swatches of its ANSI colours (read from `getComputedStyle` with the attribute set on a hidden element, or a static map in `THEMES`; the builder chooses)
- [ ] **Step 4: Run the gate**, then commit with the message `feat: path-bar headings, bracketed controls, and theme settings`.

### Task 6: Browser check, README, final review

- [ ] **Browser check.** On a copy of the database on :8001, take a screenshot of every screen in Neon, plus Home, Studio and Lights in each other theme. Check reduce transparency on and off.
  - Walk the README's feature list and confirm each feature still works.
  - Use the Office for any light change, and restore its state afterwards.
- [ ] **README:** add the theme list and the new preferences to the Settings table, in Carl's voice.
- [ ] **Final review** by a fresh reviewer. Fix the Critical and Important findings test-first, then merge and restart :8000.
