const { contextBridge, ipcRenderer } = require('electron');

// One cached desktop snapshot: reads and edits do not block on disk IPC.
const APP_DATA_KEY = 'invoice-app:v1';
let cachedValue;
let cacheLoaded = false;
let pendingValue;
let writeTimer;
let storageStatus = 'saved';
const statusListeners = new Set();
function setStorageStatus(status) {
  storageStatus = status;
  for (const listener of statusListeners) { try { listener(status); } catch {} }
}
function readSync(key) {
  const result = ipcRenderer.sendSync('store-get-sync', key);
  if (!result?.ok) throw new Error(result?.error || 'Failed to read store');
  return result.value;
}
function flushSync() {
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (pendingValue === undefined) return true;
  const result = ipcRenderer.sendSync('store-set-sync', APP_DATA_KEY, pendingValue);
  if (!result?.ok) throw new Error(result?.error || 'Failed to save data');
  pendingValue = undefined;
  setStorageStatus('saved');
  return true;
}
function scheduleWrite() {
  if (writeTimer !== undefined) return;
  writeTimer = setTimeout(async () => {
    writeTimer = undefined;
    const value = pendingValue;
    if (value === undefined) return;
    try {
      await ipcRenderer.invoke('store-set', APP_DATA_KEY, value);
      if (pendingValue === value) { pendingValue = undefined; setStorageStatus('saved'); }
    } catch {
      // Keep the latest snapshot for retry and prevent silent loss on close.
      setStorageStatus('error');
      ipcRenderer.send('storage-write-error');
    }
  }, 250);
}
window.addEventListener('beforeunload', (event) => {
  try { flushSync(); } catch {
    setStorageStatus('error');
    event.preventDefault();
    event.returnValue = false;
    ipcRenderer.send('storage-write-error');
  }
});

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Storage API
  store: {
    onStatus: (callback) => {
      statusListeners.add(callback);
      callback(storageStatus);
      return () => statusListeners.delete(callback);
    },
    getCached: (key) => {
      if (key !== APP_DATA_KEY) return readSync(key);
      if (!cacheLoaded) { cachedValue = readSync(key); cacheLoaded = true; }
      return cachedValue;
    },
    setCached: (key, value) => {
      if (key !== APP_DATA_KEY || typeof value !== 'string') throw new Error('Invalid storage write');
      cachedValue = value;
      cacheLoaded = true;
      pendingValue = value;
      setStorageStatus('saving');
      scheduleWrite();
      return true;
    },
    get: (key) => ipcRenderer.invoke('store-get', key),
    set: (key, value) => ipcRenderer.invoke('store-set', key, value),
    getSync: (key) => {
      const result = ipcRenderer.sendSync('store-get-sync', key);
      if (!result?.ok) throw new Error(result?.error || 'Failed to read store');
      return result.value;
    },
    setSync: (key, value) => {
      if (key === APP_DATA_KEY) { clearTimeout(writeTimer); writeTimer = undefined; }
      const result = ipcRenderer.sendSync('store-set-sync', key, value);
      if (!result?.ok) throw new Error(result?.error || 'Failed to write store');
      if (key === APP_DATA_KEY) {
        cachedValue = value;
        cacheLoaded = true;
        pendingValue = undefined;
        setStorageStatus('saved');
      }
      return true;
    },
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

  // Email with PDF attachment (best-effort; fully supported on macOS Apple Mail)
  emailInvoiceWithPdf: (payload) => ipcRenderer.invoke('email-invoice-with-pdf', payload),
  
  // Platform detection
  platform: process.platform,
  isElectron: true
});
