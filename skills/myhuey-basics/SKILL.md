---
name: myhuey-basics
description: Shared reference for the MyHuey tools (a local Philips Hue room planner). Read it before designing a light scene or building a room layout with them. Covers plan coordinates and units, which way furniture faces, the light roles, the eye-comfort rules, and what the tools refuse to do.
---

# MyHuey basics

MyHuey plans and controls Philips Hue lights room by room, on the person's own network. Its
purpose is light that is easy on the eyes for someone who works at a screen. You reach it
through its tools. This page is the shared reference; the two jobs have their own pages
(`guide` serves "myhuey-light-theme" and "myhuey-room-layout").

## Coordinates and units

A room is a floor plan seen from above, measured in centimetres.

- x grows to the right and y grows **down** the plan. A rectangle made by `add_room` has its
  top-left corner at (0, 0) and its bottom-right corner at (width, depth).
- The top edge of the plan (y = 0) is called north, the bottom south, the right east, the left
  west. `describe_room` uses these names. When a person says "the north wall", use the top edge.
- An item's x and y are its centre. Heights (elevation, ceiling, sill, top) are cm above the floor.
- Every result is in cm. A length you pass in may be a number (cm), a string of digits (cm), or a
  string with a unit: "12ft", "3.8m", "380cm", "12' 6\"". Let the tool convert feet; do not
  round by hand. Talk back to the person in their own units (a room's `units` is imperial or metric).

Worked example. A 12 by 14 foot office is 365.76 by 426.72 cm: width along x, depth along y.

- A desk is 140 by 70 cm. Centred on the north wall with its back against the wall, its centre
  is x = 365.76 / 2 ≈ 183, y = 70 / 2 = 35, rotation 0.
- A 27-inch monitor (61 by 20 cm) near the back of that desk: x 183, y 22. Its elevation
  defaults to 75, the desk's top.
- The person sits about 60 cm in front of the screen, near (183, 82), looking north (toward -y).
- A light strip hidden behind the monitor sits between it and the wall: x 183, y 8.

## Which way things face

At rotation 0 an item's front faces +y, down the plan (south). The front is the screen of a
monitor or TV, the side you sit at for a desk or sofa, and the foot of a bed. Rotation turns **clockwise**
on the plan: 90 faces west (-x), 180 faces north (-y), 270 faces east (+x). So an item against
the north wall, facing into the room, has rotation 0; against the east wall 90; the south
wall 180; the west wall 270. Monitors take the same rotation as the desk they sit on.

A light strip is different: it runs along its rotation. At 0 it lies along x (east-west), at 90
along y.

## Light roles

MyHuey gives each light a role from where it sits relative to the person's seat and gaze.
`get_room` reports, for every light, `role` (the person's pin: "auto", "bias", "task", or
"view"; "auto" means worked out) and `resolved_roles`, the role for each kind of focus:
"desk" (coding, work, study), "read" (an armchair, else a bed, else the desk), and "sofa"
(a sofa, facing the TV if there is one). Use the focus that matches the activity.

- **bias**: just behind a screen (up to about 50 cm behind it, roughly level with it). It lifts
  the wall behind the screen so the eyes are not swinging between a bright screen and a dark wall.
- **task**: within about 120 cm of the seat. It lights the desk or the page.
- **view**: in front of the eyes past the screen, within about 40 degrees of the gaze and not
  high overhead. Whatever it shows is in the person's sightline all evening.
- **behind**: behind the seat (more than 120 degrees from the gaze) and under 2 m. It reflects
  in the screen.
- **ambient**: everything else. It sets the mood of the room.

With monitors, the seat is 60 cm in front of them. A curved screen is checked as its curve: at
60 cm a tight one (1000R) bounces side lamps away from the eyes, while a lamp behind the seat
spreads its reflection across it. With no desk or screen, every light is ambient for the desk
focus. If a role looks wrong, the cause is almost always a light or a
piece of furniture in the wrong place or facing the wrong way; fix that rather than ignoring it.

## The eye-comfort rules

MyHuey's own suggestions follow these rules. Apply them to everything you design, and when a
request pulls against one, do what was asked in the gentlest form and say so.

1. **Near-white by the eyes and the screen.** Task lights and anything at the desk get `white`
   (kelvin), not colour. Colour close to the eyes tires them and shifts how the screen looks.
2. **A bias light behind a screen stays near-white, at 10 to 20 percent.** Its job is to
   soften the contrast with the screen. Brighter than that, it becomes glare itself; coloured,
   it tints how the screen looks. When someone asks for colour there, keep the bias light
   `white`, give the colour to an ambient light away from the screen, and say so.
3. **Less colour and less brightness in view or behind the chair.** A light in view shines into
   the eyes; a light behind the chair reflects in the screen. Keep them mostly white, a hint of
   colour at most, at about half the room's level or less.
4. **Colour goes to the rest of the room, more the farther from the seat.** Ambient lights carry
   the mood. Lights within about 3 m of the seat get a softer, whiter version; far ones the full colour.
5. **Warmer and dimmer toward bedtime.** In the last three hours before bed, whites are 2700 K
   or below, brightness comes down, and blue-heavy colours stay out. `suggest` knows the
   person's wake and bed times and gives the right white as `kelvin`; you do not, so use it.

## What the tools refuse, and why

These are enforced by the tools themselves, so a plan that relies on getting around them fails.

- **Layouts are built only in a sandbox.** A sandbox is a private copy of the home the person
  can look at before using it. Every tool that writes a layout takes the sandbox's id as
  `layout` and refuses the active home: "Layouts are built in a sandbox, never in the active
  home. Call create_sandbox first, then pass its id as layout."
- **Only three tools change the real lights: `apply_scene`, `room_power`, and `room_dim`.**
  Everything else, `preview_scene` and `save_scene` included, sends nothing to the bridge. Call
  those three only when the person has asked for it: they change the room the person is in.
- **Nothing deletes from the active home**, and no tool deletes a layout. Inside your own
  sandbox you may correct your work: `update_room`, `remove_room` (which also drops that room's
  scenes in the sandbox), `remove_light`, and replacing the furniture or the doors and windows.
- **You never make a sandbox active.** The person does that in the app after looking at it. Never
  tell them a layout is live, installed, or in use.
- When a layout tool answers that your sandbox "is now the active home", the person made it
  active, before or during your call; that is the usual end of a layout job, not a fault. It can
  no longer be edited here, and a new empty sandbox would not have their rooms, so do not retry:
  call `create_sandbox` with `copy_from` "active" and carry on in the copy.
- **Planned lights** (ids starting "planned-") are catalog lights that are not installed. They
  take part in roles and previews and are never sent to the bridge.

The read and scene tools that take a room also take an optional `layout` (a sandbox's name or
id); without it, or with "active", they use the active home. A tool that cannot do what you asked says why in one plain sentence, often with
the values it accepts. Read it, fix the argument, and call again.
