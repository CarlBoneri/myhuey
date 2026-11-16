"""App preferences: what the screens show and how gently MyHuey talks to the bridge.

Each preference has a default and either a type (bool) or the values it may take. They
are saved in the home document, so the CLI and the web app share them.
"""

from __future__ import annotations

from typing import Any

# Times of day in 15-minute steps, "00:00" to "23:45".
QUARTER_HOURS = tuple(f"{hour:02d}:{minute:02d}" for hour in range(24) for minute in (0, 15, 30, 45))

DARK_THEMES = ("neon", "monokai", "dracula", "nord", "graphite")
LIGHT_THEMES = ("solarized-light", "light")

PREFERENCES: dict[str, tuple[Any, Any]] = {
    # Look
    # Editor-style colour themes. "system" follows the operating system, with a theme for each mode.
    "theme": ("neon", (*DARK_THEMES, *LIGHT_THEMES, "system")),
    "theme_dark": ("neon", DARK_THEMES),
    "theme_light": ("light", LIGHT_THEMES),
    # Solid panels instead of frosted glass; "auto" follows the operating system's setting.
    "reduce_transparency": ("auto", ("auto", "on", "off")),
    # Home screen
    "room_sliders": (True, bool),  # a brightness slider on each room
    "room_sliders_when_on_only": (True, bool),  # show it only while some of the room's lights are on
    "show_light_glow": (True, bool),  # the soft glow drawn around lit lights on plans
    # Bridge traffic
    "poll_seconds": (5, (0, 2, 5, 10, 30)),  # how often the app reads light states; 0 = only on demand
    # Gap between light commands. Signify advises about 10 per second (100 ms) and less when
    # other apps or switches share the bridge.
    "command_gap_ms": (100, (100, 150, 200, 300)),
    # New rooms
    "default_units": ("imperial", ("imperial", "metric")),
    # Your day, which suggested scenes read the clock against
    "wake_time": ("07:00", QUARTER_HOURS),
    "bed_time": ("23:00", QUARTER_HOURS),
}


def merged(saved: Any) -> dict[str, Any]:
    """Every preference, with saved values where they are still valid."""
    values = {key: default for key, (default, _) in PREFERENCES.items()}
    if isinstance(saved, dict):
        for key, value in saved.items():
            if key in PREFERENCES and _valid(key, value):
                values[key] = value
    return values


def chosen(saved: Any) -> dict[str, Any]:
    """Only the saved preferences that are still known, valid, and not the default: what the user chose.

    Defaults are never stored, so a better default later reaches everyone who left it alone.
    That includes copies of defaults older versions saved: they are dropped here too.
    """
    if not isinstance(saved, dict):
        return {}
    return {
        key: value for key, value in saved.items()
        if key in PREFERENCES and _valid(key, value) and value != PREFERENCES[key][0]
    }


def _valid(key: str, value: Any) -> bool:
    _, allowed = PREFERENCES[key]
    if allowed is bool:
        return isinstance(value, bool)
    return value in allowed and type(value) is type(allowed[0])


def validate(changes: dict[str, Any]) -> dict[str, Any]:
    for key, value in changes.items():
        if key not in PREFERENCES:
            raise ValueError(f"Unknown preference '{key}'. Known: {', '.join(PREFERENCES)}")
        if not _valid(key, value):
            _, allowed = PREFERENCES[key]
            expected = "true or false" if allowed is bool else ", ".join(str(item) for item in allowed)
            raise ValueError(f"Preference '{key}' takes {expected}")
    return dict(changes)


def parse_value(text: str, key: str | None = None) -> Any:
    """A preference value typed on the command line. Words stay words for a preference that takes
    words, so `reduce_transparency on` means "on", not true."""
    lowered = text.strip().lower()
    if key in PREFERENCES:
        _, allowed = PREFERENCES[key]
        if allowed is not bool and isinstance(allowed[0], str):
            return text.strip()
    if lowered in ("true", "on", "yes"):
        return True
    if lowered in ("false", "off", "no"):
        return False
    return int(lowered) if lowered.lstrip("-").isdigit() else text.strip()
