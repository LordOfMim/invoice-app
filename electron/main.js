const { app, BrowserWindow, ipcMain, shell, dialog, Menu, screen, safeStorage } = require('electron');
const path = require('path');
const { spawn, execFile, fork } = require('child_process');
const http = require('http');
const fs = require('fs');
const { createDurableStoreClass, createSnapshotVerifier, ensurePrivateDirectory, syncDirectory } = require(path.join(__dirname, 'durable-store.cjs'));
const { StorageClient } = require(path.join(__dirname, 'storage-client.cjs'));
const { deliverEInvoice } = require(path.join(__dirname, 'einvoice-delivery.cjs'));
const { ArchiveSession, folderStatus, safeEntryName, writeBackup } = require(path.join(__dirname, 'local-files.cjs'));
const { isValidPersistedData } = require(path.join(__dirname, 'storage-validation.cjs'));
const { MailService } = require(path.join(__dirname, 'mail-service.cjs'));
const mailCore = require(path.join(__dirname, 'mail-core.cjs'));

const APP_DATA_KEY = 'invoice-app:v1';
const RECOVERY_KEY_PREFIX = `${APP_DATA_KEY}:recovery`;
const STORE_NAME = 'invoice-app-data';
const AUX_DATA_KEY = 'fachunternehmer-defaults';
// Main-only setting: the renderer can ask for a folder dialog but can never name a path itself.
const BACKUP_FOLDER_KEY = 'autoBackupFolder';

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
  if (/[\r\n]/.test(safeTo)) throw new Error('Die E-Mail-Adresse enthält ungültige Zeilenumbrüche.');
  const safeSubject = String(subject ?? "");
  const safeBody = String(body ?? "");
  const filename = String(attachmentFilename ?? "Invoice.pdf").replace(/[\r\n"\\]/g, '_');
  const mime = String(attachmentMime ?? "application/pdf");
  if (!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mime)) throw new Error('Ungültiger Anlagentyp.');

  // 76-char wrapped base64 is typical for MIME
  const wrappedBase64 = String(attachmentBase64 ?? "").replace(/(.{1,76})/g, "$1\r\n").trimEnd();

  return [
    `To: ${safeTo}`,
    `Subject: ${encodeRfc2047(safeSubject)}`,
    `X-Unsent: 1`, // opens as an editable draft in Outlook instead of a received message
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
let storageOptions;
let storeInitPromise;
let actorPromise;
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
function backupStoreBeforeUpgrade(verifySnapshot) {
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
      const stats = fs.lstatSync(backupPath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0) throw new Error('Die vorhandene Upgrade-Sicherung ist unvollständig. Original bleibt unverändert.');
      if (verifySnapshot && !verifySnapshot(fs.readFileSync(backupPath))) throw new Error('Die vorhandene Upgrade-Sicherung ist nicht vollständig lesbar. Original bleibt unverändert.');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  if (existingBackup()) return backupPath;
  const temporary = `${backupPath}.${require('crypto').randomUUID()}.tmp`;
  let publishedByUs = false;
  try {
    fs.copyFileSync(storePath, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, 0o600);
    // Windows FlushFileBuffers requires a handle with write access.
    const descriptor = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
      fs.linkSync(temporary, backupPath);
      publishedByUs = true;
    } catch (error) {
      if (['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EMLINK'].includes(error.code)) {
        // No hard links on this filesystem (exFAT, some network shares): exclusive copy instead.
        fs.copyFileSync(temporary, backupPath, fs.constants.COPYFILE_EXCL);
        publishedByUs = true;
      } else if (error.code !== 'EEXIST' || !existingBackup()) throw error;
    }
    if (publishedByUs && !fs.readFileSync(storePath).equals(fs.readFileSync(backupPath))) throw new Error('Die Upgrade-Sicherung stimmt nicht mit dem Original überein.');
    syncDirectory(directory);
    return backupPath;
  } catch (error) {
    throw new Error(`Die Sicherung vor dem Upgrade konnte nicht erstellt werden. Originaldaten bleiben unverändert: ${storePath}. ${String(error)}`);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

async function initStore() {
  if (storeInitPromise) return storeInitPromise;
  storeInitPromise = initializeStore();
  return storeInitPromise;
}

async function initializeStore() {
  const Store = (await import('electron-store')).default;
  const options = {
    name: STORE_NAME,
    encryptionKey: 'invoice-app-secure-key-2024',
    configFileMode: 0o600,
  };
  storageOptions = options;

  // Fail closed before electron-store can write defaults or migrated data.
  const directory = app.getPath('userData');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  ensurePrivateDirectory(directory);
  const verifier = typeof Store.prototype._decryptData === 'function' ? createSnapshotVerifier(Store, options, directory) : undefined;
  backupStoreBeforeUpgrade(verifier);
  try {
    const DurableStore = createDurableStoreClass(Store);
    store = new DurableStore(options);
  } catch (error) {
    const storePath = path.join(app.getPath('userData'), `${STORE_NAME}.json`);
    // Preserve the original encrypted file and fail closed. Never replace it
    // with an empty store after a permission, decryption, or JSON error.
    const backupPath = `${storePath}.recovery-${Date.now()}`;
    if (fs.existsSync(storePath)) { fs.copyFileSync(storePath, backupPath, fs.constants.COPYFILE_EXCL); fs.chmodSync(backupPath, 0o600); }
    throw new Error(`Lokale Daten konnten nicht geöffnet werden. Original: ${storePath}. Sicherung: ${backupPath}. ${String(error)}`);
  }
}

async function ensureStorageActor() {
  if (!actorPromise) actorPromise = (async () => {
    await initStore();
    const actor = new StorageClient({ directory: app.getPath('userData'), name: STORE_NAME, encryptionKey: storageOptions.encryptionKey });
    await actor.ready;
    store = actor;
    return actor;
  })();
  return actorPromise;
}

let mainWindow;

// Saved geometry is optional: ignore anything malformed, and drop a position that
// no connected display covers (e.g. the app was last closed on an unplugged monitor).
function restorableBounds(saved) {
  const fallback = { width: 1400, height: 900 };
  if (!saved || typeof saved !== 'object') return fallback;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  if (!finite(saved.width) || !finite(saved.height) || saved.width < 200 || saved.height < 200) return fallback;
  const size = { width: Math.round(saved.width), height: Math.round(saved.height) };
  if (!finite(saved.x) || !finite(saved.y)) return size;
  const visible = (screen?.getAllDisplays?.() ?? []).some(({ workArea }) =>
    saved.x < workArea.x + workArea.width - 100 && saved.x + size.width > workArea.x + 100 &&
    saved.y < workArea.y + workArea.height - 100 && saved.y >= workArea.y - 20);
  return visible ? { ...size, x: Math.round(saved.x), y: Math.round(saved.y) } : size;
}

// An installed app must never trust a stray NODE_ENV and attach to whatever listens on port 3000.
const isDev = !app.isPackaged;
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
  if (nextServer && nextServer.exitCode === null && nextServer.signalCode === null) return waitForServer(appOrigin, 90000, { signal }); // Reuse and check readiness on macOS

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

let creatingWindow;
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return Promise.resolve(); }
  if (!creatingWindow) creatingWindow = createWindowInternal().finally(() => { creatingWindow = undefined; });
  return creatingWindow;
}

async function createWindowInternal() {
  try {
    await ensureStorageActor();
  } catch (error) {
    log('Failed to initialize electron-store:', error);
    dialog.showErrorBox('Helferlein – Daten konnten nicht geladen werden', String(error));
    app.quit();
    return;
  }

  const previousBounds = await store.get('windowBounds');
  const bounds = restorableBounds(previousBounds);

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
      if (store && !win.isDestroyed()) Promise.resolve(store.set('windowBounds', win.getNormalBounds())).catch(error => log('Could not save window bounds:', String(error)));
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
  if (store instanceof StorageClient) void store.close().catch(() => {});
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
  return key === APP_DATA_KEY || key === AUX_DATA_KEY || String(key).startsWith(`${RECOVERY_KEY_PREFIX}:`);
}

ipcMain.on('store-get-sync', async (event, key) => {
  try {
    ensureTrustedSender(event);
    if (!isAllowedStoreKey(key)) throw new Error('Blocked store key');
    const backend = await ensureStorageActor();
    event.returnValue = { ok: true, value: await backend.get(key) };
  } catch (error) {
    event.returnValue = { ok: false, error: String(error) };
  }
});

ipcMain.on('store-set-sync', async (event, key, value) => {
  try {
    ensureTrustedSender(event);
    if (!isAllowedStoreKey(key)) throw new Error('Blocked store key');
    const backend = await ensureStorageActor();
    await backend.set(key, value);
    event.returnValue = { ok: true };
  } catch (error) {
    event.returnValue = { ok: false, error: String(error) };
  }
});

// IPC handlers for storage
ipcMain.handle('store-get', async (event, key) => {
  ensureTrustedSender(event);
  if (!isAllowedStoreKey(key)) throw new Error('Blocked store key');
  return (await ensureStorageActor()).get(key);
});

ipcMain.on('storage-write-error', (event) => {
  ensureTrustedSender(event);
  dialog.showErrorBox('Helferlein – Speichern fehlgeschlagen', 'Die letzten Änderungen konnten nicht gespeichert werden. Bitte die App geöffnet lassen, freien Speicher und Zugriffsrechte prüfen und eine Sicherung exportieren.');
});

ipcMain.handle('store-set', async (event, key, value) => {
  ensureTrustedSender(event);
  if (!isAllowedStoreKey(key)) throw new Error('Blocked store key');
  await (await ensureStorageActor()).set(key, value);
  return true;
});

ipcMain.handle('store-delete', async (event, key) => {
  ensureTrustedSender(event);
  if (!String(key).startsWith(`${RECOVERY_KEY_PREFIX}:`)) throw new Error('Blocked store key');
  await (await ensureStorageActor()).delete(key);
  return true;
});

ipcMain.handle('store-clear', async (event) => {
  ensureTrustedSender(event);
  throw new Error('Clearing the entire store is disabled');
});

ipcMain.handle('store-commit', async (event, batches) => {
  ensureTrustedSender(event);
  return (await ensureStorageActor()).commit(batches);
});
ipcMain.on('store-flush-sync', async (event, batches) => {
  try {
    ensureTrustedSender(event);
    const backend = await ensureStorageActor();
    if (batches?.length) await backend.commit(batches);
    await backend.flush();
    event.returnValue = { ok: true };
  } catch (error) { event.returnValue = { ok: false, error: String(error) }; }
});
ipcMain.handle('store-flush', async event => {
  ensureTrustedSender(event);
  return (await ensureStorageActor()).flush();
});
ipcMain.handle('store-list-recoveries', async event => {
  ensureTrustedSender(event);
  return (await ensureStorageActor()).listRecoveries();
});
ipcMain.handle('store-get-recovery', async (event, id) => {
  ensureTrustedSender(event);
  return (await ensureStorageActor()).getRecovery(id);
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

const DOCUMENT_FILTER_NAMES = { pdf: 'PDF-Dokument', json: 'Sicherungsdatei', csv: 'Liste für Excel (CSV)' };

async function saveDocument(win, filename, bytes, extension) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: safeDocumentFilename(filename, extension),
    filters: [{ name: DOCUMENT_FILTER_NAMES[extension] || 'XML-Rechnung', extensions: [extension] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${require('crypto').randomUUID()}.tmp`);
  try {
    const handle = await fs.promises.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (!(await fs.promises.readFile(temporary)).equals(bytes)) throw new Error('Die gespeicherte Datei ist unvollständig.');
    await fs.promises.rename(temporary, filePath);
    syncDirectory(path.dirname(filePath));
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

// Backup files (JSON) and lists (CSV) written by the window: the user chooses the place in the system dialog, and
// the window learns whether the file was really saved or the dialog was cancelled.
ipcMain.handle('save-text-file', async (event, payload) => {
  ensureTrustedSender(event);
  try {
    if (!['json', 'csv'].includes(payload?.extension) || typeof payload.text !== 'string') throw new Error('Ungültige Datei.');
    const bytes = Buffer.from(payload.text, 'utf8');
    if (!bytes.length || bytes.length > 512 * 1024 * 1024) throw new Error('Die Datei ist leer oder zu groß.');
    return await saveDocument(BrowserWindow.fromWebContents(event.sender), payload.filename, bytes, payload.extension);
  } catch (error) { return { ok: false, error: error.message }; }
});

let eInvoiceExportRunning = false;
ipcMain.handle('export-einvoice', async (event, payload) => {
  ensureTrustedSender(event);
  if (eInvoiceExportRunning) return { ok: false, error: 'Es wird bereits eine E-Rechnung erstellt. Bitte warten.' };
  if (!['zugferd', 'xrechnung'].includes(payload?.format)) return { ok: false, error: 'Unbekanntes Rechnungsformat.' };
  if (payload.delivery !== undefined && !['download', 'email', 'attach'].includes(payload.delivery)) return { ok: false, error: 'Unbekannte Übergabeart.' };
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
      const timeout = setTimeout(() => { stopExportWorker(worker); finish(new Error('Die Prüfung hat das Zeitlimit überschritten. Bitte erneut versuchen.')); }, 240000);
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
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) throw new Error('Kein aktives Fenster.');
    return await deliverEInvoice({ artifact: result, format: payload.format, number: payload.document.number, delivery: payload.delivery ?? 'download', email: payload.email ?? {} }, {
      saveDocument: (filename, bytes, extension) => saveDocument(win, filename, bytes, extension),
      stageAttachment: (filename, bytes, mimeType) => stageMailAttachment(filename, bytes, mimeType),
      ...(process.platform === 'darwin' ? { composeWithAttachment: openAppleMailComposeWithAttachment } : { openPath: filename => shell.openPath(filename) }),
      tempRoot: app.getPath('temp'),
    });
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
  if (/[\r\n]/.test(String(to))) return { ok: false, error: 'Die E-Mail-Adresse enthält ungültige Zeilenumbrüche.' };
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
    fs.writeFileSync(pdfPath, pdfData, { mode: 0o600 });

    if (process.platform === 'darwin') {
      await openAppleMailComposeWithAttachment({ to, subject, body, attachmentPath: pdfPath });
      return { ok: true, prepared: true };
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
    fs.writeFileSync(emlPath, eml, { mode: 0o600 });
    const error = await shell.openPath(emlPath);
    if (error) throw new Error(error);
    return { ok: true, prepared: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

// ── Automatic backups ────────────────────────────────────────────────────────────────────────────────────────────
// The folder is chosen in a native dialog and remembered here in the main process. The renderer only supplies the
// JSON it already holds; it cannot direct a write to any other location.

async function backupFolderStatus() {
  return folderStatus(await (await ensureStorageActor()).get(BACKUP_FOLDER_KEY));
}

ipcMain.handle('backup-folder-get', async (event) => {
  ensureTrustedSender(event);
  try { return { ok: true, ...(await backupFolderStatus()) }; }
  catch (error) { return { ok: false, folder: null, available: false, error: error.message }; }
});

ipcMain.handle('backup-folder-choose', async (event) => {
  ensureTrustedSender(event);
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const current = await backupFolderStatus();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Ordner für automatische Sicherungen',
      buttonLabel: 'Ordner verwenden',
      defaultPath: current.available ? current.folder : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
    const status = await folderStatus(filePaths[0]);
    if (!status.available) return { ok: false, error: 'In diesem Ordner kann Helferlein nicht speichern. Bitte einen anderen Ordner wählen.' };
    await (await ensureStorageActor()).set(BACKUP_FOLDER_KEY, status.folder);
    return { ok: true, ...status };
  } catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('backup-folder-clear', async (event) => {
  ensureTrustedSender(event);
  try { await (await ensureStorageActor()).set(BACKUP_FOLDER_KEY, ''); return { ok: true }; }
  catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('backup-folder-open', async (event) => {
  ensureTrustedSender(event);
  try {
    const status = await backupFolderStatus();
    if (!status.available) return { ok: false, error: 'Der Sicherungsordner ist nicht erreichbar.' };
    const error = await shell.openPath(status.folder);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
});

let backupRunning = false;
ipcMain.handle('backup-write', async (event, payload) => {
  ensureTrustedSender(event);
  if (backupRunning) return { ok: false, error: 'Es läuft bereits eine Sicherung.' };
  backupRunning = true;
  try {
    const status = await backupFolderStatus();
    if (!status.folder) return { ok: false, error: 'Es ist noch kein Sicherungsordner gewählt.' };
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const result = await writeBackup({ folder: status.folder, json: payload?.json, today, validate: isValidPersistedData });
    return { ok: true, ...result };
  } catch (error) { return { ok: false, error: error.message || 'Die Sicherung ist fehlgeschlagen.' }; }
  finally { backupRunning = false; }
});

// ── Archive for the tax advisor ──────────────────────────────────────────────────────────────────────────────────
// One export at a time: the target comes from a save dialog, the PDFs are printed here from the visible document,
// and nothing touches the disk until the complete archive is written atomically.

let archiveSession = null;

ipcMain.handle('export-archive-begin', async (event, payload) => {
  ensureTrustedSender(event);
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export für die Steuerberatung speichern',
      defaultPath: path.join(app.getPath('documents'), safeEntryName(payload?.filename || 'Helferlein-Export', 'zip')),
      filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    archiveSession = new ArchiveSession(filePath.toLowerCase().endsWith('.zip') ? filePath : `${filePath}.zip`);
    return { ok: true };
  } catch (error) { archiveSession = null; return { ok: false, error: error.message }; }
});

ipcMain.handle('export-archive-add-pdf', async (event, payload) => {
  ensureTrustedSender(event);
  try {
    if (!archiveSession) throw new Error('Es läuft kein Export.');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) throw new Error('Kein aktives Fenster.');
    const pdf = Buffer.from(await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true }));
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Die PDF konnte nicht erstellt werden.');
    return { ok: true, name: archiveSession.add(payload?.name, 'pdf', pdf) };
  } catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('export-archive-add-text', async (event, payload) => {
  ensureTrustedSender(event);
  try {
    if (!archiveSession) throw new Error('Es läuft kein Export.');
    if (!['csv', 'txt'].includes(payload?.extension) || typeof payload.text !== 'string') throw new Error('Ungültige Datei für den Export.');
    return { ok: true, name: archiveSession.add(payload.name, payload.extension, Buffer.from(payload.text, 'utf8')) };
  } catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('export-archive-finish', async (event, payload) => {
  ensureTrustedSender(event);
  const session = archiveSession;
  archiveSession = null;
  try {
    if (!session) throw new Error('Es läuft kein Export.');
    if (payload?.cancel) return { ok: false, canceled: true };
    const result = await session.finish();
    syncDirectory(path.dirname(result.path));
    if (payload?.reveal !== false) shell.showItemInFolder(result.path);
    return { ok: true, count: result.count, file: path.basename(result.path) };
  } catch (error) { return { ok: false, error: error.message || 'Der Export konnte nicht gespeichert werden.' }; }
});

// ── Built-in mailbox ─────────────────────────────────────────────────────────────────────────────────────────────
// IMAP/SMTP run here in the main process. The window passes plain data and receives plain data; it never sees the
// password again after entering it, and it cannot name files: attachments come from a native dialog, from the
// printed page or from a validated e-invoice and are referred to by a random id.

let mailService = null;
function mail() {
  if (!mailService) {
    mailService = new MailService({
      dir: path.join(app.getPath('userData'), 'mail'),
      codec: {
        available: () => { try { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'); } catch { return false; } },
        encrypt: text => safeStorage.encryptString(text),
        decrypt: bytes => safeStorage.decryptString(bytes),
      },
    });
  }
  return mailService;
}

// Files of an open draft stay until it is sent or closed; abandoned ones go after a few sweeps (mail-core.cjs).
const stagedMailAttachments = mailCore.createAttachmentStage({ newId: () => require('crypto').randomUUID() });
// The sweep starts with the first staged file, so a session without mail never runs a timer.
let stagedMailSweep = null;
// Ids the window names for its open draft. Ids that are not well-formed cannot be staged files and are left out.
const stagedIds = value => (Array.isArray(value) ? value : []).filter(mailCore.isStagedId).slice(0, mailCore.MAX_STAGED_ATTACHMENTS);
const mailFileName = filename => String(filename || 'Anhang').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/^\.+/, '').trim().slice(0, 160) || 'Anhang';
/** Sizes of the draft's files that are still held; the stage is told that this draft needs them. */
function heldMailAttachments(ids) {
  stagedMailAttachments.claim(ids);
  return ids.map(id => stagedMailAttachments.get(id)?.bytes.length).filter(size => size !== undefined);
}
/** @param {string[]} [keep] ids of the draft this file joins; its limits are checked by the caller. */
function stageMailAttachment(filename, bytes, contentType, keep = []) {
  const buffer = Buffer.from(bytes);
  const name = mailFileName(filename);
  if (!buffer.length) throw mailCore.fieldError(`„${name}“ ist leer und wurde nicht angehängt.`, 'attachments');
  mailCore.checkAttachmentBudget([], [{ name, size: buffer.length }]);
  if (!stagedMailSweep) { stagedMailSweep = setInterval(() => stagedMailAttachments.tick(), mailCore.STAGED_SWEEP_MS); stagedMailSweep.unref?.(); }
  const id = stagedMailAttachments.add({ filename: name, contentType: String(contentType || 'application/octet-stream'), bytes: buffer }, { keep });
  return { id, name, size: buffer.length };
}

/**
 * Marks a file saved from a mail as coming from the internet, so that Windows and macOS check it before it is
 * opened. Best effort: a drive that cannot carry the mark (USB stick, network share) must not fail the save.
 */
async function markAsDownloaded(filePath) {
  try {
    const mark = mailCore.downloadMark(process.platform, filePath);
    if (mark?.kind === 'stream') await fs.promises.writeFile(mark.path, mark.content);
    else if (mark?.kind === 'xattr') await new Promise(resolve => execFile(mark.command, mark.args, { timeout: 5000, windowsHide: true }, () => resolve()));
  } catch { /* the file itself is saved */ }
}

const MAIL_FILE_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet' };

function mailHandler(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    ensureTrustedSender(event);
    try { return await handler(payload, event); }
    catch (error) { return { ok: false, error: error?.userMessage || mailCore.describeError(error), field: error?.field || '', ...(Array.isArray(error?.missing) ? { missing: error.missing } : {}) }; }
  });
}

mailHandler('mail-status', async () => ({ ok: true, ...(await mail().status()) }));
mailHandler('mail-suggest', async payload => ({ ok: true, suggestion: mailCore.suggestServers(payload?.email) }));
mailHandler('mail-account-save', async payload => mail().saveAccount(payload));
mailHandler('mail-account-remove', async () => { stagedMailAttachments.clear(); return mail().removeAccount(); });
mailHandler('mail-list', async () => ({ ok: true, ...(await mail().list()) }));
mailHandler('mail-sync', async () => ({ ok: true, ...(await mail().sync()) }));
mailHandler('mail-body', async payload => ({ ok: true, body: await mail().body(payload?.id) }));
mailHandler('mail-set-seen', async payload => ({ ok: true, ...(await mail().setSeen(payload?.id, payload?.seen !== false)) }));
mailHandler('mail-remove', async payload => ({ ok: true, ...(await mail().remove(payload?.id)) }));

mailHandler('mail-attachment-save', async (payload, event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) throw new Error('Kein aktives Fenster.');
  const attachment = await mail().attachment(payload?.id, payload?.index);
  const name = attachment.filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/^\.+/, '').trim().slice(0, 160) || 'Anhang';
  const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Anhang speichern', defaultPath: path.join(app.getPath('downloads'), name) });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${require('crypto').randomUUID()}.tmp`);
  try {
    // Files from strangers are written without execute permission and are never opened by the app itself.
    await fs.promises.writeFile(temporary, attachment.bytes, { mode: 0o600 });
    await fs.promises.rename(temporary, filePath);
  } catch (error) { await fs.promises.rm(temporary, { force: true }); throw new Error(`Der Anhang konnte nicht gespeichert werden: ${error.message}`); }
  await markAsDownloaded(filePath);
  shell.showItemInFolder(filePath);
  return { ok: true, file: path.basename(filePath) };
});

mailHandler('mail-attach-files', async (payload, event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) throw new Error('Kein aktives Fenster.');
  const draft = stagedIds(payload?.held);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Dateien anhängen', properties: ['openFile', 'multiSelections'] });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };
  const files = [];
  for (const filePath of filePaths) {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw mailCore.fieldError(`„${path.basename(filePath)}“ ist keine Datei und lässt sich nicht anhängen. Es wurde nichts hinzugefügt.`, 'attachments');
    if (!stat.size) throw mailCore.fieldError(`„${path.basename(filePath)}“ ist leer und lässt sich nicht anhängen. Es wurde nichts hinzugefügt.`, 'attachments');
    files.push({ filePath, name: path.basename(filePath), size: stat.size });
  }
  // All or nothing, and checked before anything is read: number and size count together with what the draft has.
  mailCore.checkAttachmentBudget(heldMailAttachments(draft), files);
  const attachments = [];
  try {
    for (const { filePath, name } of files) {
      const extension = path.extname(filePath).slice(1).toLowerCase();
      attachments.push(stageMailAttachment(name, await fs.promises.readFile(filePath), MAIL_FILE_TYPES[extension], [...draft, ...attachments.map(item => item.id)]));
    }
  } catch (error) {
    // A file that could not be read or held: the window gets none of this selection, so none may stay behind.
    for (const item of attachments) stagedMailAttachments.delete(item.id);
    throw error?.userMessage ? error : new Error(`Eine der Dateien konnte nicht gelesen werden (${error?.code || 'unbekannter Fehler'}). Es wurde nichts hinzugefügt.`);
  }
  return { ok: true, attachments };
});

mailHandler('mail-attach-print', async (payload, event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) throw new Error('Kein aktives Fenster.');
  const pdf = Buffer.from(await win.webContents.printToPDF({ marginsType: 0, printBackground: true, pageSize: 'A4' }));
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Die PDF konnte nicht erstellt werden.');
  return { ok: true, attachment: stageMailAttachment(safeDocumentFilename(payload?.filename, 'pdf'), pdf, 'application/pdf') };
});

mailHandler('mail-attach-discard', async payload => {
  for (const id of stagedIds(payload?.ids)) stagedMailAttachments.delete(id);
  return { ok: true };
});

// A draft that is still open on screen says so every couple of minutes; its files are never swept away.
mailHandler('mail-attach-keep', async payload => {
  const ids = stagedIds(payload?.ids);
  stagedMailAttachments.claim(ids);
  return { ok: true, missing: ids.filter(id => !stagedMailAttachments.get(id)) };
});

mailHandler('mail-send', async payload => {
  const outgoing = mailCore.normalizeOutgoing(payload);
  stagedMailAttachments.claim(outgoing.attachmentIds);
  const attachments = outgoing.attachmentIds.map(id => stagedMailAttachments.get(id));
  const missing = outgoing.attachmentIds.filter((_id, index) => !attachments[index]);
  // Never sent without a file the user sees in the draft; the window is told which ones are gone.
  if (missing.length) throw Object.assign(mailCore.fieldError('Ein Anhang ist nicht mehr vorhanden. Bitte den Anhang erneut hinzufügen.', 'attachments'), { missing });
  const result = await mail().send(outgoing, attachments);
  for (const id of outgoing.attachmentIds) stagedMailAttachments.delete(id);
  return result;
});
