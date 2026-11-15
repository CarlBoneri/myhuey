# Palette library licenses

`palettes.json` holds the palettes that suggested scenes choose from. Each entry's `source`
says where it came from, and its `credit` says who made it.

| `source` | Where it comes from | License |
|---|---|---|
| `met` | Colors taken from public-domain paintings in The Metropolitan Museum of Art's Open Access collection, using myhuey's theme extractor. `credit` names the painting, the artist, and links to it. | **CC0** (Creative Commons Zero). No conditions. |
| `colourlovers` | Palettes shared by members of the COLOURlovers community. `credit` names the author and links to the palette. | **CC BY-NC-SA 3.0** (Creative Commons Attribution-NonCommercial-ShareAlike 3.0). Keep the credit, don't use them commercially, and share changes under the same license. |
| `generated` | Made by myhuey's own harmony rules (`myhuey/palettes.py`). | Same license as myhuey's code. |

The build script (`scripts/build_palettes.py`) includes COLOURlovers palettes only when its API
answers. If the API refuses automated clients, the library holds only `met` and `generated`
entries.
