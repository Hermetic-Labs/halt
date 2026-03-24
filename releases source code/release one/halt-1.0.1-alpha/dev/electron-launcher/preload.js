/**
 * HALT Electron Preload Script
 * Securely exposes limited APIs to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('eveOS', {
    // App info
    getVersion: () => ipcRenderer.invoke('get-version'),

    // Services
    getServicesStatus: () => ipcRenderer.invoke('get-services-status'),
    restartServices: () => ipcRenderer.invoke('restart-services'),

    // Window controls
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),

    // Events
    onStatusUpdate: (callback) => {
        ipcRenderer.on('status-update', (event, data) => callback(data));
    }
});
