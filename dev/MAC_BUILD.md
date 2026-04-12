# HALT — macOS Build Guide

## Quick Start (on Mac)

```bash
# Clone and navigate
git clone <your-repo-url> halt && cd halt

# Install Electron deps
cd dev/electron-launcher && npm install && cd ../..

# Run in dev mode (backend + frontend)
python start.py --no-browser --api-port 7778

# In another terminal, run Electron
cd dev/electron-launcher && npm start
```

## Build Production DMG

```bash
cd dev/electron-launcher

# Build for current architecture
npm run build:mac

# Output: dist/HALT-{version}-{arch}.dmg
```

### Universal Build (Intel + Apple Silicon)
The `package.json` already targets both `x64` and `arm64`. On an Apple Silicon Mac:
```bash
npm run build:mac
# Produces: HALT-1.0.x-arm64.dmg  (and x64 if cross-compile tools installed)
```

## What's Git-Ready (just clone & go)

| Feature | Status | Notes |
|---|---|---|
| Electron shell (`main.js`) | ✅ | Permission handler for camera/mic/screen |
| Entitlements (`entitlements.mac.plist`) | ✅ | Camera, mic, network, JIT, file access |
| Info.plist overrides | ✅ | NSCamera/Mic/NetworkUsageDescription in `package.json` |
| Backend (`start.py`) | ✅ | Cross-platform — detects macOS Python path |
| WebRTC calls | ✅ | Same code, permissions unlocked via entitlements |
| Translator (Whisper→NLLB→Kokoro) | ✅ | Same backend pipeline |
| Azure Trusted Signing | N/A | Windows-only — Mac uses Apple codesign |

## Mac Gaps (fill in on Mac)

### 1. Code Signing (Apple Developer)
```bash
# Set these env vars before building:
export CSC_LINK="path/to/Developer_ID_Application.p12"
export CSC_KEY_PASSWORD="your-p12-password"

# Or use Keychain if cert is installed:
export CSC_NAME="Developer ID Application: Hermetic Labs, LLC"
```
> You already have `developerID_application.p12` in `dev/certs/` — 
> just need to set the env vars.

### 2. Notarization (eliminates Gatekeeper warning)
Add to `package.json` → `build.mac.notarize` or use `afterSign` hook:
```bash
export APPLE_ID="your-apple-id@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
```

### 3. Python Runtime Bundling
On Windows we bundle portable Python in `app-stage/runtime/python/`.
On Mac, same approach — bundle a standalone Python:
```bash
# Option A: Use python.org framework build
# Option B: Use pyenv to build a relocatable Python
# Package into: app-stage/runtime/python/bin/python3
```
`main.js` line 66 already handles this path:
```js
path.join(appPath, 'runtime', 'python', 'bin', 'python3')
```

### 4. Whisper + Kokoro on Apple Silicon
The ML models may benefit from Metal acceleration on M-series chips.
Check if `faster-whisper` and `kokoro` support Metal/CoreML backends.

### 5. Audio Format (MediaRecorder)
Safari/macOS Chrome may prefer `audio/mp4` over `audio/webm`.
The translate stream hook already tries multiple codecs:
```js
['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
```
May need to add `audio/mp4` for Safari WebView on Mac.

## File Checklist

All Mac-specific files are in the repo:
- `dev/electron-launcher/entitlements.mac.plist` — macOS entitlements
- `dev/electron-launcher/package.json` → `build.mac` — DMG config + Info.plist
- `dev/electron-launcher/main.js` — Permission handler (cross-platform)
- `dev/certs/developerID_application.p12` — Apple signing cert
- `dev/certs/developerID_application.cer` — Apple signing cert (public)
- `dev/MAC_BUILD.md` — This file
