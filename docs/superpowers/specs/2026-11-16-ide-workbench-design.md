# IDE workbench: themes, glass blocks, and multi-pane layout

Status: draft for approval. The direction was chosen in conversation on 2026-11-15 and 2026-11-16,
using the visual companion. The mockups are in `.superpowers/brainstorm/40205-1794807755/content/`
(gitignored): `neon-glass-v2.html` (look) and `workbench-layout-v2.html` (layout).

## Intent

MyHuey is for coders who want less eye strain at the desk. It should look and feel like the tools
they live in, an IDE or a terminal like Warp, instead of a consumer smart-home app.

The owner wants two things:
- **A re-skin.** A dark, dramatic default with code-editor colour themes to choose from.
- **An IDE workbench.** Several features open at once: tabs, side-by-side splits, panes you can
  show and hide, a status bar, and a minimal log panel.

Every feature that exists today must survive. The README's sections are the checklist.

## Decisions made by the owner

- **Depth: option B, then multi-pane.** Same screens, plus a status bar and a ⌘K command palette,
  plus the ability to open several modules at once in tabs and splits (mockup `workbench-layout-v2`).
- **Look: Warp-style rounded blocks with macOS glass.** Panels are frosted and translucent, with a
  thin top highlight and a soft neon glow on lit rooms.
- **Flat background.** The page background is one solid theme colour, as in an IDE. No gradient
  washes.
- **Default theme: "Neon".** It comes from the owner's Neon Dark Terminal palette (values below),
  dark and dramatic, loosely after Warp.
- **Themes in Settings,** alongside dark and light: Monokai and similar code-editor themes.
- **View toggles at top left,** like VS Code or Warp: icon buttons that show and hide the Explorer,
  the bottom panel and the Workflows drawer, plus a ⋯ menu listing every view with a checkmark.
  Each pane also has ⋯, maximise and close.
- **The terminal is minimal and read-only.** It is a feed of what happened ("bridge 10.0.0.77
  connected", "applied Late Night Pipeline to Office"). Nothing is typed into it, and no command
  runs from it or on the server.
- **Build approach: B, the dockview library** (owner: "your pick"). Phases are built in the order
  listed under Phases.

## Goals

### Phase 1: theme system and re-skin

- **Themes are token sets.** Each theme defines the same full set of CSS custom properties. The
  existing tokens are extended with editor-style ones (`--bg`, `--bg-panel`, `--fg`, `--fg-muted`,
  `--accent`, the ANSI colours, `--selection`, `--glass-*`). `data-theme` on `<html>` takes the
  theme id.
- **The theme list:**

  | Id | Kind | Source |
  | --- | --- | --- |
  | `neon` | dark, default | The owner's palette, below |
  | `monokai` | dark | Monokai |
  | `dracula` | dark | Dracula (MIT) |
  | `nord` | dark | Nord (MIT) |
  | `graphite` | dark | Today's dark look, kept |
  | `solarized-light` | light | Solarized |
  | `light` | light | Today's light look, kept |

- **The theme preference changes.** It becomes `theme ∈ {system, neon, monokai, dracula, nord,
  graphite, solarized-light, light}`.
  - With `system`, two new preferences choose the theme for each OS mode: `theme_dark` (default
    `neon`) and `theme_light` (default `light`).
  - **The rail's sun/moon button (builder's call).** It switches between the preferred dark and
    light themes, and never loses an explicit choice. If `theme` is an explicit dark theme (say
    `monokai`), the first press saves it as `theme_dark` and switches to `theme_light`. The next
    press goes back to `theme_dark`, so Monokai again. Light themes work the same way the other
    direction. When `theme = system`, the button switches `theme` to the opposite of what is
    showing, using `theme_dark` or `theme_light`.
  - **The theme name in the status bar** opens a small picker with all seven themes and System.
    It doesn't cycle through them.
  - Stored values `dark` and `light` read as `neon` and `light`.
- **Neon tokens.** Values are read from the owner's palette image. Where its printed hex codes are
  illegible, the swatches decide.

  | Token | Value |
  | --- | --- |
  | Background | `#1f1f23` |
  | Panel base | `#19191c` |
  | Foreground | `#e6e6e6` |
  | Cursor / bright text | `#f8f8f2` |
  | Selection | `#3a2a4a` |
  | Red | `#ff4060` |
  | Green | `#a6e22e` |
  | Yellow | `#e6db74` |
  | Blue (accent) | `#5a7dff` |
  | Magenta | `#ff2eea` |
  | Cyan | `#37f6ff` |
  | White | `#e6e6e6` |
  | Bright black (muted) | `#5c6370` |
  | Bright red | `#ff6b86` |
  | Bright green | `#c3f75d` |
  | Bright yellow | `#fff2a8` |
  | Bright blue | `#8ea2ff` |
  | Bright magenta | `#ff73f2` |
  | Bright cyan | `#7cfaff` |
  | Bright white | `#ffffff` |

