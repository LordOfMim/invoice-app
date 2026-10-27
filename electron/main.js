const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const { spawn, execFile, fork } = require('child_process');
const http = require('http');
const fs = require('fs');

const APP_DATA_KEY = 'invoice-app:v1';
const RECOVERY_KEY_PREFIX = `${APP_DATA_KEY}:recovery`;
const STORE_NAME = 'invoice-app-data';

function escapeAppleScriptString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
    .replace(/"/g, "\\\"");
}

function encodeRfc2047(value) {
  const v = String(value ?? "");
  const base64 = Buffer.from(v, "utf8").toString("base64");
  return `=?UTF-8?B?${base64}?=`;
}

function buildEmlWithAttachment({ to, subject, body, attachmentFilename, attachmentMime, attachmentBase64 }) {
  const boundary = `----invoice-app-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const safeTo = String(to ?? "");
  const safeSubject = String(subject ?? "");
  const safeBody = String(body ?? "");
  const filename = String(attachmentFilename ?? "Invoice.pdf");
  const mime = String(attachmentMime ?? "application/pdf");

  // 76-char wrapped base64 is typical for MIME
  const wrappedBase64 = String(attachmentBase64 ?? "").replace(/(.{1,76})/g, "$1\r\n").trimEnd();

  return [
    `To: ${safeTo}`,
    `Subject: ${encodeRfc2047(safeSubject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset=\"utf-8\"`,
    `Content-Transfer-Encoding: 8bit`,
    "",
    safeBody.replace(/\n/g, "\r\n"),
    "",
    `--${boundary}`,
    `Content-Type: ${mime}; name=\"${filename}\"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename=\"${filename}\"`,
    "",
    wrappedBase64,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function openAppleMailComposeWithAttachment({ to, subject, body, attachmentPath }) {
  return new Promise((resolve, reject) => {
    const toEsc = escapeAppleScriptString(to ?? "");
    const subjectEsc = escapeAppleScriptString(subject ?? "");
    const bodyEsc = escapeAppleScriptString(body ?? "");
    const attachmentEsc = escapeAppleScriptString(attachmentPath);

    const script = [
      'tell application "Mail"',
      `set newMessage to make new outgoing message with properties {subject:"${subjectEsc}", content:"${bodyEsc}\\n\\n"}`,
      'tell newMessage',
      'set visible to true',
      toEsc
        ? `make new to recipient at end of to recipients with properties {address:"${toEsc}"}`
        : '(* no recipient provided *)',
      `make new attachment with properties {file name:((POSIX file "${attachmentEsc}") as alias)} at after the last paragraph`,
      'end tell',
      'activate',
      'end tell',
    ].join("\n");

    execFile('osascript', ['-e', script], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// electron-store is ESM, need dynamic import
let store;
let nextServer = null;
const exportWorkers = new Set();

function stopExportWorker(worker) {
  if (!worker.pid) return;
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(worker.pid), '/T', '/F'], () => {});
    else process.kill(-worker.pid, 'SIGTERM');
  } catch { worker.kill(); }
}

// Keep the encrypted bytes before this version can normalize or migrate data.
// Publish only a complete copy, with an exclusive link so older backups survive.
function backupStoreBeforeUpgrade() {
  const directory = app.getPath('userData');
  const storePath = path.join(directory, `${STORE_NAME}.json`);
  try {
    if (!fs.statSync(storePath).isFile()) throw new Error('Existing data path is not a regular file');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const version = String(app.getVersion()).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  if (!version) throw new Error('Cannot determine version for data backup');
  const backupPath = path.join(directory, `${STORE_NAME}.before-${version}.json`);
  function existingBackup() {
    try {
      if (!fs.lstatSync(backupPath).isFile()) throw new Error('Upgrade backup path is not a regular file');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  if (existingBackup()) return backupPath;
  const temporary = `${backupPath}.${require('crypto').randomUUID()}.tmp`;
  try {
    fs.copyFileSync(storePath, temporary, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
      fs.linkSync(temporary, backupPath);
    } catch (error) {
      if (error.code !== 'EEXIST' || !existingBackup()) throw error;
    }
    return backupPath;
  } catch (error) {
    throw new Error(`Die Sicherung vor dem Upgrade konnte nicht erstellt werden. Originaldaten bleiben unverändert: ${storePath}. ${String(error)}`);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

async function initStore() {
  const Store = (await import('electron-store')).default;
  const options = {
    name: STORE_NAME,
    encryptionKey: 'invoice-app-secure-key-2024',
    defaults: {
      windowBounds: { width: 1400, height: 900 }
    }
  };

  // Fail closed before electron-store can write defaults or migrated data.
  backupStoreBeforeUpgrade();
  try {
    store = new Store(options);
  } catch (error) {
    const storePath = path.join(app.getPath('userData'), `${STORE_NAME}.json`);
    // Preserve the original encrypted file and fail closed. Never replace it
    // with an empty store after a permission, decryption, or JSON error.
    const backupPath = `${storePath}.recovery-${Date.now()}`;
    if (fs.existsSync(storePath)) fs.copyFileSync(storePath, backupPath, fs.constants.COPYFILE_EXCL);
    throw new Error(`Lokale Daten konnten nicht geöffnet werden. Original: ${storePath}. Sicherung: ${backupPath}. ${String(error)}`);
  }
}

let mainWindow;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const HOST = '127.0.0.1';
let appPort = isDev ? 3000 : null;
let appOrigin = `http://${HOST}:${appPort ?? 0}`;

const startupLogBuffer = [];
const STARTUP_LOG_LIMIT = 250;

function log(...args) {
  const message = args
    .map((v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2)))
    .join(' ');
  startupLogBuffer.push(message);
  if (startupLogBuffer.length > STARTUP_LOG_LIMIT) {
    startupLogBuffer.splice(0, startupLogBuffer.length - STARTUP_LOG_LIMIT);
  }
  // Console logs help in dev; file logs help in packaged builds.
  try {
    console.log(message);
  } catch {}
  try {
    const logPath = path.join(app.getPath('userData'), 'main.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('startup-log', message);
    }
  } catch {}
}

// Check if server is ready
function waitForServer(url, timeout = 90000, { signal, requestTimeout = 5000, retryDelay = 500 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeRequest;
    let retryTimer;
    function discardRequest() {
      const request = activeRequest;
      activeRequest = undefined;
      request?.destroy();
    }
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(retryTimer);
      signal?.removeEventListener('abort', abort);
      discardRequest();
      error ? reject(error) : resolve();
    }
    function abort() { finish(new Error('Local server startup canceled')); }
    const deadlineTimer = setTimeout(() => finish(new Error('Timeout waiting for server')), timeout);
    function retry() {
      if (settled || retryTimer !== undefined) return;
      discardRequest();
      retryTimer = setTimeout(() => { retryTimer = undefined; check(); }, retryDelay);
    }
    function check() {
      if (settled) return;
      try {
        const request = http.get(url, (response) => {
          response.on('error', () => { if (activeRequest === request) retry(); });
          response.resume();
          if (settled || activeRequest !== request) { response.destroy(); return; }
          const status = response.statusCode || 0;
          if (status > 0 && status < 500) finish();
          else retry();
        });
        activeRequest = request;
        request.setTimeout(requestTimeout, () => {
          if (activeRequest === request) request.destroy(new Error('Local server request timed out'));
        });
        request.on('error', () => { if (activeRequest === request) retry(); });
        request.on('close', () => { if (activeRequest === request) retry(); });
      } catch { retry(); }
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else check();
  });
}

function findAvailablePort(host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('Could not allocate a local port'));
      });
    });
  });
}

