/**
 * HALT — Hermetic Anonymous Local Triage
 * Electron Main Process
 * 
 * LOCAL-FIRST architecture — all AI, translation, and patient data stays on-device.
 * 
 * Handles:
 * - Starting the bundled Python backend (portable runtime or system Python)
 * - Main window creation (loads FastAPI-served frontend)
 * - System tray integration (server keeps running when window closes)
 * - Network info display (local IP for mesh device connections)
 * - Graceful shutdown
 */

const { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

// ── Log file ─────────────────────────────────────────────────────────────────
const LOG_PATH = path.join(__dirname, '..', 'halt-log.txt');
function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch { /* ignore */ }
}
// Clear log on each launch
try { fs.writeFileSync(LOG_PATH, `=== HALT Launch ${new Date().toISOString()} ===\n`); } catch { /* ignore */ }

// Catch any uncaught exceptions in the main process
process.on('uncaughtException', (err) => {
    log(`[HALT] Uncaught exception: ${err.message}\n${err.stack}`);
});
process.on('unhandledRejection', (reason) => {
    log(`[HALT] Unhandled rejection: ${reason}`);
});

// ── Audio crash fix ──────────────────────────────────────────────────────────
// Chromium's out-of-process audio service crashes with ACCESS_VIOLATION
// (0xC0000005) when playing Audio(blob_url) in sandboxed renderers.
// Keep audio in-process to prevent renderer crash.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess,AudioServiceSandbox');

// ── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
    appName: 'HALT — Medical Triage',
    backendPort: 7778,        // Backend API port (matches start_windows.bat)
    frontendPort: 7777,       // Frontend/browser port
    startupTimeout: 90000,    // 90s — models may take time to initialize
    healthCheckInterval: 2000,
    isDev: !app.isPackaged
};

const BACKEND_URL = `http://127.0.0.1:${CONFIG.backendPort}`;

// ── State ────────────────────────────────────────────────────────────────────
let mainWindow = null;
let splashWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;

// ── Network Helpers ──────────────────────────────────────────────────────────

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// =============================================================================
// BACKEND PROCESS MANAGEMENT
// =============================================================================

/**
 * Locate the Python executable — portable runtime first, then system Python
 */
function getPythonPath() {
    const appRoot = CONFIG.isDev
        ? path.join(__dirname, '..')
        : path.join(process.resourcesPath, 'app');

    // Portable Python (bundled with the Windows distribution)
    const portablePaths = [
        path.join(appRoot, 'runtime', 'python', 'python.exe'),
        path.join(__dirname, '..', 'runtime', 'python', 'python.exe')
    ];

    for (const p of portablePaths) {
        if (fs.existsSync(p)) {
            console.log(`[HALT] Found portable Python at: ${p}`);
            return { python: p, appRoot: path.dirname(path.dirname(path.dirname(p))) };
        }
    }

    console.log('[HALT] Portable Python not found, falling back to system Python');
    return { python: 'python', appRoot };
}

/**
 * Kill any existing processes on the backend port
 */
function clearPort(port) {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            exec(`for /f "tokens=5" %p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":${port} "') do taskkill /PID %p /F`, { shell: 'cmd.exe' }, () => resolve());
        } else {
            exec(`lsof -ti :${port} | xargs kill -9`, () => resolve());
        }
    });
}

/**
 * Start the FastAPI backend via uvicorn
 */
