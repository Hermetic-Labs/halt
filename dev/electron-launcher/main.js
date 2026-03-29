/**
 * HALT Electron Launcher - Main Process
 * 
 * LOCAL-FIRST architecture - no Docker, no external dependencies.
 * 
 * Handles:
 * - Starting the bundled backend (PyInstaller exe)
 * - Main window creation (HALT UI)
 * - System tray integration
 * - Graceful shutdown
 */

const { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Configuration
const CONFIG = {
    appName: 'HALT',
    backendPort: 7778,
    frontendPort: 7777,
    startupTimeout: 1800000, // 30 minutes for backend to start (accounts for 4GB model download)
    healthCheckInterval: 1000, // Check every second during startup
    isDev: !app.isPackaged
};

// Derived URLs
const BACKEND_URL = `http://127.0.0.1:${CONFIG.backendPort}`;
const FRONTEND_URL = `http://127.0.0.1:${CONFIG.frontendPort}`;

// State
let mainWindow = null;
let splashWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;

// =============================================================================
// BACKEND PROCESS MANAGEMENT
// =============================================================================

/**
 * Get the path to the backend executable
 */
function getBackendPath() {
    if (CONFIG.isDev) {
        // In dev mode, use Python directly
        return {
            command: 'python',
            args: ['run_uvicorn.py'],
            cwd: path.join(__dirname, '..', '..'),
            isExe: false
        };
    }

    // In production, we use the bundled portable Python to run start.py
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..', '..');
    
    // The extraResources config puts our app-stage into resources/app/
    const appPath = path.join(resourcesPath, 'app');
    const pythonExe = process.platform === 'win32' 
        ? path.join(appPath, 'runtime', 'python', 'python.exe')
        : path.join(appPath, 'runtime', 'python', 'bin', 'python3'); // macOS/Linux fallback
    const startScript = path.join(appPath, 'start.py');

    // Return the command to run Python with start.py
    return {
        command: pythonExe,
        args: [startScript, '--prod', '--api-port', String(CONFIG.backendPort)],
        cwd: appPath,
        isExe: true
    };
}

/**
 * Start the backend process
 */
function startBackend() {
    return new Promise((resolve, reject) => {
        const backend = getBackendPath();

        console.log(`[HALT] Starting backend: ${backend.command}`);
        updateSplashStatus('Starting HALT backend...');

        try {
            backendProcess = spawn(backend.command, backend.args, {
                cwd: backend.cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    HALT_PORT: String(CONFIG.backendPort),
                    HALT_HOST: '127.0.0.1',
                    HALT_MODELS_DIR: path.join(backend.cwd, 'models')
                },
                detached: false,
                windowsHide: true
            });

            backendProcess.stdout.on('data', (data) => {
                console.log(`[Backend] ${data.toString().trim()}`);
            });

            backendProcess.stderr.on('data', (data) => {
                console.error(`[Backend Error] ${data.toString().trim()}`);
            });

            backendProcess.on('error', (err) => {
                console.error('[HALT] Failed to start backend:', err);
                reject(err);
            });

            backendProcess.on('close', (code) => {
                console.log(`[HALT] Backend exited with code ${code}`);
                backendProcess = null;
            });

            // Wait for backend to be ready
            waitForBackend()
                .then(resolve)
                .catch(reject);

        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Wait for backend health endpoint to respond
 */
function waitForBackend() {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let attempts = 0;

        const check = () => {
            attempts++;
            updateSplashStatus(`Connecting to backend (attempt ${attempts})...`);

            const req = http.get(`${BACKEND_URL}/api/health`, (res) => {
                if (res.statusCode === 200) {
                    console.log('[HALT] Backend is ready');
                    resolve();
                } else {
                    retry();
                }
            });

            req.on('error', retry);
            req.setTimeout(2000, retry);
        };

        const retry = () => {
            if (Date.now() - startTime > CONFIG.startupTimeout) {
                reject(new Error('Backend startup timeout - server did not respond in time'));
            } else {
                setTimeout(check, CONFIG.healthCheckInterval);
            }
        };

        // Give backend a moment to start before first check
        setTimeout(check, 500);
    });
}

/**
 * Stop the backend process
 */
function stopBackend() {
    return new Promise((resolve) => {
        if (backendProcess) {
            console.log('[HALT] Stopping backend...');

            // On Windows, we need to kill the process tree
            if (process.platform === 'win32') {
                const { exec } = require('child_process');
                exec(`taskkill /pid ${backendProcess.pid} /T /F`, () => {
                    backendProcess = null;
                    resolve();
                });
            } else {
                backendProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (backendProcess) {
                        backendProcess.kill('SIGKILL');
                    }
                    backendProcess = null;
                    resolve();
                }, 2000);
            }
        } else {
            resolve();
        }
    });
}

