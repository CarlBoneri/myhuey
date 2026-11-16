"""Turn the colour themes installed on this computer into MyHuey themes.

It reads every colour theme VS Code (and VS Code Insiders) has, built in or from an extension,
and the palettes in Starship's presets, and writes:

  frontend/src/themes.generated.css      one token block per theme
  frontend/src/lib/themes.generated.ts   the list the app shows
  src/myhuey/data/themes.json            the ids the server and CLI accept

A theme file gives a background, a foreground, and a set of terminal colours. Everything else
MyHuey needs is worked out from those, and every text colour is moved until it reads at 4.5:1
or better on the page, on panels, and on cards, so an imported theme passes the same tests as
the hand-made ones. Run it again after installing or removing a theme:

    uv run python scripts/import_editor_themes.py            # everything found
    uv run python scripts/import_editor_themes.py --list     # only say what was found
    uv run python scripts/import_editor_themes.py --skip "monokai pro"   # leave some out
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tomllib
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
CSS_OUT = REPO / "frontend/src/themes.generated.css"
TS_OUT = REPO / "frontend/src/lib/themes.generated.ts"
JSON_OUT = REPO / "src/myhuey/data/themes.json"

VSCODE_ROOTS = [
    Path("/Applications/Visual Studio Code.app/Contents/Resources/app/extensions"),
    Path("/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions"),
    Path.home() / ".vscode/extensions",
    Path.home() / ".vscode-insiders/extensions",
]
# VS Code's own terminal colours, used by themes that do not set theirs.
DEFAULT_ANSI = {
    "dark": {"red": "#cd3131", "green": "#0dbc79", "yellow": "#e5e510", "blue": "#2472c8", "magenta": "#bc3fbc", "cyan": "#11a8cd"},
    "light": {"red": "#cd3131", "green": "#107c10", "yellow": "#949800", "blue": "#0451a5", "magenta": "#bc05bc", "cyan": "#0598bc"},
}
ANSI = ("red", "green", "yellow", "blue", "magenta", "cyan")
MIN_CONTRAST = 4.6  # the tests ask for 4.5; the margin covers rounding to hex


# Colour arithmetic

def rgb(colour: str) -> tuple[int, int, int]:
    value = colour.lstrip("#")
    if len(value) in (3, 4):
        value = "".join(ch * 2 for ch in value)
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def alpha(colour: str) -> float:
    value = colour.lstrip("#")
    if len(value) == 4:
        return int(value[3] * 2, 16) / 255
    return int(value[6:8], 16) / 255 if len(value) == 8 else 1.0


def hexed(parts: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{max(0, min(255, round(part))):02x}" for part in parts)


def mix(a: str, b: str, share: float) -> str:
    """`share` of b into a."""
    x, y = rgb(a), rgb(b)
    return hexed(tuple(x[i] + (y[i] - x[i]) * share for i in range(3)))  # type: ignore[arg-type]


def flat(colour: str, ground: str) -> str:
    """A colour that may have alpha, as it looks over a solid ground."""
    return mix(ground, colour[:7] if len(colour.lstrip("#")) > 4 else "#" + "".join(ch * 2 for ch in colour.lstrip("#")[:3]), alpha(colour))


def luminance(colour: str) -> float:
    def channel(value: int) -> float:
        v = value / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(colour)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a: str, b: str) -> float:
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def readable(colour: str, grounds: list[str], toward: str) -> str:
    """The colour, moved toward white or black just far enough to read on every ground."""
    for step in range(0, 101, 2):
        candidate = mix(colour, toward, step / 100)
        if min(contrast(candidate, ground) for ground in grounds) >= MIN_CONTRAST:
            return candidate
    return toward


def rgba(colour: str, opacity: float) -> str:
    r, g, b = rgb(colour)
    return f"rgba({r}, {g}, {b}, {opacity:g})"


# From a palette to MyHuey's tokens

def tokens(kind: str, bg: str, fg: str, ansi: dict[str, str], bg2: str | None = None, accent: str | None = None,
           accent2: str | None = None, selection: str | None = None) -> dict[str, str]:
    dark = kind == "dark"
    ink = "#ffffff" if dark else "#000000"  # where text moves to gain contrast
    bg, fg = bg[:7].lower(), fg[:7].lower()
    bg2 = (bg2 or mix(bg, "#000000", 0.16 if dark else 0.05))[:7].lower()
    # Panels hover in a slightly different shade; text has to read on that too.
    surface2 = "rgba(255, 255, 255, 0.075)" if dark else "rgba(20, 16, 40, 0.07)"
    card = mix(bg, "#ffffff" if dark else "#141028", 0.075 if dark else 0.07)
    grounds = [bg, bg2, card]
    text = readable(fg, grounds, ink)
    if contrast(text, bg) < 7:  # body text should be comfortable, not just legal
        text = readable(mix(text, ink, 0.25), grounds, ink)
    colours = {name: ansi[name][:7].lower() for name in ANSI}
    accent = (accent or colours["blue"])[:7].lower()
    if contrast(accent, bg) < 2.2:  # an accent that vanishes into the page is no accent
        accent = colours["blue"] if contrast(colours["blue"], bg) >= 2.2 else readable(accent, [bg], ink)
    accent2 = (accent2 or colours["cyan"])[:7].lower()
    # Text on the accent gradient: pick dark or white, then shift the stops until it reads on both.
    on_dark, on_light = "#111118", "#ffffff"
    on = on_dark if contrast(on_dark, accent) >= contrast(on_light, accent) else on_light
    away = "#ffffff" if on == on_dark else "#000000"
    stops = [readable_ground(stop, on, away) for stop in (accent, accent2)]
    out = {
        "--bg": bg, "--bg-2": bg2, "--text": text,
        "--text-2": readable(mix(text, bg, 0.22), grounds, ink),
        "--text-3": readable(mix(text, bg, 0.42), grounds, ink),
        # Buttons are filled with the accent, so the accent itself is the stop the text reads on.
        "--accent": stops[0], "--accent-2": accent2, "--accent-strong": stops[0],
        "--accent-gradient": f"linear-gradient(135deg, {stops[0]} 0%, {stops[1]} 100%)", "--on-accent": on,
        "--danger": colours["red"], "--warn": colours["yellow"], "--ok": colours["green"],
        **{f"--ansi-{name}": colours[name] for name in ANSI},
        "--selection": flat(selection, bg) if selection else mix(bg, accent, 0.28),
        "--floor": mix(bg, fg, 0.06), "--floor-stroke": rgba(accent, 0.6), "--floor-hover": mix(bg, fg, 0.13),
        "--stage": bg2 if dark else mix(bg, "#141028", 0.05),
        "--glass": rgba(mix(bg, fg, 0.07), 0.6), "--glass-bg": rgba(mix(bg, fg, 0.07), 0.6),
        "--glass-strong": rgba(mix(bg2, fg, 0.03), 0.9), "--toast-bg": rgba(mix(bg2, fg, 0.05), 0.95),
        "--halo": bg + "d9", "--halo-soft": bg + "73", "--glow-lit": colours["magenta"] + "2e",
        "--warn-text": readable(colours["yellow"], grounds, ink), "--done-text": readable(colours["green"], grounds, ink),
        "--danger-text": readable(colours["red"], grounds, ink), "--link": readable(accent, grounds, ink),
    }
    if not dark:  # the light counterparts of the base (dark) tokens, as the hand-made Light theme has them
        out.update({
            "--surface": "rgba(20, 16, 40, 0.04)", "--surface-2": surface2, "--surface-3": "rgba(20, 16, 40, 0.1)",
            "--border": "rgba(20, 16, 40, 0.1)", "--border-strong": "rgba(20, 16, 40, 0.18)",
            "--shadow": "0 14px 40px -22px rgba(20, 16, 40, 0.35), 0 0 0 1px var(--border)",
            "--furniture": "rgba(20, 16, 40, 0.1)", "--furniture-stroke": "rgba(20, 16, 40, 0.4)", "--grid": "rgba(20, 16, 40, 0.06)",
            "--glass": rgba(mix(bg, "#ffffff", 0.6), 0.7), "--glass-bg": rgba(mix(bg, "#ffffff", 0.6), 0.62),
            "--glass-strong": rgba(mix(bg, "#ffffff", 0.7), 0.92), "--toast-bg": rgba(mix(bg, "#ffffff", 0.8), 0.96),
            "--glass-border": "rgba(20, 16, 40, 0.1)", "--glass-highlight": "rgba(255, 255, 255, 0.7)",
            "--inset": "rgba(20, 16, 40, 0.05)", "--hairline": "rgba(20, 16, 40, 0.1)", "--soft-shadow": "rgba(20, 16, 40, 0.16)",
            "--halo": bg + "e6", "--halo-soft": bg + "99", "--glow-lit": stops[0] + "26",
            "--hover-stroke": "var(--accent-strong)", "--handle-stroke": "var(--accent-strong)",
            "--lit": readable(colours["yellow"], [bg], ink), "--swatch-ring": "rgba(20, 16, 40, 0.18)", "--swatch-active": "var(--text)",
            "--panel-bg": "var(--glass-bg)", "--glow-1": "transparent", "--glow-2": "transparent", "--glow-3": "transparent",
            "color-scheme": "light",
        })
    return out


def readable_ground(ground: str, text: str, away: str) -> str:
    """A background moved away from the text's colour until the text reads on it."""
    for step in range(0, 101, 2):
        candidate = mix(ground, away, step / 100)
        if contrast(text, candidate) >= MIN_CONTRAST:
            return candidate
    return away


