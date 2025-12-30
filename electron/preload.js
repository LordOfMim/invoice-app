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
  
  // PDF generation
  printToPDF: (options) => ipcRenderer.invoke('print-to-pdf', options),
  
  // Platform detection
  platform: process.platform,
  isElectron: true
});
