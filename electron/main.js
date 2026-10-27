const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const { spawn, execSync, execFile } = require('child_process');
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

async function initStore() {
  const Store = (await import('electron-store')).default;
  const options = {
    name: STORE_NAME,
    encryptionKey: 'invoice-app-secure-key-2024',
    defaults: {
      windowBounds: { width: 1400, height: 900 }
    }
  };

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

// Check if Node.js is installed
function isNodeInstalled() {
  try {
    execSync('node --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Show error dialog
function showNodeRequiredError() {
  dialog.showMessageBoxSync({
    type: 'error',
    title: 'Node.js Required',
    message: 'Node.js is required to run this application.',
    detail: 'Please install Node.js from https://nodejs.org and restart the application.\n\nRecommended: Download the LTS version.',
    buttons: ['OK']
  });
  app.quit();
}

// Check if server is ready
function waitForServer(url, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let lastError = null;
    const check = () => {
      http.get(url, (res) => {
        // Treat any non-5xx response as "server is up".
        // (Next may redirect or return 404 for some paths.)
        const status = res.statusCode || 0;
        res.resume();
        if (status > 0 && status < 500) {
          resolve();
        } else {
          retry();
        }
      }).on('error', (err) => {
        lastError = err;
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startTime > timeout) {
        reject(lastError || new Error('Timeout waiting for server'));
      } else {
        setTimeout(check, 500);
      }
    };
    check();
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

async function startNextServer() {
  if (isDev || (nextServer && nextServer.exitCode === null)) return; // Reuse server when reopening on macOS

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
      await waitForServer(appOrigin);
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

  mainWindow = new BrowserWindow({
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

  // Show loading screen instantly
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== appOrigin) event.preventDefault(); } catch { event.preventDefault(); }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log('did-fail-load', { errorCode, errorDescription, validatedURL });
    try {
      mainWindow.loadFile(path.join(__dirname, 'server-error.html'), {
        query: { message: `Failed to load: ${validatedURL} (${errorCode}) ${errorDescription}` }
      });
    } catch (e) {
      log('Failed to show server-error.html after did-fail-load', e);
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log('render-process-gone', details);
  });

  // Start server and wait, but do not block window display
  (async () => {
    let serverError = null;
    if (!isDev) {
      try {
        log('Starting Next.js server...');
        await startNextServer();
      } catch (err) {
        log('Server failed to start:', err);
        serverError = err;
      }
    }
    const url = appOrigin;
    if (!serverError) {
      // Try to load the app
      mainWindow.loadURL(url).catch((err) => {
        log('Failed to load app URL:', err);
        mainWindow.loadFile(path.join(__dirname, 'server-error.html'), {
          query: { message: `Failed to load URL: ${url}. ${String(err)}` }
        });
      });
    } else {
      // Show error screen
      mainWindow.loadFile(path.join(__dirname, 'server-error.html'), {
        query: { message: String(serverError) }
      });
    }
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  })();

  mainWindow.on('close', () => {
    if (store) {
      const bounds = mainWindow.getBounds();
      store.set('windowBounds', bounds);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
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
  const filename = String(requestedFilename).toLowerCase().endsWith('.pdf')
    ? String(requestedFilename)
    : `${requestedFilename}.pdf`;

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
