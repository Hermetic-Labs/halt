# electron-launcher/assets/

> Icon files for Electron packaging. **The build pipeline auto-manages this directory.**

## How It Works

The build script (`dev/build_and_deploy.py`) automatically:

1. Copies `assets/logo.png` from the **repo root** into this directory
2. Generates `logo.ico` (256×256 multi-size ICO) from that PNG using Pillow

**You do not need to manually place or convert icons.** The only source of truth
is `<repo-root>/assets/logo.png`. Everything else is derived.

## Files (auto-generated)

| File | Format | Used By |
|------|--------|---------|
| `logo.png` | PNG (any size) | macOS `.dmg` icon, Electron tray, `main.js` window icon |
| `logo.ico` | ICO (256/48/32/16) | Windows NSIS installer (`installerIcon`, `uninstallerIcon`, `win.icon`) |

## ⚠️ NSIS Requires `.ico`

Windows NSIS installer **cannot** use `.png` for icons. If you see:

```
Error while loading icon from "logo.png": invalid icon file
Error in macro MUI_INTERFACE on macroline 87
```

It means NSIS is being pointed at a PNG. All three NSIS icon fields in
`package.json` must reference `.ico`:

```json
"nsis": {
    "installerIcon": "assets/logo.ico",
    "uninstallerIcon": "assets/logo.ico",
    "installerHeaderIcon": "assets/logo.ico"
}
```

The `win.icon` field must also be `.ico`:

```json
"win": {
    "icon": "assets/logo.ico"
}
```

macOS and Linux can use `.png` directly.

## To Update the Logo

1. Replace `<repo-root>/assets/logo.png` with your new logo (minimum 256×256)
2. Delete `dev/electron-launcher/assets/logo.ico` (forces regeneration)
3. Run the build: `python dev/build_and_deploy.py --platform win`
4. The pipeline will auto-generate a fresh `.ico`
