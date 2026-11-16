---
name: myhuey-light-theme
description: Design a Philips Hue light scene for a room from a plain-words request ("warm and dim in the office, a little teal behind the monitor") with the MyHuey tools, preview it, and apply or save it once the person agrees. Use when someone asks for a light theme, mood, or scene. Read myhuey-basics first.
---

# Design a light theme for a room

The person describes a feeling; you turn it into a setting for every light in the room, show
them what it will look like, and change nothing real until they say so. Read myhuey-basics
first: the roles and the five eye-comfort rules decide most of the numbers.

## Steps

1. **Read the room.** `list_rooms` if you do not know its exact name. Then `get_room`: for each
   light, `light_id` (the key you use in `lights` below), `label`, `product` (an object; its
   `productname` says what the light is), `x` and `y`, `resolved_elevation` (its height in cm;
   `elevation` is null unless someone set one), and `resolved_roles`. Add `list_lights` when you
   need to know which lights are on now or whether the bridge answers. You assign lights by
   role, so you cannot design without this.
2. **Get a baseline when the request names an activity** (coding, work, study, reading, a
   film, winding down). Call `suggest` with the room, a mode ("code", "work", "study", "read",
   or "relax"), and `at` as "HH:MM" when the request names a time ("tonight" is about 21:30;
   leave it out for now). Each suggestion has a name, the `kelvin` that suits the hour, the
   role of every light, and `lights`: settings in exactly the shape `preview_scene` takes. Start
   from the first one and change what the request asks for. Its levels already follow the rules.
3. **Give every light a setting, chosen by its role** (desk focus for code, work, and study;
   read for reading; sofa for relax). A setting is one of:
   - `{"white": 2700, "brightness": 40}`: a white from 2000 to 6500 K.
   - `{"colors": ["#2a9d8f"], "brightness": 15}`: 1 to 5 hex colours. Several colours make a
     gradient on gradient products; add `"mode": "interpolated_palette"` for a smooth blend.
   - `{"on": false}`: off.

   Brightness is a percentage. A light you leave out keeps whatever it shows now, which may be
   bright cold white, so the room would not match what you describe: set every light, or pass
   `"others": "off"` to turn off the ones you leave out. "White ambiance" products show only
   whites; give them `white`.

   Turning words into numbers: "dim" is about 20 to 35 percent for the room, "very dim" about
   10; "warm" is 2200 to 2700 K; "bright" or "focus" 60 to 90 percent at 3500 to 4500 K (by
   day only); "a little" colour is one muted colour at low brightness on one or two lights.
4. **Preview.** `preview_scene` with the room, a short name, the `lights` settings, and
   `others` if you use it. It saves nothing and sends nothing. It returns, for every light in
   the room, what it would show: `on`, `color`, `kelvin`, `brightness`, `gradient`, `planned`,
   and `changed` (false means the light keeps its current state). Check that every light you
   meant to set is changed and that none is brighter than you intended. An error names the
   light and the value; fix it and preview again.
5. **Describe it and ask.** Tell the person, in their words and by the lights' names and
   places, what each light will do, and say where you softened a wish to keep it easy on the
   eyes. Then ask whether to apply it to the lights now, save it as a scene, both, or change
   something. Do not call `apply_scene` or `save_scene` before they answer: applying changes
   the room they are sitting in, and saving adds to their list of scenes.
6. **Do what they chose.**
   - Apply: `apply_scene` with the same room, name, and `lights` (and `others`) you previewed;
     or, once saved, with `scene` set to its id and nothing else (a saved scene already says
     what happens to the other lights, so `others` is refused with it). The result lists each
     light with `applied`, `planned`, an `error` for any that refused, and a `warning` for one
     that took the scene without an effect or mode it lacks, plus a `failed` count. Report
     failures and warnings plainly (a failure is usually a light that is unplugged or out of
     reach); never say a light shows an effect its `warning` says it skipped.
   - Save: `save_scene` with the same arguments returns the scene's id. To change a saved scene
     later, pass that id as `scene_id`; `list_scenes` shows what exists. Pass `scene_id` only to
     replace a scene you made in this conversation, or one the person asked you to replace:
     replacing overwrites it, and the person may rely on the scene that is there.
