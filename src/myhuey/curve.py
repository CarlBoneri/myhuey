"""The time-of-day baseline for white light: how warm and how bright, from the user's day.

The curve is anchored to the wake time and bedtime in the preferences, not to the sun, so a
coder who sleeps at 3 a.m. winds down before 3 a.m. Kelvin is interpolated in mirek
(1,000,000 / K), which is perceptually more even than kelvin itself.
"""

from __future__ import annotations

from datetime import time

DAY = 24 * 60

# (minutes from wake, or from bed when `from_bed`), kelvin, brightness %
_FROM_WAKE = [(0, 3000, 60.0), (60, 5000, 100.0)]
_FROM_BED = [(-240, 5000, 100.0), (-120, 3000, 70.0), (0, 2400, 40.0), (60, 2200, 25.0)]


def _minutes(value: time | str) -> int:
    if isinstance(value, str):
        hours, minutes = value.split(":")
        return int(hours) * 60 + int(minutes)
    return value.hour * 60 + value.minute


def _day_length(wake: str, bed: str) -> int:
    return (_minutes(bed) - _minutes(wake)) % DAY or DAY


def _anchors(wake: str, bed: str) -> list[tuple[int, int, float]]:
    """Anchor points in minutes since wake, kept in order even on a very short day."""
    day = _day_length(wake, bed)
    points = list(_FROM_WAKE) + [(day + offset, kelvin, level) for offset, kelvin, level in _FROM_BED]
    ordered, last = [], 0
    for position, kelvin, level in points:
        last = min(DAY, max(last, position))
        ordered.append((last, kelvin, level))
    if ordered[-1][0] < DAY:
        ordered.append((DAY, ordered[-1][1], ordered[-1][2]))
    return ordered


def baseline(at: time, wake: str, bed: str) -> tuple[int, float]:
    """(kelvin, brightness %) for white light at `at`, for someone with this wake time and bedtime."""
    now = (_minutes(at) - _minutes(wake)) % DAY
    anchors = _anchors(wake, bed)
    for (start, k0, b0), (end, k1, b1) in zip(anchors, anchors[1:]):
        if start <= now < end:
            share = (now - start) / (end - start)
            mirek = 1e6 / k0 + (1e6 / k1 - 1e6 / k0) * share
            return round(1e6 / mirek), round(b0 + (b1 - b0) * share, 1)
    _, kelvin, level = anchors[-1]
    return kelvin, level


def minutes_until_bed(at: time, wake: str, bed: str) -> int | None:
    """Minutes left before bedtime, or None once bedtime has passed (until the next wake)."""
    now = (_minutes(at) - _minutes(wake)) % DAY
    day = _day_length(wake, bed)
    return day - now if now <= day else None


def minutes_since_wake(at: time, wake: str) -> int:
    """Minutes since the last wake time."""
    return (_minutes(at) - _minutes(wake)) % DAY
