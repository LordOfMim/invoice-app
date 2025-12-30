const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

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

async function startNextServer() {
  if (isDev) return; // In dev mode, Next.js runs separately
  
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, '..');
    
    nextServer = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'start', '--', '-p', PORT.toString()],
      { 
        cwd: serverPath,
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'production' }
      }
    );

    nextServer.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Next.js:', output);
      if (output.includes('Ready') || output.includes('started') || output.includes('✓')) {
        setTimeout(resolve, 1000);
      }
    });

    nextServer.stderr.on('data', (data) => {
      console.error('Next.js error:', data.toString());
    });

    nextServer.on('error', (err) => {
      console.error('Failed to start Next.js:', err);
      resolve();
    });
    
    setTimeout(resolve, 30000);
  });
}

async function createWindow() {
  await initStore();
  
  if (!isDev) {
    console.log('Starting Next.js server...');
    await startNextServer();
  }
  
  const bounds = store.get('windowBounds') || { width: 1400, height: 900 };
  const { width, height, x, y } = bounds;

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

  const url = `http://localhost:${PORT}`;
  console.log('Loading:', url);
  mainWindow.loadURL(url);
  
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

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
