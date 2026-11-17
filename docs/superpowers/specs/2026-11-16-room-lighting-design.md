# Light the room from where you are (design)

Date: 2026-11-16. Status: the owner chose "preview on screen, then try on the lights with Undo" and
said "dive in"; the calls below are mine, listed at the end for the owner to check.

## Why

The owner: "the functionality of setting lighting scenes is not that easy or obvious. … when I'm
looking at any layout in Studio or Workbench I can easily test and set room scenes, and the presets
associated with 'code' or 'chill' should take into account the room's glare and time and guide the
user."

MyHuey exists to cut eye strain for people who code. Today the presets already follow the time of day
(wake and bed times), but they never see the glare check, which lives only on the Studio's 3D screen.
The Studio has no way to light a room except the Photo view's Suggest button. "Preview on lights" is
a real change with no way back. So the person has to know where to go, and a "code" preset can still
put a bright light where it reflects in the screen.

## Goals

1. **One lighting panel, wherever a room is open.** The same "Light this room" panel opens from the
   Workbench (where the Suggested scenes panel is today) and from every Studio room view (Room plan,
   3D, Photo), from a "Light" button in the Studio header next to "Open workbench". The Photo view's
   Suggest button opens this panel.
2. **Presets respect glare.** Each preset's suggestions keep every light under its glare limit for the
   person sitting (or standing, as set in the 3D screen) at the desk: a light that reflects in the
   screen at most 18% and 2700 K, one in direct view at most 15%, one at the edge of view at most 35%
   in code and study. These are the limits the 3D screen's glare check already uses.
3. **Presets explain themselves.** The panel says, in plain words, what the time of day did ("21:40,
   1 h 20 before bed: warm whites, no blue palettes") and what glare did ("Desk lamp held at 15%: it
   sits in your view of the screen"), or why glare was not checked ("No desk with a screen in this
   room, so glare was not checked. Add one in the Room plan.").
4. **See it before the lights change.** Choosing a suggestion card shows it on screen first: the plan
   and the 3D view draw the lights in the suggestion's colors and brightness, and the 3D screen's
   glare table counts hazards for the suggestion, not for the lights as they are. On the Photo view,
   "Show on photo" keeps working.
5. **Try it on the lights, with Undo.** "Try on lights" sends the suggestion to the real lights and
   shows a bar: "Trying Code · Ember on Office · Keep · Undo". Undo puts every light in the room back
   the way it was before the first try. Keep ends the try. Trying a second card while the bar is
   showing keeps the first "before" state for every light it already saved (and saves any light it had not), so Undo always goes back to where the person started.
   "Save as scene" stays.
6. **"Chill".** The relax preset is shown as "Chill" everywhere in the app; `chill` is accepted as a
   name for it by the API, CLI and the assistant tools. Its id stays `relax`, so saved scenes and
   scripts keep working.

## Non-goals

- A glare checker on the server (that is glare engine slice 1, planned separately). CLI and assistant
  suggestions keep today's role-based rules until it exists.
- The sun, windows, date or season; schedules or automations; new presets beyond the "Chill" name.
- Changing the saved-scene editor.

## Anti-goals

- Any change to the real lights before the person presses "Try on lights", "Keep" or "Undo".
- A suggestion whose preview, saved scene and applied result disagree (all three must come from the
  same capped scene).
- Losing the person's light state with no way back after a try.

## Constraints

- Lights change only from the person's press. Planned lights are never sent (as today).
- In a sandbox, trying a suggestion still drives the real lights, using the room as drawn in that
  sandbox. The bar says so: "… on Office (as drawn in sandbox X)".
- Home's quick settings stay as they are (one tap, active home, no panel).
- Every new text colour passes the existing contrast tests; no interface text under 12px.
- Keep the tool server's rules: only `apply_scene`, `room_power`, `room_dim` change lights.

## Approaches considered

- **The browser works out the glare limits and the server builds within them (chosen).** The 3D
  screen's glare tracer (`lib/glareMath.ts`, `lib/roomGlare.ts`) already gives each light a status and
  a limit from the room's geometry and posture. The panel sends those limits with the suggest request;
  the server caps each light while building the suggestion and returns the reasons. Preview, save and
  apply all use that one capped scene. Cost: the CLI and assistant don't get glare limits until a
  server-side checker exists.
- **Build the server-side glare checker first** (glare engine slice 1). Right for the long run, but a
  much larger piece whose plan the owner has not reviewed.
- **Cap in the browser after the server answers.** Fastest, but the server's preview and the saved
  scene would disagree with what is shown: ruled out by the anti-goals.

## How it works

**Glare limits.** A function in the frontend turns the glare report into limits:
`{ light_id: { brightness: number, kelvin?: number, reason: string } }` for each light whose status is
`screen_reflection`, `direct_fov` or `peripheral_warn`. The glare mode follows the preset: code and
study use their own; work, read and chill use work's (no edge-of-view limit). Posture comes from the
3D screen's setting (seated by default). Planned lights get limits too (they are drawn and checked;
they are just never sent).

