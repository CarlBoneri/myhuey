"""Certificate pinning for Hue bridges.

Hue bridges present a certificate that no public CA signs and that carries no
IP address, so normal verification cannot succeed. Instead the certificate is
fetched once, stored under the config directory, and every later connection
must present exactly that certificate (trust on first use).
"""

from __future__ import annotations

import hashlib
import logging
import re
import ssl
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter

from .errors import BridgeCertificateError, BridgeUnreachable
from .storage import DEFAULT_STORAGE_PATH

log = logging.getLogger(__name__)

DEFAULT_CERT_DIR = DEFAULT_STORAGE_PATH.parent / "certs"


def fetch_certificate(host: str, port: int = 443, timeout: float = 5.0) -> str:
    """Return the PEM certificate the server at host:port presents right now."""
    try:
        return ssl.get_server_certificate((host, port), timeout=timeout)
    except (OSError, ValueError) as exc:
        raise BridgeUnreachable(f"Cannot reach a Hue bridge at {host}:{port}: {exc}") from None


def fingerprint(pem: str) -> str:
    """SHA-256 fingerprint of a PEM certificate, as lowercase hex."""
    try:
        return hashlib.sha256(ssl.PEM_cert_to_DER_cert(pem.strip())).hexdigest()
    except ValueError:
        raise BridgeCertificateError("The stored bridge certificate is not valid PEM.") from None


def pin_path(host: str, port: int = 443, cert_dir: str | Path | None = None) -> Path:
    name = re.sub(r"[^A-Za-z0-9._-]", "_", host)
    if port != 443:
        name = f"{name}_{port}"
    return Path(cert_dir or DEFAULT_CERT_DIR) / f"{name}.pem"


def load_pin(host: str, port: int = 443, cert_dir: str | Path | None = None) -> str | None:
    path = pin_path(host, port, cert_dir)
    return path.read_text(encoding="ascii") if path.exists() else None


def pin_certificate(
    host: str,
    port: int = 443,
    *,
    cert_dir: str | Path | None = None,
    replace: bool = False,
) -> str:
    """Pin the bridge certificate if it is not pinned yet. Return its fingerprint."""
    pinned = load_pin(host, port, cert_dir)
    if pinned and not replace:
        return fingerprint(pinned)

    pem = fetch_certificate(host, port)
    digest = fingerprint(pem)
    path = pin_path(host, port, cert_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(pem, encoding="ascii")
    log.warning(
        "Pinned the certificate of the Hue bridge at %s (SHA-256 %s). "
        "Later connections must present this exact certificate.",
        host,
        digest,
    )
    return digest


class _PinnedAdapter(HTTPAdapter):
    """Accept one server certificate only, identified by its SHA-256 fingerprint."""

    def __init__(self, digest: str) -> None:
        self._digest = digest
        super().__init__()

    def init_poolmanager(self, *args, **kwargs) -> None:
        kwargs["assert_fingerprint"] = self._digest
        super().init_poolmanager(*args, **kwargs)

    def send(self, request, **kwargs):
        # The pin replaces CA-chain and hostname checks, which a bridge
        # certificate can never pass. urllib3 compares the fingerprint on every
        # new connection, before any request data is sent.
        kwargs["verify"] = False
        return super().send(request, **kwargs)


def session_for_certificate(host: str, port: int, pem: str) -> requests.Session:
    """A session that talks to host:port only if it presents the given certificate."""
    session = requests.Session()
    session.trust_env = False  # never route bridge traffic through an environment proxy
    session.mount(f"https://{host}:{port}/", _PinnedAdapter(fingerprint(pem)))
    return session


def pinned_session(host: str, port: int = 443, *, cert_dir: str | Path | None = None) -> requests.Session:
    """A session pinned to the stored bridge certificate, pinning it first if needed."""
    pin_certificate(host, port, cert_dir=cert_dir)
    pem = load_pin(host, port, cert_dir)
    if pem is None:
        raise BridgeCertificateError(f"No pinned certificate found for the bridge at {host}.")
    return session_for_certificate(host, port, pem)
