"""Certificate pinning, tested against a real TLS server on localhost."""

import json
import shutil
import ssl
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from myhuey import tls
from myhuey.errors import BridgeCertificateError, BridgeUnreachable
from myhuey.hue import HueBridgeClient

from conftest import USERNAME

REAL_FETCH_CERTIFICATE = tls.fetch_certificate

pytestmark = pytest.mark.skipif(shutil.which("openssl") is None, reason="needs the openssl command")


def _self_signed(directory, name):
    cert, key = directory / f"{name}.pem", directory / f"{name}.key"
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
            "-nodes", "-days", "1", "-subj", f"/CN={name}", "-keyout", str(key), "-out", str(cert),
        ],
        check=True,
        capture_output=True,
    )
    return cert, key


@pytest.fixture
def tls_bridge(tmp_path, monkeypatch):
    """A local HTTPS server with a self-signed certificate, like a Hue bridge has."""
    monkeypatch.setattr("myhuey.tls.fetch_certificate", REAL_FETCH_CERTIFICATE)
    cert, key = _self_signed(tmp_path, "bridge")
    requests_seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests_seen.append(self.path)
            body = json.dumps({"1": {"name": "Lamp", "state": {"on": True}}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    server.cert_pem = cert.read_text(encoding="ascii")
    server.requests_seen = requests_seen
    server.cert_dir = tmp_path / "certs"
    yield server
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def test_first_contact_pins_the_certificate_and_later_calls_verify_it(tls_bridge, monkeypatch):
    port = tls_bridge.server_port
    client = HueBridgeClient(f"127.0.0.1:{port}", USERNAME, cert_dir=tls_bridge.cert_dir)

    assert client.get_lights()["1"]["name"] == "Lamp"

    pin = tls.pin_path("127.0.0.1", port, tls_bridge.cert_dir)
    assert tls.fingerprint(pin.read_text(encoding="ascii")) == tls.fingerprint(tls_bridge.cert_pem)

    def refuse(*args, **kwargs):
        raise AssertionError("the certificate was fetched again instead of using the pin")

    monkeypatch.setattr("myhuey.tls.fetch_certificate", refuse)
    again = HueBridgeClient(f"127.0.0.1:{port}", USERNAME, cert_dir=tls_bridge.cert_dir)
    assert again.get_lights()["1"]["name"] == "Lamp"


def test_a_different_certificate_is_refused_before_any_request_is_sent(tls_bridge, tmp_path):
    port = tls_bridge.server_port
    other_cert, _ = _self_signed(tmp_path, "impostor")
    pin = tls.pin_path("127.0.0.1", port, tls_bridge.cert_dir)
    pin.parent.mkdir(parents=True)
    pin.write_text(other_cert.read_text(encoding="ascii"), encoding="ascii")

    client = HueBridgeClient(f"127.0.0.1:{port}", USERNAME, cert_dir=tls_bridge.cert_dir)
    with pytest.raises(BridgeCertificateError) as caught:
        client.get_lights()

    assert tls_bridge.requests_seen == []
    assert USERNAME not in str(caught.value)
    assert str(pin) in str(caught.value)


def test_normal_verification_still_rejects_the_self_signed_bridge(tls_bridge):
    import requests

    with pytest.raises(requests.exceptions.SSLError):
        requests.Session().get(f"https://127.0.0.1:{tls_bridge.server_port}/", timeout=5)


def test_the_pin_only_applies_to_the_bridge_it_was_made_for(tls_bridge):
    port = tls_bridge.server_port
    session = tls.pinned_session("127.0.0.1", port, cert_dir=tls_bridge.cert_dir)

    assert isinstance(session.get_adapter(f"https://127.0.0.1:{port}/api"), tls._PinnedAdapter)
    assert not isinstance(session.get_adapter("https://127.0.0.1/api"), tls._PinnedAdapter)
    assert not isinstance(session.get_adapter("https://discovery.meethue.com"), tls._PinnedAdapter)
    assert session.trust_env is False


def test_pin_file_names_are_safe_and_distinct(tmp_path):
    assert tls.pin_path("10.0.0.77", cert_dir=tmp_path).name == "10.0.0.77.pem"
    assert tls.pin_path("10.0.0.77", 8443, cert_dir=tmp_path).name == "10.0.0.77_8443.pem"
    assert tls.pin_path("../../etc/passwd", cert_dir=tmp_path).parent == tmp_path


def test_unreachable_host_and_corrupt_pin_are_reported_clearly(tmp_path, monkeypatch):
    monkeypatch.setattr("myhuey.tls.fetch_certificate", REAL_FETCH_CERTIFICATE)
    with pytest.raises(BridgeUnreachable):
        tls.pin_certificate("127.0.0.1", 1, cert_dir=tmp_path)

    tls.pin_path("10.0.0.9", cert_dir=tmp_path).write_text("not a certificate", encoding="ascii")
    with pytest.raises(BridgeCertificateError):
        tls.pinned_session("10.0.0.9", cert_dir=tmp_path)
