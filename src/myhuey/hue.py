"""Client for the local REST API of a Philips Hue bridge (the /api/<username>/... resources)."""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

import requests

from .color import build_hue_state
from .errors import BridgeCertificateError, BridgeUnreachable, HueApiError, LinkButtonNotPressed
from .tls import pin_path, pinned_session

DISCOVERY_URL = "https://discovery.meethue.com"
PAIRING_WINDOW = 30.0
COLLECTIONS = (
    "lights",
    "groups",
    "scenes",
    "sensors",
    "rules",
    "schedules",
    "resourcelinks",
    "capabilities",
    "config",
)

_SEGMENT = re.compile(r"[A-Za-z0-9_-]+")


def _segment(value: Any) -> str:
    text = str(value)
    if not _SEGMENT.fullmatch(text):
        raise ValueError(f"Invalid Hue API path segment: {text!r}")
    return text


def _first_error(payload: Any) -> HueApiError | None:
    for item in payload if isinstance(payload, list) else []:
        error = item.get("error") if isinstance(item, dict) else None
        if isinstance(error, dict):
            return HueApiError(
                int(error.get("type", 0)),
                str(error.get("description", "unknown error")),
                str(error.get("address", "")),
            )
    return None


def _registered_username(payload: Any) -> str | None:
    for item in payload if isinstance(payload, list) else []:
        success = item.get("success") if isinstance(item, dict) else None
        if isinstance(success, dict) and success.get("username"):
            return str(success["username"])
    return None


def _exchange(
    session: Any,
    method: str,
    url: str,
    *,
    host: str,
    port: int,
    cert_dir: str | Path | None,
    timeout: float,
    error_body_ok: bool = False,
    **kwargs: Any,
) -> Any:
    """Send one request and return the decoded JSON.

    Errors are re-raised without the URL or headers, because they carry the username.
    With `error_body_ok`, a 4xx answer is decoded too (the v2 API explains errors in its body).
    """
    try:
        response = session.request(method, url, timeout=timeout, **kwargs)
        if not (error_body_ok and 400 <= response.status_code < 500):
            response.raise_for_status()
    except requests.exceptions.SSLError as exc:
        if "fingerprint" not in str(exc).lower():
            raise BridgeUnreachable(f"Cannot reach the Hue bridge at {host}:{port} (TLS handshake failed).") from None
        raise BridgeCertificateError(
            f"The bridge at {host} presented a certificate that differs from the pinned one "
            f"({pin_path(host, port, cert_dir)}). If the bridge was replaced or reset, delete that file "
            f"and run `myhuey bridge setup --force`."
        ) from None
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "an error"
        raise BridgeUnreachable(f"The Hue bridge at {host} answered with HTTP {status}.") from None
    except requests.exceptions.RequestException as exc:
        raise BridgeUnreachable(f"Cannot reach the Hue bridge at {host}:{port} ({type(exc).__name__}).") from None

    try:
        return response.json()
    except ValueError:
        raise BridgeUnreachable(f"The device at {host} did not answer like a Hue bridge.") from None


def _clip_error(payload: Any) -> HueApiError | None:
    errors = payload.get("errors") if isinstance(payload, dict) else None
    if errors:
        description = "; ".join(str(item.get("description", "error")) for item in errors if isinstance(item, dict))
        return HueApiError(0, description or "unknown error")
    if not isinstance(payload, dict):
        return HueApiError(0, "unexpected answer from the v2 API")
    return None


