"""Verified, pinned TLS for Hue bridges.

A Hue bridge presents a certificate signed by Signify's private Hue Bridge root CA, with
the bridge ID as its common name and no IP address in it, so ordinary hostname checks
cannot pass. Following Signify's "Using HTTPS" guidance, the first contact verifies the
certificate against the Hue root CAs and reads the bridge ID from it; only then is it
pinned. Every later connection must present exactly the pinned certificate.

When a bridge renews its certificate (a firmware update, or a move to Signify's secondary
root), the pin stops matching. The new certificate is verified the same way and pinned
again only if it carries the same bridge ID, so a different device at the address is
still refused.
"""

from __future__ import annotations

import hashlib
import socket
import logging
import re
import ssl
from pathlib import Path
from typing import NamedTuple

import requests
from requests.adapters import HTTPAdapter

from .errors import BridgeCertificateError, BridgeUnreachable
from .storage import DEFAULT_STORAGE_PATH

log = logging.getLogger(__name__)

DEFAULT_CERT_DIR = DEFAULT_STORAGE_PATH.parent / "certs"

# Signify's Hue Bridge root CAs, as published in the Hue developer documentation
# ("Using HTTPS"): the one in use first, then the secondary they may move to.
HUE_ROOT_CAS = """\
-----BEGIN CERTIFICATE-----
MIICMjCCAdigAwIBAgIUO7FSLbaxikuXAljzVaurLXWmFw4wCgYIKoZIzj0EAwIw
OTELMAkGA1UEBhMCTkwxFDASBgNVBAoMC1BoaWxpcHMgSHVlMRQwEgYDVQQDDAty
b290LWJyaWRnZTAiGA8yMDE3MDEwMTAwMDAwMFoYDzIwMzgwMTE5MDMxNDA3WjA5
MQswCQYDVQQGEwJOTDEUMBIGA1UECgwLUGhpbGlwcyBIdWUxFDASBgNVBAMMC3Jv
b3QtYnJpZGdlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjNw2tx2AplOf9x86
aTdvEcL1FU65QDxziKvBpW9XXSIcibAeQiKxegpq8Exbr9v6LBnYbna2VcaK0G22
jOKkTqOBuTCBtjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNV
HQ4EFgQUZ2ONTFrDT6o8ItRnKfqWKnHFGmQwdAYDVR0jBG0wa4AUZ2ONTFrDT6o8
ItRnKfqWKnHFGmShPaQ7MDkxCzAJBgNVBAYTAk5MMRQwEgYDVQQKDAtQaGlsaXBz
IEh1ZTEUMBIGA1UEAwwLcm9vdC1icmlkZ2WCFDuxUi22sYpLlwJY81Wrqy11phcO
MAoGCCqGSM49BAMCA0gAMEUCIEBYYEOsa07TH7E5MJnGw557lVkORgit2Rm1h3B2
sFgDAiEA1Fj/C3AN5psFMjo0//mrQebo0eKd3aWRx+pQY08mk48=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBzDCCAXOgAwIBAgICEAAwCgYIKoZIzj0EAwIwPDELMAkGA1UEBhMCTkwxFDAS
BgNVBAoMC1NpZ25pZnkgSHVlMRcwFQYDVQQDDA5IdWUgUm9vdCBDQSAwMTAgFw0y
NTAyMjUwMDAwMDBaGA8yMDUwMTIzMTIzNTk1OVowPDELMAkGA1UEBhMCTkwxFDAS
BgNVBAoMC1NpZ25pZnkgSHVlMRcwFQYDVQQDDA5IdWUgUm9vdCBDQSAwMTBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABFfOO0jfSAUXGQ9kjEDzyBrcMQ3ItyA5krE+
cyvb1Y3xFti7KlAad8UOnAx0FBLn7HZrlmIwm1QnX0fK3LPM13mjYzBhMB0GA1Ud
DgQWBBTF1pSpsCASX/z0VHLigxU2CAaqoTAfBgNVHSMEGDAWgBTF1pSpsCASX/z0
VHLigxU2CAaqoTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggq
hkjOPQQDAgNHADBEAiAk7duT+IHbOGO4UUuGLAEpyYejGZK9Z7V9oSfnvuQ5BQIg
IYSgwwxHXm73/JgcU9lAM6c8Bmu3UE3kBIUwBs1qXFw=
-----END CERTIFICATE-----
"""


class VerifiedCertificate(NamedTuple):
    pem: str
    bridge_id: str  # lowercase, from the certificate's common name


