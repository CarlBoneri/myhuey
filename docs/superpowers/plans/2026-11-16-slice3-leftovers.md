# Slice 3: the last visual leftovers, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the fifteen leftovers in the spec: Part A (looks, one CLI fix, docs) on `fix/visual-leftovers`, then Part B (pointer and keyboard) on `fix/pointer-and-keyboard`, branched from main after A merges.

**Architecture:** Frontend changes in `frontend/src/` (React 19, zustand, one stylesheet `styles.css`), with stylesheet rules pinned by tests that read `styles.css` as text (the pattern in `lib/tabsCss.test.ts`) and behaviour pinned by happy-dom component tests (the pattern in `components/StudioHead.test.tsx`). One backend change in `src/myhuey/preferences.py`.

**Tech Stack:** TypeScript, React 19, vitest (+ happy-dom, React Testing Library via `frontend/src/test/dom.ts`), Python 3.11+, pytest.

**Spec:** `docs/superpowers/specs/2026-11-16-slice3-leftovers-design.md` (read it; item numbers below are the spec's).

## Global Constraints

- Never start `myhuey serve`, never open a browser, never read or write `~/.myhuey`, never send anything to a Hue bridge. Checks by eye are done later by the controller.
- Do not add any `TODO(human)` comment. `frontend/src/lib/commands.ts` keeps exactly its one.
- Commit messages: plain sentences in the repo's style (`fix: …`, `docs: …`). Never add `Co-Authored-By` or any AI attribution.
- Do not re-run `scripts/import_editor_themes.py` and do not edit `themes.generated.css` or `lib/themes.generated.ts`.
- New colours are built from tokens every theme defines (`--text`, `--accent`, `--accent-strong`, …), for example `color-mix(in srgb, var(--accent) 20%, transparent)`.
- Themes whose own accent is violet (Graphite, Light) keep it. The scene editor's starting paint colour `#8b5cf6` stays.
- Labels drawn at map scale inside SVG plans or the 3D view (SVG `fontSize` in plan units) are out of scope for the 12px floor.
- Before each commit: `npm --prefix frontend test` and `npm --prefix frontend run typecheck` pass; for Task A5 also `uv run pytest -q`.
- Run commands from the worktree root `.claude/worktrees/slice3-check`.

## Review Focus

1. **Imported light themes** (16 of them, e.g. GitHub Light, Light+): purple and stroke fixes must hold there, not only in the built-in Light and Solarized Light. Pinned in A3 (no hard-coded violet or white outside theme blocks) and A4 (new line token derived from `--text`).
2. **A long scene or room name** in the narrowed scene editor header: the editable name must wrap or shrink, never push the Saved / Live / Apply tools off screen. Pinned in A2 by a CSS rule (`max-width: 100%` on the field) and checked by eye.
3. **A one-item "+" menu** (no closed tabs: only "Reset the tabs", plus a `<p>` note): arrows keep focus on that one item and never land on the note. Pinned in B1.
4. **A press in the Studio header that is not on a control** (the heading text) while a keyboard choice is pending: the pending room must still open after the pause. Pinned in B6.
5. **Ctrl+click on a Mac** on the rail handle or a pane bar: it is a right-click there and must not start a resize. Pinned in B2.

---

## Part A: `fix/visual-leftovers` (already checked out in the worktree)

### Task A1: "auto" transparency follows the system live; remove `themeToggle`

**Files:**
- Modify: `frontend/src/lib/theme.ts` (add `followSystemTransparency`, delete `themeToggle`)
- Modify: `frontend/src/App.tsx:58` (the transparency effect)
- Test: `frontend/src/lib/theme.test.ts`

**Interfaces:**
- Produces: `followSystemTransparency(setting: 'auto' | 'on' | 'off'): () => void` in `lib/theme.ts`.

- [ ] **Step 1: Write the failing tests** in the `reduce transparency` describe of `theme.test.ts`:
  - `it('re-applies "auto" when the system setting changes, and stops when told')`: stub `matchMedia` with an object whose `matches` can be flipped and whose `addEventListener('change', fn)` / `removeEventListener` record `fn`; call `const stop = followSystemTransparency('auto')`; flip `matches` to true and call the recorded listener; expect `attrs.transparency` toBe `'reduced'`; flip to false, call it; expect `undefined`; call `stop()`; expect the listener removed.
  - `it('listens to nothing for "on" and "off"')`: `followSystemTransparency('on')` and `('off')` add no listener and return a function.
  - Delete every test that uses `themeToggle`.
- [ ] **Step 2:** `npm --prefix frontend test -- theme` fails (no `followSystemTransparency`).
- [ ] **Step 3:** Implement `followSystemTransparency` in `lib/theme.ts` next to `followSystemTheme`, the same shape: no-op for anything but `'auto'` or when `matchMedia` is missing; the listener calls `applyTransparency('auto')`. Delete `themeToggle`. In `App.tsx` the effect becomes `applyTransparency(setting); return followSystemTransparency(setting);`.
- [ ] **Step 4:** `npm --prefix frontend test` and typecheck pass. `grep -rn themeToggle frontend/src` prints nothing.
- [ ] **Step 5: Commit** `fix: "auto" transparency follows the system as it changes; drop the unused theme toggle`

### Task A2: names keep their case; the scene editor header reads like the others

**Files:**
- Modify: `frontend/src/styles.css` (the path-heading block around lines 497-510; `.title-input`)
- Modify: `frontend/src/views/RoomWorkbench.tsx:38`, `frontend/src/components/StudioHead.tsx:120`, `frontend/src/views/SceneEditor.tsx:312-317`
- Create: `frontend/src/lib/headingsCss.test.ts`
- Test: `frontend/src/components/StudioHead.test.tsx`

**Interfaces:**
- Produces: CSS class `as-typed` ("show this text exactly as typed"), usable on an `h1` or a `span` inside `.page-head`.

- [ ] **Step 1: Write the failing tests.**
  - `headingsCss.test.ts` (copy the `bodies()` helper idea from `tabsCss.test.ts`):
    - `it('shows names as typed inside path headings')`: a rule for `.page-head .as-typed` contains `text-transform: none`.
    - `it('sizes the scene name field as heading text')`: the rule(s) for `.page-head .title-input` contain `font: inherit` (or `font-size: inherit`), `max-width: 100%`, and no `font-size: 28px`.
    - `it('keeps fixed heading words lowercase')`: `.page-head h1` still contains `text-transform: lowercase`.
  - `StudioHead.test.tsx`: `it('shows the room name as typed')`: render `view="3d" room="Office"`; the `h1` has class `as-typed`. Render `view="home"`; the `h1` ("Whole home") does not.
- [ ] **Step 2:** the new tests fail.
- [ ] **Step 3: Implement.**
  - CSS: `.page-head .as-typed { text-transform: none; }`. Style `.page-head h1 .title-input` as heading text: `font: inherit; color: inherit; background: transparent; border: 0; border-bottom: 1px dashed transparent; padding: 0; max-width: 100%;`, with `:hover` and `:focus-visible` showing the bottom border (`var(--border-strong)` on hover, `var(--accent)` on focus). Remove the 28px size wherever `.title-input` sets it for this header.
  - `RoomWorkbench`: `<h1 className="as-typed">`. `StudioHead`: `as-typed` only when a room is shown. In both, the room name in any eyebrow path stays as typed too (wrap it in `<span className="as-typed">`).
  - `SceneEditor` header: eyebrow `<a href="#/scenes">Scenes</a> / <span className="as-typed">{draft.room}</span>`, then `<h1 className="as-typed"><input className="title-input" size={Math.max(4, draft.name.length)} … /></h1>` (same `value`, `aria-label`, `onChange` as today), so the path, the " / " and the caret come from the existing `h1::before`/`::after` rules. Put `OriginLabel` on its own line below the heading row (outside the flex row that holds eyebrow and h1).
- [ ] **Step 4:** tests and typecheck pass.
- [ ] **Step 5: Commit** `fix: room and scene names keep their case in headings, and the scene editor's heading reads like the others`

### Task A3: no interface text under 12px; no leftover purple

**Files:**
- Modify: `frontend/src/styles.css` (the 16 sub-12px sizes listed in the spec; `.mono` at line 372; the 12 violet values)
- Create: `frontend/src/lib/legibilityCss.test.ts`

- [ ] **Step 1: Write the failing tests** in `legibilityCss.test.ts` (read `styles.css` as text):
  - `it('sets no font size under 12px')`: every `font-size:` declaration whose value is `Npx` has N ≥ 12.
  - `it('never lets a relative size shrink text under 12px')`: every `font-size:` value in `em`/`rem`/`%` that is below 1em/1rem/100% is wrapped in `max(12px, …)`.
  - `it('leaves no hard-coded violet outside theme palettes')`: strip every rule whose selector starts with `:root` (the theme blocks), then the rest contains none of `167, 139, 250`, `139, 92, 246`, `124, 58, 237`, `#a78bfa`, `#8b5cf6`, `#7c3aed` (case-insensitive). Leave `.dot.image`'s rainbow gradient alone: list its line as the one allowed exception by selector.
- [ ] **Step 2:** the tests fail (16 sizes, `.mono`, about 12 violet values).
- [ ] **Step 3: Implement.** Raise each size to 12px (12.5px where the neighbouring text is 12px and the item is a heading-like label, builder's eye). `.mono { font-size: max(12px, 0.92em); }`. Replace each violet value with the same alpha of the accent: `rgba(167, 139, 250, A)` → `color-mix(in srgb, var(--accent) A*100%, transparent)`; `rgba(139, 92, 246, A)` → the same with `var(--accent-strong)`. If a tag or badge now overflows its row, let it ellipsize (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`), never shrink it back.
- [ ] **Step 4:** tests, the existing contrast tests (`lib/contrast.test.ts`, `lib/themeCss.test.ts`) and typecheck pass.
- [ ] **Step 5: Commit** `fix: no interface text under 12px, and focus rings, tags and glows follow the theme's accent instead of a leftover violet`

### Task A4: lines stay visible on light themes

**Files:**
- Modify: `frontend/src/styles.css` (base `:root` block: add `--plan-line`; `.end-handle circle`)
- Modify: `frontend/src/views/SceneEditor.tsx:56,181,357`, `frontend/src/components/PlanLightsPanel.tsx:96`, `frontend/src/components/Shapes.tsx:58,77` (see Step 3 for Shapes)
- Create: `frontend/src/lib/strokesCss.test.ts`

**Interfaces:**
- Produces: CSS custom property `--plan-line` = `color-mix(in srgb, var(--text) 45%, transparent)`, declared once in the base `:root` block (it resolves per theme because every theme sets `--text` on the same element).

- [ ] **Step 1: Write the failing tests** in `strokesCss.test.ts`:
  - `it('declares one line colour built from the text colour')`: `styles.css` matches `/--plan-line:\s*color-mix\(in srgb, var\(--text\)/` exactly once.
  - `it('draws no white stroke straight onto a theme background')`: read `views/SceneEditor.tsx`, `components/PlanLightsPanel.tsx` as text; neither contains `stroke="#fff"` nor `stroke="rgba(255,255,255`. The `.end-handle circle` rule in `styles.css` does not contain `stroke: #fff`.
  - `it('keeps the scene thumbnails a dark room')`: `views/ScenesView.tsx` still contains `'#15131f'` (the lights-out room stays dark by design).
- [ ] **Step 2:** the tests fail.
- [ ] **Step 3: Implement.** Use `var(--plan-line)` for the zone outline (SceneEditor:357, keep its dash and drop the 0.35 opacity in favour of the token), the drawing-in-progress outline (:56), and the planned-light rings in `PlanLightsPanel` (:96). The override marker ring (:181) and `.end-handle circle` use `var(--handle-stroke)`. In `Shapes.tsx` (:58, :77) first check what each line is drawn over: if over the light's own lit fill, leave it and say so in the commit body; if over the plan background, use `var(--plan-line)`.
- [ ] **Step 4:** tests and typecheck pass.
- [ ] **Step 5: Commit** `fix: outlines and rings in the plan and scene editor use theme colours, so they show on light themes`

### Task A5: `myhuey prefs` words in any case; README links the vignettes

**Files:**
- Modify: `src/myhuey/preferences.py:99-111` (`parse_value`)
- Modify: `README.md` (section "Install and run", line ~32)
- Test: `tests/test_theme_preference.py`

- [ ] **Step 1: Write the failing test** `test_parse_value_matches_words_in_any_case`:
  ```python
  assert parse_value("Auto", "reduce_transparency") == "auto"
  assert parse_value(" NEON ", "theme") == "neon"
  assert parse_value("VSCode-Abyss", "theme") == "vscode-abyss"
  assert parse_value("Purple", "theme") == "Purple"   # unknown words pass through for validation to reject
  assert parse_value("On", "room_sliders") is True     # booleans unchanged
  ```
- [ ] **Step 2:** `uv run pytest -q tests/test_theme_preference.py` fails on the first assert.
- [ ] **Step 3:** In `parse_value`, for a key whose allowed values are words, return the allowed word that equals `text.strip()` ignoring case, else `text.strip()`. Add one line to the README under "Install and run": a link to `docs/vignettes/` describing it as step-by-step guides (installing and running, designing a room layout).
- [ ] **Step 4:** `uv run pytest -q` passes.
- [ ] **Step 5: Commit** `fix: myhuey prefs accepts words in any case; docs: link the step-by-step guides from the README`

**After Part A (controller):** whole-branch review, by-eye round per the spec, merge to main, rebuild the main checkout's frontend, restart :8000, then create `fix/pointer-and-keyboard` from main in the worktree.

---

## Part B: `fix/pointer-and-keyboard` (branched from main after A merges)

### Task B1: the "+" menu works from the keyboard, sharing the right-click menu's keys

**Files:**
- Create: `frontend/src/lib/menuKeys.ts`
- Modify: `frontend/src/components/TabContextMenu.tsx:52-63` (use the helper), `frontend/src/components/TabStrip.tsx:47-54,258-277` (the "+" menu)
- Test: `frontend/src/lib/menuKeys.test.ts` is not needed if the component tests cover it; tests go in `frontend/src/components/TabStrip.test.tsx` (new describe `TabStrip "+" menu keys`) and the existing `TabContextMenu.test.tsx` must keep passing.

**Interfaces:**
- Produces: `moveMenuFocus(menu: HTMLElement, key: string): boolean` in `lib/menuKeys.ts`. Handles `ArrowDown`, `ArrowUp` (wrapping), `Home`, `End` over the menu's `button` elements; returns true when it handled the key (caller then calls `preventDefault`), false otherwise.

- [ ] **Step 1: Write the failing tests** (`TabStrip.test.tsx`, reuse its `strip()` helper):
  - `it('focuses the first item when the "+" menu opens')`: click "Reopen or reset tabs"; `document.activeElement` is the first `menuitem`.
  - `it('moves through the items with the arrows, Home and End, and wraps')`: with two closed tabs (three items), ArrowDown ×3 returns to the first; End lands on "Reset the tabs"; Home on the first; ArrowUp from the first lands on the last.
  - `it('stays on the only item when nothing is closed')`: no closed tabs; ArrowDown and ArrowUp keep focus on "Reset the tabs"; the note paragraph never gets focus.
  - `it('closes on Escape and on Tab and gives focus back to "+"')`: both keys close the menu (`queryByRole('menu')` null) and focus is the "+" button.
- [ ] **Step 2:** the new tests fail.
- [ ] **Step 3:** Write `moveMenuFocus`; make `TabContextMenu.move` call it (keep its Tab handling). In `TabStrip`, focus the first item when the menu opens (a layout effect on `menu`), handle `onKeyDown` on the menu: Tab or Escape → close and focus the "+" button (keep a ref to it), otherwise `moveMenuFocus`. Remove the window-level Escape listener's duplicate close only if the new handler covers it; Escape pressed while focus is outside the menu must still close it.
- [ ] **Step 4:** all frontend tests (including `TabContextMenu.test.tsx`) and typecheck pass.
- [ ] **Step 5: Commit** `fix: the "+" tab menu works from the keyboard, with the same keys as the right-click menu`

### Task B2: only the main button resizes (rail handle and pane bars)

**Files:**
- Create: `frontend/src/lib/pointer.ts`
- Modify: `frontend/src/components/TabStrip.tsx:146` (`dragRail`), `frontend/src/components/Studio3D.tsx:75` (`dragBar`)
- Test: `frontend/src/lib/pointer.test.ts`, `frontend/src/components/TabStrip.test.tsx` (describe `TabStrip rail handle drag`)

**Interfaces:**
- Produces: `isResizePress(event: { button: number; ctrlKey: boolean }, mac: boolean): boolean` (true only for button 0 without Ctrl on a Mac) and `isMac(): boolean` (from `navigator.platform` / `userAgentData`, false when `navigator` is missing) in `lib/pointer.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `pointer.test.ts`: `isResizePress({button:0,ctrlKey:false}, true)` true; `({button:2,ctrlKey:false}, false)` false; `({button:1,…})` false; `({button:0,ctrlKey:true}, true)` false; `({button:0,ctrlKey:true}, false)` true.
  - `TabStrip.test.tsx`: `it('ignores a right-button press on the handle')`: `fireEvent.pointerDown(handle, { button: 2 })` then a `pointermove`; the rail width in `useUi` is unchanged and `defaultPrevented` is false.
- [ ] **Step 2:** tests fail.
- [ ] **Step 3:** Implement; `dragRail` and `dragBar` return before `preventDefault` when `!isResizePress(event, isMac())`.
- [ ] **Step 4:** tests and typecheck pass.
- [ ] **Step 5: Commit** `fix: only a main-button press resizes the rail or the 3D panes; a right-click (or Ctrl+click on a Mac) opens the browser's menu`

### Task B3: the rail handle looks normal after a mouse drag

**Files:**
- Modify: `frontend/src/components/TabStrip.tsx` (`dragRail`), possibly `frontend/src/styles.css:448-451`
- Test: `frontend/src/components/TabStrip.test.tsx` and `frontend/src/lib/tabsCss.test.ts` as the fix requires

- [ ] **Step 1: Find the cause before fixing** (superpowers:systematic-debugging). Known: `dragRail` calls `bar.focus()` on the press; the pill turns accent from `.rail-handle:focus-visible span` and from `.splitter:hover span, .splitter:active span`. Write down which rule keeps it lit after pointerup with the pointer moved away, from the code and the CSS (the controller confirms by eye). Candidate fixes: `bar.focus({ focusVisible: false })` where supported, focusing only for keyboard use, or a `data-dragged` attribute cleared on the next keydown that suppresses the focus colour.
- [ ] **Step 2: Write the failing test** that pins the chosen mechanism (for example: after pointerdown + pointerup with the mouse, the handle carries no marker that the focus style keys on; after a keydown, it does). The keyboard path must still show the focus colour: `tabsCss.test.ts` keeps asserting `.rail-handle:focus-visible span` uses `var(--accent)`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** tests and typecheck pass.
- [ ] **Step 5: Commit** `fix: the rail handle goes back to its resting look after a mouse drag, and still shows focus for the keyboard` (commit body: the cause found in Step 1)

### Task B4: pane bars stay under the pointer; "whole column" works in a narrow window

**Files:**
- Create: `frontend/src/lib/paneDrag.ts`
- Modify: `frontend/src/components/Studio3D.tsx:85-92` (the two resize handlers), `:107` (root class), `frontend/src/styles.css:870-877` (narrow block)
- Test: `frontend/src/lib/paneDrag.test.ts`, `frontend/src/lib/studioCss.test.ts`

**Interfaces:**
- Consumes: `clamp` from `lib/view3d.ts`.
- Produces: `splitAfterDrag(startSplit: number, startY: number, y: number, height: number): number` (clamped to `[0.2, 0.85]`) and `inspectorAfterDrag(startWidth: number, startX: number, x: number): number` (clamped to `[280, 680]`) in `lib/paneDrag.ts`. CSS class `audit-folded` on `.studio3d` when the glare table is folded.

- [ ] **Step 1: Write the failing tests.**
  - `paneDrag.test.ts`: `splitAfterDrag(0.62, 400, 400, 800)` is `0.62` (no move, no jump, wherever the bar was grabbed); `splitAfterDrag(0.5, 400, 480, 800)` is `0.6`; clamps at both ends. `inspectorAfterDrag(380, 1000, 900)` is `480`; clamps at 280 and 680.
  - `studioCss.test.ts`: `it('gives the 3D view most of a narrow window when the glare table is folded')`: inside the `@media` block that holds `.studio3d .pane-body.stage`, a rule for `.studio3d.audit-folded .pane-body.stage` exists and sets a `height` different from `clamp(320px, 62vh, 620px)`.
- [ ] **Step 2:** tests fail.
- [ ] **Step 3:** Implement: each handler reads the start position and start size on the press and applies the helper on move (the rail handle already works this way). Add `audit-folded` to the root's class list when `collapsed.audit`. Pick the narrow folded height by reasoning about the chrome (top bar, Studio header, pane head, prompt); start from `clamp(320px, calc(100dvh - 260px), 1200px)` and leave the final number to the controller's by-eye check.
- [ ] **Step 4:** tests and typecheck pass.
- [ ] **Step 5: Commit** `fix: the 3D screen's pane bars stay under the pointer, and folding the glare table gives a narrow window's 3D view the whole column`

### Task B5: a view click after a keyboard room choice is not lost in Safari or Firefox

**Files:**
- Modify: `frontend/src/components/StudioHead.tsx:104-108` (`blur`), the `<header>` element
- Test: `frontend/src/components/StudioHead.test.tsx`

- [ ] **Step 1: Write the failing tests** (reuse `byKey`, `radio`, `wait`):
  - `it('keeps a pending room for the view switch when a press in the header blurs the picker without focusing anything (Safari, Firefox)')`: render `view="plan" room="Office"`; `byKey('Den')`; `fireEvent.pointerDown(radio('3D'))`; `fireEvent.blur(picker(), { relatedTarget: null })`; expect `go` not called; `fireEvent.click(radio('3D'))`; expect `go` called once with the 3D address for Den (`{ view: 'design', room: 'Den', tab: '3d' }`).
  - `it('still opens the pending room after the pause when the press was on the heading, not a control')`: `byKey('Den')`; `fireEvent.pointerDown(screen.getByRole('heading'))`; blur with `relatedTarget: null`; `wait(PICK_SETTLE_MS)`; expect `go` called once with Den in the plan view.
  - `it('opens the pending room at once when a press outside the header blurs the picker')`: `byKey('Den')`; blur with `relatedTarget: null` and no press in the header; `go` called at once (today's behaviour, kept).
- [ ] **Step 2:** the first two fail.
- [ ] **Step 3:** Implement: a capture-phase `onPointerDownCapture` on the `<header>` records "pressed inside the header" (cleared on the next `pointerup` anywhere, or after the click it produced); in `blur`, when `relatedTarget` is null and a press inside the header is in progress, leave the pending choice alone (the timer keeps running, so a press on a non-control still opens it after the pause).
- [ ] **Step 4:** all StudioHead tests and typecheck pass.
- [ ] **Step 5: Commit** `fix: a view click right after a keyboard room choice also lands in Safari and Firefox, which do not focus a clicked button`

**After Part B (controller):** whole-branch review, by-eye round per the spec, merge to main, rebuild, restart :8000; add an "As built" section to the spec; update the backlog memory.
