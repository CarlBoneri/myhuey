"""Finding a bridge and pairing with it. The CLI and the web API both call into here."""

from __future__ import annotations

import ipaddress
import math
import re
import socket
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Iterable

from .errors import BridgeCertificateError, BridgeUnreachable, HueApiError, HueError, LinkButtonNotPressed, PairingInProgress
from .hue import PAIRING_WINDOW, HueBridgeClient
from .discovery import discover
from .service import HueRoomService
from .tls import pin_certificate, pinned_bridge_id

_MAX_RANGE_SIZE = 1024
# One pairing at a time: a second request while one waits would make a second key on the bridge.
_pairing = threading.Lock()


def expand_ip_ranges(ranges: Iterable[str] | None) -> list[str]:
    """Expand addresses and CIDR ranges such as 192.168.1.0/24 into single addresses."""
    values: list[str] = []
    for raw in ranges or []:
        item = str(raw).strip()
        if not item:
            continue
        if "/" not in item:
            values.append(item)
            continue
        try:
            network = ipaddress.ip_network(item, strict=False)
        except ValueError:
            continue
        if network.num_addresses > _MAX_RANGE_SIZE:
            raise ValueError(f"The range {item} is too large. Use /22 or smaller.")
        values.append(str(network.network_address))
        values.extend(str(host) for host in network.hosts())
    return list(dict.fromkeys(values))