async function startBackend() {
    const { python, appRoot } = getPythonPath();
    const apiDir = path.join(appRoot, 'api');
    const patientsDir = path.join(appRoot, 'patients');
    const modelsDir = path.join(appRoot, 'models');

    log(`isDev: ${CONFIG.isDev}`);
    log(`__dirname: ${__dirname}`);
    log(`resourcesPath: ${process.resourcesPath}`);
    log(`Python: ${python}`);
    log(`Python exists: ${fs.existsSync(python)}`);
    log(`API dir: ${apiDir}`);
    log(`API exists: ${fs.existsSync(apiDir)}`);
    log(`App root: ${appRoot}`);
    log(`Models dir: ${modelsDir}`);
    log(`Models exists: ${fs.existsSync(modelsDir)}`);
    log(`Patients dir: ${patientsDir}`);

    // Log model files for debugging
    if (fs.existsSync(modelsDir)) {
        const files = fs.readdirSync(modelsDir);
        log(`Models contents: ${files.join(', ')}`);
        log(`kokoro-v1.0.onnx exists: ${fs.existsSync(path.join(modelsDir, 'kokoro-v1.0.onnx'))}`);
        log(`voices-v1.0.bin exists: ${fs.existsSync(path.join(modelsDir, 'voices-v1.0.bin'))}`);
        log(`faster-whisper-base exists: ${fs.existsSync(path.join(modelsDir, 'faster-whisper-base'))}`);
    }

    // Ensure patients directory exists
    if (!fs.existsSync(patientsDir)) {
        fs.mkdirSync(patientsDir, { recursive: true });
        log(`Created patients directory: ${patientsDir}`);
    }

    // Clear any existing processes on the port
    updateSplashStatus('Clearing ports...');
    await clearPort(CONFIG.backendPort);
    await new Promise(r => setTimeout(r, 1000));

    updateSplashStatus('Starting HALT backend...');

    const envVars = {
        ...process.env,
        HALT_MODELS_DIR: modelsDir,
        HALT_DATA_DIR: patientsDir,
        PYTHONPATH: apiDir
    };
    log(`ENV HALT_MODELS_DIR: ${envVars.HALT_MODELS_DIR}`);
    log(`ENV HALT_DATA_DIR: ${envVars.HALT_DATA_DIR}`);
    log(`ENV PYTHONPATH: ${envVars.PYTHONPATH}`);

    return new Promise((resolve, reject) => {
        try {
            backendProcess = spawn(python, [
                '-m', 'uvicorn', 'main:app',
                '--host', '0.0.0.0',
                '--port', String(CONFIG.backendPort)
            ], {
                cwd: apiDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: envVars,
                detached: false,
                windowsHide: true
            });

            backendProcess.stdout.on('data', (data) => {
                const line = data.toString().trim();
                log(`[stdout] ${line}`);
            });

            backendProcess.stderr.on('data', (data) => {
                const line = data.toString().trim();
                log(`[stderr] ${line}`);
            });

            backendProcess.on('error', (err) => {
                log(`[HALT] Failed to start backend: ${err.message}`);
                reject(err);
            });

            backendProcess.on('close', (code) => {
                console.log(`[HALT] Backend exited with code ${code}`);
                backendProcess = null;
                if (!isQuitting && mainWindow) {
                    dialog.showErrorBox(
                        'HALT Backend Stopped',
                        'The medical triage backend has stopped unexpectedly.\n\n' +
                        'Please restart the application.'
                    );
                }
            });

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
            if (attempts === 1) updateSplashStatus('Connecting...');
            else if (attempts === 5) updateSplashStatus('Loading AI models...');
            else if (attempts === 15) updateSplashStatus('Almost ready...');

            const req = http.get(`${BACKEND_URL}/health`, (res) => {
                if (res.statusCode === 200) {
                    console.log('[HALT] Backend is ready');
                    resolve();
                } else {
                    retry();
                }
            });

            req.on('error', retry);
            req.setTimeout(2000, () => { req.destroy(); retry(); });
        };

        const retry = () => {
            if (Date.now() - startTime > CONFIG.startupTimeout) {
                reject(new Error('Backend startup timeout — server did not respond in 60 seconds'));
            } else {
                setTimeout(check, CONFIG.healthCheckInterval);
            }
        };

        setTimeout(check, 500);
    });
}

/**
 * Stop the backend process tree
 */
function stopBackend() {
    return new Promise((resolve) => {
        if (backendProcess) {
            console.log('[HALT] Stopping backend...');

            if (process.platform === 'win32') {
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
 * Create splash screen
 */
function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 420,
        height: 340,
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

    splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getSplashHTML())}`);
}

/**
 * Splash screen HTML — HALT branding
 */
function getSplashHTML() {
    // Load the HALT logo from assets
    const logoPath = path.join(__dirname, 'assets', 'halt transparent.png');
    let logoDataUrl = '';
    if (fs.existsSync(logoPath)) {
        const logoData = fs.readFileSync(logoPath).toString('base64');
        logoDataUrl = `data:image/png;base64,${logoData}`;
    }

    return `<!DOCTYPE html>
<html><head><style>
    * { box-sizing: border-box; }
    body {
        margin: 0; padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #0f172a;
        color: white;
        display: flex; align-items: center; justify-content: center;
        height: 100vh;
        border-radius: 12px;
        overflow: hidden;
        -webkit-app-region: drag;
    }
    .container { text-align: center; padding: 32px; }
    .logo-img {
        width: 160px; height: auto;
        margin-bottom: 28px;
    }
    .bar-track {
        width: 220px;
        height: 4px;
        background: rgba(255,255,255,0.08);
        border-radius: 2px;
        margin: 0 auto 14px;
        overflow: hidden;
    }
    .bar-fill {
        height: 100%;
        width: 40%;
        background: #ef4444;
        border-radius: 2px;
        animation: slide 1.4s ease-in-out infinite;
    }
    @keyframes slide {
        0%   { transform: translateX(-100%); width: 40%; }
        50%  { width: 60%; }
        100% { transform: translateX(650%); width: 40%; }
    }
    #status { color: #64748b; font-size: 12px; letter-spacing: 0.5px; }
</style></head><body>
    <div class="container">
        ${logoDataUrl ? `<img class="logo-img" src="${logoDataUrl}" alt="HALT" />` : '<div style="font-size:48px;font-weight:800;letter-spacing:8px;margin-bottom:28px;">HALT</div>'}
        <div class="bar-track"><div class="bar-fill"></div></div>
        <div id="status">Initializing...</div>
    </div>
</body></html>`;
}

/**
 * Update splash status text
 */
function updateSplashStatus(status) {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.executeJavaScript(
            `document.getElementById('status').textContent = '${status.replace(/'/g, "\\'")}';`
        ).catch(() => { });
    }
}

