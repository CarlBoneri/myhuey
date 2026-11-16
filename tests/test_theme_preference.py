"""The app's colour theme is a preference, shared by the web app and the CLI."""

import pytest

from myhuey.cli import main
from myhuey.preferences import merged, parse_value
from myhuey.service import HueRoomService

THEMES = ["neon", "monokai", "dracula", "nord", "graphite", "solarized-light", "light"]


def test_theme_defaults_to_neon():
    prefs = merged({})
    assert (prefs["theme"], prefs["theme_dark"], prefs["theme_light"], prefs["reduce_transparency"]) == ("neon", "neon", "light", "auto")


@pytest.mark.parametrize("theme", [*THEMES, "system"])
def test_every_theme_can_be_chosen(db_path, theme):
    assert HueRoomService(db_path).update_preferences({"theme": theme})["theme"] == theme


def test_an_old_dark_or_unknown_theme_reads_as_neon():
    assert merged({"theme": "dark"})["theme"] == "neon"
    assert merged({"theme": "bogus"})["theme"] == "neon"


def test_each_mode_takes_only_its_own_kind(db_path):
    service = HueRoomService(db_path)
    assert service.update_preferences({"theme_dark": "dracula", "theme_light": "solarized-light"})["theme_dark"] == "dracula"
    with pytest.raises(ValueError):
        service.update_preferences({"theme_dark": "light"})
    with pytest.raises(ValueError):
        service.update_preferences({"theme_light": "neon"})


def test_reduce_transparency_takes_auto_on_off(db_path):
    service = HueRoomService(db_path)
    for value in ("on", "off", "auto"):
        assert service.update_preferences({"reduce_transparency": value})["reduce_transparency"] == value


def test_the_cli_sets_words_as_words_for_word_preferences(db_path, capsys):
    assert parse_value("on", "reduce_transparency") == "on"
    assert parse_value("on", "room_sliders") is True
    for key, value in (("theme", "dracula"), ("reduce_transparency", "on")):
        with pytest.raises(SystemExit) as caught:
            main(["--db", db_path, "prefs", "set", "--key", key, "--value", value])
        assert caught.value.code == 0
    prefs = HueRoomService(db_path).preferences()
    assert (prefs["theme"], prefs["reduce_transparency"]) == ("dracula", "on")