**The suggest request** gains an optional `caps` field with those limits. The server applies them
after it builds each suggestion: brightness never above the limit, and for a reflection limit, a white
no warmer-than-limit kelvin (a colored light under a reflection limit becomes that white). Each
suggestion returns `guide`: `{ time: string, glare: string[], checked: boolean }`, where `time` explains
what the clock did (from the existing wake/bed curve and night window) and `glare` lists one line per
capped light. A request without `caps` behaves exactly as today, with `checked: false`.

**Showing a suggestion.** Choosing a card sets a "showing" suggestion for that room in the app's UI
state. The plan and the 3D stage draw lights from the suggestion's per-light results instead of the
live state while it is set; the glare table and badge recount from it. Leaving the room, closing the
panel, or pressing "Show live" clears it. A small label on the stage reads "Showing: Code · Ember
(not on your lights)".

**Try and Undo.** On the first try in a room the app captures the room's real lights (on, brightness,
color or white, gradient) with the same capture the saved light groups use (`capture_look`), keeps it
in the browser, then applies the suggestion. Undo sends that captured look back through the same path
the groups use (`look_commands`); the server gains one route that applies a given look to a room's
lights. Keep, a navigation away from the room, or a successful Undo ends the try. If the capture fails
(bridge not answering), the try is refused with a message rather than applied without a way back.

## Answers from the builder check (my calls)

1. **What the glare table counts.** The tracer's limits come from geometry only. The table keeps its
   rows and limits, adds each light's shown level next to its limit, and marks a row "over" only when
   the shown level is above the limit. The badge reads "N over the limit · M to watch" for whatever is
   shown: the live lights, or the suggestion. A capped suggestion therefore shows "0 over the limit".
2. **Which presets get glare limits.** Only the desk presets, Code, Work and Study (their seat is the
   desk, which is where the tracer sits the person). Read and Chill get none, and their guide says
   "Glare is checked for the desk presets (Code, Work, Study)." For a desk preset in a room with no
   desk and screen, the guide says the no-desk line from Goal 3.
3. **Undo survives leaving.** The before-look is stored in the browser per room with the time of the
   first try. Leaving the room does not end the try: on coming back (Workbench or any Studio room
   view) within 12 hours, the bar shows "You tried a scene on Office at 21:40 · Keep · Undo". Keep,
   Undo, or 12 hours end it. If the lights were changed elsewhere since (a wall switch, the Hue app),
   Undo still puts back the before-look; the bar says "Undo puts back how Office was at 21:38".
4. **Effects.** Undo restores what the saved light groups capture (on, brightness, color or white,
   gradient points), and also a light's effect if the bridge reports one. If the bridge data has no
   effect field, Undo turns off any effect the suggestion started and the bar's Undo tooltip says
   effects are not restored.
5. **Limits on gradient and colored lights.** A reflection limit makes the light one white at no more
   than 2700 K and the limit's brightness (a gradient light loses its gradient for that suggestion).
   A direct or edge-of-view limit caps brightness only and keeps the colors. A limit applies to
   whatever role the server gave the light, task and bias included: glare wins.
