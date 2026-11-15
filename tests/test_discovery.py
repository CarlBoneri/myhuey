"""Finding bridges as Signify recommends: mDNS on the local network first, the cloud
discovery service second (at most once per 15 minutes), merged by bridge ID."""

import struct

from myhuey import discovery


def _name(text):
    return b"".join(bytes([len(part)]) + part.encode() for part in text.split(".")) + b"\x00"


def _record(name, rtype, rdata):
    return _name(name) + struct.pack("!HHIH", rtype, 1, 120, len(rdata)) + rdata


def _answer(instance="Philips Hue - 25B8F8", bridge_id="001788fffe25b8f8", model="BSB002", compress=True):
    """An mDNS answer like a bridge sends: PTR to its instance, TXT with bridgeid and modelid."""
    service = "_hue._tcp.local"
    full = f"{instance}.{service}"
    ptr = _record(service, 12, _name(full))
    txt_data = b"".join(bytes([len(item)]) + item for item in (f"bridgeid={bridge_id}".encode(), f"modelid={model}".encode()))
    if compress:  # name compression: point back at the PTR's target name (offset 12 + len(PTR header part))
        pointer = 12 + len(_name(service)) + 10
        txt = struct.pack("!H", 0xC000 | pointer) + struct.pack("!HHIH", 16, 0x8001, 4500, len(txt_data)) + txt_data
    else:
        txt = _record(full, 16, txt_data)
    header = struct.pack("!HHHHHH", 0, 0x8400, 0, 2, 0, 0)
    return header + ptr + txt


def test_query_asks_for_hue_bridges():
    packet = discovery.mdns_query()
    assert packet[:12] == struct.pack("!HHHHHH", 0, 0, 1, 0, 0, 0)
    assert _name("_hue._tcp.local") in packet and packet.endswith(struct.pack("!HH", 12, 0x8001))


def test_parse_reads_bridge_id_model_and_name_from_an_answer():
    for compress in (True, False):
        found = discovery.parse_mdns(_answer(compress=compress), "10.0.0.93")
        assert found == {"id": "001788fffe25b8f8", "internalipaddress": "10.0.0.93", "name": "Philips Hue - 25B8F8",
                         "modelid": "BSB002", "source": "mdns"}


def test_parse_ignores_other_services_and_junk():
    assert discovery.parse_mdns(b"\x00" * 5, "10.0.0.1") is None
    other = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 0) + _record("_printer._tcp.local", 12, _name("Printer._printer._tcp.local"))
    assert discovery.parse_mdns(other, "10.0.0.1") is None
    looping = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 0) + struct.pack("!H", 0xC00C)  # a pointer to itself
    assert discovery.parse_mdns(looping, "10.0.0.1") is None


def test_cloud_discovery_is_asked_at_most_once_per_15_minutes(monkeypatch):
    calls = []
    clock = [1000.0]
    monkeypatch.setattr(discovery, "_cloud_fetch", lambda: calls.append(1) or [{"id": "abc", "internalipaddress": "10.0.0.5"}])
    monkeypatch.setattr(discovery.time, "monotonic", lambda: clock[0])
    discovery.reset_cloud_cache()
    assert discovery.cloud_bridges()[0]["source"] == "cloud"
    clock[0] += 14 * 60
    discovery.cloud_bridges()
    assert len(calls) == 1
    clock[0] += 2 * 60
    discovery.cloud_bridges()
    assert len(calls) == 2


def test_discover_merges_by_bridge_id_preferring_mdns(monkeypatch):
    monkeypatch.setattr(discovery, "mdns_bridges", lambda timeout=1.5: [
        {"id": "001788fffe25b8f8", "internalipaddress": "10.0.0.93", "name": "Philips Hue - 25B8F8", "source": "mdns"}])
    monkeypatch.setattr(discovery, "cloud_bridges", lambda: [
        {"id": "001788FFFE25B8F8", "internalipaddress": "10.0.0.93", "source": "cloud"},
        {"id": "001788fffe7a11ce", "internalipaddress": "10.0.0.77", "source": "cloud"}])
    found = discovery.discover()
    assert [(b["id"], b["source"]) for b in found] == [("001788fffe25b8f8", "mdns"), ("001788fffe7a11ce", "cloud")]


def test_discover_survives_a_failing_method(monkeypatch):
    def broken(*args, **kwargs):
        raise OSError("no multicast here")
    monkeypatch.setattr(discovery, "mdns_bridges", broken)
    monkeypatch.setattr(discovery, "cloud_bridges", lambda: [{"id": "x", "internalipaddress": "10.0.0.5", "source": "cloud"}])
    assert [b["internalipaddress"] for b in discovery.discover()] == ["10.0.0.5"]
