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

const { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage, session } = require('electron');
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
        // In dev mode, use start.py (the universal launcher)
        const projectRoot = path.join(__dirname, '..', '..');
        return {
            command: 'python',
            args: ['start.py', '--no-browser', '--api-port', String(CONFIG.backendPort)],
            cwd: projectRoot,
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
        args: [startScript, '--prod', '--no-browser', '--api-port', String(CONFIG.backendPort)],
        cwd: appPath,
        isExe: true
    };
}

/**
 * Kill any orphan processes hogging our ports.
 * Runs on startup to ensure clean state.
 */
function killOrphanProcesses() {
    if (CONFIG.isDev) return; // Don't kill dev servers
    if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        for (const port of [CONFIG.backendPort]) {
            try {
                // Find and kill any process on our port
                const result = execSync(
                    `netstat -ano | findstr :${port} | findstr LISTENING`,
                    { encoding: 'utf8', timeout: 5000 }
                );
                const lines = result.trim().split('\n');
                const pids = new Set();
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[parts.length - 1]);
                    if (pid > 0 && pid !== process.pid) pids.add(pid);
                }
                for (const pid of pids) {
                    try {
                        execSync(`taskkill /pid ${pid} /T /F`, { timeout: 5000 });
                        console.log(`[HALT] Killed orphan process ${pid} on port ${port}`);
                    } catch { /* already dead */ }
                }
            } catch { /* no process on port — clean */ }
        }
    }
}

/**
 * Start the backend process
 */
function startBackend() {
    return new Promise((resolve, reject) => {
        // Clean up any orphan processes from previous run
        killOrphanProcesses();

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
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        // Backend is alive — that's all we need to open the app.
                        // Models warm up in the background; the React frontend
                        // shows its own loading state for GGUF/Whisper readiness.
                        console.log(`[HALT] Backend alive (models_ready=${data.models_ready})`);
                        resolve();
                    } catch {
                        // Server is up but response isn't JSON yet — keep trying
                        retry();
                    }
                });
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

            // On Windows, we need to kill the process tree AND clean ports
            if (process.platform === 'win32') {
                const { exec } = require('child_process');
                exec(`taskkill /pid ${backendProcess.pid} /T /F`, () => {
                    backendProcess = null;
                    // Also kill any orphan python processes on our port
                    killOrphanProcesses();
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

    // Load the designed splash screen
    splashWindow.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
}



/**
 * Update splash screen status
 */
function updateSplashStatus(status) {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.executeJavaScript(
            `if (window._setStatus) window._setStatus(${JSON.stringify(status)}); else document.getElementById('status').textContent = ${JSON.stringify(status)};`
        ).catch(() => { });
    }
}

/**
 * Create main application window
 */
function createMainWindow() {
    return new Promise(async (resolve) => {
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

    // Clear all caches to ensure fresh frontend assets on every launch
    // This prevents the PWA service worker from serving stale builds
    const ses = mainWindow.webContents.session;
    await ses.clearCache();
    await ses.clearStorageData({ storages: ['serviceworkers'] });
    console.log('[HALT] Cleared browser cache and service workers');

    // Grant camera + microphone + screen capture for WebRTC calls & translator
    // Without this, getUserMedia fails silently in Electron's sandboxed renderer
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
        const granted = ['media', 'mediaKeySystem', 'display-capture', 'notifications'].includes(permission);
        console.log(`[HALT] Permission ${permission}: ${granted ? 'GRANTED' : 'DENIED'}`);
        callback(granted);
    });

    // Also handle permission checks (Chromium queries before requesting)
    ses.setPermissionCheckHandler((_webContents, permission) => {
        return ['media', 'mediaKeySystem', 'display-capture', 'notifications'].includes(permission);
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

    resolve();
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
        await createMainWindow();
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