6. **Sandboxes and missing lights.** Capture and Undo cover the room's lights that are on the bridge
   and not planned. The bar names any it skipped ("2 lights skipped (planned or not on the bridge)").
7. **Time.** The panel keeps its time picker ("Now" or a quarter hour). The guide's time line is made
   on the server from the chosen time, wake and bed: "Morning, 1 h 10 after waking: …", "21:40, 1 h 20
   before bed: warm whites, no blue palettes", "Past bedtime: the warmest, dimmest whites, no blue".
   Choosing a time other than now and trying it applies that time's scene; the bar names the time.

## Left to the builder

The panel's exact layout and wording beyond the strings above, the route names, how the UI state is
stored, how the plan and 3D stage take an override, and where the Studio "Light" button opens the
panel (a drawer in the work area like Workflows, or the room screens' sidebar).

## Calls I made on the owner's behalf (with what each costs if wrong)

- Glare limits come from the browser's existing tracer, not a new server checker. If wrong: CLI and
  assistant presets stay glare-blind until glare slice 1.
- Work, read and chill use work's glare rules (no edge-of-view limit). If wrong: a light at the edge
  of view may be brighter than the person wants while reading.
- "Chill" renames relax in the app, keeping the id `relax`. If wrong: one label to change back.
- Undo goes back to the state before the first try, not the previous try. If wrong: one extra Undo
  step wanted.
- In a sandbox, Try still drives the real lights, with a note. If wrong: block trying in sandboxes.
- Home's quick settings are unchanged (no glare limits there yet). If wrong: a follow-up to send the
  limits from Home too.

## As built (2026-11-16)

Where the finished work differs from the design above, and why:

- **Every try captures.** A second try captures the room again and merges: lights the first capture
  saved keep their first state, and a light that joined the room since (a planned light swapped for
  a real one, or a try in another layout) gets its state saved before it changes. Found by the final
  review; without it Undo could not put such a light back.
- **Undo goes to the layout the try was made in**, not the one open when Undo is pressed.
- **The time line follows the curve's own phases:** waking up, day ("19:04, 3 h 56 before bed:
  daylight whites."), winding down ("whites warming for the evening"), the night window ("warm
  whites, no blue palettes"), past bedtime. An early version called 18:36 "midday"; found by eye.
- **The time and the glare limits are said once, at the top of the panel**, grouped by reason; each
  card says how many lights it held ("9 lights held for glare"). A light only recoloured for a
  reflection limit is "made warm white", not "held at 18%". The server returns `guide.held` for the
  count. Found by eye: each card had ten lines of repeated text.
- **Read and Chill say why glare was not checked** ("Glare is checked for the desk presets").
- **A shown card stays shown when switching between Room plan, 3D and Photo**; the Studio room
  screen (and the Workbench) decide when it ends: another room, closing the panel, or leaving.
  Cards are matched by mode, palette, shuffle and time, since a refetch gives new scene ids.
- **The Studio panel uses the saved room**, so dragging in the plan does not refetch suggestions.
- **The Light button unfolds the 3D screen's inspector** if it was folded.
- **The "Showing" label** sits top-centre on the plan (clear of the tools) and top-right in 3D.
- **The 3D badge is green when nothing is over its limit.**
- **The glare request is bounded** (kelvin 2000-6500, brightness at least 1, at most 64 lights).
- **"Chill" works in the in-app prompt too** (`suggest --mode chill`).

Checked by eye in Chrome on a test copy (with every light-changing request blocked): the Light button
on Room plan, 3D and Photo; one panel per screen; a shown card on the plan and in 3D, kept across
the switch; the badge and "Fix glare" waiting while shown; the time and glare lines; Chill's line.
Not checked by eye: "Try on lights", "Keep" and "Undo" on real lights (tests cover them; trying
them changes the owner's lights). Known and left: dark palette colours still draw as darker glows
on a light theme's plan; the centred plan label can overlap the outline/openings tool hint while a
card is shown; dim lights are faint in the card thumbnails.