/**
 * Create main application window
 */
function createMainWindow() {
    const localIP = getLocalIP();

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 768,
        title: `${CONFIG.appName}  —  ${localIP}:${CONFIG.backendPort}`,
        icon: getAppIcon(),
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Load the frontend from the FastAPI backend (serves pre-built Vite dist)
    // Backend is on 7778, frontend is served from the same backend on that port
    mainWindow.loadURL(BACKEND_URL);

    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
        }
        mainWindow.show();

        // Temporarily force DevTools to capture white screen error
        if (CONFIG.isDev) {
            mainWindow.webContents.openDevTools();
        }

        mainWindow.webContents.on('render-process-gone', (event, details) => {
            const crashMsg = `Renderer gone: reason=${details.reason} exitCode=${details.exitCode}`;
            log(`[HALT] ${crashMsg}`);
            // Auto-reload after crash
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    log('[HALT] Attempting auto-reload...');
                    mainWindow.loadURL(BACKEND_URL);
                }
            }, 2000);
        });

        // Catch ALL navigation events — the speak button may be triggering a navigation
        mainWindow.webContents.on('will-navigate', (event, url) => {
            log(`[HALT] will-navigate: ${url}`);
            // If navigating away from our app, block it
            if (!url.startsWith(BACKEND_URL)) {
                log(`[HALT] BLOCKED navigation to: ${url}`);
                event.preventDefault();
            }
        });
        mainWindow.webContents.on('did-navigate', (event, url, httpResponseCode) => {
            log(`[HALT] did-navigate: ${url} code=${httpResponseCode}`);
        });
        mainWindow.webContents.on('did-navigate-in-page', (event, url, isMainFrame) => {
            log(`[HALT] did-navigate-in-page: ${url} mainFrame=${isMainFrame}`);
        });

        mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
            log(`[HALT] Page load failed: ${errorCode} ${errorDescription} url=${validatedURL}`);
        });

        // Capture ALL renderer console output to file (console clears on reload!)
        mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
            if (message.includes('TTS-TRACE') || message.includes('HALT-DIAG') || level >= 2) {
                log(`[RENDERER ${level === 2 ? 'WARN' : level >= 3 ? 'ERROR' : 'LOG'}] ${message}`);
            }
        });
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Close = quit (kills backend cleanly)
    mainWindow.on('close', () => {
        isQuitting = true;
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * Get app icon from assets
 */
function getAppIcon() {
    const iconPaths = [
        path.join(__dirname, 'assets', 'Icon.ico'),
        path.join(__dirname, 'assets', 'icon.png'),
        path.join(__dirname, '..', 'assets', 'Icon.ico')
    ];

    for (const p of iconPaths) {
        if (fs.existsSync(p)) return p;
    }
    return undefined;
}

/**
 * System tray — shows connection info + controls
 */
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    let icon = fs.existsSync(iconPath)
        ? nativeImage.createFromPath(iconPath)
        : nativeImage.createEmpty();

    if (!icon.isEmpty()) {
        icon = icon.resize({ width: 16, height: 16 });
    }

    tray = new Tray(icon);

    const localIP = getLocalIP();
    tray.setToolTip(`HALT — ${localIP}:${CONFIG.backendPort}`);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open HALT',
            click: () => mainWindow?.show()
        },
        { type: 'separator' },
        {
            label: `Server: ${localIP}:${CONFIG.backendPort}`,
            enabled: false
        },
        {
            label: 'Copy Server Address',
            click: () => {
                require('electron').clipboard.writeText(`http://${localIP}:${CONFIG.backendPort}`);
            }
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
        {
            label: 'Public Patient Lookup',
            click: () => shell.openExternal(`http://${localIP}:${CONFIG.backendPort}/lookup`)
        },
        { type: 'separator' },
        {
            label: 'Quit HALT',
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

async function startup() {
    try {
        // Step 0: Kill anything lingering on our ports FIRST
        console.log('[HALT] Clearing ports before startup...');
        await clearPort(CONFIG.backendPort);
        await clearPort(CONFIG.frontendPort);
        await new Promise(r => setTimeout(r, 1000));

        createSplashWindow();

        // Step 1: Start backend
        updateSplashStatus('Starting HALT backend...');
        await startBackend();

        // Step 2: Create main window + tray
        const localIP = getLocalIP();
        updateSplashStatus(`Ready — ${localIP}:${CONFIG.backendPort}`);
        createMainWindow();
        createTray();

        console.log(`[HALT] Server running at http://${localIP}:${CONFIG.backendPort}`);
        console.log(`[HALT] Other devices can connect via browser to this address`);

    } catch (error) {
        console.error('[HALT] Startup error:', error);

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

// Handle app quit — stop backend
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

app.on('will-quit', async () => {
    await stopBackend();
});