def candidate_bridge_ips(
    preferred_ranges: Iterable[str] | None = None,
    discovered: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Addresses to offer for pairing: the given ranges first, then discovered bridges."""
    candidates = expand_ip_ranges(preferred_ranges)
    for bridge in discovered or []:
        ip_value = bridge.get("internalipaddress") or bridge.get("ipaddress") or bridge.get("ip")
        if ip_value:
            candidates.append(str(ip_value))
    return list(dict.fromkeys(candidates))


def bridge_address(bridge_ip: str) -> str:
    """The form an address is saved and shown in: host, or host:port for a non-standard port."""
    host, port = HueBridgeClient.normalize_bridge_endpoint(bridge_ip)
    return host if port == 443 else f"{host}:{port}"


def instance_name() -> str:
    """This computer's name as the bridge's app list shows it (at most 19 characters)."""
    host = socket.gethostname().split(".")[0]
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", host).strip("-")[:19].strip("-")
    return cleaned or "computer"


def _fresh_pin(address: str, service: HueRoomService) -> None:
    """Verify the certificate at an address that is not the paired bridge, replacing any
    old pin for it. Addresses change hands (DHCP), so a pin made while browsing bridges in
    the wizard must not block pairing the bridge that has that address now. The paired
    bridge keeps its pin; a renewal there is handled by bridge ID."""
    if address != service.get_bridge().get("ip"):
        host, port = HueBridgeClient.normalize_bridge_endpoint(address)
        pin_certificate(host, port, cert_dir=service.cert_dir, replace=True)


def _save_pairing(address: str, username: str, service: HueRoomService) -> None:
    """Save the bridge with the ID its verified certificate carries, so it can be found
    again by ID if its address changes."""
    host, port = HueBridgeClient.normalize_bridge_endpoint(address)
    service.set_bridge(address, username, pinned_bridge_id(host, port, service.cert_dir))


def check_bridge(bridge_ip: str, *, service: HueRoomService) -> dict[str, Any]:
    """What the bridge at an address says about itself, before pairing: proof that it is a
    Hue bridge, which one, and whether it is the one already paired."""
    address = bridge_address(bridge_ip)
    _fresh_pin(address, service)
    config = HueBridgeClient.probe(address, cert_dir=service.cert_dir)
    host, port = HueBridgeClient.normalize_bridge_endpoint(address)
    proven = pinned_bridge_id(host, port, service.cert_dir)
    claimed = str(config.get("bridgeid") or "")
    if proven and claimed and claimed.lower() != proven:
        raise BridgeCertificateError(
            f"The bridge at {address} says it is {claimed.upper()}, which does not match its certificate ({proven.upper()})."
        )
    return {
        "bridge_ip": address,
        "name": str(config.get("name") or "Hue bridge"),
        "model": str(config.get("modelid") or ""),
        "bridge_id": proven or claimed,
        "software": str(config.get("swversion") or ""),
        "api_version": str(config.get("apiversion") or ""),
        "paired": service.get_bridge().get("ip") == address,
    }


def pair_bridge(
    bridge_ip: str,
    *,
    service: HueRoomService,
    app_name: str = "myhuey",
    window: float = PAIRING_WINDOW,
    on_wait: Callable[[float], None] | None = None,
) -> dict[str, Any]:
    """Wait for the link button, register, and save the bridge. The result never holds the username."""
    address = bridge_address(bridge_ip)
    if not _pairing.acquire(blocking=False):
        raise PairingInProgress()
    try:
        _fresh_pin(address, service)
        username = HueBridgeClient.register_user(
            address, app_name, window=window, on_wait=on_wait, cert_dir=service.cert_dir, instance=instance_name()
        )
        _save_pairing(address, username, service)
    finally:
        _pairing.release()
    return {"bridge_ip": address, "app_name": app_name, "status": "ready"}


def pair_any(
    bridge_ips: Iterable[str],
    *,
    service: HueRoomService,
    app_name: str = "myhuey",
    window: float = PAIRING_WINDOW,
) -> dict[str, Any]:
    """Wait for the link button on several bridges at once and pair whichever is pressed.

    Signify's discovery guide suggests this for homes with more than one bridge: the
    person picks a bridge by pressing its button. The others stop asking at once, and all
    stop if any fails unexpectedly.

    Known limit: if two buttons are pressed within the same second, both bridges may
    grant a key before either sees the other; only the first is saved.
    """
    addresses = list(dict.fromkeys(bridge_address(ip) for ip in bridge_ips))
    if not addresses:
        raise ValueError("Give at least one bridge address")
    if not _pairing.acquire(blocking=False):
        raise PairingInProgress()
    stop = threading.Event()
    instance = instance_name()

    def attempt(address: str) -> tuple[str, str]:
        try:
            _fresh_pin(address, service)
            username = HueBridgeClient.register_user(
                address, app_name, window=window, cert_dir=service.cert_dir, instance=instance, should_stop=stop.is_set
            )
        except LinkButtonNotPressed:
            raise
        except Exception:
            stop.set()  # something is wrong; do not leave the others waiting for 30 seconds
            raise
        stop.set()
        return address, username

    winner: tuple[str, str] | None = None
    errors: list[Exception] = []
    try:
        with ThreadPoolExecutor(max_workers=len(addresses)) as pool:
            for future in as_completed([pool.submit(attempt, address) for address in addresses]):
                try:
                    result = future.result()
                except Exception as exc:  # noqa: BLE001 - reported below
                    errors.append(exc)
                    continue
                winner = winner or result
    finally:
        stop.set()
        _pairing.release()
    if winner is None:
        # "No button was pressed" only when that is all that happened; a real fault is reported over it.
        raise next((e for e in errors if not isinstance(e, LinkButtonNotPressed)), errors[0] if errors else LinkButtonNotPressed(addresses[0], window))
    _save_pairing(winner[0], winner[1], service)
    return {"bridge_ip": winner[0], "app_name": app_name, "status": "ready"}


def _line_countdown(print_func: Callable[[str], None], every: int = 5) -> Callable[[str, float], None]:
    last: list[int] = []

    def on_wait(bridge_ip: str, remaining: float) -> None:
        seconds = math.ceil(remaining)
        if not last or last[0] - seconds >= every:
            last[:] = [seconds]
            print_func(f"  Waiting for the link button on {bridge_ip}: {seconds}s left")

    return on_wait


def _choose_bridge(
    preferred_ranges: Iterable[str] | None,
    print_func: Callable[[str], None],
    input_func: Callable[[str], str],
) -> str:
    discovered = discover(report=print_func)

    candidates = candidate_bridge_ips(preferred_ranges, discovered)
    if not candidates:
        raise ValueError(
            "No Hue bridge was found. Give its address with --bridge-ip, for example --bridge-ip 192.168.1.50."
        )
    if len(candidates) == 1:
        print_func(f"Found one Hue bridge at {candidates[0]}.")
        return candidates[0]

    print_func("Found these Hue bridges:")
    for index, candidate in enumerate(candidates, start=1):
        print_func(f"  {index}. {candidate}")
    try:
        choice = input_func("Which one should be paired? Enter a number or an address [1]: ").strip()
    except EOFError:
        choice = ""
    if not choice:
        return candidates[0]
    if choice.isdigit() and 1 <= int(choice) <= len(candidates):
        return candidates[int(choice) - 1]
    return choice


def run_setup(
    *,
    bridge_ip: str | None = None,
    app_name: str = "myhuey",
    preferred_ranges: Iterable[str] | None = None,
    storage_path: str | None = None,
    window: float = PAIRING_WINDOW,
    force: bool = False,
    print_func: Callable[[str], None] = print,
    input_func: Callable[[str], str] = input,
    on_wait: Callable[[str, float], None] | None = None,
) -> dict[str, Any]:
    """The guided path: pick a bridge, wait for its link button, save the pairing, confirm it works.

    A saved pairing that still works is kept unless `force` is set. `on_wait` receives the
    bridge address and the seconds left; by default a line is printed every five seconds.
    """
    service = HueRoomService(storage_path)
    saved = service.get_bridge()

    if saved and not force and (not bridge_ip or bridge_address(bridge_ip) == bridge_address(saved["ip"])):
        try:
            count = len(service.client().get_lights())
        except HueError as exc:
            print_func(f"The saved pairing with the bridge at {saved['ip']} no longer works: {exc}")
            if isinstance(exc, HueApiError):
                bridge_ip = bridge_ip or saved["ip"]
        else:
            print_func(
                f"The bridge at {saved['ip']} is already paired and responding ({count} lights). "
                f"Use --force to pair again."
            )
            return {"bridge_ip": saved["ip"], "app_name": app_name, "status": "already-paired", "lights": count}

    if not bridge_ip:
        bridge_ip = _choose_bridge(preferred_ranges, print_func, input_func)

    address = bridge_address(bridge_ip)
    print_func(f"Press the round link button on the Hue bridge at {address} now.")
    print_func(f"Waiting up to {window:.0f} seconds for it.")
    wait = on_wait or _line_countdown(print_func)
    result = pair_bridge(
        address,
        service=service,
        app_name=app_name,
        window=window,
        on_wait=lambda remaining: wait(address, remaining),
    )

    count = len(service.client().get_lights())
    print_func(f"Paired with the bridge at {address} and saved it to {service.storage_path}. Found {count} lights.")
    return {**result, "lights": count}
