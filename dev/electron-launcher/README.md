# HALT Desktop Launcher (`dev/electron-launcher/`)

> Electron shell that wraps the Python backend + React PWA into a native desktop app.

## Architecture

```
HALT - Medical Triage.exe
  └─ Electron Shell (main.js)
       ├─ Splash Screen ──→ "HALT" gradient spinner
       ├─ spawn() ──→ resources/app/runtime/python/python.exe
       │                  └─ start.py --prod --api-port 7778
       │                       ├─ Auto-downloads AI models (~4 GB, first run only)
       │                       ├─ Starts FastAPI on port 7778
       │                       └─ Serves viewer/dist/ as static PWA
       ├─ BrowserWindow ──→ http://127.0.0.1:7778 (loads the PWA)
       └─ System Tray ──→ Quit / Restart / Open API Docs
```

## Build Pipeline

**DO NOT run `npm run build:win` directly.** Use the orchestrator:

```bash
# From repo root — not from this directory
cd <repo-root>

# Development (fast — portable folder only, no installer)
python dev/build_and_deploy.py --platform win --dev

# Production (full NSIS installer + ZIP)
python dev/build_and_deploy.py --platform win

# Ship it (build + git tag + R2 upload + GitHub release)
python dev/build_and_deploy.py --platform win --release
```

### What the pipeline does

| Step | What happens | Output |
|------|-------------|--------|
| 1. Version bump | `package.json` version incremented (skip with `--no-bump`) | — |
| 2. Frontend build | `cd viewer && npm run build` → compiled PWA | `viewer/dist/` |
| 3. Stage | Copies `api/`, `viewer/dist/`, `models/`, `runtime/`, `start.py` into `app-stage/` | `app-stage/` |
| 4. Icon sync | Copies `assets/logo.png` → `assets/logo.ico` (auto-converts via Pillow) | `assets/logo.ico` |
| 5. Electron build | `electron-builder --win` packages everything | `dist/win-unpacked/` |
| 6. NSIS installer | Wraps `win-unpacked/` into a Setup wizard | `dist/HALT-Setup-X.X.X.exe` |
| 7. ZIP | Creates distribution archive with SHA-256 manifest | `builds/HALT-vX.X.X-Windows.zip` |

> **`--dev` skips steps 6-7** and only produces the `dist/win-unpacked/` portable folder.
> **`--dev` cannot be combined with `--deploy` or `--release`** — the pipeline will refuse.

### Output paths

```
dev/electron-launcher/
├── app-stage/               ← Staging area (rebuilt each run, gitignored)
├── dist/
│   ├── win-unpacked/        ← Portable app (run HALT - Medical Triage.exe directly)
│   └── HALT-Setup-X.X.X.exe ← NSIS installer (production only)
├── assets/
│   ├── logo.png             ← Copied from repo root assets/
│   └── logo.ico             ← Auto-generated from logo.png
└── node_modules/            ← Electron + electron-builder deps

builds/                      ← (at repo root) ZIP distributions for R2
└── HALT-vX.X.X-Windows.zip
```

## Configuration

In `main.js`:

```javascript
const CONFIG = {
    appName: 'HALT',
    backendPort: 7778,        // FastAPI listens here
    frontendPort: 7777,       // Unused in production (backend serves PWA)
    startupTimeout: 1800000,  // 30 minutes — covers first-run model download
    isDev: !app.isPackaged    // true when running `npm start`, false in built .exe
};
```

## Key Behaviors

| Behavior | Detail |
|----------|--------|
| **First-run model download** | `start.py` fetches ~4 GB from Cloudflare R2 with progress bar. The 30-min timeout ensures Electron doesn't kill the backend during this. |
| **Close button** | Minimizes to system tray (background operation). Use tray → Quit to actually exit. |
| **Single instance** | `requestSingleInstanceLock()` prevents duplicate windows. |
| **Process cleanup** | `taskkill /T /F` on Windows ensures the Python process tree dies on quit. |
| **ASAR disabled** | `"asar": false` in package.json — required because `runtime/python/` and `models/*.gguf` must be accessed as raw filesystem paths. |

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid icon file` | NSIS pointed at `.png` instead of `.ico` | Ensure `nsis.installerIcon` etc. use `assets/logo.ico` |
| `Backend startup timeout` | First-run model download taking too long | `startupTimeout` is 30 min — wait, or pre-download models |
| `electron-builder failed (exit 1)` | Usually missing `app-stage/` | Run from the orchestrator, not `npm run build:win` directly |
| `QuickEdit freeze` | Windows terminal paused build output | Click terminal, press Enter to resume |

## Requirements

- Node.js 18+
- Python 3.10+ with Pillow (`pip install Pillow`) for ICO generation
- Windows 10+ (for win builds)
