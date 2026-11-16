# Tab bar and rail polish (visual iteration, slice 1)

Status: awaiting the owner's approval. Date: 2026-11-16. Branch: `feat/tab-rail-polish`.

## Why

The tab bar, the side rail and its right-click menu were built in the last iteration with the
instruction to leave polish for later. This slice clears the leftovers that all live in the same
few files, and adds the test setup that lets focus and keyboard behaviour be checked by a test
instead of only by eye.

## Goals

1. The rail's resize handle no longer covers part of a scrollbar.
2. After "Close tab" on the active tab from the right-click menu, focus lands on the tab that
   became active.
3. Scrolling the active tab into view stops short of the pinned buttons ("+", and in a rail the
   Tabs toggle), so the active tab is never hidden under one.
4. Two screen-reader fixes: no `aria-orientation` on the `<nav>`, and the rail toggle says its
   state once.
5. In a narrow window, where a left or right rail is drawn in the top bar, the app says that the
   saved choice still applies.
6. CSS and constant tidy-up: one default for the rail width, one definition of the
   narrow-window rule.
7. A DOM test setup for the frontend, dev-only and documented, with the first component tests
   for `TabStrip` and `TabContextMenu`.
8. The by-eye checks that were never done for the tab menu and the toasts.

## Not in this slice

- The Studio items (Room picker and the 3D view, the squeezed 3D pane, `StudioHead` tests): slice 2.
- Theme colours and the older re-skin leftovers: slice 3.
- Any backend change, any new runtime dependency, any change to what the tabs can do.

## What must not happen

- The owner's app on :8000 is not rebuilt or replaced while this is built or checked.
- Nothing is written to `~/.myhuey` and no real light changes.
- The existing 508 frontend tests keep running as they do now (in plain Node, no DOM).
- `frontend/src/lib/commands.ts` keeps its one `TODO(human)` comment, untouched.

## How things work today (what was found)

- **Handle.** The handle is a 10 px strip centred on the rail's inner edge, so 5 px of it lies
  inside the rail. On a left rail that is where the rail's 8 px scrollbar is.
- **Focus.** Choosing "Close tab" closes the tab and asks for the next screen in the same moment.
  The tab list is redrawn first; the address change that marks the new tab active arrives a
  moment later. Focus is placed in between, finds no active tab, and falls back to the first tab.
- **Scrolling.** The active tab is scrolled to the nearest edge of the strip. The "+" is pinned
  to that edge and drawn on top, so the tab ends up under it.
- **Narrow window.** Below 720 px a left or right rail is drawn at the top. The right-click menu
  still shows Left or Right as chosen, with nothing to explain why the tabs are at the top.
  Settings says so in a fixed sentence; the `tabs left` command reply says nothing.
- **Repeats.** `210px` is written three times in the stylesheet as a fallback that is never used
  (the app always sets the width). The narrow-window rule is written in `App.tsx` and again in
  `lib/runCommand.ts`.

## Approaches

### The resize handle

- **A. Give the handle its own lane (chosen).** The handle becomes a normal strip beside the rail,
  inside the rail's total width, the same way the bars between the 3D screen's panes work. It
  overlaps nothing on either side. Cost: the tab column is a few pixels narrower.
- **B. Slide the handle off the scrollbar.** Outside the rail on the left, inside on the right.
  Rejected: on the left it then covers the first pixels of the page, and next to an open
  Workflows drawer or the page's own scrollbar it creates the same overlap somewhere else.
- **C. Hide the rail's scrollbar.** Rejected: the rail would give no sign that it scrolls.

### The DOM test setup

- **A. happy-dom plus React Testing Library, switched on per test file (chosen).** Dev
  dependencies only, pinned to exact versions like every other dependency. A test file opts in
  with a one-line comment at its top; every other test keeps running in Node. Nothing is added
  to the built app and tests make no network requests.
- **B. jsdom instead of happy-dom.** The more widely used simulator, but a much larger install,
  and it lacks `matchMedia` and `scrollIntoView`, which these components call. The fallback if
  happy-dom turns out to mishandle focus or portals; the builder reports before switching.
- **C. A real browser (Playwright).** Could check layout too, but it downloads browsers and is
  far heavier than this project needs. Rejected.

## Design

1. **Handle.** Approach A. `--rail-w` stays the full width of the rail including the lane, so
   the toasts and the Workflows drawer keep their positions. Dragging, arrow keys, Home/End and
   double-click behave as now.
