'use strict';
// Explicit native smoke, outside node --test: hidden disposable Electron window,
// actual production preload + Worker + Conf. Never opens an installed profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StorageClient } = require('../../electron/storage-client.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-native-storage-'));
app.setPath('userData', path.join(root, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
// Keep the test process alive between its close/reopen scenarios.
app.on('window-all-closed', () => {});
const directory = path.join(root, 'store');
fs.mkdirSync(directory);
const fixture = path.join(__dirname, '../runtime/fixtures/legacy-ae06259');
fs.copyFileSync(path.join(fixture, 'invoice-app-data.json'), path.join(directory, 'invoice-app-data.json'));
const encryptionKey = fs.readFileSync(path.join(fixture, 'old-main.js'), 'utf8').match(/encryptionKey:\s*'([^']+)'/)[1];
const options = { directory, name: 'invoice-app-data', encryptionKey };
const key = 'invoice-app:v1';
let client, win, failure = false;
let reports = 0, vetoes = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Native storage smoke timed out.'); app.exit(1); }, 30000);
function guard() { if (failure) throw new Error('Injected ENOSPC: native close must veto.'); }
ipcMain.on('store-get-sync', async (event, name) => {
  try { event.returnValue = { ok: true, value: await client.get(name) }; }
  catch (error) { event.returnValue = { ok: false, error: error.message }; }
});
ipcMain.on('store-set-sync', async (event, name, value) => {
  try { guard(); await client.set(name, value); event.returnValue = { ok: true }; }
  catch (error) { event.returnValue = { ok: false, error: error.message }; }
});
ipcMain.on('store-flush-sync', async (event, batches) => {
  try { guard(); if (batches.length) await client.commit(batches); await client.flush(); event.returnValue = { ok: true }; }
  catch (error) { event.returnValue = { ok: false, error: error.message }; }
});
ipcMain.on('storage-write-error', () => { reports++; });
ipcMain.handle('store-commit', async (_event, batches) => { guard(); return client.commit(batches); });
ipcMain.handle('store-flush', async () => { guard(); return client.flush(); });
async function open() {
  win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, preload: path.resolve(__dirname, '../../electron/preload.js') } });
  win.webContents.on('will-prevent-unload', () => { vetoes++; });
  await win.loadURL('data:text/html,<title>Disposable Helferlein storage smoke</title>');
  return win;
}
async function edit(value) {
  return win.webContents.executeJavaScript(`window.electronAPI.store.applyPatches([{op:'set',path:['settings','defaultFooterText'],value:${JSON.stringify(value)}}])`);
}
async function run() {
  client = new StorageClient(options);
  await client.ready;
  const original = JSON.parse(await client.get(key));
  await open();
  assert.equal(await edit('native immediate close'), true);
  const closed = new Promise(resolve => win.once('closed', resolve));
  win.close(); // Deliberately before the 250 ms debounce.
  await closed;
  await client.close();
  client = new StorageClient(options);
  await client.ready;
  const reopened = JSON.parse(await client.get(key));
  assert.equal(reopened.settings.defaultFooterText, 'native immediate close');
  for (const collection of ['invoices', 'customers', 'products', 'tags', 'creditNotes', 'recurringInvoices', 'templateVariants']) assert.deepEqual(reopened[collection], original[collection]);
  await open();
  failure = true;
  await edit('native retry after rejected close');
  win.close();
  await pause(300);
  assert.equal(win.isDestroyed(), false, 'real beforeunload must keep window open after disk failure');
  assert.ok(vetoes > 0 && reports > 0, 'real Electron must report and veto the failed flush');
  failure = false;
  assert.equal(await win.webContents.executeJavaScript('window.electronAPI.store.flush()'), true);
  const retriedClose = new Promise(resolve => win.once('closed', resolve));
  win.close();
  await retriedClose;
  await client.close();
  client = new StorageClient(options);
  await client.ready;
  assert.equal(JSON.parse(await client.get(key)).settings.defaultFooterText, 'native retry after rejected close');
  await client.close();
  client = null;
  console.log('PASS native Electron: production preload, asynchronous sync-IPC, worker durable reopen, all legacy collections, immediate close, failed-close veto and retry.');
}
app.whenReady().then(run).then(() => {
  clearTimeout(timeout);
  fs.rmSync(root, { recursive: true, force: true });
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
app.on('will-quit', () => { clearTimeout(timeout); });
app.on('quit', () => { fs.rmSync(root, { recursive: true, force: true }); });
