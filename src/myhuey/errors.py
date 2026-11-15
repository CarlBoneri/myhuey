from __future__ import annotations


class HueError(RuntimeError):
    """Base class for every error myhuey raises on purpose."""


class BridgeNotConfigured(HueError):
    def __init__(self) -> None:
        super().__init__("No Hue bridge is configured. Run `myhuey bridge setup` to pair one.")


class BridgeUnreachable(HueError):
    """The bridge did not answer, or what answered is not a Hue bridge."""


class BridgeCertificateError(HueError):
    """The bridge presented a certificate other than the pinned one."""


class RoomNotFound(HueError, LookupError):
    def __init__(self, name: str) -> None:
        super().__init__(f"Room '{name}' not found")


class HueApiError(HueError):
    """An error entry returned by the Hue API itself."""

    UNAUTHORIZED = 1
    NOT_AVAILABLE = 3
    LINK_BUTTON_NOT_PRESSED = 101

    def __init__(self, error_type: int, description: str, address: str = "") -> None:
        self.type = error_type
        self.description = description
        self.address = address
        super().__init__(f"Hue bridge error {error_type}: {description}")


class LinkButtonNotPressed(HueError):
    def __init__(self, bridge_ip: str, window: float) -> None:
        self.bridge_ip = bridge_ip
        self.window = window
        super().__init__(
            f"The link button on the bridge at {bridge_ip} was not pressed within {window:.0f} seconds. "
            f"Press the round button on that bridge, then try again."
        )


class SceneNotFound(HueError, LookupError):
    def __init__(self, key: str) -> None:
        super().__init__(f"Scene '{key}' not found")
