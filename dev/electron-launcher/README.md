# HALT Desktop Launcher

Cross-platform Electron launcher for HALT – a local-first AI platform.

## Features

- 🖥️ **Local-First** - Bundled backend, no external dependencies
- 🔒 **Sealed Source** - Everything runs from the installed package
- 🔔 **System Tray** - Background operation with tray icon
- 🚀 **Splash Screen** - Professional branded loading screen
- 📦 **Multi-Platform** - Builds for Windows, macOS, and Linux

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Run in development mode (requires backend running separately)
npm start
```

### Building Installers

```bash
# Build for current platform
npm run build:win    # Windows (.exe)
npm run build:mac    # macOS (.dmg)
npm run build:linux  # Linux (.AppImage, .deb)

# Build for all platforms
npm run build:all
```

## Requirements

- Node.js 18+
- Python 3.11+ (for development only)
- Bundled backend exe (included in production builds)

## Project Structure

```
electron-launcher/
├── main.js           # Main Electron process
├── preload.js        # Secure IPC bridge
├── package.json      # Dependencies and build config
└── assets/
    ├── icon.png      # 512x512 app icon
    ├── icon.ico      # Windows icon
    ├── icon.icns     # macOS icon
    └── tray-icon.png # System tray icon
```

## Architecture

HALT runs as a **local-first application**:

1. **Electron Launcher** - Creates the desktop window and manages lifecycle
2. **Bundled Backend** - PyInstaller-compiled Python backend (eve-backend.exe)
3. **Frontend** - Built React app served locally or via dev server

```
┌─────────────────────────────────────────────┐
│              Electron Shell                  │
│  ┌────────────────┐  ┌─────────────────────┐│
│  │  Main Window   │  │   System Tray       ││
│  │  (Frontend)    │  │   Menu              ││
│  └────────────────┘  └─────────────────────┘│
│           │                                  │
│           ▼                                  │
│  ┌────────────────────────────────────────┐ │
│  │        Backend Process                  │ │
│  │        (eve-backend.exe)               │ │
│  │        Port 8000                        │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Configuration

Edit `main.js` to customize:

```javascript
const CONFIG = {
    appName: 'HALT',
    backendPort: 7778,
    frontendPort: 7777,
    startupTimeout: 30000,
    isDev: !app.isPackaged
};
```

## Code Signing (Production)

For production distribution, you'll need:

### Windows

- EV Code Signing Certificate
- Set `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables

### macOS

- Apple Developer certificate
- Notarization credentials
- Set `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`

## License

MIT License - Copyright © 2025 HALT
