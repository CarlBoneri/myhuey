"""The app's colour theme is a preference, shared by the web app and the CLI."""

import pytest

from myhuey.preferences import merged
from myhuey.service import HueRoomService


def test_theme_defaults_to_dark():
    assert merged({})["theme"] == "dark"


def test_theme_can_be_light_or_system(db_path):
    service = HueRoomService(db_path)
    assert service.update_preferences({"theme": "light"})["theme"] == "light"
    assert service.update_preferences({"theme": "system"})["theme"] == "system"


def test_unknown_theme_is_refused(db_path):
    with pytest.raises(ValueError):
        HueRoomService(db_path).update_preferences({"theme": "neon"})
