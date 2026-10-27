const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-upgrade-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let version = options.version ?? '1.1.0';
  let constructed = 0;
  const context = {
    require: name => name === 'electron' ? {
      app: { isPackaged: true, on() {}, requestSingleInstanceLock: () => true,
        whenReady: () => ({ then() {} }), getPath: () => directory, getVersion: () => version },
      ipcMain: { handle() {}, on() {} },
    } : name === 'fs' ? { ...fs, ...options.fs } : require(name),
    process, URL, console, __dirname: path.resolve('electron'),
    TestStore: class { constructor() { constructed++; } },
  };
  // Stub only the ESM dependency; execute the production initialization order.
  const source = fs.readFileSync('electron/main.js', 'utf8')
    .replace("const Store = (await import('electron-store')).default;", 'const Store = globalThis.TestStore;');
  vm.runInNewContext(source + '\nglobalThis.runtime = { backupStoreBeforeUpgrade, initStore };', context);
  return { ...context.runtime, directory, original: path.join(directory, 'invoice-app-data.json'),
    setVersion(value) { version = value; }, get constructed() { return constructed; } };
}

test('first upgrade preserves exact encrypted bytes before constructing electron-store', async t => {
  const runtime = fixture(t);
  const encrypted = Buffer.from([0, 255, 14, 128, 0, 33, 100]);
  fs.writeFileSync(runtime.original, encrypted);
  await runtime.initStore();
  assert.equal(runtime.constructed, 1);
  assert.deepEqual(fs.readFileSync(path.join(runtime.directory, 'invoice-app-data.before-1.1.0.json')), encrypted);
  assert.deepEqual(fs.readFileSync(runtime.original), encrypted);
  assert.equal(fs.readdirSync(runtime.directory).some(name => name.endsWith('.tmp')), false);
});

test('same version never overwrites backup; next version gets its own unchanged copy', t => {
  const runtime = fixture(t);
  fs.writeFileSync(runtime.original, 'old-encrypted-bytes');
  const backup = runtime.backupStoreBeforeUpgrade();
  fs.writeFileSync(runtime.original, 'current-encrypted-bytes');
  assert.equal(runtime.backupStoreBeforeUpgrade(), backup);
  assert.equal(fs.readFileSync(backup, 'utf8'), 'old-encrypted-bytes');
  runtime.setVersion('1.2.0');
  const next = runtime.backupStoreBeforeUpgrade();
  assert.equal(fs.readFileSync(next, 'utf8'), 'current-encrypted-bytes');
});

test('backup failure prevents Store construction and preserves original bytes', async t => {
  const runtime = fixture(t, { fs: { copyFileSync() { throw new Error('disk full'); } } });
  fs.writeFileSync(runtime.original, 'only-original');
  await assert.rejects(runtime.initStore(), /Sicherung vor dem Upgrade/);
  assert.equal(runtime.constructed, 0);
  assert.equal(fs.readFileSync(runtime.original, 'utf8'), 'only-original');
  assert.deepEqual(fs.readdirSync(runtime.directory), ['invoice-app-data.json']);
});

test('exclusive publication never overwrites a backup created concurrently', t => {
  const runtime = fixture(t, { fs: { linkSync(source, destination) {
    fs.writeFileSync(destination, 'first-complete-backup', { flag: 'wx' });
    fs.linkSync(source, destination);
  } } });
  fs.writeFileSync(runtime.original, 'original');
  const backup = runtime.backupStoreBeforeUpgrade();
  assert.equal(fs.readFileSync(backup, 'utf8'), 'first-complete-backup');
  assert.equal(fs.readdirSync(runtime.directory).some(name => name.endsWith('.tmp')), false);
});

test('unsafe version characters cannot escape the data directory', t => {
  const runtime = fixture(t, { version: '../../odd/version' });
  fs.writeFileSync(runtime.original, 'encrypted');
  const backup = runtime.backupStoreBeforeUpgrade();
  assert.equal(path.dirname(backup), runtime.directory);
  assert.equal(fs.readFileSync(backup, 'utf8'), 'encrypted');
});

test('fresh installation has no original to back up', async t => {
  const runtime = fixture(t);
  assert.equal(runtime.backupStoreBeforeUpgrade(), null);
  await runtime.initStore();
  assert.equal(runtime.constructed, 1);
});
