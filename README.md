# MyHuey

MyHuey is a local app for a Philips Hue home: a Python library, a CLI, and a web UI. You draw each room to scale, place furniture and lights at their real sizes, and paint scenes onto rooms. Each light takes the color of the zone or image it sits under, and gradient lights take colors along their length.

## Features

- **Rooms to scale.** Enter dimensions in feet and inches or meters, and reshape the outline beyond rectangles (drag corners, add or remove them). Place furniture at real sizes.
- **Lights drawn as they look.** Lightstrips are long and thin, Play bars are bars, tubes are tubes, Signe is a column, and bulbs and spots are round fixtures. The shape comes from each light's archetype, product name, and model ID. Lights rotate, and lightstrip and string-light length is adjustable.
- **Scenes.** Paint color zones (rectangle, ellipse, freehand) onto a room. Lights outside every zone can turn off, stay as they are, take a base color, or take the nearest zone. Scenes are named, saved, editable, and can be applied from the UI or the CLI.
- **Images in scenes.** Import an image to extract a color theme by mood (colorful, bright, muted, deep, dark), with a draggable picker on the image for every swatch. Lay the image over the room so lights take the color beneath them.
- **Room photos.** Upload a photo of the real room and place its lights on it, as a second view beside the plan.
- **Gradients and effects.** Edit each gradient light's colors (2 to 5 points), mode (blend, mirrored, bands, scatter), and effect (candle, fire, prism, and more) from the light controls. The plan draws each light's live gradient.
- **Color tools.** An OKLCH and HCT color picker with tonal palettes, harmonies, and shades, tints, and tones.

## Quick start

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'

npm --prefix frontend install
npm --prefix frontend run build      # builds the web UI into static/app

myhuey bridge setup                  # guided pairing: press the bridge's link button
myhuey serve --port 8000             # open http://127.0.0.1:8000
```

For UI development, run `myhuey serve` and `npm --prefix frontend run dev` together. The Vite dev server proxies `/api` to port 8000.

## Finding your way

- **Home** is for everyday control: on/off and brightness for every room, and a tile per room showing what's on and its colours. The **⋮** on a tile offers eye-comfort suggestions for right now and the room's saved scenes, one tap each. Click a tile to open that room's **workbench** (each light, the room's scenes, and the full suggestions).
- **Studio** is for building: saved layouts and sandboxes, the floor-plan image, tracing and drawing rooms, and each room's designer (outline, furniture, doors and windows, light placement, and the room photo).
- **Scenes** lists every scene and makes new ones from images, colours, or the Hue gallery.
- **Lights** lists every light. Tick several, or Cmd/Ctrl-click them, to change them together.
- **Settings** holds the bridge pairing and your preferences.

## Suggested scenes

Open a room's ⋮ menu on Home, or its workbench (or run `myhuey suggest --room Office --mode code`). Pick what you are doing: **code**, **work**, **study**, **read**, or **relax**. MyHuey suggests scenes from a palette library, the time of day, and where each light sits in the room:

- **The clock**: white light cools and brightens after your wake time and warms and dims over the four hours before your bedtime (set both in Settings). Blue-heavy palettes are left out from three hours before bed until you wake.
- **Your eyes**: lights by the desk stay white (task), a light just behind the monitor stays dim (bias), and lights in your line of sight or behind your chair are dimmed and kept near white, so the screen doesn't fight glare or reflections. The palette colors the rest of the room.
- **Heights and roles**: each light's height is guessed from its product (ceiling, floor lamp, table lamp, strip) and the furniture under it; set it in the light's details if the guess is off. A light's role is worked out automatically, or pin it to Bias, Task, or View.

A suggestion is a normal scene: preview it on the lights, then save it and edit it like any other. Put your monitors on the plan so MyHuey knows where the screen is.

## CLI

Lengths accept units: `12ft`, `12'6"`, `3.8m`, `380cm`. A bare number means feet in imperial rooms and meters in metric rooms. Positions (`--x`, `--y`) are in centimeters from the room's corner.

```bash
myhuey bridge status
myhuey room import                                   # copy Hue rooms and their lights
myhuey room create --name Office --width 12ft --height "10ft 6in"
myhuey room update --name Office --outline "0,0 14,0 14,8 8,8 8,12 0,12"   # an L-shaped room, in feet
myhuey room assign --name Office --light-id 28 --x 120 --y 40 --rotation 90 --length 2m
myhuey room photo --name Office --file office.jpg
myhuey furniture add --room Office --kind desk --width 5ft --depth 30in --x 200 --y 80

myhuey scene create --name Sunset --room Office --base-mode nearest
myhuey scene zone --scene Sunset --rect 0,0,200,300 --color "#ff4d6d" --brightness 80
myhuey scene image --scene Sunset --file sunset.jpg --mood bright
myhuey scene preview --scene Sunset
myhuey scene apply --scene Sunset

myhuey palette --file sunset.jpg --mood muted --count 5
myhuey lights list
myhuey lights set --light-id 3 --on on --brightness 200 --color "#ff8000"
myhuey lights gradient --light-id 28 --colors "#ff4d6d,#ffd166,#3a86ff" --mode segmented_palette
myhuey lights effect --light-id 28 --effect candle     # no_effect stops it
```

Gradient lights take 2 to 5 colors, spaced evenly from start to end (Hue fixes the spacing). The mode draws them as a blend (`interpolated_palette`), mirrored from the middle, as hard bands (`segmented_palette`), or scattered (`random_pixelated`); each light lists the modes and effects it supports in `lights list`. On the bridge an effect replaces the gradient, and setting a gradient stops the effect. Scenes can override any light with its own colors, mode, effect, or brightness.

## Storage

Everything lives under `~/.myhuey`:

- `myhuey.db` is SQLite with one JSON document (table `app_state`, key `config`) holding the pairing, rooms, and scenes. Lengths are in centimeters. Older documents are upgraded when they are loaded, and the original is kept under the key `config_backup_v1`. Version 1 rooms (900 x 600 abstract units) became 4.5 m x 3 m, with light positions scaled the same way.
- `certs/` holds the pinned bridge certificate.
- `uploads/` holds room photos and scene images. Uploads must be JPEG, PNG, or WebP, at most 15 MB. They are re-encoded, which removes EXIF data such as GPS location, and saved under server-generated names. Images that nothing refers to anymore are deleted.

The pairing key never leaves the server: API responses and CLI output do not include it.

## Hue API versions

Bridge traffic goes through `myhuey.hue.HueBridgeClient`. Pairing, lights, rooms, and plain color changes use the v1 API. Gradient lights use the v2 (CLIP) API, which is the only way to set colors along a light's length. The v1 username works as the v2 `hue-application-key`. Placements keep v1 light IDs, and the v2 IDs are looked up through each light's `id_v1`.

## Tests

```bash
pytest -q
npm --prefix frontend test
```

## Credits

Light and room icons are path data from [hass-hue-icons](https://github.com/arallsopp/hass-hue-icons) by Andrew Allsopp, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (non-commercial use only). See `frontend/src/components/HUE_ICONS_LICENSE.txt`. The Inter font is bundled locally from `@fontsource-variable/inter`.

Suggested-scene palettes include colors taken from public-domain paintings in [The Metropolitan Museum of Art's Open Access collection](https://www.metmuseum.org/hubs/open-access) (CC0); each palette names its painting. The rest are generated by MyHuey. See `src/myhuey/data/PALETTES_LICENSE.md`.
