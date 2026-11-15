"""Built-in modes: what the user is doing, and how that shapes a suggested scene.

Modes are data, so user-defined modes can later be added as more rows.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Mode:
    name: str
    focus: str  # "desk", "read", or "sofa" (see roles.find_focus)
    brightness: float = 1.0  # multiplies the time-of-day brightness
    kelvin_offset: int = 0
    task_brightness: float = 1.0  # extra multiplier at the task light
    task_min_kelvin: int = 0  # the task light is never warmer than this
    color_strength: float = 0.5  # 0 = all white, 1 = full palette color on ambient lights
    bias: bool = False  # light the bias light behind the screen
    ambient_only: bool = False  # only ambient lights carry palette color
    prefers: tuple[str, ...] = ()  # palette tags that suit the mode

    @property
    def title(self) -> str:
        return self.name.capitalize()


MODES: dict[str, Mode] = {
    mode.name: mode
    for mode in (
        Mode("code", "desk", brightness=0.8, color_strength=0.6, bias=True, prefers=("muted", "analogous")),
        Mode("work", "desk", brightness=1.0, color_strength=0.5, bias=True, prefers=("muted", "analogous")),
        Mode("study", "desk", brightness=1.1, color_strength=0.35, ambient_only=True, prefers=("muted",)),
        Mode("read", "read", task_brightness=1.2, task_min_kelvin=4000, color_strength=0.4, prefers=("warm", "muted")),
        Mode("relax", "sofa", brightness=0.7, kelvin_offset=-500, color_strength=1.0, prefers=("warm", "vivid", "accent")),
    )
}


def get_mode(name: str) -> Mode:
    if name not in MODES:
        raise ValueError(f"Mode must be one of {', '.join(MODES)}")
    return MODES[name]