async function startNextServer(signal) {
  if (isDev) return;
  if (nextServer && nextServer.exitCode === null) return waitForServer(appOrigin, 90000, { signal }); // Reuse and check readiness on macOS

  // In packaged builds, prefer Electron's embedded Node mode so the app
  // does not depend on an external Node.js installation.
  return new Promise(async (resolve, reject) => {
    let standaloneDir, serverPath;
    const appPath = app.getAppPath();


    // In production, check app/.next/standalone first (electron-builder output)
    standaloneDir = path.join(process.resourcesPath, 'app', '.next', 'standalone');
    serverPath = path.join(standaloneDir, 'server.js');
    log('Production (app/) standalone dir:', standaloneDir);
    log('Production (app/) server path:', serverPath);

    if (!fs.existsSync(serverPath)) {
      // Fallback: try resourcesPath/.next/standalone (older config)
      standaloneDir = path.join(process.resourcesPath, '.next', 'standalone');
      serverPath = path.join(standaloneDir, 'server.js');
      log('Fallback (resources/.next) server path:', serverPath);
    }

    if (!fs.existsSync(serverPath)) {
      // Fallback: try appPath (for dev/testing)
      standaloneDir = path.join(appPath, '.next', 'standalone');
      serverPath = path.join(standaloneDir, 'server.js');
      log('Fallback (appPath) server path:', serverPath);
    }

    if (!fs.existsSync(serverPath)) {
      log('Standalone server not found!');
      reject(new Error('Packaged standalone server not found'));
      return;
    }

    // NOTE: Do not copy assets at runtime in production.
    // Installed apps often live in read-only locations (e.g. Program Files),
    // which causes startup failures and the loading screen to hang.
    // Assets should be copied into `.next/standalone` during the build step.

    try {
      appPort = await findAvailablePort(HOST);
      appOrigin = `http://${HOST}:${appPort}`;
      log('Allocated local app port:', appPort);

      const nodeCmd = isDev
        ? (process.platform === 'win32' ? 'node.exe' : 'node')
        : process.execPath;

      nextServer = spawn(nodeCmd, [serverPath], {
        cwd: standaloneDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: appPort.toString(),
          HOSTNAME: HOST,
          ...(isDev ? {} : { ELECTRON_RUN_AS_NODE: '1' })
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      });

      nextServer.stdout.on('data', (data) => {
        log('Next.js:', data.toString());
      });

      nextServer.stderr.on('data', (data) => {
        log('Next.js error:', data.toString());
      });

      nextServer.on('error', (err) => {
        log('Failed to start Next.js:', err);
        reject(err);
      });

      nextServer.on('exit', (code, signal) => {
        log('Next.js server exited with code:', code, 'signal:', signal);
        reject(new Error(`Local server exited (${code ?? signal})`));
      });

      // Wait for server to be ready
      log('Waiting for Next.js server on', appOrigin);
      await waitForServer(appOrigin, 90000, { signal });
      log('Next.js server ready!');
    } catch (err) {
      log('Error starting Next.js server:', err);
      reject(err);
      return;
    }

    resolve();
  });
}

