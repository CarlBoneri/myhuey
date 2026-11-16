"""The theme importer's colour rules that do not depend on what is installed on this computer."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "import_editor_themes.py"
spec = importlib.util.spec_from_file_location("import_editor_themes", SCRIPT)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


@pytest.mark.parametrize("colour, slot", [
    ("#ffbeb8", "red"), ("#fcdfad", "yellow"), ("#79c3a4", "green"),
    ("#b0f4fd", "cyan"), ("#61afef", "blue"), ("#c2adfc", "blue"), ("#fcade7", "magenta"), ("#e05561", "red"),
])
def test_each_colour_lands_in_one_terminal_hue(colour, slot):
    assert importer.hue_slot(colour) == slot


def test_greys_are_not_hues():
    assert importer.hue_saturation("#abb2bf")[1] < importer.VIVID < importer.hue_saturation("#fcade7")[1]
    assert importer.hue_saturation("#808080") == (0.0, 0.0)


def test_syntax_palette_takes_the_most_used_colour_for_each_hue():
    theme = {"tokenColors": [
        {"scope": ["a", "b", "c"], "settings": {"foreground": "#C2ADFC"}},        # lavender, 3 scopes
        {"scope": "keyword", "settings": {"foreground": "#61afef"}},              # a blue used less: loses the slot
        {"scope": ["d", "e"], "settings": {"foreground": "#fcade7ff"}},           # pink, with an alpha suffix
        {"scope": ["f"], "settings": {"foreground": "#abb2bf"}},                  # grey: ignored
        {"scope": ["g"], "settings": {"fontStyle": "italic"}},                    # no colour
        {"scope": ["h"], "settings": {"foreground": "red"}},                      # not a hex colour
        "junk",
    ]}
    palette = importer.syntax_palette(theme)
    assert palette == {"ansi": {"blue": "#c2adfc", "magenta": "#fcade7"}, "accents": ["#c2adfc", "#fcade7"]}
    assert importer.syntax_palette({}) == {"ansi": {}, "accents": []}
