"""Real-world lengths. Everything is stored in centimeters; people type feet, inches, or meters."""

from __future__ import annotations

import re

CM_PER_INCH = 2.54
CM_PER_FOOT = 30.48
UNIT_SYSTEMS = ("imperial", "metric")

_FEET_INCHES = re.compile(
    r"""^\s*(?:(?P<ft>\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot))?\s*,?\s*
        (?:(?P<inch>\d+(?:\.\d+)?)\s*(?:"|''|in|inch|inches))?\s*$""",
    re.VERBOSE | re.IGNORECASE,
)
_WITH_UNIT = re.compile(r"^\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mm|cm|m)\s*$", re.IGNORECASE)
_BARE = re.compile(r"^\s*\d+(?:\.\d+)?\s*$")


def parse_length(text: str | float | int, default_unit: str = "imperial") -> float:
    """Parse a length into centimeters.

    Accepts 12'6", 12ft 6in, 12 ft, 6in, 3.5m, 350cm, 900mm. A bare number is feet
    for imperial and meters for metric.
    """
    if isinstance(text, (int, float)):
        value = float(text)
        return value * CM_PER_FOOT if default_unit == "imperial" else value * 100
    raw = str(text).strip()
    if not raw:
        raise ValueError("A length is required")
    if _BARE.match(raw):
        return parse_length(float(raw), default_unit)
    match = _WITH_UNIT.match(raw)
    if match:
        value = float(match["value"])
        return value * {"mm": 0.1, "cm": 1.0, "m": 100.0}[match["unit"].lower()]
    match = _FEET_INCHES.match(raw)
    if match and (match["ft"] or match["inch"]):
        return float(match["ft"] or 0) * CM_PER_FOOT + float(match["inch"] or 0) * CM_PER_INCH
    raise ValueError(f"Cannot read the length {raw!r}. Try 12'6\", 12ft 6in, 3.8m, or 380cm.")


def format_length(cm: float, system: str = "imperial") -> str:
    """Show a length the way people read it: 12' 6" or 3.81 m."""
    if system == "metric":
        return f"{cm / 100:.2f} m" if cm >= 100 else f"{cm:.0f} cm"
    total_inches = round(cm / CM_PER_INCH)
    feet, inches = divmod(total_inches, 12)
    if not feet:
        return f'{inches}"'
    return f"{feet}' {inches}\"" if inches else f"{feet}'"