# VS Code

def jsonc(text: str) -> Any:
    """JSON with comments and trailing commas, as VS Code's theme files are written."""
    out, i, in_string = [], 0, False
    while i < len(text):
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\":
                out.append(text[i + 1]); i += 1
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True; out.append(ch)
        elif text.startswith("//", i):
            i = text.find("\n", i)
            if i < 0:
                break
            continue
        elif text.startswith("/*", i):
            i = text.find("*/", i) + 2
            continue
        else:
            out.append(ch)
        i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def theme_colours(path: Path, seen: frozenset[Path] = frozenset()) -> dict[str, str]:
    data = jsonc(path.read_text(encoding="utf-8"))
    colours: dict[str, str] = {}
    include = data.get("include")
    if include and (target := (path.parent / include).resolve()) not in seen and target.exists():
        colours.update(theme_colours(target, seen | {path.resolve()}))
    colours.update({key: value for key, value in (data.get("colors") or {}).items() if isinstance(value, str) and value.startswith("#")})
    return colours


def vscode_themes() -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for root in VSCODE_ROOTS:
        if not root.is_dir():
            continue
        for manifest in sorted(root.glob("*/package.json")):
            try:
                package = json.loads(manifest.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            entries = (package.get("contributes") or {}).get("themes") or []
            if not entries:
                continue
            nls_path = manifest.with_name("package.nls.json")
            nls = json.loads(nls_path.read_text(encoding="utf-8")) if nls_path.exists() else {}
            for entry in entries:
                label = str(entry.get("label") or entry.get("id") or "")
                if label.startswith("%") and label.endswith("%"):
                    translated = nls.get(label[1:-1], label)
                    label = translated.get("message", label) if isinstance(translated, dict) else translated
                ui = str(entry.get("uiTheme") or "vs-dark")
                path = (manifest.parent / str(entry.get("path", ""))).resolve()
                if not label or not path.is_file() or label.lower() in found:
                    continue  # the same theme in both VS Code and Insiders is imported once
                try:
                    colours = theme_colours(path)
                except (json.JSONDecodeError, OSError, ValueError):
                    continue
                origin = str(package.get("displayName") or package.get("name") or manifest.parent.name)
                if origin.startswith("%"):  # VS Code's own themes name themselves through a translation table
                    origin = "built in"
                kind = "light" if ui in ("vs", "hc-light") else "dark"
                defaults = {"dark": ("#1e1e1e", "#d4d4d4"), "light": ("#ffffff", "#000000")}[kind]
                bg = colours.get("editor.background", defaults[0])
                fg = colours.get("editor.foreground") or colours.get("foreground") or defaults[1]
                ansi = {name: colours.get(f"terminal.ansi{name.capitalize()}", DEFAULT_ANSI[kind][name]) for name in ANSI}
                side = colours.get("sideBar.background")
                accent = next((colours[key] for key in ("button.background", "focusBorder", "activityBarBadge.background") if key in colours and alpha(colours[key]) > 0.6), None)
                found[label.lower()] = {
                    "label": label, "kind": kind, "source": "VS Code", "from": origin,
                    "tokens": tokens(kind, flat(bg, defaults[0]), flat(fg, bg[:7]), {k: flat(v, bg[:7]) for k, v in ansi.items()},
                                     bg2=flat(side, bg[:7]) if side and flat(side, bg[:7]) != bg[:7].lower() else None,
                                     accent=flat(accent, bg[:7]) if accent else None, selection=colours.get("editor.selectionBackground")),
                }
    return sorted(found.values(), key=lambda item: (item["kind"] != "dark", item["label"].lower()))


# Starship

def starship_preset(name: str) -> str | None:
    binary = shutil.which("starship")
    if not binary:
        return None
    result = subprocess.run([binary, "preset", name], capture_output=True, text=True, check=False)
    return result.stdout if result.returncode == 0 else None


def starship_themes() -> list[dict[str, Any]]:
    themes: list[dict[str, Any]] = []

    def add(label: str, kind: str, preset: str, **palette: Any) -> None:
        themes.append({"label": label, "kind": kind, "source": "Starship", "from": f"the {preset} preset", "tokens": tokens(kind, **palette)})

    text = starship_preset("catppuccin-powerline")
    if text:
        names = {"catppuccin_mocha": ("Catppuccin Mocha", "dark"), "catppuccin_macchiato": ("Catppuccin Macchiato", "dark"),
                 "catppuccin_frappe": ("Catppuccin Frappé", "dark"), "catppuccin_latte": ("Catppuccin Latte", "light")}
        for key, p in (tomllib.loads(text).get("palettes") or {}).items():
            if key in names and {"base", "text", "mauve"} <= set(p):
                add(names[key][0], names[key][1], "catppuccin-powerline", bg=p["base"], fg=p["text"], bg2=p.get("mantle"), accent=p["mauve"], accent2=p.get("sky") or p.get("teal"),
                    ansi={"red": p["red"], "green": p["green"], "yellow": p["yellow"], "blue": p["blue"], "magenta": p.get("pink", p["mauve"]), "cyan": p.get("teal", p["blue"])})
    text = starship_preset("gruvbox-rainbow")
    if text and (p := (tomllib.loads(text).get("palettes") or {}).get("gruvbox_dark")):
        # The preset has no page background of its own; it is the palette's first background, darkened.
        add("Gruvbox Rainbow", "dark", "gruvbox-rainbow", bg=mix(p["color_bg1"], "#000000", 0.3), fg=p["color_fg0"], bg2=mix(p["color_bg1"], "#000000", 0.45),
            accent=p["color_orange"], accent2=p["color_yellow"],
            ansi={"red": p["color_red"], "green": p["color_green"], "yellow": p["color_yellow"], "blue": p["color_blue"], "magenta": p["color_purple"], "cyan": p["color_aqua"]})
    text = starship_preset("tokyo-night")
    if text and all(colour in text.lower() for colour in ("#1d2230", "#212736", "#769ff0", "#e3e5e5")):
        # Background, text, and blue are the preset's. It has no other hues, so the rest are Tokyo Night's own.
        add("Tokyo Night", "dark", "tokyo-night", bg="#1d2230", fg="#e3e5e5", bg2="#171b26", accent="#769ff0", accent2="#7dcfff",
            ansi={"red": "#f7768e", "green": "#9ece6a", "yellow": "#e0af68", "blue": "#769ff0", "magenta": "#bb9af7", "cyan": "#7dcfff"})
    text = starship_preset("pastel-powerline")
    if text and all(colour in text.upper() for colour in ("#9A348E", "#DA627D", "#FCA17D", "#86BBD8", "#06969A", "#33658A")):
        # Six segment colours and no background: the page is the preset's blue, taken almost to black.
        add("Pastel Powerline", "dark", "pastel-powerline", bg=mix("#33658A", "#000000", 0.78), fg="#f1eef6", accent="#DA627D", accent2="#FCA17D",
            ansi={"red": "#DA627D", "green": "#06969A", "yellow": "#FCA17D", "blue": "#33658A", "magenta": "#9A348E", "cyan": "#86BBD8"})
    return themes


# Writing

def slug(source: str, label: str) -> str:
    plain = label.replace("é", "e").replace("+", " plus")
    return f"{source.lower().replace(' ', '')}-" + re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--list", action="store_true", help="Only print what was found")
    parser.add_argument("--skip", action="append", default=[], metavar="TEXT", help="Leave out themes whose name or extension contains this (repeatable)")
    args = parser.parse_args()

    themes = [*vscode_themes(), *starship_themes()]
    skip = [text.lower() for text in args.skip]
    themes = [theme for theme in themes if not any(text in theme["label"].lower() or text in str(theme["from"]).lower() for text in skip)]
    ids: set[str] = set()
    for theme in themes:
        theme["id"] = slug(theme["source"], theme["label"])
        if theme["id"] in ids:
            raise SystemExit(f"Two themes would both be called {theme['id']}")
        ids.add(theme["id"])
    for theme in themes:
        print(f"{theme['id']:<46} {theme['kind']:<5} {theme['label']}  ({theme['from']})")
    print(f"{len(themes)} themes")
    if args.list:
        return

    header = "Generated by scripts/import_editor_themes.py from the themes installed on this computer. Do not edit; run the script again."
    css = [f"/* {header} */\n"]
    for theme in themes:
        css.append(f"/* {theme['label']}: {theme['source']}, {theme['from']} */")
        css.append(f":root[data-theme=\"{theme['id']}\"] {{")
        css.extend(f"  {name}: {value};" for name, value in theme["tokens"].items())
        css.append("}\n")
    CSS_OUT.write_text("\n".join(css), encoding="utf-8")

    rows = [
        f"  {{ id: {json.dumps(theme['id'])}, label: {json.dumps(theme['label'], ensure_ascii=False)}, kind: {json.dumps(theme['kind'])}, source: {json.dumps(theme['source'])}, "
        f"swatches: {json.dumps([theme['tokens'][f'--ansi-{name}'] for name in ANSI])} }},"
        for theme in themes
    ]
    TS_OUT.write_text(
        f"// {header}\n\n/** Themes imported from VS Code and Starship. Their colours are in themes.generated.css. */\n"
        "export const GENERATED_THEMES = [\n" + "\n".join(rows) + "\n] as const;\n", encoding="utf-8")
    JSON_OUT.write_text(json.dumps({
        "dark": [theme["id"] for theme in themes if theme["kind"] == "dark"],
        "light": [theme["id"] for theme in themes if theme["kind"] == "light"],
    }, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {CSS_OUT.relative_to(REPO)}, {TS_OUT.relative_to(REPO)}, {JSON_OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