- **Type.** JetBrains Mono (`@fontsource-variable/jetbrains-mono`, OFL) is bundled locally for the
  whole UI. Text is at least 12px. Muted text keeps at least 4.5:1 contrast against its background
  in every theme, and a test checks this for every token pair used for text.
- **Text tokens versus palette tokens (builder's call).** Each theme keeps its source palette
  exactly for non-text uses: swatches, borders, accents and glows. Text uses its own tokens
  (`--fg`, `--fg-muted`, `--fg-faint`), lightened or darkened where needed so they pass 4.5:1.
  - For example, Neon's bright black `#5c6370` is about 2.7:1 on `#1f1f23`. It stays as a border
    and divider colour, and muted text uses a lighter grey.
  - The same goes for Monokai's comment grey and Solarized's base01/base1.
  - Reason: the app exists to reduce eye strain, so readable text wins over palette fidelity.
- **Glass blocks.**
  - Panels, tiles, menus, the rail, the path bar and the status bar use: a translucent fill, a
    `backdrop-filter` blur with saturation, a 1px border, a top inner highlight, and an 8–12px
    radius.
  - Lit tiles get a soft glow in the accent colour.
  - Glass is never applied to the plan, photo or scene canvases.
- **Reduce transparency.** A new preference, `reduce_transparency` (bool, default off), turns glass
  and glow into flat solid panels. If unset, it follows the OS `prefers-reduced-transparency`.
- **IDE furniture.**
  - The page title becomes a path bar (`~ / studio / office ▌`) whose segments are links.
  - Brackets and `>` prefixes are used sparingly on segmented controls and primary actions, as in
    the mockups.
- **The light colours stay real.** Light chips, plan glows and scene colours always show the
  lights' real colours, whatever the theme.

### Phase 2: the workbench (dockview)

- **Dependency.** `dockview-react@8.8.3`, pinned exactly (MIT, no dependencies besides
  `dockview-core`), styled entirely with the theme tokens.
- **Every screen is a panel type:**
  - `home`
  - `workbench:<room>`
  - `studio` (whole plan)
  - `design:<room>` (plan or photo tab)
  - `scenes`
  - `scene:<id>`
  - `lights` (with groups)
  - `settings`

  - **Setup wizard (builder's call).** With no bridge paired, the app shows the setup wizard full
    screen before the dock, as it does today. `#/setup` opens it again, as does "Run setup again"
    on the Settings panel. When it finishes, the dock appears.

  Opening a screen focuses its panel if it is already open; otherwise it opens it as a tab in the
  active group. Panels can be split right or down, dragged between groups, resized, maximised and
  closed. At least one panel always stays open.
- **When a panel's room or scene is missing (builder's call).** This can happen after a sandbox
  switch, restoring an arrangement saved in another layout, or a delete. The panel stays where it
  is and shows a placeholder: "Office isn't in this layout", with Close and Open Home buttons.
  Restoring an arrangement never drops a panel quietly. A room rename updates the ids of every
  open panel for that room, so they follow it, as the routes already do. Arrangements are
  therefore app-wide; each panel resolves against whichever layout is open.
- **Hash routes keep working.** Today's `#/…` routes, including legacy ones, open or focus the
  matching panel. The hash follows the focused panel, so the browser's back button and shared
  links still work.
- **Chrome around the dock:**
  - top bar: view toggles, path bar, ⌘K box, layout pill
  - activity bar, Explorer and Workflows drawer
  - bottom panel and status bar

  ⌘B, ⌘J and ⌘⇧W toggle the Explorer, the bottom panel and Workflows. The ⋯ menu lists every
  view with a check, "Open <screen> in a new tab", "Split right", the status bar, "Save
  arrangement as…", and "Reset arrangement".
- **The Explorer is a tree of the open layout:** rooms (each with on/off and how many are lit),
  scenes, groups, plan image, sandboxes, and an Open editors list. Clicking opens the matching
  panel.
- **The bottom panel** has tabs:
  - **Activity:** the read-only feed. It is built in the browser from what the app already knows:
    - bridge connected or lost
    - polling errors
    - applies, with their result counts
    - light failures
    - sandbox opened or closed
    - saves and deletes

    It holds the last 500 entries and can be cleared. Each entry shows a time, a level and one
    line.
  - **Problems:** current warnings, such as lights not answering, planned lights, or a stale
    server.
  - **Commands:** the `myhuey` command for each UI action that has an exact CLI equivalent, ready
    to copy. Nothing runs from here.
    - **Builder's call:** actions with no CLI form (gradient edits, drawing zones, drags) don't
      appear here. The CLI is not extended to cover them.
- **Status bar:**
  - bridge state (address, and a dot that turns red when unreachable)
  - the open layout, Active or sandbox
  - the number of problems
  - lights on
  - the time with its phase (morning, day, wind-down, late), worked out from the wake and bed
    times
  - the theme name, which switches theme when clicked
  - ⌘K
- **Arrangements.**
  - The current arrangement is saved per browser, so a reload restores it.
  - Named arrangements ("Evening") are stored app-wide in the database, under a new global key
    `arrangements`, through `GET/PUT/DELETE /api/arrangements[/{name}]`.
  - Each holds dockview's JSON plus the show/hide state of the chrome. Names are 1–60 characters
    and unique ignoring case. At most 20 are kept.
- **Sandboxes are unchanged.** One layout is open app-wide, and every panel follows it, except
  Home and its ⋮ menu, which stay Active-only. Per-pane layouts are a non-goal.
- **Narrow screens.** Below 860px, the dock collapses to one panel at a time with a tab strip, and
  the drawers become overlays.

### Phase 3: command palette and Workflows

- **⌘K palette.**
  - It searches, in the browser with simple fuzzy matching, across: screens, rooms, scenes, saved
    groups, workflows and settings.
  - It also offers actions: open, apply a scene, apply a group's look, suggest for a room plus
    mode, room on/off/dim, switch theme, toggle a view, open or close a sandbox.
  - Enter runs the top result. Every action goes through the existing API functions.
- **Workflows** are saved actions, stored app-wide under a new global key `workflows`, through
  `GET/POST/PATCH/DELETE /api/workflows`.
  - Each workflow is `{id, name, action}`, where `action` is one of:
    - `{kind:"scene", scene}`
    - `{kind:"group", group}`
    - `{kind:"suggest", room, mode}`, which applies the top eye-comfort suggestion for that room
      and mode at the time it runs (CLI: `myhuey suggest --room R --mode M --apply`). The
      suggestions change with the clock, which is what a daily workflow wants.
    - `{kind:"power", room, on}`
    - `{kind:"dim", room, level?}`

    A missing `level` makes ▶ Run ask for it inline.
  - **Which layout workflows act on (builder's call).** Like Home, workflows and the palette's
    apply actions always act on the **Active** layout (`activeOnly` calls), even while a sandbox
    is open. They are daily controls.
    - A workflow stores scenes by id and rooms by name. Saving checks them against Active.
    - A workflow whose target is gone from Active shows as broken in the drawer, with Edit and
      Delete, and Run refuses with a clear message.
    - The palette's open/navigate actions still follow the open layout.
  - The drawer shows each workflow's matching `myhuey` command with Copy. ▶ Run calls the API.
  - "Save as workflow" appears on scenes, groups and suggestion cards.
  - The CLI gets `myhuey workflows list | run <name>`, so the two stay in step.

## Non-goals

- Running shell or CLI commands from the browser or on the server.
- A real terminal emulator.
- Panes showing different layouts at once.
- Pop-out windows.
- A plugin system.
- Changes to the lighting logic, suggestions, scenes or storage formats beyond the new keys
  (`arrangements`, `workflows`) and preferences (`theme_dark`, `theme_light`,
  `reduce_transparency`).

## Anti-goals

- **A missing feature.** Every README feature must still work. This is checked by hand in the
  browser against the README list, on a copy of the database.
- **Low-contrast text.** No text below 4.5:1, and nothing under 12px.
- **Glass on the canvases,** or blur that makes dragging on the plan stutter.
- **Breaking old links.**
- **Home acting on a sandbox.**
- **Any network fetch at runtime.** Fonts and libraries are bundled.

## Constraints

- **Stack:** React 19, zustand, Vite, vitest in the node environment (no DOM test tooling), and a
  FastAPI backend.
- Real-light checks are in the Office only, restoring light state afterwards. Browser checks run
  on a copy of the database on a second server.
- No AI attribution in commits. Work happens on feature branches, one per phase.

## Approaches considered

- **A. A hand-built shell.** Full control and no new dependency. Rejected: drag-to-dock, resizing
  and saving the arrangement are a lot of edge cases to own.
- **B. dockview (chosen).** Tabs, splits, drag-to-dock, resizing and save/restore come built in.
  The costs are one pinned dependency and styling it to the theme.
- **C. Tabs only.** Rejected: it drops the side-by-side panes the owner called the main win.

## Left to the builder

- Exact radii, blur strength and glow values, within the mockups.
- How the Explorer orders its items.
- Icons, which come from lucide (already a dependency).
- The fuzzy-match scoring.
- The wording of Activity entries.
- How the existing views are wrapped as panels, keeping their internals unchanged where possible.
