/**
 * HALT Electron Preload Script
 * Securely exposes limited APIs to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('halt', {
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