2. **Focus after closing.** When the menu's "Close tab" closes the active tab, the strip
   remembers which tab is about to become active and moves focus only once that tab is drawn as
   active. Closing a tab that is not active keeps today's behaviour. The rule itself is a small
   pure function in `lib/tabs.ts`, with tests there.
3. **Scrolling.** The strip declares the space its pinned buttons take (CSS `scroll-padding`), so
   "scroll to the nearest edge" stops before them: the "+" at the end of a horizontal strip, the
   Tabs toggle at the top and the "+" at the bottom of a rail.
4. **Screen readers.** `aria-orientation` comes off the `<nav>` (it stays on the resize handle,
   where it belongs). The rail toggle gets one fixed name, "Tab rail", and its expanded or
   collapsed state is the only thing that changes; the tooltip keeps the action wording.
5. **Narrow-window hint.** One sentence, produced in one place (`lib/tabs.ts`), shown only while
   it applies (saved choice is Left or Right, window under 720 px):
   - in the right-click menu, as a muted line under "Tab position";
   - in Settings, under the Tab position control, replacing the fixed sentence;
   - in the reply to `tabs left` and `tabs right`.

   Wording: "This window is too narrow for a side rail, so the tabs are at the top for now.
   Left is saved and applies when the window is wider." No permanent marker in the top bar:
   a narrow window has no room to spare there.
6. **Tidy-up.** The rail width's default is declared once in the stylesheet and the three
   fallbacks go. The narrow-window rule becomes one exported constant and one helper in
   `lib/tabs.ts`, used by `App.tsx` and `lib/runCommand.ts`.
7. **Tests.** New files `frontend/src/components/TabStrip.test.tsx` and
   `TabContextMenu.test.tsx` cover: focus after closing the active tab and another tab; the menu
   opening once from Shift+F10 and the Menu key; Escape and Tab closing it with focus handed
   back; the two screen-reader fixes; the narrow-window line. A simulated DOM has no layout, so
   the handle, the scrolling, what sits above what, and toast positions are checked by eye only.
8. **Documentation of the test setup.** A short part of the README's Development section: what
   was added and why, that it is dev-only, how a test file opts in, and what such tests cannot
   check. A comment in `frontend/vite.config.ts` says the same in one line.

## Checking by eye

Done in a separate working copy of the repo with its own build, served on port 8001 from a copy
of the database, so the app on :8000 is untouched until the branch is merged. The copy holds the
real bridge key: nothing that changes lights is pressed, the tab is closed and the server stopped
as soon as the checks are done, and the owner is told it was a throwaway test copy.

- The handle and both scrollbars, left rail and right rail, with the Workflows drawer open.
- The active tab next to the "+" in a full horizontal strip, and at both ends of a full rail.
- Focus after "Close tab" from the menu.
- Shift+F10 and the Menu key open the menu once; Tab closes it.
- The menu sits above the Workflows drawer.
- Toast positions with a right rail and with bottom tabs.
- The narrow-window line in the menu and in Settings.

## Left to the builder

Exact lane width and how the rail's border meets it; the exact `scroll-padding` values; the names
of the new helper functions; exact pinned versions of the three dev dependencies.

## The owner's decisions behind this

- The grouping of this slice and the two later ones (approved 2026-11-16).
- A DOM test setup as dev-only dependencies, and it must be documented (approved 2026-11-16).
- Choices marked "chosen" above, the hint's wording and where it shows are the assistant's
  proposals, open to correction in this review.

## As built (2026-11-16)

Where the finished work differs from the design above, and why:

- The rail toggle's one fixed name for screen readers is "Tabs", not "Tab rail". "Tabs" is the label
  drawn on the button, and a name that differs from the visible label breaks voice control.
- Pressing Tab inside the right-click menu closes it and hands focus back, the same as Escape.
- The pinned "Tabs" toggle and the pinned "+" of a rail are now opaque and run to the rail's edges.
  Before, tabs scrolling beneath them showed through. This was found by eye and was not in the list.
- Scroll padding is 40px at both ends of a rail and before the "+" of the bottom strip (32px in the
  top bar), measured in a browser.
- The handle's drag is measured from where it began, and a press on it no longer starts a text
  selection. Without that, the browser turned the drag into a drag of a tab and cancelled the resize.
- The reply to `tabs width` and `tabs collapse` in a narrow window now gives the same sentence as the
  hint, instead of saying the tabs are not on a side.

Found and left for a later slice: under 980 px the Workflows drawer covers the top bar and the prompt;
the "+" menu has no arrow-key or Tab handling; a right-button press on the handle starts a resize.
Not checked: the Menu key (no such key on this keyboard; a test covers it) and always-visible
scrollbars (judged from the layout only).
