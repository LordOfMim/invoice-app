const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');

// electron-store is ESM, need dynamic import
let store;
let nextServer = null;

async function initStore() {
  const Store = (await import('electron-store')).default;
  store = new Store({
    name: 'invoice-app-data',
    encryptionKey: 'invoice-app-secure-key-2024',
    defaults: {
      windowBounds: { width: 1400, height: 900 }
    }
  });
}

let mainWindow;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const PORT = isDev ? 3000 : 3456;

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
        if (res.statusCode === 200 || res.statusCode === 304) {
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

async function startNextServer() {
  if (isDev) return; // In dev mode, Next.js runs separately
  
  // Check if Node.js is installed
  if (!isNodeInstalled()) {
    showNodeRequiredError();
    return;
  }
  
  return new Promise(async (resolve) => {
    const appPath = app.getAppPath();
    const fs = require('fs');
    
    // Path to standalone server
    let standaloneDir = path.join(appPath, '.next', 'standalone');
    let serverPath = path.join(standaloneDir, 'server.js');
    
    console.log('App path:', appPath);
    console.log('Standalone dir:', standaloneDir);
    console.log('Server path:', serverPath);
    
    // Check if standalone server exists, try alternative paths
    if (!fs.existsSync(serverPath)) {
      console.log('Server not found at app path, trying resources path...');
      standaloneDir = path.join(process.resourcesPath, '.next', 'standalone');
      serverPath = path.join(standaloneDir, 'server.js');
      console.log('Alternative server path:', serverPath);
    }
    
    if (!fs.existsSync(serverPath)) {
      console.error('Standalone server not found!');
      console.log('Directory contents of appPath:', fs.readdirSync(appPath));
      resolve();
      return;
    }
    
    // Copy static files if needed
    const staticSrc = path.join(appPath, '.next', 'static');
    const staticDest = path.join(standaloneDir, '.next', 'static');
    if (fs.existsSync(staticSrc) && !fs.existsSync(staticDest)) {
      console.log('Copying static files...');
      fs.cpSync(staticSrc, staticDest, { recursive: true });
    }
    
    // Copy public folder if needed  
    const publicSrc = path.join(appPath, 'public');
    const publicDest = path.join(standaloneDir, 'public');
    if (fs.existsSync(publicSrc) && !fs.existsSync(publicDest)) {
      console.log('Copying public files...');
      fs.cpSync(publicSrc, publicDest, { recursive: true });
    }
    
    try {
      // Try to find node executable
      const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
      
      nextServer = spawn(nodeCmd, [serverPath], {
        cwd: standaloneDir,
        env: { 
          ...process.env, 
          NODE_ENV: 'production',
          PORT: PORT.toString(),
          HOSTNAME: 'localhost'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true
      });

      nextServer.stdout.on('data', (data) => {
        console.log('Next.js:', data.toString());
      });

      nextServer.stderr.on('data', (data) => {
        console.error('Next.js error:', data.toString());
      });

      nextServer.on('error', (err) => {
        console.error('Failed to start Next.js:', err);
      });
      
      nextServer.on('exit', (code, signal) => {
        console.log('Next.js server exited with code:', code, 'signal:', signal);
      });
      
      // Wait for server to be ready
      console.log('Waiting for Next.js server on port', PORT);
      await waitForServer(`http://localhost:${PORT}`);
      console.log('Next.js server ready!');
    } catch (err) {
      console.error('Error starting Next.js server:', err);
    }
    
    resolve();
  });
}

async function createWindow() {
  await initStore();
  await initStore();

  const bounds = store.get('windowBounds') || { width: 1400, height: 900 };

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
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

  // Show loading screen immediately
  mainWindow.loadFile(path.join(__dirname, 'loading.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  let serverError = null;
  if (!isDev) {
    try {
      console.log('Starting Next.js server...');
      await startNextServer();
      // Wait for server to be ready (with error handling)
      await waitForServer(`http://localhost:${PORT}`);
    } catch (err) {
      console.error('Server failed to start:', err);
      serverError = err;
    }
  }

  const url = `http://localhost:${PORT}`;
  if (!serverError) {
    // Try to load the app
    mainWindow.loadURL(url).catch((err) => {
      console.error('Failed to load app URL:', err);
      mainWindow.loadFile(path.join(__dirname, 'server-error.html'));
    });
  } else {
    // Show error screen
    mainWindow.loadFile(path.join(__dirname, 'server-error.html'));
  }

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

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
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (nextServer) {
    nextServer.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.kill();
  }
});

// IPC handlers for storage
ipcMain.handle('store-get', async (event, key) => {
  if (!store) await initStore();
  return store.get(key);
});

ipcMain.handle('store-set', async (event, key, value) => {
  if (!store) await initStore();
  store.set(key, value);
  return true;
});

ipcMain.handle('store-delete', async (event, key) => {
  if (!store) await initStore();
  store.delete(key);
  return true;
});

ipcMain.handle('store-clear', async () => {
  if (!store) await initStore();
  store.clear();
  return true;
});

ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    name: app.getName(),
    path: app.getPath('userData')
  };
});

ipcMain.handle('print-to-pdf', async (event, options) => {
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