def fetch_certificate(host: str, port: int = 443, timeout: float = 5.0, *, expected_id: str | None = None) -> VerifiedCertificate:
    """The certificate the bridge at host:port presents, verified against the Hue root CAs.

    With `expected_id`, the certificate must also name that bridge ID.
    """
    context = ssl.create_default_context(cadata=HUE_ROOT_CAS)
    context.check_hostname = False  # the bridge ID is checked below; the certificate names no IP
    try:
        with socket.create_connection((host, port), timeout=timeout) as raw, context.wrap_socket(raw) as conn:
            der = conn.getpeercert(binary_form=True)
            subject = dict(item[0] for item in (conn.getpeercert() or {}).get("subject", ()))
    except ssl.SSLCertVerificationError:
        raise BridgeCertificateError(
            f"The device at {host} presented a certificate not signed by the Hue bridge root CA. It is not a "
            f"genuine Hue bridge, or its software is very old: update the bridge in the Hue app and try again."
        ) from None
    except (OSError, ValueError) as exc:
        raise BridgeUnreachable(f"Cannot reach a Hue bridge at {host}:{port}: {exc}") from None
    bridge_id = str(subject.get("commonName") or "").lower()
    if not der or not bridge_id:
        raise BridgeCertificateError(f"The device at {host} presented a certificate without a bridge ID.")
    if expected_id and bridge_id != expected_id.lower():
        raise BridgeCertificateError(
            f"The device at {host} is Hue bridge {bridge_id.upper()}, not {expected_id.upper()}, the bridge "
            f"MyHuey is paired with. If you replaced the bridge, run the setup guide again."
        )
    return VerifiedCertificate(ssl.DER_cert_to_PEM_cert(der), bridge_id)


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


def id_path(host: str, port: int = 443, cert_dir: str | Path | None = None) -> Path:
    return pin_path(host, port, cert_dir).with_suffix(".id")


def pinned_bridge_id(host: str, port: int = 443, cert_dir: str | Path | None = None) -> str | None:
    """The bridge ID verified when this address was pinned, if it was pinned with one."""
    path = id_path(host, port, cert_dir)
    return path.read_text(encoding="ascii").strip() or None if path.exists() else None


def load_pin(host: str, port: int = 443, cert_dir: str | Path | None = None) -> str | None:
    path = pin_path(host, port, cert_dir)
    return path.read_text(encoding="ascii") if path.exists() else None


def pin_certificate(
    host: str,
    port: int = 443,
    *,
    cert_dir: str | Path | None = None,
    replace: bool = False,
    expected_id: str | None = None,
) -> str:
    """Verify and pin the bridge certificate if it is not pinned yet. Return its fingerprint."""
    pinned = load_pin(host, port, cert_dir)
    if pinned and not replace:
        return fingerprint(pinned)

    verified = fetch_certificate(host, port, expected_id=expected_id)
    digest = fingerprint(verified.pem)
    path = pin_path(host, port, cert_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(verified.pem, encoding="ascii")
    id_path(host, port, cert_dir).write_text(verified.bridge_id, encoding="ascii")
    log.warning(
        "Pinned the verified certificate of Hue bridge %s at %s (SHA-256 %s).",
        verified.bridge_id.upper(),
        host,
        digest,
    )
    return digest


def _learn_bridge_id(host: str, port: int, pem: str, cert_dir: str | Path | None) -> None:
    """Record the bridge ID of a pin made before certificates were verified, so a later
    certificate renewal can be accepted. Only if the bridge still presents the pinned
    certificate and it verifies; otherwise leave the pin as it is."""
    try:
        verified = fetch_certificate(host, port)
    except (BridgeCertificateError, BridgeUnreachable):
        return
    if fingerprint(verified.pem) == fingerprint(pem):
        id_path(host, port, cert_dir).write_text(verified.bridge_id, encoding="ascii")


def repin(host: str, port: int = 443, *, cert_dir: str | Path | None = None) -> bool:
    """Pin a renewed certificate from the same bridge. False when the pin has no bridge ID
    to check against (pinned before verification existed); raises if the new certificate
    is not a verified certificate for that bridge."""
    known = pinned_bridge_id(host, port, cert_dir)
    if not known:
        return False
    pin_certificate(host, port, cert_dir=cert_dir, replace=True, expected_id=known)
    return True


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
    if pem is not None and pinned_bridge_id(host, port, cert_dir) is None:
        _learn_bridge_id(host, port, pem, cert_dir)
    if pem is None:
        raise BridgeCertificateError(f"No pinned certificate found for the bridge at {host}.")
    return session_for_certificate(host, port, pem)
