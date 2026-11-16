# Slice 3: the last visual leftovers (design)

Date: 2026-11-16. Status: approved on autopilot (the owner said "slice 3 on autopilot"; my
recommendations stand in for approvals, as in slices 1 and 2).

## Why

MyHuey exists to cut eye strain for people who code. The re-skin and the first two polish slices left
a list of small faults: text too small to read comfortably, colours that ignore the chosen theme,
lines that vanish on light themes, names shown in the wrong case, and a few controls that misbehave
with a mouse or keyboard. This slice clears that list so the visual iteration can close.

## Goals

Every item below either works as described or is reported as not checkable, with the reason.

**Branch A, `fix/visual-leftovers`** (looks, plus one CLI fix and docs):

1. **"Auto" reduce transparency follows the system live.** Today it is read once when the app loads.
   It should listen for the system setting changing, the same way "system" theme already does
   (`followSystemTheme` in `lib/theme.ts`), and stop listening when the setting is "on" or "off".
2. **Names keep their case in headings.** The path-style headings lowercase everything, so the Office
   room's page reads "office". Fixed words ("home", "room", "scenes", "your rooms") stay lowercase, as
   the path look intends. Names people typed (rooms, scenes, layouts) show exactly as typed, in the
   heading and in the path before it. The mechanism is the builder's call (for example a class that
   turns the lowercasing off on the name).
3. **The scene editor's header reads like the other headings.** Today the path and the editable name
   run together: "scenes / kitchen**test_gen_kitchen**", with the name in a 28px field. It should
   read "~ / scenes / kitchen / test_gen_kitchen ▌" at the heading size, with the name still editable
   in place. The field should look like heading text until hovered or focused, then show it can be
   edited (an underline or a border). The Saved state, Live, and Apply stay where they are.
4. **No interface text under 12px.** There are 16 sizes under 12px in `styles.css` (10 to 11.5px)
   and `.mono` shrinks text to 0.92em, so some text lands at 10.8px. Raise all of them to at least
   12px. Labels drawn inside a plan or the 3D view at map scale (furniture names, light labels, edge
   lengths) grow and shrink with the drawing and are out of scope.
5. **No leftover purple.** About 12 places in `styles.css` hard-code the old violet
   (`rgba(167, 139, 250, …)`, `rgba(139, 92, 246, …)`) for focus rings, tags, glows, the selected
   swatch, the plan's mid-handles, the rug fill, the trace preview, and the current setup step. They
   should follow the theme's accent (for example `color-mix(in srgb, var(--accent) 20%, transparent)`).
   Themes whose own accent is violet (Graphite, Light) keep it; that is their palette. The scene
   editor's starting paint colour (`#8b5cf6`) is scene data, not a tint, and stays.
6. **Lines stay visible on light themes.** Strokes hard-coded white that are drawn straight onto the
   page or plan background vanish on light themes: zone outlines and the drawing-in-progress outline
   in the scene editor, the override marker's ring, the dashed rings around planned lights in the
   suggestion preview (`PlanLightsPanel`), the strip-light centre line (`Shapes.tsx`), and the end
   handle's ring. They should use theme tokens; the light themes already define `--hover-stroke` and
   `--handle-stroke`, and a new token may be added where none fits. White fills on handles with an
   accent ring are fine and stay.
   The scene cards' thumbnails draw the room dark (a room with the lights out) with light-coloured
   lights; that is a picture of light in a dark room, not a theme surface, and stays dark on every
   theme.
7. **`myhuey prefs set` accepts words in any case.** `--value Auto` and `--value NEON` should store
   `auto` and `neon`. The stored value is always the canonical word from the allowed list.
8. **The README links to `docs/vignettes/`**, from "How to use it" or "Install and run".
9. **Remove the unused `themeToggle`** in `lib/theme.ts` and its tests. The sun/moon button it served
   went away with the rail.

**Branch B, `fix/pointer-and-keyboard`** (behaviour), built after A merges:

10. **The "+" menu works from the keyboard.** When it opens, focus goes to its first item; Up and
    Down move between items and wrap; Home and End jump; Escape and Tab close it and hand focus back
    to "+". This is the behaviour the tab right-click menu (`TabContextMenu`) already has; share the
    code rather than copy it.
11. **Only the main button resizes.** A right-button (or middle-button) press on the rail handle or
    on the 3D screen's pane bars does nothing, so the browser's own menu can open.
12. **The rail handle looks normal after a mouse drag.** Today its pill stays accent-coloured until
    focus moves. After a mouse drag it should look like it does at rest; after keyboard use it still
    shows the focus colour. The cause is not known yet (the press calls `bar.focus()`); finding it is
    part of the work, and the fix is checked by eye.
13. **Pane bars stay under the pointer.** Dragging the bar between the wide 3D screen's panes ends a
    few pixels from the pointer. Measure the drag from where it began (start split plus distance
    moved), as the rail handle already does, so the bar stays under the pointer wherever it was
    grabbed. The same for the inspector's bar.
14. **"Give the 3D view the whole column" works in a narrow window.** Under 980px the view has a
    fixed height (`clamp(320px, 62vh, 620px)`), so folding the glare table changes nothing visible.
    With the glare table folded, the view should take most of the window's height (the builder picks
    the number by eye; the view must still fit without the page scrolling past the prompt).
15. **A view click right after a keyboard room choice is not lost in Safari or Firefox.** On a Mac
    those browsers do not focus a button when it is clicked, so the picker's blur sees no new focus
    and opens the pending room itself. Treat a press that lands inside the Studio header as a move
    within the header: the pending room is then left to the view switch, as it is in Chrome.

## Non-goals