async function createWindow() {
  try {
    if (!store) await initStore();
  } catch (error) {
    log('Failed to initialize electron-store:', error);
    dialog.showErrorBox('Helferlein – Daten konnten nicht geladen werden', String(error));
    app.quit();
    return;
  }

  const bounds = store?.get('windowBounds') || { width: 1400, height: 900 };

  const startupController = new AbortController();
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    show: false,
    icon: path.join(__dirname, '../public/icon.png')
  });

  mainWindow = win;

  function showError(message) {
    if (win.isDestroyed()) return;
    win.loadFile(path.join(__dirname, 'server-error.html'), { query: { message } })
      .catch((error) => { if (!win.isDestroyed()) log('Failed to show server error', String(error)); });
  }

  // Show loading screen instantly
  win.loadFile(path.join(__dirname, 'loading.html')).catch((error) => {
    if (!win.isDestroyed()) log('Failed to load loading screen', String(error));
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  win.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== appOrigin) event.preventDefault(); } catch { event.preventDefault(); }
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (win.isDestroyed() || errorCode === -3) return;
    log('did-fail-load', { errorCode, errorDescription, validatedURL });
    // Do not recursively reload an error page that itself failed to load.
    if (validatedURL.startsWith('file:')) return;
    showError(`Failed to load: ${validatedURL} (${errorCode}) ${errorDescription}`);
  });

  win.webContents.on('render-process-gone', (event, details) => {
    log('render-process-gone', details);
  });

  // Start server and wait, but do not block window display
  (async () => {
    let serverError = null;
    if (!isDev) {
      try {
        log('Starting Next.js server...');
        await startNextServer(startupController.signal);
      } catch (err) {
        log('Server failed to start:', err);
        serverError = err;
      }
    }
    if (win.isDestroyed() || startupController.signal.aborted) return;
    const url = appOrigin;
    if (!serverError) {
      win.loadURL(url).catch((error) => {
        if (win.isDestroyed() || startupController.signal.aborted) return;
        log('Failed to load app URL:', String(error));
        showError(`Failed to load URL: ${url}. ${String(error)}`);
      });
    } else {
      showError(String(serverError));
    }
    if (isDev && !win.isDestroyed()) win.webContents.openDevTools();
  })().catch((error) => {
    if (!win.isDestroyed()) { log('Window startup failed:', String(error)); showError(String(error)); }
  });

  win.on('close', () => {
    try {
      if (store && !win.isDestroyed()) store.set('windowBounds', win.getBounds());
    } catch (error) {
      // Geometry is optional. A disk error must not interrupt beforeunload's data flush.
      log('Could not save window bounds:', String(error));
    }
  });

  win.on('closed', () => {
    startupController.abort();
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        shell.openExternal(url);
      }
    } catch {}
    return { action: 'deny' };
  });
}

