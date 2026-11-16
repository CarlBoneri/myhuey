---
name: myhuey-room-layout
description: Build a room layout (walls, doors and windows, furniture, and where the Hue lights go) from a plain description such as "12 by 14 feet, desk on the north wall under the window" with the MyHuey tools, in a sandbox the person reviews in the app. Use when someone describes a room to plan or wants to rework one. Read myhuey-basics first.
---

# Build a room layout from a description

The person describes a room; you build it in a sandbox, check it, and hand them a link to see
it in 3D. Read myhuey-basics first: coordinates, rotation, and roles decide every number here.
You never make the sandbox active; the person does that in the app once they like it.

## Steps

1. **Restate the room with numbers, and ask only for what is missing and matters.** Before
   building, say back what you will make, in their units and in cm: the size, the ceiling, which
   wall the desk is on, how many screens, which lights and where. Ask only about what changes
   the light: the room's size, where the desk and screens go, and which lights there are. Assume
   the rest and say so: a ceiling of 244 cm (8 ft), an 80 cm door, a window sill of 90 cm and top
   of 210 cm, catalog sizes for furniture. One short round of questions, then a result, is what
   they want. `list_lights` tells you which lights are paired; anything else comes from `catalog`
   as a planned light.
2. **Make a sandbox.** `create_sandbox` with a name returns `{"id", "name", "rooms"}`. Pass that
   id as `layout` to every call below. To rework a room that already exists, pass `copy_from`
   "active" and change the copy (`update_room`, `remove_light`, and so on) instead of adding a new room.
3. **Add the room.** `add_room` with `layout`, `name`, `width` (along x), `depth` (along y),
   and optionally `ceiling` and `units` ("imperial" or "metric", for how the app shows it). For
   an L-shape or any other shape, pass `outline` instead: [x, y] corners in cm, going clockwise
   from the top-left. The result is the room as `get_room` shows it (there the depth is called
   `height`).
4. **Doors and windows.** `set_openings` with a list of `{"kind": "door" or "window", "wall",
   "offset", "width"}`, plus `sill` and `top` for a window. `wall` counts the outline's edges
   from 0. For a rectangle from `add_room`: 0 is north (starting at the top-left corner, running
   east), 1 east (from the top-right, running south), 2 south (from the bottom-right, running
   west), 3 west (from the bottom-left, running north). `offset` is the distance from that
   starting corner to the near side of the opening. To centre a 120 cm window on a 366 cm north
   wall, `offset` is 183 - 60 = 123. Each call replaces all openings, so send the full list.
5. **Furniture.** `set_furniture` with the full list; each call replaces what is there. Each item
   is `{"kind", "x", "y", "rotation"}` with optional `width`, `depth`, `elevation`, `height`,
   and `label`. `catalog` lists the kinds with default sizes, for example "desk" (140 by 70),
   "desk-l", "desk-standing", "monitor-24", "monitor-27", "monitor-34", "tv", "sofa",
   "armchair", "bed-queen", "bookshelf", "chair". Against a wall, the centre sits half the
   depth out from it. Monitors go inside the desk's footprint, with the desk's rotation; their
   height off the floor defaults to 75 (the desk's top), so set `elevation` 110 on a standing
   desk. Two 27-inch monitors side by side sit about 66 cm apart, centre to centre.
6. **Lights.** `place_light` with `layout`, `room`, `x`, `y`, and exactly one of `light_id` (a
   paired light from `list_lights`) or `catalog` (a planned light, such as "gradient-strip",
   "play-bar", "floor-lamp", "table-lamp", "desk-lamp", "ceiling"). Optional: `rotation`,
   `height` (cm off the floor; most products have a default: ceiling lights at the ceiling,
   floor lamps at 150, table lamps and strips on the furniture under them), `length` for
   strips, `role` ("auto", "bias", "task", "view"), and `label`. It returns the placed light
   with its `light_id`; planned ones start "planned-". Calling it again with that `light_id`
   moves the light. A bias strip goes between the monitors and the wall, at about the middle of
   the screens' height (95 cm on a 75 cm desk).
7. **Look at it.** `describe_room` returns a text drawing: each character is `cm_per_column`
   wide and `cm_per_row` tall (rows are twice as tall as columns), "." is floor, capital letters
   are furniture, lower-case letters are lights, and the legend says which is which with its x
   and y. The openings come back in words with their side of the room. Check it the way the
   person would: is the desk on the wall they named, under the window, the lamp in the right corner?
8. **Check it.** `check_layout` returns `{"ok", "problems"}`, each problem with a `kind`, the
   `item` id, and a sentence. Fix each and check again:
   - `outside`: the item or light sticks out of the room. Move it in: its centre must be at least
     half its size from every wall.
   - `overlap`: two pieces at the same height overlap. Move one. A monitor on a desk, or anything
     on a rug, is not an overlap.
   - `screen_off_desk`: a monitor is not over a desk. Move its x and y inside the desk.
   - `screen_faces_wall`: the seat in front of a monitor would be outside the room. Its rotation
     is wrong; give it the desk's rotation, facing into the room.
   - `no_seat`: no desk and no monitor. Right for a bedroom without a desk; otherwise add them.
   - `height_unknown`: the light's product has no default height. Place it again with `height`.
   Then `get_room` and look at `resolved_roles`: a strip meant as a bias light should be "bias"
   for the desk focus; a lamp that came out "view" or "behind" will glare or reflect, so
   suggest a better spot or say so.
9. **Hand it over.** `open_in_app` with `layout` and `room` returns `{"url", "answering",
   "note"}`. Give the person the url. When `answering` is false, pass on the note (the app is
   not running; `myhuey serve` starts it).
10. **Summarise.** In their units: the size, what stands where, each light and its role, the
    assumptions you made, and what to look at in the 3D view. Say it is in the sandbox you
    named, not in their home, and that they can make it active in the app when they are happy.
    Never say it is active, live, or installed.

Always finish with `describe_room`, `check_layout`, and `open_in_app`, even after a small
change: they are how you and the person know the layout is what was meant.

## Worked example

Request: "A 12 by 14 foot office, desk on the north wall under the window with two monitors, a
floor lamp in the corner by the window, and a light strip behind the screens."

`list_lights` shows no strip or floor lamp is paired, so both are planned. Restate, and since
nothing that matters is missing, build:

> A 12 by 14 ft office (366 by 427 cm) with an 8 ft ceiling. A 120 cm window centred on the
> north wall, sill at 90 cm. The desk (140 by 70 cm) centred under it with two 27-inch
> monitors, a planned gradient strip behind them, and a planned floor lamp in the north-east
> corner. I'll assume the door is on the south wall, 40 cm from the east corner (wall 2 starts
> at the bottom-right, so that is an offset of 40).

