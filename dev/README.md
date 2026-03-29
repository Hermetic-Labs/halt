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

```
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
| `electron-launcher/` | Electron main process, preload scripts, package.json build config — [see its README](electron-launcher/README.md) |
| `ios-companion/` | Capacitor iOS companion app configuration |
| `macos/` | macOS-specific build scripts and `.command` launcher |
| `pi5-kiosk-forge/` | Raspberry Pi 5 kiosk mode setup scripts |
| `windows/` | Windows installer resources |

## Environment Variables (for R2 deployment)

| Variable | Required For | Purpose |
|----------|-------------|---------|
| `R2_ACCOUNT_ID` | `--deploy`, `--release`, `setup.py` | Cloudflare account ID |
| `R2_ACCESS_KEY` | `--deploy`, `--release`, `setup.py` | R2 API access key |
| `R2_SECRET_KEY` | `--deploy`, `--release`, `setup.py` | R2 API secret key |

> Without these, local builds work fine. Only R2 upload/download requires them.

## Common Gotchas

| Gotcha | What Happens | Prevention |
|--------|-------------|------------|
| **Running `npm run build:win` directly** | Builds without staging `app-stage/` → empty or stale bundle | Always use `build_and_deploy.py` |
| **NSIS icon format** | `.png` icons crash NSIS with `invalid icon file` | Pipeline auto-converts PNG→ICO; all `package.json` refs use `.ico` |
| **Version inflation** | Each run without `--no-bump` increments version | Use `--no-bump` during iteration |
| **Terminal freeze (Windows QuickEdit)** | Clicking terminal pauses `subprocess` output | Click terminal, press Enter |
| **`--dev` + `--release`** | Pipeline blocks this combination | `--dev` is for local testing only |
