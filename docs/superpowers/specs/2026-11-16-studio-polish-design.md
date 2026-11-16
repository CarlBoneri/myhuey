# Studio polish (visual iteration, slice 2)

Status: approved by the owner on 2026-11-16 ("yes to all"; decisions follow the assistant's
recommendations for this slice). Branch: `feat/studio-polish`.

## Why

The Studio became one module in the last iteration, with polish deferred. This slice clears the
Studio leftovers, adds the Studio header's first component tests, and fixes one layout fault in
the Workflows drawer that the slice 1 check by eye turned up.

## Goals

1. Stepping through the Studio's Room picker with the keyboard no longer rebuilds the screen on
   every key press.
2. In a narrow window (about 680 px wide) the 3D view is a usable size instead of being squeezed
   to almost nothing.
3. Under 980 px, the Workflows drawer covers only the work area, not the top bar or the prompt.
4. Dragging a bar between the 3D screen's panes does not select text on the page.
5. Component tests for `StudioHead`.
6. Check by eye that renaming a room keeps the designer's selection and the 3D camera.

## Not in this slice

Theme colours and the older re-skin leftovers (slice 3); the "+" menu's keyboard handling; any
backend change; any new dependency; any change to what the Studio can do.

## What must not happen

- The app on :8000 is not rebuilt or replaced until the branch is merged.
- Nothing is written to `~/.myhuey`, and no real light changes.
- `frontend/src/lib/commands.ts` keeps its one `TODO(human)` comment, untouched.
- Choosing a room with the mouse, or with Enter, must not feel slower than today.

## How things work today (what was found)

- **Room picker.** It is a native `<select>`. Every change goes straight to a new address, and the
  designer is rebuilt for each room (it is keyed by room so a new room starts clean). A closed
  `<select>` fires a change on every arrow key or typed letter, so walking down the list rebuilds
  the plan or the 3D view once per key.
- **Narrow 3D view.** Under 980 px the 3D screen's panes stack in a column whose height is "as tall
  as its content". The 3D pane asks for 62% of that undefined height and its body has no minimum
  height of its own, so it collapses.
- **Workflows drawer.** Under 980 px it is positioned against the whole window frame, because the
  work area it belongs to is not a positioning container. It therefore covers the top bar,
  including the button that opens it, and the prompt.
- **Pane bars.** Their drag does not claim the press, the same fault the rail's handle had: the
  press starts a text selection.

## Approaches

### The Room picker

- **A. Let keyboard changes settle (chosen).** A change made with the keyboard is shown in the
  picker at once but only opens the room after a short pause with no further key (350 ms), or at
  once on Enter or when focus leaves the picker. A change made with the mouse opens the room at
  once, as today. Cost: a third of a second before the room opens when you stop on it by keyboard.
- **B. Keep the designer mounted and swap the room inside it.** Rejected: the designer holds a lot
  of per-room state that being rebuilt resets for free, and getting every piece to reset by hand
  is a large change with real risk.
- **C. Replace the native picker with a custom list that only acts on Enter.** Rejected: more to
  build and to get right for screen readers than the problem deserves.

### The narrow 3D view

- **A. Give the stacked panes real heights (chosen).** Under 980 px the 3D pane's body gets a
  definite height (most of the window, with a floor), the glare table takes its natural height up
  to a cap and scrolls inside, and the inspector follows below. The saved split and inspector
  width are untouched and apply again in a wide window.
- **B. Keep the side-by-side layout and shrink it.** Rejected: at 680 px there is no room for the
  inspector beside the view.

## Design

1. **Picker.** `lib/studio.ts` gets the pause length and a small pure rule for "open now or let it
   settle". `StudioHead` shows a pending choice in the picker while it settles. Enter and leaving
   the picker open the pending room at once; Escape drops it and shows the room on screen again.
   Focus still returns to the picker after the screen is rebuilt.
2. **Narrow 3D view.** CSS only, inside the existing 980 px rule: stacked panes do not use the
   wide layout's percentage; the 3D pane's body is `clamp(320px, 62vh, 620px)` tall; the glare
   table's body is at most `50vh` and scrolls.
3. **Workflows drawer.** The work area becomes the drawer's positioning container, so under 980 px
   the drawer runs from under the top bar to above the prompt (and above bottom tabs), beside a
   right rail as now.
4. **Pane bars.** The drag claims the press (as the rail handle now does), and every pane bar is
   excluded from text selection.
5. **Tests.** `StudioHead.test.tsx` in the simulated DOM: the picker lists "Whole home" and every
   room; a mouse choice opens the room at once; keyboard changes open only the last one after the
   pause; Enter and blur open it at once; Escape drops it; the three room views are disabled with
   no rooms; the view switch keeps the room. Stylesheet text tests pin the narrow 3D rules, the
   work area as positioning container, and the pane bars' selection rule.

## Checking by eye

From a separate working copy on port 8001 with a copy of the database, as in slice 1: the picker
with arrow keys in the 3D view; the 3D screen at about 680 px and 900 px wide and in a wide
window; the Workflows drawer under 980 px with top tabs, bottom tabs and a right rail; dragging
both pane bars; and renaming a room with a light selected and the camera moved (on the copy only;
a rename changes no light). The tab is closed and the server stopped after each round.

## Left to the builder

Names of the new helpers; how `StudioHead` tells a keyboard change from a mouse one; exact CSS
selectors.

## As built (2026-11-16)

Where the finished work differs from the design above, and why:

- The picker tells stepping through the closed picker from choosing in its open list by timing, not
  by "keyboard or mouse": a change waits only when it comes within 80 ms of a key press that was
  not Enter. So a room chosen in the open list, or with Enter, opens at once on every platform.
- Any further key restarts the pause, and a pending room that has since been renamed or deleted
  opens nothing.
- The view switch goes to the room the picker has chosen, even if that room has not opened yet. A
  click on a view right after a keyboard choice therefore lands on that room in that view. When
  focus moves from the picker to the view switch, the pending room is left to the pause instead of
  being opened at once.
- Renaming a room now keeps the 3D camera. The check by eye found it did not: for a moment after
  the rename was saved the designer could not find the room under its old name and rebuilt the 3D
  screen. The Room panel with the Name field only shows with nothing selected, so there is no
  selection to keep.
- Under 980 px the bar between the stacked 3D view and glare table is hidden. It resized nothing
  there but still rewrote the saved split.

Left for later: in Safari and Firefox on a Mac a click does not focus a button, so a view click
right after a keyboard choice can still be lost there (Chrome is fine); in a narrow window "Give
the 3D view the whole column" folds the glare table but cannot make the view taller; dragging the
bar between the wide layout's panes ends a few pixels from the pointer.
Not checked by eye: choosing from the picker's open list and arrow-key stepping on a closed picker
(the test browser's keys do not drive the Mac's native list, and on a Mac arrows open it); tests
cover both.
