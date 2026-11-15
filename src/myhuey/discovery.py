"""Finding Hue bridges, in the order Signify's "Hue Bridge Discovery" guide recommends.

1. mDNS: ask the local network for `_hue._tcp.local`. Bridges answer with their bridge ID
   and model in TXT records. Local, fast, and not rate limited.
2. The cloud discovery service (https://discovery.meethue.com), which knows the bridges
   seen from this network's public address. Limited to one request per 15 minutes per
   client, so its answer is cached for that long.
3. Manual address entry, offered by the caller when both find nothing.

Plain standard library: one multicast question and a small DNS answer parser, so
installing MyHuey needs no mDNS package.
"""

from __future__ import annotations

import socket
import struct
import threading
import time
from typing import Any, Callable

from .errors import BridgeUnreachable, HueError

SERVICE = "_hue._tcp.local"
MDNS_GROUP = ("224.0.0.251", 5353)
CLOUD_TTL_SECONDS = 15 * 60  # discovery.meethue.com allows one request per 15 minutes per client
_PTR, _TXT, _IN = 12, 16, 1
_QU = 0x8000  # "unicast response" bit: older bridges (BSB002) answer a plain query only to the multicast group

_cloud_lock = threading.Lock()
_cloud_cache: tuple[float, list[dict[str, Any]] | None, str] | None = None


def _encode_name(name: str) -> bytes:
    return b"".join(bytes([len(part)]) + part.encode("utf-8") for part in name.split(".")) + b"\x00"


def mdns_query() -> bytes:
    """One question: which `_hue._tcp.local` services are here (PTR, class IN, answer me directly)."""
    return struct.pack("!HHHHHH", 0, 0, 1, 0, 0, 0) + _encode_name(SERVICE) + struct.pack("!HH", _PTR, _QU | _IN)


def _read_name(packet: bytes, offset: int) -> tuple[str, int]:
    """A DNS name at `offset`, following compression pointers. Returns (name, offset after it)."""
    labels: list[str] = []
    end = None
    for _ in range(64):  # bounds pointer loops in a hostile or broken packet
        if offset >= len(packet):
            raise ValueError("name runs past the packet")
        length = packet[offset]
        if length == 0:
            return ".".join(labels), (end if end is not None else offset + 1)
        if length & 0xC0 == 0xC0:
            if offset + 1 >= len(packet):
                raise ValueError("truncated pointer")
            if end is None:
                end = offset + 2
            offset = ((length & 0x3F) << 8) | packet[offset + 1]
            continue
        labels.append(packet[offset + 1:offset + 1 + length].decode("utf-8", "replace"))
        offset += 1 + length
    raise ValueError("name too long or looping")


def parse_mdns(packet: bytes, source_ip: str) -> dict[str, Any] | None:
    """A bridge from one mDNS answer, or None if it is not a Hue bridge answer.

    The address is the packet's source: the bridge answers for itself.
    """
    try:
        _, _, questions, answers, authority, additional = struct.unpack("!HHHHHH", packet[:12])
        offset = 12
        for _ in range(questions):
            _, offset = _read_name(packet, offset)
            offset += 4
        instance = ""
        txt: dict[str, str] = {}
        for _ in range(answers + authority + additional):
            owner, offset = _read_name(packet, offset)
            rtype, _, _, length = struct.unpack("!HHIH", packet[offset:offset + 10])
            offset += 10
            data_start, offset = offset, offset + length
            if rtype == _PTR and owner.lower() == SERVICE:
                instance = _read_name(packet, data_start)[0]
            elif rtype == _TXT and owner.lower().endswith(SERVICE):
                position = data_start
                while position < offset:
                    size = packet[position]
                    key, _, value = packet[position + 1:position + 1 + size].decode("utf-8", "replace").partition("=")
                    txt[key.lower()] = value
                    position += 1 + size
    except (ValueError, struct.error, IndexError):
        return None
    if not instance and "bridgeid" not in txt:
        return None
    return {
        "id": txt.get("bridgeid", "").lower(),
        "internalipaddress": source_ip,
        "name": instance[: -len(SERVICE) - 1] if instance.lower().endswith("." + SERVICE) else instance,
        "modelid": txt.get("modelid", ""),
        "source": "mdns",
    }


def mdns_bridges(timeout: float = 1.5) -> list[dict[str, Any]]:
    """Ask the local network for Hue bridges and collect answers for `timeout` seconds.

    The question goes out from an ordinary port, so bridges answer straight back to it
    (a "legacy unicast" query); nothing needs to listen on port 5353.
    """
    found: dict[str, dict[str, Any]] = {}
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
        sock.settimeout(0.25)
        sock.sendto(mdns_query(), MDNS_GROUP)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                packet, (address, _) = sock.recvfrom(9000)
            except socket.timeout:
                continue
            bridge = parse_mdns(packet, address)
            if bridge:
                found[bridge["id"] or address] = bridge
    return list(found.values())


def _cloud_fetch() -> list[dict[str, Any]]:
    from .hue import HueBridgeClient

    return HueBridgeClient.discover_bridges()


def reset_cloud_cache() -> None:
    global _cloud_cache
    with _cloud_lock:
        _cloud_cache = None


def cloud_bridges() -> list[dict[str, Any]]:
    """Bridges the cloud service knows for this network, asked at most once per 15 minutes.
    A failed request counts too: its error is repeated, not the request, until 15 minutes pass."""
    global _cloud_cache
    with _cloud_lock:
        if _cloud_cache and time.monotonic() - _cloud_cache[0] < CLOUD_TTL_SECONDS:
            if _cloud_cache[1] is None:
                raise BridgeUnreachable(_cloud_cache[2])
            return [dict(item) for item in _cloud_cache[1]]
        try:
            raw = _cloud_fetch()
        except HueError as exc:
            _cloud_cache = (time.monotonic(), None, str(exc))
            raise
        bridges = [
            {"id": str(item.get("id") or "").lower(), "internalipaddress": str(item.get("internalipaddress") or ""),
             "name": str(item.get("name") or ""), "source": "cloud"}
            for item in raw if isinstance(item, dict) and item.get("internalipaddress")
        ]
        _cloud_cache = (time.monotonic(), bridges, "")
        return [dict(item) for item in bridges]


def discover(mdns_timeout: float = 1.5, report: Callable[[str], None] | None = None) -> list[dict[str, Any]]:
    """Every bridge found by mDNS, then by the cloud service, one entry per bridge ID.
    A method that fails (no multicast, no internet) is skipped and passed to `report`."""
    found: list[dict[str, Any]] = []
    for method in (lambda: mdns_bridges(mdns_timeout), cloud_bridges):
        try:
            results = method()
        except (OSError, HueError) as exc:
            if report:
                report(str(exc))
            continue
        for bridge in results:
            key = (bridge.get("id") or "").lower() or bridge.get("internalipaddress")
            if not any(((item.get("id") or "").lower() or item.get("internalipaddress")) == key for item in found):
                found.append(bridge)
    return found