```
create_sandbox {"name": "Office idea"}
→ {"id": "737ac62f311f", "name": "Office idea", "rooms": []}
add_room {"layout": "737ac62f311f", "name": "Office", "width": "12ft", "depth": "14ft",
          "ceiling": "8ft", "units": "imperial"}
→ {"name": "Office", "width": 365.76, "height": 426.72, "ceiling": 243.84, ...}
set_openings {"layout": "737ac62f311f", "room": "Office", "openings": [
    {"kind": "window", "wall": 0, "offset": 123, "width": 120},
    {"kind": "door", "wall": 2, "offset": 40, "width": 80}]}
set_furniture {"layout": "737ac62f311f", "room": "Office", "furniture": [
    {"kind": "desk", "x": 183, "y": 35, "rotation": 0},
    {"kind": "monitor-27", "x": 150, "y": 22, "rotation": 0},
    {"kind": "monitor-27", "x": 216, "y": 22, "rotation": 0},
    {"kind": "chair", "x": 183, "y": 110}]}
place_light {"layout": "737ac62f311f", "room": "Office", "x": 183, "y": 8,
             "catalog": "gradient-strip", "length": 120, "height": 95, "label": "Monitor strip"}
→ {"light_id": "planned-dfd1995fce3d", "label": "Monitor strip", "x": 183.0, "y": 8.0, ...}
place_light {"layout": "737ac62f311f", "room": "Office", "x": 335, "y": 30,
             "catalog": "floor-lamp", "label": "Corner lamp"}
describe_room {"room": "Office", "layout": "737ac62f311f"}
→ {"drawing": "...", "cm_per_column": 10.0, "cm_per_row": 20.0,
   "legend": [{"mark": "A", "what": "desk", "name": "Desk", "x": 183.0, "y": 35.0}, ...,
              {"mark": "b", "what": "light", "name": "Corner lamp", "x": 335.0, "y": 30.0}],
   "openings": ["Window on wall 0 (north side), 123 cm from its start, 120 cm wide, sill 90 cm, top 210 cm",
                "Door on wall 2 (south side), 40 cm from its start, 80 cm wide"]}
check_layout {"room": "Office", "layout": "737ac62f311f"}
→ {"ok": true, "problems": []}
get_room {"room": "Office", "layout": "737ac62f311f"}
→ Monitor strip: resolved_roles {"desk": "bias", ...}; Corner lamp: {"desk": "ambient", ...}
open_in_app {"layout": "737ac62f311f", "room": "Office"}
→ {"url": "http://127.0.0.1:8000/?layout=737ac62f311f#/studio/room/Office/3d", "answering": true, ...}
```

The drawing's first rows, printed (the room is 37 columns by 22 rows):

```
...........AAAAAAAaAAAAAA............
...........ABBBBBBACCCCCC........b...
...........AAAAAAAAAAAAAA............
...........AAAAAAAAAAAAAA............
................DDDDD................
```

It shows the desk (A) against the top wall with both monitors (B, C) on it, the strip
(a) behind them, and the lamp (b) in the top-right corner. To the person:

> Your office is built in the sandbox "Office idea": 12 by 14 ft, the desk centred under the
> north window with both monitors, the gradient strip behind them (it counts as a bias light,
> so it will stay soft), and the floor lamp in the north-east corner, out of your line of
> sight. I put the door on the south wall, 40 cm from the east corner; tell me if it is
> elsewhere. Open http://127.0.0.1:8000/?layout=737ac62f311f#/studio/room/Office/3d to see it
> in 3D. It is not your active home; make it active in the app when you are happy with it.
