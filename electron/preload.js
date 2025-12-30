const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Storage API
  store: {
    get: (key) => ipcRenderer.invoke('store-get', key),
    set: (key, value) => ipcRenderer.invoke('store-set', key, value),
    delete: (key) => ipcRenderer.invoke('store-delete', key),
    clear: () => ipcRenderer.invoke('store-clear')
  },
  
  // App info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // Startup logs (main process)
  getStartupLogs: () => ipcRenderer.invoke('startup-log-get'),
  onStartupLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('startup-log', listener);
    return () => ipcRenderer.removeListener('startup-log', listener);
  },
  
  // PDF generation
  printToPDF: (options) => ipcRenderer.invoke('print-to-pdf', options),
  
  // Platform detection
  platform: process.platform,
  isElectron: true
});
