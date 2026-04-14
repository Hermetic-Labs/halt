"""
Setup routes — SSL certificate lifecycle for field deployment.

Provides self-service certificate installation so any team member can
enable secure video calls from their device with a single button tap.
Auto-detects platform (iOS/Android/Desktop) and serves the correct
certificate format with step-by-step instructions.
"""
import os
import io
import json
import base64
import datetime
import ipaddress
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import Response, JSONResponse

router = APIRouter()

SSL_DIR = Path(os.path.dirname(os.path.abspath(__file__))).parent.parent / "dev" / "ssl"
CERT_FILE = SSL_DIR / "cert.pem"
KEY_FILE = SSL_DIR / "key.pem"
CA_FILE = SSL_DIR / "rootCA.pem"
CA_KEY_FILE = SSL_DIR / "rootCA-key.pem"
IP_FILE = SSL_DIR / "last_ip.txt"


def _get_local_ip() -> str:
    """Get the device's local network IP."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _generate_ca() -> tuple:
    """Generate a root CA certificate and key."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Hermetic Labs"),
        x509.NameAttribute(NameOID.COMMON_NAME, "HALT Medical Local CA"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .sign(key, hashes.SHA256())
    )
    return cert, key


def _generate_server_cert(ca_cert, ca_key, ip: str) -> tuple:
    """Generate a server certificate signed by our CA for the given IP."""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    # Build SAN list with common hotspot ranges + current IP
    san_entries = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        x509.IPAddress(ipaddress.IPv4Address(ip)),
    ]

    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Hermetic Labs"),
            x509.NameAttribute(NameOID.COMMON_NAME, "HALT Triage Server"),
        ]))
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    return cert, key


def ensure_certs(current_ip: Optional[str] = None) -> dict:
    """Ensure SSL certs exist and match the current IP. Regenerate if needed.

    Returns a status dict with what happened.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography import x509

    if current_ip is None:
        current_ip = _get_local_ip()

    SSL_DIR.mkdir(parents=True, exist_ok=True)
    status = {"ip": current_ip, "action": "none", "ready": False}

    # Check if we need to regenerate
    need_regen = False
    reason = ""

    if not CA_FILE.exists() or not CA_KEY_FILE.exists():
        need_regen = True
        reason = "No root CA found"
    elif not CERT_FILE.exists() or not KEY_FILE.exists():
        need_regen = True
        reason = "No server cert found"
    elif IP_FILE.exists():
        last_ip = IP_FILE.read_text().strip()
        if last_ip != current_ip:
            need_regen = True
            reason = f"IP changed: {last_ip} → {current_ip}"
    else:
        need_regen = True
        reason = "No IP record found"

    if need_regen:
        # Generate or load CA
        if not CA_FILE.exists() or not CA_KEY_FILE.exists():
            ca_cert, ca_key = _generate_ca()
            CA_FILE.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
            CA_KEY_FILE.write_bytes(ca_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            ))
            status["ca_generated"] = True
        else:
            ca_cert = x509.load_pem_x509_certificate(CA_FILE.read_bytes())
            ca_key = serialization.load_pem_private_key(CA_KEY_FILE.read_bytes(), password=None)

        # Generate server cert for current IP
        srv_cert, srv_key = _generate_server_cert(ca_cert, ca_key, current_ip)
        CERT_FILE.write_bytes(srv_cert.public_bytes(serialization.Encoding.PEM))
        KEY_FILE.write_bytes(srv_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ))
        IP_FILE.write_text(current_ip)

        status["action"] = "regenerated"
        status["reason"] = reason

    status["ready"] = CERT_FILE.exists() and KEY_FILE.exists()
    return status


# ── API Routes ────────────────────────────────────────────────────────────────


@router.get("/api/setup/status")
def cert_status(request: Request):
    """Return current SSL certificate status and device IP."""
    current_ip = _get_local_ip()
    last_ip = IP_FILE.read_text().strip() if IP_FILE.exists() else None
    port = request.url.port or 7778
    proto = "https" if os.environ.get("HALT_USE_SSL") else "http"

    return {
        "ssl_enabled": os.environ.get("HALT_USE_SSL") == "1",
        "current_ip": current_ip,
        "cert_ip": last_ip,
        "ip_match": current_ip == last_ip,
        "cert_exists": CERT_FILE.exists() and KEY_FILE.exists(),
        "ca_exists": CA_FILE.exists(),
        "https_url": f"https://{current_ip}:{port}",
        "http_url": f"http://{current_ip}:{port}",
        "needs_regeneration": current_ip != last_ip if last_ip else True,
    }


@router.get("/api/setup/cert.mobileconfig")
def download_mobileconfig():
    """Dynamically generate iOS .mobileconfig with the current root CA."""
    if not CA_FILE.exists():
        return JSONResponse({"error": "No root CA. Restart the server to auto-generate."}, status_code=404)

    ca_b64 = base64.b64encode(CA_FILE.read_bytes()).decode()
    current_ip = _get_local_ip()

    profile = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>halt-ca.pem</string>
            <key>PayloadContent</key>
            <data>{ca_b64}</data>
            <key>PayloadDescription</key>
            <string>Enables secure video calls, camera, and microphone access for HALT Medical Triage on your local network ({current_ip}).</string>
            <key>PayloadDisplayName</key>
            <string>HALT Medical — Network Security</string>
            <key>PayloadIdentifier</key>
            <string>com.hermeticlabs.halt.ca</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>Required for secure video calls in HALT Medical Triage. Verifies your device is communicating with the real HALT server on your local network.</string>
    <key>PayloadDisplayName</key>
    <string>HALT Medical — Secure Video</string>
    <key>PayloadIdentifier</key>
    <string>com.hermeticlabs.halt.profile</string>
    <key>PayloadOrganization</key>
    <string>Hermetic Labs</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>F1E2D3C4-B5A6-7890-FEDC-BA0987654321</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>"""

    return Response(
        content=profile.encode("utf-8"),
        media_type="application/x-apple-asix-config",
        headers={"Content-Disposition": "attachment; filename=halt-secure.mobileconfig"},
    )


@router.get("/api/setup/cert.pem")
def download_ca_pem():
    """Download the root CA as .pem (for Android / manual install)."""
    if not CA_FILE.exists():
        return JSONResponse({"error": "No root CA. Restart the server to auto-generate."}, status_code=404)

    return Response(
        content=CA_FILE.read_bytes(),
        media_type="application/x-pem-file",
        headers={"Content-Disposition": "attachment; filename=halt-ca.pem"},
    )


@router.post("/api/setup/regenerate")
def regenerate_certs():
    """Force-regenerate certs for the current IP. Requires server restart to take effect."""
    current_ip = _get_local_ip()
    # Delete old IP record to force regeneration
    if IP_FILE.exists():
        IP_FILE.unlink()
    result = ensure_certs(current_ip)
    result["message"] = "Certificates regenerated. Restart the server for changes to take effect."
    return result
