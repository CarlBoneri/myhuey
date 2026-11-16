"""Convert the Hue scene gallery gist into src/myhuey/data/hue_scenes.json (a developer tool).

Source: https://gist.github.com/Hypfer/a0a8b5b9429831a7306ec4300077eaaa (scenes.json), the
scene gallery of the official Hue app as of 2023-09-28, recorded clean-room from real lights
(x, y and brightness per light) by Hypfer and coderph0x.

    python scripts/import_hue_scenes.py path/to/scenes.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from myhuey.color import xy_to_hex  # noqa: E402

GIST = "https://gist.github.com/Hypfer/a0a8b5b9429831a7306ec4300077eaaa"
OUT = Path(__file__).resolve().parents[1] / "src" / "myhuey" / "data" / "hue_scenes.json"


def main() -> None:
    source = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    sets = []
    for group in source["sets"]:
        scenes = []
        for scene in group["scenes"]:
            xy = [[round(float(light["x"]), 4), round(float(light["y"]), 4)] for light in scene["lights"]]
            scenes.append({"name": str(scene["name"]), "bri": max(1, min(254, int(scene["bri"]))), "xy": xy,
                           "colors": [xy_to_hex(point) for point in xy]})
        sets.append({"name": str(group["name"]), "scenes": scenes})
    data = {
        "credit": {"by": "Philips Hue app scene gallery (2023-09-28); values recorded by Hypfer and coderph0x",
                   "url": GIST, "note": "Philips Hue and the scene names belong to Signify."},
        "sets": sets,
    }
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {sum(len(s['scenes']) for s in sets)} scenes in {len(sets)} sets to {OUT}")


if __name__ == "__main__":
    main()
