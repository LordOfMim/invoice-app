const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { fork } = require('node:child_process');

function mainFunctions(dialog) {
  const app = { isPackaged: true, on() {}, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) };
  const context = {
    require: (name) => name === 'electron' ? { app, ipcMain: { on() {}, handle() {} }, dialog } : require(name),
    process, console, URL, Buffer, setTimeout, clearTimeout, __dirname: path.resolve('electron'),
  };
  vm.runInNewContext(fs.readFileSync('electron/main.js', 'utf8') + '\nglobalThis.exportsForTest = { safeDocumentFilename, saveDocument };', context);
  return context.exportsForTest;
}

test('native PDF saving preserves cancellation and restricts suggested filenames', async () => {
  const functions = mainFunctions({ showSaveDialog: async () => ({ canceled: true }) });
  assert.ok(!functions.safeDocumentFilename('../../secret\ninvoice', 'pdf').includes('/'));
  assert.equal(functions.safeDocumentFilename('Rechnung-1.pdf', 'pdf'), 'Rechnung-1.pdf');
  const result = await functions.saveDocument({}, 'Rechnung', Buffer.from('%PDF-test'), 'pdf');
  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
});

test('native saving replaces the selected file atomically and removes temporary files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-save-test-'));
  const filePath = path.join(directory, 'Rechnung.pdf');
  try {
    fs.writeFileSync(filePath, 'old');
    const functions = mainFunctions({ showSaveDialog: async () => ({ canceled: false, filePath }) });
    const result = await functions.saveDocument({}, 'Rechnung', Buffer.from('%PDF-new'), 'pdf');
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), '%PDF-new');
    assert.deepEqual(fs.readdirSync(directory), ['Rechnung.pdf']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('export worker carries a validated PDF across process IPC', {
  skip: !fs.existsSync('electron/einvoice-runtime/manifest.json'), timeout: 120000,
}, async () => {
  const worker = fork(path.resolve('electron/einvoice-worker.cjs'), [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    const result = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => { if (code) reject(new Error(`worker exit ${code}`)); });
      worker.send({ format: 'zugferd', document: require('../einvoice/fixture.cjs')(), runtimeDir: path.resolve('electron/einvoice-runtime'), assetsDir: path.resolve('electron/einvoice-assets') });
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.extension, 'pdf');
    assert.equal(Buffer.from(result.bytes).subarray(0, 5).toString(), '%PDF-');
  } finally { worker.kill(); }
});
