const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const { createDurableStoreClass, lastGoodPathFor } = require('../../electron/durable-store.cjs');

const fixture = path.join(__dirname, 'fixtures/legacy-ae06259');
const provenance = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'));
const payload = JSON.parse(fs.readFileSync(path.join(fixture, 'payload.json'), 'utf8'));
const historicalMain = fs.readFileSync(path.join(fixture, 'old-main.js'), 'utf8');
// Read the historical configuration without duplicating its key in tests or logs.
const encryptionKey = historicalMain.match(/encryptionKey:\s*'([^']+)'/)[1];
const name = 'invoice-app-data';
const key = 'invoice-app:v1';
const collections = ['invoices', 'customers', 'products', 'tags', 'creditNotes', 'recurringInvoices', 'templateVariants'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

// Only Electron OS/environment access is stubbed. Store, Conf and crypto are real.
const electronEntry = require.resolve('electron');
const electronModule = new Module(electronEntry);
electronModule.exports = {
  app: { getPath: () => os.tmpdir(), getVersion: () => '1.1.0' }, ipcMain: { on() {} }, shell: {},
};
require.cache[electronEntry] = electronModule;
const storeClasses = import('electron-store').then(({ default: Store }) => ({ Store, DurableStore: createDurableStoreClass(Store) }));

const modules = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, '../..', relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = new Module(filename, module);
  modules.set(filename, mod);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = request => request.startsWith('@/') ? load(`src/${request.slice(2)}.ts`) : Module.prototype.require.call(mod, request);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return mod.exports;
}
const storage = load('src/lib/storage/store.ts');
const calc = load('src/lib/calc.ts');
const normalize = value => JSON.parse(JSON.stringify(value));
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-actual-legacy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function options(cwd) { return { name, cwd, encryptionKey, configFileMode: 0o600, defaults: { windowBounds: { width: 1400, height: 900 } } }; }
function adapter(store) { return { getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); } }; }
function copyOriginal(directory) {
  const primary = path.join(directory, `${name}.json`);
  fs.copyFileSync(path.join(fixture, `${name}.json`), primary, fs.constants.COPYFILE_EXCL);
  return primary;
}

test('fixture provenance matches historical main, raw payload and actual encrypted file', () => {
  assert.equal(sha(historicalMain), provenance.oldMainSha256);
  assert.equal(sha(fs.readFileSync(path.join(fixture, 'payload.json'))), provenance.payloadSha256);
  assert.equal(sha(fs.readFileSync(path.join(fixture, `${name}.json`))), provenance.encryptedSha256);
  assert.equal(provenance.baseline, 'ae06259');
  for (const collection of collections) assert.ok(payload[collection].length > 0, `${collection} must exercise a real record`);
});

test('real historical encryption survives current parse, unrelated edit, close/reopen and JSON export', async t => {
  const { Store, DurableStore } = await storeClasses;
  const directory = temporary(t);
  const primary = copyOriginal(directory);
  const originalHash = sha(fs.readFileSync(primary));
  const durable = new DurableStore(options(directory));
  storage.clearDataCache();
  const initial = storage.loadData(adapter(durable));
  const expected = normalize(initial);
  const balances = initial.invoices.map(invoice => calc.computeInvoiceTotals(invoice));
  for (const collection of collections) assert.deepEqual(initial[collection].map(item => item.id), payload[collection].map(item => item.id));

  storage.updateSettings(adapter(durable), previous => ({ ...previous, defaultFooterText: 'DEMO – unrelated preference edit' }));
  await Promise.resolve(storage.flushPendingPersist());
  // Store commits are synchronous here; the actual background-actor protocol is tested separately.
  const reopened = new DurableStore(options(directory));
  storage.clearDataCache();
  const exported = JSON.parse(storage.exportData(adapter(reopened)));
  for (const collection of collections) assert.deepEqual(exported[collection], expected[collection], `${collection} must remain intact`);
  assert.deepEqual(exported.invoices.map(invoice => calc.computeInvoiceTotals(invoice)), balances);
  assert.equal(exported.settings.defaultFooterText, 'DEMO – unrelated preference edit');
  assert.ok(exported.invoices.some(invoice => invoice.attachments.some(file => file.dataUrl)), 'attachment bytes must survive');

  const lastGood = lastGoodPathFor(primary);
  assert.equal(sha(fs.readFileSync(lastGood)), originalHash);
  const backupDirectory = temporary(t);
  fs.copyFileSync(lastGood, path.join(backupDirectory, `${name}.json`));
  const oldReader = new Store(options(backupDirectory));
  assert.deepEqual(JSON.parse(oldReader.get(key)), payload, 'the untouched backup remains readable by the original Store format');
});

test('an actually corrupted historical ciphertext fails closed without changing source bytes', async t => {
  const { DurableStore } = await storeClasses;
  const directory = temporary(t);
  const primary = copyOriginal(directory);
  const bytes = fs.readFileSync(primary).subarray(0, 31);
  fs.writeFileSync(primary, bytes);
  const before = sha(bytes);
  assert.throws(() => new DurableStore(options(directory)));
  assert.equal(sha(fs.readFileSync(primary)), before);
});

for (const [label, mutate] of [
  ['unsupported root schema', data => { data.schemaVersion = 999; }],
  ['invalid nested collection', data => { data.invoices[0].payments = {}; }],
]) {
  test(`${label} in a real encrypted store cannot initialize empty data or alter its source`, async t => {
    const { Store, DurableStore } = await storeClasses;
    const directory = temporary(t);
    const data = structuredClone(payload);
    mutate(data);
    const oldWriter = new Store(options(directory));
    oldWriter.set(key, JSON.stringify(data));
    const primary = oldWriter.path;
    const before = sha(fs.readFileSync(primary));
    const current = new DurableStore(options(directory));
    storage.clearDataCache();
    assert.throws(() => storage.loadData(adapter(current)), /ungültig|unsupported|invalid/i);
    assert.equal(sha(fs.readFileSync(primary)), before);
  });
}