// =============================================================================
// WINDOW MANAGEMENT
// =============================================================================

/**
 * Create splash screen window
 */
function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 400,
        height: 300,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Load inline splash HTML
    splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getSplashHTML())}`);
}

/**
 * Get splash screen HTML
 */
function getSplashHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #312e81 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            border-radius: 12px;
            -webkit-app-region: drag;
        }
        .container {
            text-align: center;
        }
        .logo {
            font-size: 48px;
            font-weight: 700;
            background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 20px;
        }
        .spinner {
            width: 32px;
            height: 32px;
            border: 3px solid rgba(255,255,255,0.2);
            border-top-color: #60a5fa;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        #status {
            color: #94a3b8;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">HALT</div>
        <div class="spinner"></div>
        <div id="status">Initializing...</div>
    </div>
</body>
</html>`;
}

/**
 * Update splash screen status
 */
function updateSplashStatus(status) {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.executeJavaScript(
            `document.getElementById('status').textContent = '${status}';`
        ).catch(() => { });
    }
}

/**
 * Create main application window
 */
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        title: CONFIG.appName,
        icon: getAppIcon(),
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Load the frontend through the backend proxy (which serves viewer/dist)
    // This maintains window.location.host so WebSockets can resolve the LAN/Local IP properly.
    const frontendUrl = CONFIG.isDev ? FRONTEND_URL : BACKEND_URL;
    mainWindow.loadURL(frontendUrl);

    // Show when ready
    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
        }
        mainWindow.show();

        // Open DevTools in development
        if (CONFIG.isDev) {
            mainWindow.webContents.openDevTools();
        }
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Handle close - minimize to tray instead
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * Get app icon
 */
function getAppIcon() {
    const iconPaths = [
        path.join(__dirname, 'assets', 'logo.png'),
        path.join(__dirname, 'assets', 'logo.png'),
        path.join(__dirname, '..', 'assets', 'logo.png')
    ];

    for (const p of iconPaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return undefined;
}

/**
 * Create system tray
 */
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'logo.png');
    let icon = fs.existsSync(iconPath)
        ? nativeImage.createFromPath(iconPath)
        : nativeImage.createEmpty();

    // Resize for tray (16x16 on Windows)
    if (!icon.isEmpty()) {
        icon = icon.resize({ width: 16, height: 16 });
    }

    tray = new Tray(icon);
    tray.setToolTip(CONFIG.appName);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open HALT',
            click: () => mainWindow?.show()
        },
        { type: 'separator' },
        {
            label: 'Backend Status',
            submenu: [
                {
                    label: backendProcess ? '✓ Running' : '✗ Stopped',
                    enabled: false
                },
                { type: 'separator' },
                {
                    label: 'Restart Backend',
                    click: async () => {
                        await stopBackend();
                        await startBackend();
                    }
                }
            ]
        },
        { type: 'separator' },
        {
            label: 'Open API Docs',
            click: () => shell.openExternal(`${BACKEND_URL}/docs`)
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow?.show());
}

// =============================================================================
// APPLICATION LIFECYCLE
// =============================================================================

/**
 * Application startup sequence
 */
async function startup() {
    try {
        createSplashWindow();

        // Step 1: Start backend
        updateSplashStatus('Starting backend...');
        await startBackend();

        // Step 2: Create main window
        updateSplashStatus('Launching HALT...');
        createMainWindow();
        createTray();

    } catch (error) {
        console.error('[HALT] Startup error:', error);

        // Close splash if open
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
        }

        dialog.showErrorBox(
            'HALT Startup Error',
            `Failed to start HALT:\n\n${error.message}\n\n` +
            'Please check that:\n' +
            '• The installation is complete\n' +
            '• No other instance is running\n' +
            `• Port ${CONFIG.backendPort} is not in use`
        );
        app.quit();
    }
}

// App ready
app.whenReady().then(startup);

// macOS: Re-create window when dock icon clicked
app.on('activate', () => {
    if (mainWindow === null) {
        createMainWindow();
    } else {
        mainWindow.show();
    }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// Handle app quit - stop backend
app.on('before-quit', async (event) => {
    if (backendProcess && !isQuitting) {
        event.preventDefault();
        isQuitting = true;
        await stopBackend();
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        isQuitting = true;
        app.quit();
    }
});

// Cleanup on exit
app.on('will-quit', async () => {
    await stopBackend();
});
