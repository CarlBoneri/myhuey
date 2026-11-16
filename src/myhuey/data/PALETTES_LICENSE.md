# Palette library licenses

`palettes.json` holds the palettes that suggested scenes choose from. Each entry's `source`
says where it came from, and its `credit` says who made it.

| `source` | Where it comes from | License |
|---|---|---|
| `met` | Colors taken from public-domain paintings in The Metropolitan Museum of Art's Open Access collection, using myhuey's theme extractor. `credit` names the painting, the artist, and links to it. | **CC0** (Creative Commons Zero). No conditions. |
| `colourlovers` | Palettes shared by members of the COLOURlovers community. `credit` names the author and links to the palette. | **CC BY-NC-SA 3.0** (Creative Commons Attribution-NonCommercial-ShareAlike 3.0). Keep the credit, don't use them commercially, and share changes under the same license. |
| `d3` | The 27 sequential color schemes from [d3-scale-chromatic](https://d3js.org/d3-scale-chromatic/sequential) (version 3.1.0), each sampled in a few windows. `credit` names the scheme and who made it. | d3-scale-chromatic is **ISC** (© Mike Bostock). The single- and multi-hue schemes (Blues … YlOrRd) are **ColorBrewer** by Cynthia Brewer, **Apache 2.0**. Viridis, Inferno, Magma, and Plasma are matplotlib's colormaps by van der Walt, Smith (and Firing), **CC0**. Turbo is by Anton Mikhailov (Google), **Apache 2.0**. Cividis (Nuñez, Anderton, Renslow), Warm and Cool (after Niccoli's perceptual rainbow), and Cubehelix (Dave Green) are used as distributed in d3-scale-chromatic. |
| `generated` | Made by myhuey's own harmony rules (`myhuey/palettes.py`). | Same license as myhuey's code. |

The build script (`scripts/build_palettes.py`) includes COLOURlovers palettes only when its API
answers. If the API refuses automated clients, the library holds only `met` and `generated`
entries.

### Apache 2.0 notice (ColorBrewer)

Apache-Style Software License for ColorBrewer software and ColorBrewer Color Schemes.
Copyright (c) 2002 Cynthia Brewer, Mark Harrower, and The Pennsylvania State University.
Licensed under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0.
Unless required by applicable law or agreed to in writing, software distributed under the License
is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied. See the License for the specific language governing permissions and limitations.