ipcMain.handle('startup-log-get', async (event) => {
  ensureTrustedSender(event, { allowFile: true });
  return startupLogBuffer.slice();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
    else void createWindow().catch((error) => log('Failed to reopen window:', String(error)));
  });
  app.whenReady().then(() => {
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' },
      { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
    return createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// before-quit precedes renderer beforeunload, which can cancel quitting when
// a save fails. Keep the server available until quitting is confirmed.
app.on('will-quit', () => {
  if (nextServer) {
    nextServer.kill();
  }
  for (const worker of exportWorkers) stopExportWorker(worker);
});

function isTrustedSender(event, { allowFile = false } = {}) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) return false;
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  try {
    const parsed = new URL(senderUrl);
    if (allowFile && parsed.protocol === 'file:') return true;
    return parsed.origin === appOrigin;
  } catch {
    return false;
  }
}

function ensureTrustedSender(event, options) {
  if (!isTrustedSender(event, options)) {
    throw new Error('Blocked IPC call from untrusted sender');
  }
}

function isAllowedStoreKey(key) {
  return key === APP_DATA_KEY || String(key).startsWith(`${RECOVERY_KEY_PREFIX}:`);
}

ipcMain.on('store-get-sync', (event, key) => {
  try {
    ensureTrustedSender(event);
    if (!isAllowedStoreKey(key)) throw new Error('Blocked store key');
    if (!store) throw new Error('Store is not initialized');
    event.returnValue = { ok: true, value: store.get(key) };
  } catch (error) {
    event.returnValue = { ok: false, error: String(error) };
  }
});

ipcMain.on('store-set-sync', (event, key, value) => {
  try {
    ensureTrustedSender(event);
    if (!isAllowedStoreKey(key)) throw new Error('Blocked store key');
    if (!store) throw new Error('Store is not initialized');
    store.set(key, value);
    event.returnValue = { ok: true };
  } catch (error) {
    event.returnValue = { ok: false, error: String(error) };
  }
});

// IPC handlers for storage
ipcMain.handle('store-get', async (event, key) => {
  ensureTrustedSender(event);
  if (!isAllowedStoreKey(key)) throw new Error('Blocked store key');
  if (!store) await initStore();
  return store.get(key);
});

ipcMain.on('storage-write-error', (event) => {
  ensureTrustedSender(event);
  dialog.showErrorBox('Helferlein – Speichern fehlgeschlagen', 'Die letzten Änderungen konnten nicht gespeichert werden. Bitte die App geöffnet lassen, freien Speicher und Zugriffsrechte prüfen und eine Sicherung exportieren.');
});

ipcMain.handle('store-set', async (event, key, value) => {
  ensureTrustedSender(event);
  if (!isAllowedStoreKey(key)) throw new Error('Blocked store key');
  if (!store) await initStore();
  store.set(key, value);
  return true;
});

ipcMain.handle('store-delete', async (event, key) => {
  ensureTrustedSender(event);
  if (!String(key).startsWith(`${RECOVERY_KEY_PREFIX}:`)) throw new Error('Blocked store key');
  if (!store) await initStore();
  store.delete(key);
  return true;
});

ipcMain.handle('store-clear', async (event) => {
  ensureTrustedSender(event);
  throw new Error('Clearing the entire store is disabled');
});

ipcMain.handle('get-app-info', (event) => {
  ensureTrustedSender(event, { allowFile: true });
  return {
    version: app.getVersion(),
    name: app.getName(),
    path: app.getPath('userData')
  };
});

function safeDocumentFilename(value, extension) {
  const name = String(value || 'Rechnung').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/^\.+/, '').trim().slice(0, 160) || 'Rechnung';
  return name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
}

