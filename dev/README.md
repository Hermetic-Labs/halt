# dev/

> Build, deploy, and quality tooling — developer only. Nothing in this directory ships to end users.

## Build & Deploy Pipeline

The primary workflow for shipping HALT:

```bash
# From repo root — always run from repo root, not from dev/

# ── Development Iteration ────────────────────────────────────────
python dev/build_and_deploy.py --platform win --dev          # Fast portable build (no installer)
python dev/build_and_deploy.py --platform win --dev --no-bump # Same, keep current version

# ── Production Build ─────────────────────────────────────────────
python dev/build_and_deploy.py --platform win                # Full build + NSIS installer + ZIP
python dev/build_and_deploy.py --platform mac                # macOS (run on a Mac)

# ── Ship It ──────────────────────────────────────────────────────
python dev/build_and_deploy.py --platform win --release      # build → zip → git tag → R2 upload → GitHub release

# ── Repackage Without Rebuilding ─────────────────────────────────
python dev/build_and_deploy.py --zip-only --no-bump --deploy # Zip existing build and push to R2
```

### Build output locations

```text
repo-root/
├── dev/electron-launcher/dist/
│   ├── win-unpacked/                    ← Portable app (test by running the .exe inside)
│   └── HALT-Setup-X.X.X-alpha.exe      ← NSIS installer (production)
│
└── builds/
    └── HALT-vX.X.X-alpha-Windows.zip   ← Distribution ZIP (uploaded to R2)
```

### Pipeline flags

| Flag | Effect | Can combine with --release? |
|------|--------|:--:|
| `--dev` | Portable folder only (no NSIS) — fastest iteration | ❌ Blocked |
| `--no-bump` | Keep current version | ✅ |
| `--zip-only` | Skip build, just zip existing `dist/win-unpacked` | ✅ |
| `--deploy` | Upload ZIP to Cloudflare R2 | ✅ |
| `--release` | Full pipeline: build → zip → git tag+push → R2 → GitHub release | ✅ |
| `--bump minor` | Bump minor version instead of patch | ✅ |
| `--upload-assets` | Upload `models/` + `runtime/` dev assets to R2 | N/A |

## Files

| File | Purpose | Run From |
|------|---------|----------|
| `build_and_deploy.py` | Full pipeline — build, version bump, zip, R2 upload, git release | `python dev/build_and_deploy.py` |
| `setup.py` | Post-clone setup — downloads AI models + portable Python from R2 | `python dev/setup.py` |
| `upload_r2.py` | One-shot upload helper for large ZIPs to R2 (100 MB multipart) | `python dev/upload_r2.py` |
| `white_glove.py` | Master lint orchestrator — 8 passes (Python, JS, HTML, Shell, etc.) | `python dev/white_glove.py [--strict]` |
| `cloudflare.md` | Cloudflare R2/Pages deployment docs | Reference only |
| `.env.example` | Template for R2 credentials | Copy to `.env` |
| `windows-preflight.ps1` | Windows pre-build checks (Node, Python, runtime) | `.\dev\windows-preflight.ps1` |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `electron-launcher/` | Electron main process, preload scripts, package.json build config |
| `ios-companion/` | Capacitor iOS companion app configuration |
| `macos/` | macOS-specific build scripts and launcher |
| `pi5-kiosk-forge/` | Raspberry Pi 5 kiosk mode setup scripts |
| `windows/` | Windows installer resources |

## Environment Variables

