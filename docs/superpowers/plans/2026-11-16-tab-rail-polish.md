# Tab Bar and Rail Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the deferred polish on the window tabs, the side rail and its right-click menu, and add a dev-only DOM test setup so focus and keyboard behaviour are tested.

**Architecture:** Frontend only. Rules stay as pure functions in `frontend/src/lib/tabs.ts` (tested in Node, as today); the components call them. Component tests run in happy-dom, switched on per test file, so the existing 508 tests keep their Node environment. Layout fixes are CSS in `frontend/src/styles.css`.

**Tech Stack:** React 19.3, zustand 5, Vite 8, vitest 5.1, TypeScript 7. New dev dependencies: `happy-dom`, `@testing-library/react`, `@testing-library/dom`.

**Spec:** `docs/superpowers/specs/2026-11-16-tab-rail-polish-design.md`

## Global Constraints

- Work only inside this working copy: `.claude/worktrees/tab-rail-polish`. Never edit or run anything in `<repo root>` outside it.
- Never start `myhuey serve`, never open a browser, never read or write `~/.myhuey`, never send anything to a Hue bridge. Checks by eye are done later by the controller.
- No new runtime dependency. New packages go in `devDependencies` with exact versions (no `^` or `~`), like every other entry in `frontend/package.json`.
- The existing tests keep running in Node: `test.environment` in `frontend/vite.config.ts` stays `'node'`.
- `frontend/src/lib/commands.ts` holds exactly one `TODO(human)` comment. Do not touch it and do not add another anywhere.
- No backend change. No change to what the tabs can do beyond what a task states.
- Commit messages: plain, in the repo's style (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), and with no `Co-Authored-By` line or any AI attribution.
- Comments in code are plain sentences that say why, in the style of the files around them.
- Before each commit, from the working copy root: `npm --prefix frontend test` and `npm --prefix frontend run typecheck` both pass.
- The hint's wording is fixed by the spec: "This window is too narrow for a side rail, so the tabs are at the top for now. Left is saved and applies when the window is wider." ("Right" for a right rail.)

## Review Focus