- New themes, colour changes to any theme's palette, or a new type scale.
- Plan and 3D labels drawn at map scale (item 4).
- The functional follow-ups (cross-process lock, sandbox deletion, misleading messages, client setup
  docs, wheel contents), the glare engine, accessory modules, and the docs-screenshot idea. All are
  queued separately.

## Anti-goals (would count as failure even if the items "work")

- Any change that sends anything to the lights or writes to the owner's database during development
  or checks.
- Text that fails the existing contrast tests (every text colour is tested at 4.5:1 or better).
- A purple fix that makes a theme's own accent disappear (Graphite and Light keep their violet).
- Adding a `TODO(human)` comment; `frontend/src/lib/commands.ts` keeps exactly its one.

## Constraints

- Frontend: React 19, Vite, zustand; component tests use the dev-only DOM setup (happy-dom and React
  Testing Library, opt in per file, tools from `frontend/src/test/dom.ts`).
- Backend change is limited to `parse_value` in `src/myhuey/preferences.py` (item 7). The server on
  :8000 is restarted after A merges.
- All checks pass before each merge: `uv run pytest -q`, `npm --prefix frontend test`, typecheck,
  build.
- By-eye checks use the worktree under `.claude/worktrees/`, a server on :8001 against a read-only
  copy of the database in the session scratchpad, a tab marked "TEST COPY", nothing pressed that
  reaches the lights, drags done on the Help page where possible (the pane bars live only on the 3D
  screen; there the pointer stays on the bar), and the tab closed, server stopped, log read and copy
  deleted at the end of each round.

## Approaches considered

- **Two branches in turn, looks first (chosen).** Each review covers one kind of change: A is
  checked by sweeping themes, B by tests and drags. Both touch `styles.css`, so B starts from A's
  merge and never conflicts.
- **One branch for everything.** One review and one by-eye pass, but a large mixed diff and nothing
  merges until all fifteen items are done.
- **Two branches side by side.** Faster, but both edit `styles.css` and the merge would conflict.

## How each branch is checked

- **A:** a scan in the browser of every visible element's computed font size and colours, on the
  Office workbench, Scenes, a scene editor, the Studio plan and 3D screen, Lights and Settings, in one
  dark theme (Neon) and one light theme (Light, then Solarized Light), with screenshots of headings,
  the scene editor header, and the plan strokes. Themes are switched in the page only
  (`data-theme`), never saved. The transparency listener is checked in a test (the browser tool
  cannot change the Mac's setting).
- **B:** component tests for items 10, 11, 13 and 15; by eye for 10 (real arrow keys), 11 (a real
  right-click), 12, 13 and 14 (a narrow width via a same-origin iframe if the window will not
  resize).

## Answers from the builder check (my calls, on autopilot)

- **Merging and restarting.** I merge A to main, rebuild the frontend in the main checkout, and
  restart the live server on :8000 the way it was started on 2026-11-16 (`.venv/bin/myhuey serve
  --port 8000` from the main checkout, in the background, its log in the session scratchpad). Then B
  branches from that main, and the same happens after B. No pause for the owner between them.
- **Item 2 covers the path-style headings only.** The Scenes page's small uppercase group labels
  ("OFFICE") are a deliberate label style and stay. Layout names appear in no heading today, so
  nothing changes for them. Room names in the path keep their case too ("scenes / Kitchen").
- **Ctrl+click on a Mac counts as a right-click** (item 11): it opens the browser's menu and does
  not start a resize.
- **Tokens:** every light theme, the 16 imported ones included, already sets `--hover-stroke` and
  `--handle-stroke`. Any new colour token is built from tokens every theme defines (for example
  `color-mix(in srgb, var(--text) 40%, transparent)`), never by re-running
  `scripts/import_editor_themes.py`, which reads themes installed on this Mac and a git-ignored
  folder and could quietly drop themes.
- **The "Suggested: …" line** (`OriginLabel`) in the scene editor's heading block may move to its
  own line under the heading.

## Left to the builder

The exact sizes and tokens, how the heading keeps a name's case, the styling of the editable name,
the narrow view's height, the shared menu-keys code's shape, and the root cause for item 12.

## Not checkable by eye here (stated up front)

- Safari and Firefox (item 15): only Chrome can be driven; a test covers the press-then-blur order.
- The Menu key: the browser tool has no such key (tried 2026-11-16); a test covers it.
- Always-visible scrollbars: needs the Mac's "Show scroll bars: Always" setting, a system change
  this slice does not make.
- The Room picker's native open list and arrow-stepping on a closed picker on a Mac: the tools
  cannot drive the native list; tests cover both.

## As built, Part A (2026-11-16)

Where the finished work differs from the design above, and why:

- `<small>` elements with no size of their own fell back to the browser's "smaller" (10.8px) on the
  Home room tiles and in the scene editor's lists. Found by eye; a base `small` rule now gives them a
  12px floor.
- The unselected light ring and the strip outline on the plan (`Shapes.tsx`) were not on the list in
  item 6, but on light themes a pale lit light had no visible edge. Found by eye; both now use the
  plan line colour.
- The plan line colour is 55% of the text colour, not the 45% first planned: the final review
  measured 45% at about 2.7:1 on the Light floor, under the usual 3:1 for lines.
- In a narrow window a long scene name made the page scroll sideways by about 11px. Found by eye;
  the heading that holds the name is now a row the name can shrink in.
- The scene name shows a solid 2px accent underline when focused (dashed 1px on hover), with no
  shift in height between the states.
- The README links the guides and both of them.

Not checked by eye: the baseline of tags and role badges (they appear only after selecting a light
or with overrides, next to real light controls); the transparency listener (needs the Mac's
setting changed; a test covers it).
