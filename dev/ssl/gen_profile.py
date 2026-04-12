"""Generate halt-secure.mobileconfig and setup page for iOS certificate install."""
import base64
import os
import shutil

SSL_DIR = r"d:\Halt\dev\ssl"
DIST_DIR = r"d:\Halt\viewer\dist"

# Read root CA
with open(os.path.join(SSL_DIR, "rootCA.pem"), "rb") as f:
    ca_pem = f.read()

ca_b64 = base64.b64encode(ca_pem).decode()

# Create .mobileconfig
mobileconfig = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>halt-local-ca.pem</string>
            <key>PayloadContent</key>
            <data>{ca_b64}</data>
            <key>PayloadDescription</key>
            <string>Installs the HALT local network certificate so your device can make secure video calls, use the camera, and access the microphone over your local WiFi.</string>
            <key>PayloadDisplayName</key>
            <string>HALT Medical - Local Network Security</string>
            <key>PayloadIdentifier</key>
            <string>com.hermeticlabs.halt.localca</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDescription</key>
    <string>Required for secure video calls and camera/microphone access in HALT Medical Triage. This certificate verifies your device is communicating with the real HALT server on your local network.</string>
    <key>PayloadDisplayName</key>
    <string>HALT Medical - Secure Video</string>
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

for d in [SSL_DIR, DIST_DIR]:
    with open(os.path.join(d, "halt-secure.mobileconfig"), "w", encoding="utf-8") as f:
        f.write(mobileconfig)

# Also copy rootCA.pem to dist
shutil.copy2(os.path.join(SSL_DIR, "rootCA.pem"), os.path.join(DIST_DIR, "rootCA.pem"))

print("Done: halt-secure.mobileconfig + rootCA.pem -> dist/")