1. A "focus the next tab" claim whose tab never becomes active (the address change did not land) must expire, not steal focus seconds later when the person opens that tab themselves. Pinned in Task 2, Step 1 (`refocusReady` gives `'drop'` after `REFOCUS_WINDOW`).
2. Closing the active tab from the menu while focus was somewhere still usable (the prompt's input) puts focus back there at once, without waiting. Pinned in Task 2, Step 4.
3. A narrow window with the tabs saved at Top or Bottom shows no hint anywhere. Pinned in Task 3, Step 1 and Step 5.
4. Widening the window while Settings is open removes the hint without a reload. Pinned in Task 3, Step 3 (`useNarrow` follows the media query's change event).
5. A rail folded to icons keeps one name on its toggle and has no resize lane. Pinned in Task 3, Step 5 and Task 4, Step 1.

## File Map

| File | Change |
|---|---|
| `frontend/package.json`, `frontend/package-lock.json` | three dev dependencies |
| `frontend/vite.config.ts` | one comment about DOM tests |
| `frontend/src/test/dom.ts` (new) | the one place component tests import their tools from; registers cleanup |
| `frontend/src/components/TabContextMenu.test.tsx` (new) | menu behaviour |
| `frontend/src/components/TabStrip.test.tsx` (new) | strip behaviour |
| `frontend/src/lib/tabs.ts`, `tabs.test.ts` | new rules: refocus, narrow window, labels |
| `frontend/src/lib/useNarrow.ts` (new), `useNarrow.test.tsx` (new) | the narrow-window hook, moved out of `App.tsx` |
| `frontend/src/components/TabStrip.tsx`, `TabContextMenu.tsx` | focus, Tab key, aria, hint |
| `frontend/src/App.tsx`, `frontend/src/lib/runCommand.ts`, `frontend/src/views/SettingsView.tsx` | shared narrow rule, hint |
| `frontend/src/styles.css`, `frontend/src/lib/tabsCss.test.ts` (new) | handle lane, scroll padding, one rail-width default |
| `README.md` | Development section: the DOM test setup |

---

### Task 1: DOM test setup, documented, with the menu's first tests

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`, `README.md` (Development section)
- Create: `frontend/src/test/dom.ts`, `frontend/src/components/TabContextMenu.test.tsx`
- Modify: `frontend/src/components/TabContextMenu.tsx` (Tab key only)

**Interfaces:**
- Produces: `frontend/src/test/dom.ts` exporting `render`, `screen`, `fireEvent`, `act`, `within`, `cleanup` (re-exported from `@testing-library/react`) and registering `afterEach(cleanup)`. Every component test starts with the line `// @vitest-environment happy-dom` and imports its tools from `../test/dom`.
- Produces: in `TabContextMenu`, pressing Tab or Shift+Tab inside the menu calls `onClose(true)` and prevents the default.

- [ ] **Step 1: Install the dev dependencies, exact versions**

Run from the working copy root:
`npm --prefix frontend install --save-dev --save-exact happy-dom@21.0.4 @testing-library/react@16.3.3 @testing-library/dom@10.4.2`
Expected: `frontend/package.json` lists the three under `devDependencies` with no range prefix; `dependencies` is unchanged.

- [ ] **Step 2: Create `frontend/src/test/dom.ts`**

A header comment says: component tests run in happy-dom, a simulated browser with no layout; a test file opts in with `// @vitest-environment happy-dom` on its first line; sizes, scrolling and what is drawn on top of what cannot be tested this way. Then the re-exports and `afterEach(cleanup)` (vitest's `afterEach`, since vitest globals are off).

- [ ] **Step 3: Write the failing tests in `frontend/src/components/TabContextMenu.test.tsx`**

First line `// @vitest-environment happy-dom`. Items come from `tabMenuItems` in `../lib/tabs`. Tests, by name and assertion:

```tsx
const items = (over = {}) => tabMenuItems({ closable: true, tabPlacement: 'top', drawnAsRail: false, rail: { width: 210, collapsed: false }, ...over });

it('opens with focus on its first item', () => {
  render(<TabContextMenu items={items()} at={{ x: 10, y: 10 }} onChoose={vi.fn()} onClose={vi.fn()} />);
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close tab' }));
});
it('offers Close tab only for a closable tab, and the rail rows only for a rail', () => {
  // closable: false -> no 'Close tab'; drawnAsRail: true -> 'Collapse rail' and 'Reset rail width' present; false -> absent
});
it('marks the saved position as checked', () => {
  // tabPlacement: 'left' -> menuitemradio 'Left' has aria-checked "true", the other three "false"
});
it('moves between items with the arrow keys, Home and End, wrapping', () => {
  // ArrowUp from the first item focuses the last ('Reset the tabs'); Home focuses the first
});
it('Escape closes it and asks for focus back', () => {
  // fireEvent.keyDown(window, { key: 'Escape' }) -> onClose called once with true
});
it('Tab and Shift+Tab close it and ask for focus back', () => {
  // fireEvent.keyDown(menu, { key: 'Tab' }) -> onClose(true), event default prevented; same with shiftKey
});
it('a click outside closes it without asking for focus back', () => {
  // fireEvent.pointerDown(document.body) -> onClose(false)
});
it('choosing an item reports it', () => {
  // click 'Bottom' -> onChoose called with { kind: 'place', placement: 'bottom', checked: false }
});
```

- [ ] **Step 4: Run them and see the Tab test fail**

Run: `npm --prefix frontend test -- src/components/TabContextMenu.test.tsx`
Expected: every test passes except "Tab and Shift+Tab close it…" (the menu has no Tab handling yet). If another test fails, the setup is wrong: fix the setup, not the component.

- [ ] **Step 5: Handle Tab in `TabContextMenu`**

In the menu's `onKeyDown` (the `move` function), before the arrow-key handling: `Tab` (with or without Shift) prevents the default and calls `onClose(true)`. Update the file's header comment so it says Tab leaves the menu like Escape.

- [ ] **Step 6: Document the setup**

In `README.md`, Development section, after the test commands, add a short part titled "Component tests" that says, in the README's plain voice: what was added (happy-dom and React Testing Library) and why (focus and keyboard behaviour could only be checked by eye before); that they are dev-only, nothing from them is in the built app, and tests make no network requests; how a test file opts in (the first-line comment, importing from `frontend/src/test/dom.ts`) and that every other test still runs in plain Node; and what these tests cannot check (anything that depends on layout: sizes, scrolling, stacking), which is still checked by eye. In `frontend/vite.config.ts`, a one-line comment above `test:` says the environment stays `node` and component tests opt in per file.

- [ ] **Step 7: Run everything**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck`
Expected: 508 old tests plus the new ones pass; typecheck is clean.

- [ ] **Step 8: Commit**

`git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/test/dom.ts frontend/src/components/TabContextMenu.tsx frontend/src/components/TabContextMenu.test.tsx README.md`
`git commit -m "test: a DOM test setup for components, and the tab menu's first tests; Tab leaves the menu"`

---

### Task 2: Focus goes to the tab that became active

**Files:**
- Modify: `frontend/src/lib/tabs.ts`, `frontend/src/lib/tabs.test.ts`, `frontend/src/components/TabStrip.tsx`
- Create: `frontend/src/components/TabStrip.test.tsx`

**Interfaces:**
- Consumes: `frontend/src/test/dom.ts` from Task 1.
- Produces in `lib/tabs.ts`:
  - `export const REFOCUS_WINDOW = 1500;`
  - `export function refocusReady(claim: { waitFor: TabId | null; at: number }, has: { restore: boolean }, activeTab: TabId, now: number): 'now' | 'wait' | 'drop'`
- Produces: `TabStrip.test.tsx` with a `strip(over?)` helper later tasks extend (it renders `TabStrip` with five tabs, `home` active, placement `top`, and returns `{ rerender, setTabs }`).

Background for the implementer: `go()` in `lib/router.ts` only sets `window.location.hash`. The app learns the new active tab from the browser's later `hashchange` event. `TabStrip` gets `activeTab` as a prop, so after "Close tab" it re-renders once with the tab gone (active tab unchanged, and no longer drawn), and again when `activeTab` changes. Today the module-level `refocusAfterMenu` claim is used up on the first of those renders.

- [ ] **Step 1: Write the failing rule tests in `tabs.test.ts`**

```ts
describe('refocusReady', () => {
  const claim = { waitFor: 'scenes' as TabId, at: 1000 };
  it('places focus now when nothing is awaited', () => {
    expect(refocusReady({ waitFor: null, at: 1000 }, { restore: false }, 'home', 1001)).toBe('now');
  });
  it('places focus now when what had focus before can take it back', () => {
    expect(refocusReady(claim, { restore: true }, 'home', 1001)).toBe('now');
  });
  it('waits while the awaited tab is not yet the active one', () => {
    expect(refocusReady(claim, { restore: false }, 'home', 1001)).toBe('wait');
  });
  it('places focus once the awaited tab is active', () => {
    expect(refocusReady(claim, { restore: false }, 'scenes', 1200)).toBe('now');
  });
  it('gives up when the awaited tab has not arrived within the window', () => {
    expect(refocusReady(claim, { restore: false }, 'home', 1000 + REFOCUS_WINDOW + 1)).toBe('drop');
  });
});
```

- [ ] **Step 2: Run to see them fail, implement `refocusReady` and `REFOCUS_WINDOW`, run to see them pass**

Run: `npm --prefix frontend test -- src/lib/tabs.test.ts`

- [ ] **Step 3: Write the failing component tests in `TabStrip.test.tsx`**

First line `// @vitest-environment happy-dom`. The `strip()` helper builds `Tab` objects (any lucide icon) for `home`, `studio`, `scenes`, `lights`, `settings`, passes `state` and a `setTabs` mock, and resets `useUi` (`tabPlacement: 'top'`, default rail) and `window.location.hash` in `beforeEach`. Tests:

```tsx
it('after Close tab on the active tab from the menu, focus lands on the tab that became active', () => {
  // home is active and first. Focus home's link, fireEvent.contextMenu on it, click 'Close tab'.
  // setTabs was called with home closed. Rerender with that state, activeTab still 'home':
  //   expect(document.activeElement) not to be any tab link   (no early fallback to the first tab)
  // Rerender with activeTab 'studio' (home's neighbour):
  //   expect(document.activeElement).toBe(link 'studio')
});
it('after Close tab on another tab, focus goes back to where it was', () => {
  // focus home's link (active), contextMenu on the 'lights' tab, click 'Close tab', rerender with lights closed:
  //   expect(document.activeElement).toBe(link 'home')
});
it('opens one menu from Shift+F10 whether or not the browser follows with a contextmenu event', () => {
  // vi.useFakeTimers(). keyDown {key:'F10', shiftKey:true} on a link, then contextMenu, then keyUp, advance 100 ms:
  //   screen.getAllByRole('menu', { name: 'Tabs' }) has length 1
  // close it (Escape); keyDown + keyUp only, advance 100 ms: length 1 again
});
it('opens one menu from the Menu key', () => { /* same with key 'ContextMenu' */ });
```

- [ ] **Step 4: Add the Review Focus test**

```tsx
it('puts focus back in the page at once when that is where it was', () => {
  // render an <input aria-label="prompt"> beside the strip and focus it; contextMenu on the active tab (home),
  // click 'Close tab', rerender with home closed and activeTab still 'home':
  //   expect(document.activeElement).toBe(the input)
});
```

- [ ] **Step 5: Run to see the focus tests fail**

Run: `npm --prefix frontend test -- src/components/TabStrip.test.tsx`
Expected: the first test fails (focus is on the first tab link after the first rerender); the menu-key tests may already pass.

- [ ] **Step 6: Make the claim wait in `TabStrip.tsx`**

`refocusAfterMenu` becomes `{ restore: HTMLElement | null; waitFor: TabId | null; at: number }`. `choose` sets `waitFor` to the tab `close()` is about to open (the `neighbour` of the closed tab) only when the closed tab is the active one and that neighbour exists; every other menu choice, and Escape, sets `waitFor: null`. The refocus effect asks `refocusReady`: `'wait'` leaves the claim in place for the next render, `'drop'` clears it without moving focus, `'now'` clears it and places focus by the existing `focusAfterClose` order. Keep the comment above the effect truthful.

- [ ] **Step 7: Run everything, then commit**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck`
`git add frontend/src/lib/tabs.ts frontend/src/lib/tabs.test.ts frontend/src/components/TabStrip.tsx frontend/src/components/TabStrip.test.tsx`
`git commit -m "fix: closing the active tab from the menu moves focus to the tab that became active"`

---

### Task 3: Screen-reader fixes and the narrow-window hint

**Files:**
- Modify: `frontend/src/lib/tabs.ts`, `tabs.test.ts`, `frontend/src/components/TabStrip.tsx`, `TabContextMenu.tsx`, `TabStrip.test.tsx`, `TabContextMenu.test.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/runCommand.ts`, `frontend/src/views/SettingsView.tsx`, `frontend/src/styles.css` (one rule for the note)
- Create: `frontend/src/lib/useNarrow.ts`, `frontend/src/lib/useNarrow.test.tsx`

**Interfaces:**
- Consumes: the `strip()` helper from Task 2.
- Produces in `lib/tabs.ts`:
  - `export const PLACE_LABELS: Record<TabPlacement, string>` (moved from `TabContextMenu.tsx`, which now imports it; values unchanged: Top, Bottom, Left, Right)
  - `export const NARROW_QUERY = '(max-width: 719.98px)';`
  - `export const isNarrowWindow = (): boolean` (false when there is no `window.matchMedia`)
  - `export function narrowRailNote(saved: TabPlacement, narrow: boolean): string | null`
- Produces: `frontend/src/lib/useNarrow.ts` exporting `useNarrow(): boolean` (the hook now in `App.tsx`, unchanged in behaviour, using `NARROW_QUERY`).
- Produces: `TabContextMenu` takes an optional prop `note?: string | null`.

- [ ] **Step 1: Write the failing rule tests in `tabs.test.ts`**

```ts
describe('narrowRailNote', () => {
  it('says the saved side still applies when a rail is drawn at the top', () => {
    expect(narrowRailNote('left', true)).toBe('This window is too narrow for a side rail, so the tabs are at the top for now. Left is saved and applies when the window is wider.');
    expect(narrowRailNote('right', true)).toBe('This window is too narrow for a side rail, so the tabs are at the top for now. Right is saved and applies when the window is wider.');
  });
  it('says nothing in a wide window', () => {
    for (const place of TAB_PLACEMENTS) expect(narrowRailNote(place, false)).toBeNull();
  });
  it('says nothing for top or bottom tabs, however narrow', () => {
    expect(narrowRailNote('top', true)).toBeNull();
    expect(narrowRailNote('bottom', true)).toBeNull();
  });
});
it('isNarrowWindow is false where there is no matchMedia', () => { expect(isNarrowWindow()).toBe(false); });
```

- [ ] **Step 2: Run to see them fail, implement in `tabs.ts`, run to see them pass**

- [ ] **Step 3: Move the hook, with a test**

Create `useNarrow.ts` from the `NARROW` constant and `useNarrow` function now in `App.tsx`; `App.tsx` imports it. `useNarrow.test.tsx` (happy-dom) stubs `window.matchMedia` with an object whose `matches` can be flipped and whose `change` listeners can be fired:

```tsx
it('follows the window as it crosses the narrow width', () => {
  // matches: true -> a component rendering String(useNarrow()) shows 'true';
  // flip to false and fire 'change' inside act -> shows 'false'
});
it('asks with the shared query', () => { /* matchMedia was called with NARROW_QUERY */ });
```

`lib/runCommand.ts` replaces its own `matchMedia('(max-width: 719.98px)')` line with `isNarrowWindow()`.

- [ ] **Step 4: The hint in three places**

- `TabContextMenu`: when `note` is set, a `<p className="tab-menu-note" id=…>` after the four position rows, inside the "Tab position" group, and the group points at it with `aria-describedby`. One CSS rule in `styles.css` next to `.tab-menu p`: muted text (`var(--text-3)`), 12px, wraps, and the menu must not grow wider for it (`max-width` matching the menu's 190px minimum plus padding is the builder's call).
- `TabStrip`: passes `note={narrowRailNote(tabPlacement, isVertical(tabPlacement) && !vertical)}` (a saved side drawn as a horizontal strip is exactly the narrow case, so the strip needs no media query of its own).
- `SettingsView`: the Tab position row's hint is the first sentence it has now ("Where the window tabs sit: in the top bar, above the prompt, or in a rail down the left or right.") followed by `narrowRailNote(tabPlacement, useNarrow())` when that is not null. The fixed sentence "In a narrow window they stay at the top." goes.
- `runCommand`, case `tabs-place`: the reply is `Tabs: <placement>`, followed by `. ` and the note when `narrowRailNote(intent.placement, isNarrowWindow())` is not null.

- [ ] **Step 5: The screen-reader fixes, tests first**

Add to `TabStrip.test.tsx`:

```tsx
it('puts no aria-orientation on the nav, in a strip or a rail', () => {
  // placement 'top' and placement 'left': screen.getByRole('navigation', { name: 'Main' }) has no aria-orientation attribute
});
it('names the rail toggle once and lets aria-expanded carry the state', () => {
  // placement 'left': getByRole('button', { name: 'Tab rail' }) has aria-expanded "true";
  // with useUi tabRail.collapsed true: same name, aria-expanded "false", and no element with role 'separator'
});
it('explains a rail drawn at the top in the menu', () => {
  // useUi tabPlacement 'left', TabStrip placement 'top': open the menu -> the note text is in the menu
});
it('adds nothing to the menu when the tabs are where they were saved', () => {
  // tabPlacement 'top', placement 'top' -> no '.tab-menu-note'; tabPlacement 'left', placement 'left' -> none either
});
```

Add to `TabContextMenu.test.tsx`: with `note="…"`, the group named "Tab position" is described by the note (`aria-describedby` resolves to an element with that text); without `note`, the group has no `aria-describedby`.

Then in `TabStrip.tsx`: remove `aria-orientation` from the `<nav>` (the resize handle keeps its own); the rail toggle's `aria-label` is always `Tab rail`, and its `title` keeps the two action wordings it has now.

- [ ] **Step 6: Run everything, then commit**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck`
`git add -A frontend/src`
`git commit -m "feat: say when a side rail is drawn at the top in a narrow window; fix: the rail toggle says its state once"`

---

### Task 4: The handle's own lane, scrolling clear of pinned buttons, one rail-width default

**Files:**
- Modify: `frontend/src/styles.css`, and `frontend/src/components/TabStrip.tsx` only if the markup order must change
- Create: `frontend/src/lib/tabsCss.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new names. `--rail-w` keeps its meaning: the full width of the rail including the handle's lane.

A simulated DOM has no layout, so this task's tests read the stylesheet as text, the way `frontend/src/lib/themeCss.test.ts` does; the controller checks the result by eye afterwards.

- [ ] **Step 1: Write the failing stylesheet tests in `tabsCss.test.ts`**

```ts
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
it('declares the rail width default once and uses it without fallbacks', () => {
  expect(css.match(/--rail-w:\s*210px/g)).toHaveLength(1);
  expect(css).not.toMatch(/var\(--rail-w,/);
});
it('keeps the resize handle in the flow, in a lane of its own', () => {
  // the .rail-handle rule has no `position: absolute`, and no rule sets `right: -5px` or `left: -5px` on it
});
it('stops scrolling short of the pinned buttons', () => {
  // the `.tabs {` rule contains scroll-padding-inline-end; the `.tabs.rail {` rule contains scroll-padding (top and bottom)
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm --prefix frontend test -- src/lib/tabsCss.test.ts`

- [ ] **Step 3: Change the stylesheet**

- Rail width: `--rail-w: 210px` is declared once on `.shell` (the app's inline style still overrides it), and the three `var(--rail-w, 210px)` become `var(--rail-w)`. The comment above `.rail-shell` is updated to match.
- Lane: `.rail-handle` is a normal flex child of `.rail-shell`, 7px wide, on the rail's inner side for both placements (after the nav for a left rail, before it for a right rail: `flex-direction: row-reverse` on `.rail-shell.right`, or `order`, whichever keeps keyboard order sensible). The shell carries the rail's background (`var(--glass-strong)`) and the inner border that `.tabs.rail.left` / `.tabs.rail.right` carry now, so the lane reads as part of the rail. The pill inside it is 3px wide. The `:focus-visible` treatment stays. Nothing of the handle lies over the nav, the page, or the Workflows drawer. A folded rail has no handle and is still `--rail-w` (48px) wide.
- Scrolling: `.tabs` gets `scroll-padding-inline-end: 32px` (the pinned "+" is 24px plus its margin). `.tabs.rail` gets `scroll-padding: 34px 0 32px` (the pinned Tabs toggle above, the pinned "+" below) and resets the inline-end value.

- [ ] **Step 4: Run everything, then commit**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run build`
Expected: all pass; the build writes into this working copy's own `static/app` only.
`git add frontend/src/styles.css frontend/src/lib/tabsCss.test.ts frontend/src/components/TabStrip.tsx`
`git commit -m "fix: the rail's resize handle has its own lane, and the active tab scrolls clear of the pinned buttons"`

---

## After the tasks (controller, not a subagent)

1. Whole-branch review by a fresh agent.
2. Checks by eye from this working copy on port 8001 with a copy of the database, following the spec's "Checking by eye" list; close the tab and stop the server at once.
3. Report to the owner: what was checked by eye, what only in code, what was not checked.
