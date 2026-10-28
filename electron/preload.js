const { contextBridge, ipcRenderer } = require('electron');

// One cached desktop snapshot: reads and edits do not block on disk IPC.
const APP_DATA_KEY = 'invoice-app:v1';
let cachedValue;
let cacheLoaded = false;
let pendingValue;
let writeTimer;
let storageStatus = 'saved';
let writeGeneration = 0;
let revision = 0;
let batchSequence = 0;
const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let pendingOperations = [];
let inFlight = null;
let retryBatches = [];
let incrementalMode = false;
let replacementInFlight = false;
const statusListeners = new Set();
function assertEditable() {
  if (replacementInFlight) throw new Error('Eine Wiederherstellung wird gerade gespeichert. Bitte warten Sie, bis sie abgeschlossen ist.');
}
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
  assertEditable();
  clearTimeout(writeTimer);
  writeTimer = undefined;
  if (incrementalMode) {
    const pending = takeBatch();
    const batches = [...retryBatches, ...(inFlight?.batches ?? []), pending?.batch].filter(Boolean);
    writeGeneration++;
    try {
      const result = ipcRenderer.sendSync('store-flush-sync', batches);
      if (!result?.ok) throw new Error(result?.error || 'Failed to save data');
      inFlight = null;
      retryBatches = [];
      pendingValue = undefined;
      setStorageStatus('saved');
      return true;
    } catch (error) {
      retryBatches = [...new Map(batches.map(batch => [`${batch.session}:${batch.sequence}`, batch])).values()];
      inFlight = null;
      setStorageStatus('error');
      throw error;
    }
  }
  if (pendingValue === undefined && !inFlight) return true;
  const value = pendingValue ?? inFlight.value;
  writeGeneration++;
  const result = ipcRenderer.sendSync('store-set-sync', APP_DATA_KEY, value);
  if (!result?.ok) throw new Error(result?.error || 'Failed to save data');
  pendingValue = undefined;
  inFlight = null;
  setStorageStatus('saved');
  return true;
}
function takeBatch() {
  if (!pendingOperations.length) return null;
  const operations = pendingOperations;
  pendingOperations = [];
  return { batch: { session, sequence: ++batchSequence, operations }, revision, generation: writeGeneration };
}
function enqueue(operation) {
  if (pendingOperations.length >= 50000 || retryBatches.length >= 120) throw new Error('Speichern ist ausgelastet. Bitte den Vorgang wiederholen, sobald die Änderungen gespeichert sind.');
  incrementalMode = true;
  revision++;
  pendingOperations.push(operation);
  setStorageStatus('saving');
  scheduleWrite();
  return true;
}
function scheduleWrite() {
  if (writeTimer !== undefined) return;
  writeTimer = setTimeout(async () => {
    writeTimer = undefined;
    if (inFlight) return;
    if (incrementalMode) {
      const pending = takeBatch();
      const batches = [...retryBatches, pending?.batch].filter(Boolean);
      if (!batches.length) return;
      const current = { batches, revision, generation: writeGeneration };
      retryBatches = [];
      inFlight = current;
      try {
        const committed = await ipcRenderer.invoke('store-commit', current.batches);
        if (committed !== true) throw new Error('Speichern wurde nicht bestätigt.');
        if (current.generation === writeGeneration && current.revision === revision && !pendingOperations.length) { pendingValue = undefined; setStorageStatus('saved'); }
      } catch {
        if (current.generation !== writeGeneration) return;
        // Keep the exact batch identity: array splices must not be applied twice
        // if a write committed but its acknowledgement was lost.
        retryBatches = current.batches;
        setStorageStatus('error');
        ipcRenderer.send('storage-write-error');
        return;
      } finally {
        if (inFlight === current) inFlight = null;
        if (!inFlight && pendingOperations.length && storageStatus !== 'error') scheduleWrite();
      }
      return;
    }
    const value = pendingValue;
    const generation = writeGeneration;
    const currentRevision = revision;
    if (value === undefined) return;
    const current = { value, generation, revision: currentRevision };
    inFlight = current;
    try {
      if (await ipcRenderer.invoke('store-set', APP_DATA_KEY, value) !== true) throw new Error('Speichern wurde nicht bestätigt.');
      if (generation === writeGeneration && currentRevision === revision) { pendingValue = undefined; setStorageStatus('saved'); }
    } catch {
      if (generation !== writeGeneration) return;
      // Keep the latest snapshot for retry and prevent silent loss on close.
      setStorageStatus('error');
      ipcRenderer.send('storage-write-error');
    } finally {
      if (inFlight === current) inFlight = null;
      if (generation === writeGeneration && pendingValue !== undefined && currentRevision !== revision) scheduleWrite();
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
      assertEditable();
      // Reject overload before changing the cache; callers publish their state
      // only after this synchronous acceptance succeeds.
      if (incrementalMode) enqueue({ type: 'replace', value });
      cachedValue = value;
      cacheLoaded = true;
      pendingValue = value;
      if (incrementalMode) return true;
      revision++;
      setStorageStatus('saving');
      scheduleWrite();
      return true;
    },
    applyPatches: (patches) => {
      assertEditable();
      if (!Array.isArray(patches)) throw new Error('Invalid data patches');
      if (!patches.length) return true;
      // Preserve a previously accepted legacy full snapshot before switching
      // to incremental updates (for example immediately after an import).
      if (!incrementalMode && pendingValue !== undefined) pendingOperations.push({ type: 'replace', value: pendingValue });
      return enqueue({ type: 'patch', patches });
    },
    flush: async () => {
      assertEditable();
      if (incrementalMode || pendingValue !== undefined || inFlight) return flushSync();
      return ipcRenderer.invoke('store-flush');
    },
    listRecoveries: () => ipcRenderer.invoke('store-list-recoveries'),
    getRecovery: (id) => ipcRenderer.invoke('store-get-recovery', id),
    get: (key) => {
      if (key === APP_DATA_KEY && (pendingValue !== undefined || pendingOperations.length || inFlight || retryBatches.length)) {
        try { flushSync(); } catch { setStorageStatus('error'); }
      }
      return ipcRenderer.invoke('store-get', key);
    },
    set: async (key, value) => {
      const replacesData = key === APP_DATA_KEY;
      if (replacesData) {
        assertEditable();
        flushSync();
        replacementInFlight = true;
        setStorageStatus('saving');
      }
      try {
        const result = await ipcRenderer.invoke('store-set', key, value);
        if (result !== true) throw new Error('Speichern wurde nicht bestätigt.');
        if (replacesData) {
        writeGeneration++;
        revision++;
        cachedValue = value;
        cacheLoaded = true;
        pendingValue = undefined;
        pendingOperations = [];
        retryBatches = [];
        inFlight = null;
          setStorageStatus('saved');
        }
        return true;
      } catch (error) {
        if (replacesData) setStorageStatus('error');
        throw error;
      } finally {
        if (replacesData) replacementInFlight = false;
      }
    },
    getSync: (key) => {
      const result = ipcRenderer.sendSync('store-get-sync', key);
      if (!result?.ok) throw new Error(result?.error || 'Failed to read store');
      return result.value;
    },
    setSync: (key, value) => {
      if (key === APP_DATA_KEY) assertEditable();
      if (key === APP_DATA_KEY) { clearTimeout(writeTimer); writeTimer = undefined; writeGeneration++; }
      const result = ipcRenderer.sendSync('store-set-sync', key, value);
      if (!result?.ok) { if (key === APP_DATA_KEY) setStorageStatus('error'); throw new Error(result?.error || 'Failed to write store'); }
      if (key === APP_DATA_KEY) {
        writeGeneration++;
        cachedValue = value;
        cacheLoaded = true;
        pendingValue = undefined;
        revision++;
        pendingOperations = [];
        retryBatches = [];
        inFlight = null;
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
  saveDocument: (payload) => ipcRenderer.invoke('save-document', payload),
  exportEInvoice: (payload) => ipcRenderer.invoke('export-einvoice', payload),

  // Email with PDF attachment (best-effort; fully supported on macOS Apple Mail)
  emailInvoiceWithPdf: (payload) => ipcRenderer.invoke('email-invoice-with-pdf', payload),
  
  // Platform detection
  platform: process.platform,
  isElectron: true
});
