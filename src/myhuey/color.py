"""Color conversions between what people pick (hex, RGB, Kelvin) and what Hue stores (CIE xy, mired)."""

from __future__ import annotations

import math
from typing import Any, Iterable

DEFAULT_WHITE_XY = (0.3227, 0.329)
MIRED_RANGE = (153, 500)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _channels(values: Iterable[float], count: int, what: str) -> tuple[float, ...]:
    channels = tuple(float(value) for value in values)
    if len(channels) != count:
        raise ValueError(f"{what} must contain exactly {count} values")
    return channels


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(character * 2 for character in text)
    if len(text) != 6:
        raise ValueError("Hex color must be in #RRGGBB format")
    try:
        return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
    except ValueError:
        raise ValueError(f"Invalid hex color: {value!r}") from None


def rgb_to_hex(rgb: Iterable[float]) -> str:
    return "#" + "".join(f"{int(round(clamp(channel, 0, 255))):02x}" for channel in _channels(rgb, 3, "RGB colors"))


def _to_linear(channel: float) -> float:
    value = clamp(channel, 0, 255) / 255.0
    return ((value + 0.055) / 1.055) ** 2.4 if value > 0.04045 else value / 12.92


def _from_linear(value: float) -> float:
    return 12.92 * value if value <= 0.0031308 else 1.055 * (value ** (1.0 / 2.4)) - 0.055


def rgb_to_xy(rgb: Iterable[float]) -> tuple[float, float]:
    """Convert sRGB to CIE xy with the wide-gamut D65 matrix Philips recommends for Hue."""
    red, green, blue = (_to_linear(channel) for channel in _channels(rgb, 3, "RGB colors"))
    x = red * 0.664511 + green * 0.154324 + blue * 0.162028
    y = red * 0.283881 + green * 0.668433 + blue * 0.047685
    z = red * 0.000088 + green * 0.072310 + blue * 0.986039
    total = x + y + z
    if total == 0:
        return DEFAULT_WHITE_XY
    return (round(x / total, 4), round(y / total, 4))


def xy_to_rgb(xy: Iterable[float]) -> tuple[int, int, int]:
    """Convert CIE xy to sRGB at full brightness. Hue tracks brightness separately."""
    x_value, y_value = _channels(xy, 2, "XY colors")
    if y_value <= 0:
        raise ValueError("The y coordinate must be greater than zero")

    x = x_value / y_value
    z = (1.0 - x_value - y_value) / y_value
    linear = (
        x * 1.656492 - 0.354851 - z * 0.255038,
        -x * 0.707196 + 1.655397 + z * 0.036152,
        x * 0.051713 - 0.121364 + z * 1.011530,
    )
    linear = tuple(max(channel, 0.0) for channel in linear)
    peak = max(linear)
    if peak == 0:
        return (0, 0, 0)
    return tuple(int(round(clamp(_from_linear(channel / peak), 0.0, 1.0) * 255)) for channel in linear)


def xy_to_hex(xy: Iterable[float]) -> str:
    return rgb_to_hex(xy_to_rgb(xy))


def color_temperature_to_mired(temperature_k: float) -> int:
    if temperature_k <= 0:
        raise ValueError("Color temperature must be greater than zero")
    return int(round(1000000.0 / temperature_k))


def mired_to_color_temperature(mired: float) -> int:
    """Kelvin for a mired value, rounded to the nearest 100 K."""
    if mired <= 0:
        raise ValueError("Mired value must be greater than zero")
    return int(round((1000000.0 / mired) / 100.0) * 100)


def color_temperature_to_rgb(temperature_k: float) -> tuple[int, int, int]:
    """Approximate the sRGB color of white light at a color temperature (Tanner Helland's fit)."""
    value = clamp(temperature_k, 1000, 40000) / 100.0
    if value <= 66:
        red = 255.0
        green = 99.4708025861 * math.log(value) - 161.1195681661
    else:
        red = 329.698727446 * ((value - 60) ** -0.1332047592)
        green = 288.1221695283 * ((value - 60) ** -0.0755148492)
    if value >= 66:
        blue = 255.0
    elif value <= 19:
        blue = 0.0
    else:
        blue = 138.5177312231 * math.log(value - 10) - 305.0447927307
    return tuple(int(round(clamp(channel, 0, 255))) for channel in (red, green, blue))


def light_state_to_hex(state: dict[str, Any]) -> str | None:
    """The color a light is showing, from the `state` object the bridge reports. None if it reports none."""
    xy, mired = state.get("xy"), state.get("ct")
    use_temperature = bool(mired) and (state.get("colormode") == "ct" or not xy)
    try:
        if use_temperature:
            return rgb_to_hex(color_temperature_to_rgb(1000000.0 / float(mired)))
        if xy:
            return xy_to_hex(xy)
    except (TypeError, ValueError):
        return None
    return None


def normalize_hue_color(value: str | Iterable[float] | None) -> tuple[float, float] | None:
    """Turn a hex string, an RGB triple, or an xy pair into an xy pair."""
    if value is None:
        return None
    if isinstance(value, str):
        return rgb_to_xy(hex_to_rgb(value))
    channels = tuple(float(item) for item in value)
    if len(channels) == 3:
        return rgb_to_xy(channels)
    if len(channels) == 2:
        return (clamp(channels[0], 0.0, 1.0), clamp(channels[1], 0.0, 1.0))
    raise ValueError("Unsupported Hue color value")


def build_hue_state(
    *,
    on: bool | None = None,
    brightness: float | None = None,
    color: str | Iterable[float] | None = None,
    rgb: Iterable[float] | None = None,
    xy: Iterable[float] | None = None,
    color_temp: float | None = None,
    hue: int | None = None,
    sat: int | None = None,
) -> dict[str, Any]:
    """Build the body for a Hue `state` update from friendly values.

    `color` takes a hex string, an RGB triple, or an xy pair. `color_temp` takes
    Kelvin (above 1000) or mired. Anything left as None is not sent.
    """
    state: dict[str, Any] = {}

    if on is not None:
        state["on"] = bool(on)
    if brightness is not None:
        state["bri"] = int(clamp(float(brightness), 1, 254))

    chosen = color if color is not None else rgb if rgb is not None else xy
    if chosen is not None:
        state["xy"] = list(normalize_hue_color(chosen))

    if color_temp is not None:
        mired = color_temperature_to_mired(float(color_temp)) if float(color_temp) > 1000 else float(color_temp)
        state["ct"] = int(clamp(mired, *MIRED_RANGE))
    if hue is not None:
        state["hue"] = int(clamp(float(hue), 0, 65535))
    if sat is not None:
        state["sat"] = int(clamp(float(sat), 0, 254))

    return state