7. **Planned lights** (`planned: true`) are not installed yet. They appear in the preview so the
   person sees the whole plan, and they are never sent. Say they will take the scene once installed.

"Turn the office off" or "dim it to 30" needs no design: `room_power` and `room_dim` do that.
They change real lights too, so use them only when that is what was asked.

## Worked example

Request: "Warm and dim in the office for coding tonight, a little teal behind the monitor,
nothing bright behind me."

`get_room` with `{"room": "Office"}` returns four lights (abridged):

| light_id | label | product.productname | x, y | resolved_elevation | resolved_roles.desk |
|---|---|---|---|---|---|
| 4 | Monitor strip | Hue gradient lightstrip | 183, 8 | 95 | bias |
| 7 | Signe | Signe gradient floor | 335, 30 | 150 | ambient |
| 9 | Ceiling | Hue white ambiance ceiling | 183, 213 | 244 | ambient |
| 12 | Shelf lamp | Hue color lamp | 150, 412 | 120 | behind |

Coding names an activity, so get a baseline:

```
suggest {"room": "Office", "mode": "code", "at": "21:30"}
→ [{"name": "Code · Honey Split 69", "kelvin": 2824,
    "roles": {"4": "bias", "7": "ambient", "9": "ambient", "12": "behind"},
    "lights": {"4": {"white": 2824, "brightness": 10.0},
               "7": {"colors": ["#cd945f", "#dba05f", "#e3a587", "#d8ab89", "#ecb27e"],
                     "brightness": 50.0, "mode": "interpolated_palette"},
               "9": {"white": 2824, "brightness": 50.0},
               "12": {"colors": ["#f8a961"], "brightness": 20.0}}}, ...]
```

From the request:

- "Warm and dim": whites down to 2400 K and levels down from the baseline's 50.
- "A little teal behind the monitor": light 4 is the bias light. Teal is what they asked for,
  so it gets teal, but at 15 percent, inside rule 2.
- "Nothing bright behind me": light 12 is behind the chair. Very warm white at 8 percent.
- The ceiling (9) is white only and near the middle of the room: 2400 K at 25 percent.
- The Signe (7) is the farthest ambient light: it carries the warmth as an amber gradient.

```
preview_scene {"room": "Office", "name": "Teal evening",
               "lights": {"4": {"colors": ["#2a9d8f"], "brightness": 15},
                          "7": {"colors": ["#e08a3c", "#c0603a"], "brightness": 35,
                                "mode": "interpolated_palette"},
                          "9": {"white": 2400, "brightness": 25},
                          "12": {"white": 2200, "brightness": 8}}}
→ {"scene": {"name": "Teal evening", "room": "Office"},
   "lights": [{"id": "4", "name": "Monitor strip", "on": true, "color": "#2a9d8f", "kelvin": null,
               "brightness": 15.0, "gradient": null, "planned": false, "changed": true},
              {"id": "7", "name": "Signe", "on": true, "color": "#e08a3c", "kelvin": null,
               "brightness": 35.0, "gradient": ["#e08a3c", "#c0603a"], "planned": false, "changed": true},
              ...],
   "saved": false, "sent": false}
```

All four changed, none above 35 percent. Then, to the person:

> Here is "Teal evening" for the office: the strip behind your monitors glows a soft teal at
> 15 percent, kept low so it eases the contrast with the screen instead of competing with it.
> The Signe in the corner fades from amber to copper at 35 percent, the ceiling light is a warm
> 2400 K at 25 percent, and the shelf lamp behind your chair is a very warm white at 8 percent
> so it will not reflect in the screen. Shall I put it on the lights now, save it as a scene, or both?

They answer "both". Call `save_scene` with the same arguments, then `apply_scene` with
`{"scene": "<the id save_scene returned>"}`, and report how many lights took it.