class HueBridgeClient:
    """Talk to one bridge as one registered user.

        client = HueBridgeClient("192.168.1.50", username)
        client.collection("lights")                      # GET  /lights
        client.resource("groups", "1")                   # GET  /groups/1
        client.resource("lights", "3", action="state", method="PUT", payload={"on": True})
        client.set_light_color("3", color="#ff8000", brightness=180)

    The bridge certificate is pinned on first contact and checked on every request.
    """

    def __init__(
        self,
        bridge_ip: str,
        username: str,
        *,
        session: Any = None,
        cert_dir: str | Path | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.bridge_ip, self.port = self.normalize_bridge_endpoint(bridge_ip)
        self.username = username
        self.base_url = f"https://{self.bridge_ip}:{self.port}/api/{username}"
        self.timeout = timeout
        self._cert_dir = cert_dir
        self._session = session

    def __repr__(self) -> str:
        return f"HueBridgeClient({self.bridge_ip!r})"

    @staticmethod
    def normalize_bridge_endpoint(bridge_ip: str) -> tuple[str, int]:
        """Split a bridge address into (host, port).

        Accepts a host, host:port, host/port, or an https URL. The port defaults to 443.
        """
        value = str(bridge_ip or "").strip()
        if not value:
            raise ValueError("bridge_ip is required")
        if "://" not in value:
            host, _, tail = value.partition("/")
            value = f"https://{host}:{tail}" if tail.isdigit() else f"https://{value}"

        parsed = urlsplit(value)
        try:
            host, port = parsed.hostname, parsed.port
        except ValueError:
            host = None
        if parsed.scheme != "https" or not host:
            raise ValueError(f"Not a valid Hue bridge address: {bridge_ip!r} (the bridge is reached over HTTPS)")
        return host, port or 443

    @staticmethod
    def discover_bridges() -> list[dict[str, Any]]:
        """Ask the Hue discovery service which bridges are on this network."""
        try:
            response = requests.get(DISCOVERY_URL, timeout=10)
            response.raise_for_status()
            payload = response.json()
        except (requests.exceptions.RequestException, ValueError) as exc:
            raise BridgeUnreachable(
                f"Hue bridge discovery failed ({type(exc).__name__}). Give the bridge address directly instead."
            ) from None
        return payload if isinstance(payload, list) else []

    @staticmethod
    def register_user(
        bridge_ip: str,
        app_name: str = "myhuey",
        *,
        window: float = PAIRING_WINDOW,
        interval: float = 1.0,
        on_wait: Callable[[float], None] | None = None,
        session: Any = None,
        cert_dir: str | Path | None = None,
    ) -> str:
        """Pair with the bridge and return the new username.

        The bridge only agrees after its link button is pressed, so this asks every
        `interval` seconds for up to `window` seconds. `on_wait` is called with the
        seconds left before each wait. Raises LinkButtonNotPressed when time runs out.
        """
        host, port = HueBridgeClient.normalize_bridge_endpoint(bridge_ip)
        session = session or pinned_session(host, port, cert_dir=cert_dir)
        url = f"https://{host}:{port}/api"
        payload = {"devicetype": f"{app_name[:20]}#{app_name[:19]}"}

        deadline = time.monotonic() + window
        while True:
            result = _exchange(
                session, "POST", url, host=host, port=port, cert_dir=cert_dir, timeout=10.0, json=payload
            )
            username = _registered_username(result)
            if username:
                return username

            error = _first_error(result)
            if error is None:
                raise BridgeUnreachable(f"The device at {host} did not answer like a Hue bridge.")
            if error.type != HueApiError.LINK_BUTTON_NOT_PRESSED:
                raise error

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise LinkButtonNotPressed(host, window)
            if on_wait:
                on_wait(remaining)
            time.sleep(min(interval, remaining))

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        """Call a path under /api/<username>. Raises HueApiError if the bridge reports an error."""
        if self._session is None:
            self._session = pinned_session(self.bridge_ip, self.port, cert_dir=self._cert_dir)
        result = _exchange(
            self._session,
            method.upper(),
            f"{self.base_url}{path}",
            host=self.bridge_ip,
            port=self.port,
            cert_dir=self._cert_dir,
            timeout=timeout or self.timeout,
            params=params,
            json=payload,
        )
        error = _first_error(result)
        if error:
            raise error
        return result

    def collection(self, collection_name: str, *, params: dict[str, Any] | None = None) -> Any:
        """Read a whole collection, for example "lights" or "groups". See COLLECTIONS."""
        return self.request("GET", f"/{_segment(collection_name)}", params=params)

    def resource(
        self,
        collection_name: str,
        resource_id: str,
        *,
        action: str | None = None,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Read or change one resource, for example resource("lights", "3", action="state", method="PUT", ...)."""
        path = f"/{_segment(collection_name)}/{_segment(resource_id)}"
        if action:
            path = f"{path}/{_segment(action)}"
        return self.request(method, path, params=params, payload=payload)

    def get_lights(self) -> dict[str, Any]:
        return self.collection("lights")

    def get_light(self, light_id: str) -> dict[str, Any]:
        return self.resource("lights", light_id)

    def set_light_state(self, light_id: str, state: dict[str, Any]) -> Any:
        """Send a raw Hue state body, for example {"on": True, "bri": 200}."""
        return self.resource("lights", light_id, action="state", method="PUT", payload=state)

    def set_light_color(
        self,
        light_id: str,
        *,
        color: str | tuple[float, ...] | None = None,
        rgb: tuple[int, int, int] | None = None,
        xy: tuple[float, float] | None = None,
        brightness: float | None = None,
        on: bool | None = None,
        color_temp: float | None = None,
    ) -> Any:
        """Change a light with friendly values: a hex color, 1-254 brightness, Kelvin color temperature."""
        state = build_hue_state(on=on, brightness=brightness, color=color, rgb=rgb, xy=xy, color_temp=color_temp)
        if not state:
            raise ValueError("No light changes were given")
        return self.set_light_state(light_id, state)

    def get_groups(self) -> dict[str, Any]:
        return self.collection("groups")

    def get_group(self, group_id: str) -> dict[str, Any]:
        return self.resource("groups", group_id)

    def get_scenes(self) -> dict[str, Any]:
        return self.collection("scenes")

    def get_sensors(self) -> dict[str, Any]:
        return self.collection("sensors")

    def get_config(self) -> dict[str, Any]:
        return self.collection("config")

    # Hue API v2 (CLIP). The v1 username doubles as the v2 application key.

    def clip(self, method: str, resource: str, resource_id: str | None = None, payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Call /clip/v2/resource/<resource>[/<id>] and return its `data` list."""
        if self._session is None:
            self._session = pinned_session(self.bridge_ip, self.port, cert_dir=self._cert_dir)
        path = f"/clip/v2/resource/{_segment(resource)}"
        if resource_id:
            path = f"{path}/{_segment(resource_id)}"
        result = _exchange(
            self._session,
            method.upper(),
            f"https://{self.bridge_ip}:{self.port}{path}",
            host=self.bridge_ip,
            port=self.port,
            cert_dir=self._cert_dir,
            timeout=self.timeout,
            error_body_ok=True,
            headers={"hue-application-key": self.username},
            json=payload,
        )
        error = _clip_error(result)
        if error:
            raise error
        data = result.get("data")
        return data if isinstance(data, list) else []

    def get_v2_lights(self) -> list[dict[str, Any]]:
        return self.clip("GET", "light")

    def set_v2_light(self, light_rid: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        """Send a v2 light update, for example {"gradient": {"points": [...]}}."""
        return self.clip("PUT", "light", light_rid, body)