async function saveDocument(win, filename, bytes, extension) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: safeDocumentFilename(filename, extension),
    filters: [{ name: extension === 'pdf' ? 'PDF-Dokument' : 'XML-Rechnung', extensions: [extension] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${require('crypto').randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(temporary, filePath);
    return { ok: true };
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
}

ipcMain.handle('save-document', async (event, payload) => {
  ensureTrustedSender(event);
  try {
    const bytes = Buffer.from(payload?.bytes ?? []);
    if (!bytes.length || bytes.length > 100 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Ungültige PDF-Datei.');
    return await saveDocument(BrowserWindow.fromWebContents(event.sender), payload.filename, bytes, 'pdf');
  } catch (error) { return { ok: false, error: error.message }; }
});

let eInvoiceExportRunning = false;
ipcMain.handle('export-einvoice', async (event, payload) => {
  ensureTrustedSender(event);
  if (eInvoiceExportRunning) return { ok: false, error: 'Es wird bereits eine E-Rechnung erstellt. Bitte warten.' };
  if (!['zugferd', 'xrechnung'].includes(payload?.format)) return { ok: false, error: 'Unbekanntes Rechnungsformat.' };
  eInvoiceExportRunning = true;
  try {
    if (!payload.document || Buffer.byteLength(JSON.stringify(payload.document)) > 20 * 1024 * 1024) throw new Error('Die E-Rechnungsdaten sind zu groß oder unvollständig.');
    const result = await new Promise((resolve, reject) => {
      const worker = fork(path.join(__dirname, 'einvoice-worker.cjs'), [], {
        execPath: process.execPath,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        serialization: 'advanced',
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      exportWorkers.add(worker);
      let settled = false;
      function finish(error, message) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        error ? reject(error) : resolve(message);
      }
      const timeout = setTimeout(() => { stopExportWorker(worker); finish(new Error('Die Prüfung hat das Zeitlimit überschritten. Bitte erneut versuchen.')); }, 120000);
      worker.once('message', (message) => finish(message.ok ? null : new Error(message.error), message));
      worker.once('error', (error) => finish(error));
      worker.once('exit', () => {
        exportWorkers.delete(worker);
        finish(new Error('Die E-Rechnungsprüfung wurde unterbrochen.'));
      });
      worker.send({
        format: payload.format,
        document: payload.document,
        runtimeDir: app.isPackaged ? path.join(process.resourcesPath, 'einvoice-runtime') : path.join(__dirname, 'einvoice-runtime'),
        assetsDir: app.isPackaged ? path.join(process.resourcesPath, 'einvoice-assets') : path.join(__dirname, 'einvoice-assets'),
      });
    });
    const filename = `${payload.document?.number || 'Rechnung'}-${payload.format}`;
    return await saveDocument(BrowserWindow.fromWebContents(event.sender), filename, Buffer.from(result.bytes), result.extension);
  } catch (error) { return { ok: false, error: error.message || 'Export fehlgeschlagen.' }; }
  finally { eInvoiceExportRunning = false; }
});

ipcMain.handle('print-to-pdf', async (event, options) => {
  ensureTrustedSender(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;

  try {
    const pdfData = await win.webContents.printToPDF({
      marginsType: 0,
      printBackground: true,
      pageSize: 'A4',
      ...options
    });
    return pdfData;
  } catch (error) {
    console.error('PDF generation failed:', error);
    return null;
  }
});

ipcMain.handle('email-invoice-with-pdf', async (event, payload) => {
  ensureTrustedSender(event);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'No active window' };

  const to = payload?.to ?? "";
  const subject = payload?.subject ?? "";
  const body = payload?.body ?? "";
  const requestedFilename = payload?.filename ?? "Invoice.pdf";
  const filename = safeDocumentFilename(requestedFilename, 'pdf');

  try {
    const pdfData = await win.webContents.printToPDF({
      marginsType: 0,
      printBackground: true,
      pageSize: 'A4',
    });

    const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'invoice-app-'));
    const pdfPath = path.join(tempDir, filename);
    fs.writeFileSync(pdfPath, pdfData);

    if (process.platform === 'darwin') {
      await openAppleMailComposeWithAttachment({ to, subject, body, attachmentPath: pdfPath });
      return { ok: true };
    }

    const eml = buildEmlWithAttachment({
      to,
      subject,
      body,
      attachmentFilename: filename,
      attachmentMime: 'application/pdf',
      attachmentBase64: Buffer.from(pdfData).toString('base64'),
    });
    const emlPath = path.join(tempDir, 'invoice-email.eml');
    fs.writeFileSync(emlPath, eml);
    await shell.openPath(emlPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});
