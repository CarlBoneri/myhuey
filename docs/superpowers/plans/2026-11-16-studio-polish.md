# Studio Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Studio's Room picker rebuilding the screen per key press, give the narrow 3D view a usable size, keep the Workflows drawer inside the work area, stop pane-bar drags selecting text, and add `StudioHead`'s first component tests.

**Architecture:** Frontend only. The picker's settle behaviour lives in `StudioHead` (a pending choice plus one timer) with its pause length exported from `lib/studio.ts`. The layout fixes are CSS in `frontend/src/styles.css`, pinned by stylesheet text tests, and checked by eye by the controller.

**Tech Stack:** React 19.3, zustand 5, vitest 5.1, happy-dom component tests (opt-in per file, tools from `frontend/src/test/dom.ts`).

**Spec:** `docs/superpowers/specs/2026-11-16-studio-polish-design.md`

## Global Constraints

- Work only inside this working copy: `.claude/worktrees/studio-polish`. Never edit or run anything in `<repo root>` outside it, and never touch `../myhuey-docs`.
- Never start `myhuey serve`, never open a browser, never read or write `~/.myhuey`, never send anything to a Hue bridge. Checks by eye are done later by the controller.
- No new dependency. No backend change. No change to what the Studio can do beyond what a task states.
- The existing tests keep running in Node (`test.environment` stays `'node'`); a component test opts in with a first line `// @vitest-environment happy-dom` and imports `render, screen, fireEvent, act, within, cleanup` from `../test/dom`. Vitest globals are off.
- `frontend/src/lib/commands.ts` holds exactly one `TODO(human)` comment. Do not touch it and do not add another anywhere.
- Never use `git stash` (the stash is shared with other working copies). To see a test fail first, write the test before the code.
- Commit messages: plain, in the repo's style (`feat:`, `fix:`, `test:`), and with no `Co-Authored-By` line or any AI attribution.
- Comments in code are plain sentences that say why, in the style of the files around them.
- Before each commit, from the working copy root: `npm --prefix frontend test` and `npm --prefix frontend run typecheck` both pass, with clean output (an `act(...)` warning is a defect; Node's "ExperimentalWarning: localStorage" line is pre-existing).
- A room chosen with the pointer must open at once, exactly as today. The keyboard pause is 350 ms.

## Review Focus

1. A pending choice when the header unmounts (the person clicked a view button, or the screen changed) must not open a room afterwards. Pinned in Task 1, Step 1 (unmount test).
2. Walking away with the keyboard and back to the room already on screen must open nothing. Pinned in Task 1, Step 1.
3. A choice made with the pointer right after keyboard use must still open at once. Pinned in Task 1, Step 1.
4. On the home plan (`PlanView` stays mounted and follows `onPick`), `onPick` must be told at the moment the room opens, not while the choice is pending. Pinned in Task 1, Step 1.
5. A folded 3D pane or glare table in a narrow window must not reserve its height. Pinned in Task 2, Step 1 (the rules target the pane bodies, which are not rendered when folded).

---

### Task 1: The Room picker lets keyboard changes settle, with StudioHead's tests

**Files:**
- Modify: `frontend/src/lib/studio.ts`, `frontend/src/components/StudioHead.tsx`
- Create: `frontend/src/components/StudioHead.test.tsx`

**Interfaces:**
- Produces in `lib/studio.ts`: `export const PICK_SETTLE_MS = 350;` with a comment saying what it is for.
- `StudioHead`'s props do not change.

Background for the implementer: `StudioHead` renders a native `<select>` (the Room picker) and a `Segmented` radiogroup labelled "View" (four `role="radio"` buttons). Its `pick(value)` calls `onPick?.(next)` and `go(pickRoom(view, next, known ? room : null))`. `go` (from `lib/router`) sets `window.location.hash`. The room designer is rebuilt for each room, and a module-level `refocusPicker` flag hands focus back to the new picker; keep that working. A closed native `<select>` fires `change` on every arrow key or typed letter, which today opens a room per key.

Behaviour to build:
- The picker remembers whether the last interaction with it was a key (`keydown` of anything except Tab, Enter and Escape sets "by keyboard") or the pointer (`pointerdown` clears it).
- `change` by pointer: open the room at once (today's `pick`).
- `change` by keyboard: show the chosen value in the picker (a pending choice held in component state), and (re)start one timer of `PICK_SETTLE_MS`; when it fires, open the pending room, unless it is the room already on screen, in which case just clear the pending choice.
- Enter while a choice is pending: open it at once. Focus leaving the picker (`blur`) while a choice is pending: open it at once.
- Escape while a choice is pending: drop it; the picker shows the room on screen again; nothing opens.
- Unmount: clear the timer; nothing opens.
- `onPick` and the `refocusPicker` claim happen when the room opens, not while pending.

- [ ] **Step 1: Write the failing tests in `StudioHead.test.tsx`**

First line `// @vitest-environment happy-dom`. Mock the router's `go` and keep the rest: `vi.mock('../lib/router', async (original) => ({ ...(await original<typeof import('../lib/router')>()), go: vi.fn() }))`. Set rooms with `useStore.setState({ rooms })` using three minimal rooms named `Office`, `Den`, `Kitchen` (cast as needed; only `name` is read) and reset `useUi` `currentRoom` in `beforeEach`; `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`. Helpers: `picker()` is `screen.getByRole('combobox')`; `byKey(value)` fires `keyDown` (`key: 'ArrowDown'`) then `change` with that value; `byPointer(value)` fires `pointerDown` then `change`.

```tsx
it('lists Whole home and every room, and shows the room on screen', () => {
  // render <StudioHead view="3d" room="Office" />: option names are ['Whole home', 'Office', 'Den', 'Kitchen']; picker value 'Office'
});
it('opens a room chosen with the pointer at once', () => {
  // byPointer('Den') -> go called once with { view: 'design', room: 'Den', tab: '3d' }
});
it('lets keyboard changes settle and opens only the last one', () => {
  // byKey('Den'); advance 100; byKey('Kitchen'); picker value is 'Kitchen'; go not called
  // advance PICK_SETTLE_MS - 1 -> still not called; advance 1 -> called once with room 'Kitchen'
});
it('opens the pending room at once on Enter', () => { /* byKey('Den'); keyDown Enter -> go called once with 'Den'; advancing the timer adds no call */ });
it('opens the pending room at once when focus leaves the picker', () => { /* byKey('Den'); fireEvent.blur(picker()) -> called once */ });
it('drops the pending room on Escape', () => { /* byKey('Den'); keyDown Escape -> picker value 'Office'; advance PICK_SETTLE_MS -> go never called */ });
it('opens nothing when the keyboard comes back to the room on screen', () => { /* byKey('Den'); byKey('Office'); advance PICK_SETTLE_MS -> go never called; picker value 'Office' */ });
it('still opens a pointer choice at once after keyboard use', () => { /* byKey('Den'); byPointer('Kitchen') -> go called once, with 'Kitchen'; advancing the timer adds no call */ });
it('opens nothing after it unmounts with a choice pending', () => { /* byKey('Den'); unmount; advance PICK_SETTLE_MS -> go never called */ });
it('tells onPick when the room opens, not while it is pending', () => {
  // render view="home" room={null} onPick={spy}; byKey('Den') -> spy not called; advance PICK_SETTLE_MS -> spy called once with 'Den'
  // and go called with { view: 'studio', focus: 'Den' }
});
it('goes to the whole home from a room', () => { /* view="3d" room="Office"; byPointer('') -> go called with { view: 'studio', focus: 'Office' } */ });
it('keeps the room when the view changes', () => { /* view="plan" room="Office"; click radio '3D' -> go called with { view: 'design', room: 'Office', tab: '3d' } */ });
it('offers only the home plan when there are no rooms', () => { /* rooms []: radios 'Room plan', '3D', 'Photo' are disabled; 'Home plan' is not */ });
```

- [ ] **Step 2: Run them and see the settle tests fail**

Run: `npm --prefix frontend test -- src/components/StudioHead.test.tsx`
Expected: the tests about settling, Enter, blur, Escape, coming back, unmount and `onPick` timing fail (today every change opens at once); the listing, pointer, whole-home, view-switch and no-rooms tests pass. If one of those fails, fix the test setup, not the component.

- [ ] **Step 3: Add `PICK_SETTLE_MS` to `lib/studio.ts` and build the behaviour in `StudioHead.tsx`**

Keep `pick` as the single place that opens a room. Update the file's header comment and the comment on `refocusPicker` so they stay true.

- [ ] **Step 4: Run everything, then commit**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck`
`git add frontend/src/lib/studio.ts frontend/src/components/StudioHead.tsx frontend/src/components/StudioHead.test.tsx`
`git commit -m "fix: the Studio's Room picker waits for the keyboard to settle before opening a room"`

---

### Task 2: A usable narrow 3D view, the drawer inside the work area, pane bars that claim the press

**Files:**
- Modify: `frontend/src/styles.css`, `frontend/src/components/Studio3D.tsx` (`dragBar` only)
- Create: `frontend/src/lib/studioCss.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no new names.

Background for the implementer: read `frontend/src/lib/tabsCss.test.ts` for how a test reads rules out of the stylesheet. The 3D screen is `.studio3d` (a grid: `.studio3d-main` column, a `.splitter.col` bar, the inspector). `.studio3d-main` holds two `.pane` sections (the 3D view, whose body is `.pane-body.stage`, and the glare table, whose body is `.pane-body.audit`) with a `.splitter.row` bar between them; each `.pane` gets an inline `flex` from `Studio3D.tsx` (for example `0 0 calc(62% - 5px)`), and a folded pane renders no body. The `@media (max-width: 980px)` block near line 868 already turns `.studio3d` into a column with `height: auto`, where that percentage has nothing to resolve against and `.pane-body.stage { min-height: 0 }` lets the 3D view collapse. The Workflows drawer is `.workflows`, a child of `.workspace`; under 980 px it is `position: absolute; right: 0; top: 0; bottom: 0`, but `.workspace` is not a positioning container, so it is laid out against `.shell` and covers the top bar and the prompt. `dragBar` in `Studio3D.tsx` starts the pane-bar drags without preventing the press's default, so the press starts a text selection (the rail's handle had the same fault; see `dragRail` in `frontend/src/components/TabStrip.tsx` for the fix made there).

- [ ] **Step 1: Write the failing stylesheet tests in `studioCss.test.ts`**

```ts
it('makes the work area the Workflows drawer\'s positioning container', () => {
  // the `.workspace {` rule contains `position: relative`
});
it('gives the stacked 3D panes real heights in a narrow window', () => {
  // inside the `@media (max-width: 980px)` block that contains `.studio3d`:
  //   a rule for `.studio3d-main > .pane` sets `flex: none !important`
  //   a rule for `.studio3d .pane-body.stage` sets `height: clamp(320px, 62vh, 620px)`
  //   a rule for `.studio3d .pane-body.audit` sets `max-height: 50vh`
});
it('keeps pane bars out of text selection', () => {
  // the `.splitter {` rule contains `user-select: none`
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm --prefix frontend test -- src/lib/studioCss.test.ts`

- [ ] **Step 3: Change the stylesheet and `dragBar`**

- `.workspace` gets `position: relative`, with a comment saying the drawer is laid out against it in a narrow window.
- In the 980 px block: the three rules from Step 1, with one comment saying why (the stacked column has no height for a percentage to resolve against). The glare table's body already scrolls (`overflow: auto`).
- `.splitter` gets `user-select: none; -webkit-user-select: none;`. The rail handle's own copy of that rule may stay.
- `dragBar` calls `event.preventDefault()` first, with a "why" comment like the one in `dragRail`. Nothing else in `dragBar` changes (the pane bars are not focusable, so there is no focus call).

- [ ] **Step 4: Run everything, then commit**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run build`
Expected: all pass; the build writes into this working copy's own git-ignored `static/app` only.
`git add frontend/src/styles.css frontend/src/components/Studio3D.tsx frontend/src/lib/studioCss.test.ts`
`git commit -m "fix: a usable 3D view in a narrow window, the Workflows drawer stays in the work area, pane bars claim the press"`

---

## After the tasks (controller, not a subagent)

1. Whole-branch review by a fresh agent.
2. Checks by eye from this working copy on port 8001 with a copy of the database, following the spec's "Checking by eye" list; close the tab and stop the server at once.
3. Report to the owner: what was checked by eye, what only in code, what was not checked.