| Variable | Required For | Purpose |
|----------|-------------|---------|
| `R2_ACCOUNT_ID` | `--deploy`, `--release`, `setup.py` | Cloudflare account ID |
| `R2_ACCESS_KEY` | `--deploy`, `--release`, `setup.py` | R2 API access key |
| `R2_SECRET_KEY` | `--deploy`, `--release`, `setup.py` | R2 API secret key |
| `AZURE_TENANT_ID` | signing (win) | Azure AD tenant (`bb1b06c5-…`) |
| `AZURE_CLIENT_ID` | signing (win) | `halt-signing-pipeline` app ID (`385db38c-…`) |
| `AZURE_CLIENT_SECRET` | signing (win) | App registration client secret |
| `AZURE_ENDPOINT` | signing (win) | `https://eus.codesigning.azure.net` |
| `AZURE_CERT_PROFILE` | signing (win) | Certificate profile name (e.g. `HALT`) |
| `CSC_LINK` | signing (mac) | Base64-encoded Developer ID `.p12` |
| `CSC_KEY_PASSWORD` | signing (mac) | Password for the `.p12` (`HermeticLabs2031`) |
| `APPLE_TEAM_ID` | signing (mac) | `Q88YSQLQ8S` |
| `APPLE_ID` | notarize (mac) | `mrdwaynetillman@gmail.com` |
| `APPLE_ID_PASSWORD` | notarize (mac) | App-specific password (appleid.apple.com) |

> Without R2 vars, local builds work fine. Only R2 upload/download requires them.
> Without signing vars, builds are unsigned. Windows shows SmartScreen; macOS shows Gatekeeper warning.

## Common Gotchas

| Gotcha | What Happens | Prevention |
|--------|-------------|------------|
| **Running `npm run build:win` directly** | Builds without staging `app-stage/` → empty or stale bundle | Always use `build_and_deploy.py` |
| **NSIS icon format** | `.png` icons crash NSIS with `invalid icon file` | Pipeline auto-converts PNG→ICO; all `package.json` refs use `.ico` |
| **Version inflation** | Each run without `--no-bump` increments version | Use `--no-bump` during iteration |
| **Terminal freeze (Windows QuickEdit)** | Clicking terminal pauses `subprocess` output | Click terminal, press Enter |
| **`--dev` + `--release`** | Pipeline blocks this combination | `--dev` is for local testing only |

---

## Signing Status

### ✅ macOS — Developer ID Application (Complete)

**Cert:** Hermetic Labs LLC (`Q88YSQLQ8S`) — expires 2031/03/31
**File:** `dev/macos/developerID_application.p12` (gitignored)

Set these env vars on your Mac before running `--platform mac`:

```bash
export CSC_LINK=$(base64 -i dev/macos/developerID_application.p12)
export CSC_KEY_PASSWORD="HermeticLabs2031"
export APPLE_TEAM_ID="Q88YSQLQ8S"
export APPLE_ID="mrdwaynetillman@gmail.com"
export APPLE_ID_PASSWORD="<app-specific password — appleid.apple.com>"

python dev/build_and_deploy.py --platform mac --deploy
```

Pipeline logs `[SIGN] macOS Developer ID signing credentials detected` then
`[NOTARIZE] Submitting to Apple notary service...` — Gatekeeper warning gone.

---

### 🔲 Windows — Authenticode (awaiting Microsoft identity validation)

**Submitted:** March 30, 2026
**Check back:** April 3, 2026 (3 business days — expected validation window)

Microsoft is verifying Hermetic Labs' organization identity for Azure Trusted
Signing (`haltsigning` account, East US, Basic, ~$9.99/mo). Once the approval
email arrives, complete these two steps — next build ships signed and the
Windows SmartScreen "Run anyway" prompt is eliminated permanently.

**Step 1 — Create the Certificate Profile in Azure:**

```text
Azure Portal → haltsigning (halt-signing RG, East US)
  → Objects → Certificate profiles → + Add
    Name:  HALT
    Type:  Public Trust
```

**Step 2 — Set env vars and redeploy:**

```powershell
$env:AZURE_TENANT_ID     = "bb1b06c5-1b43-4295-8c01-d7ffd3a5b366"
$env:AZURE_CLIENT_ID     = "385db38c-a11d-41c9-8dea-a092e97e646a"
$env:AZURE_CLIENT_SECRET = "<secret — halt-signing-pipeline app registration>"
$env:AZURE_ENDPOINT      = "https://eus.codesigning.azure.net"
$env:AZURE_CERT_PROFILE  = "HALT"

python dev/build_and_deploy.py --platform win --deploy
```

Pipeline will log `[SIGN] Azure Trusted Signing credentials detected — build will be signed`.
Re-run `python dev/pull_and_inspect.py` — `[SIGN]` check should report `✓ Signed`.
