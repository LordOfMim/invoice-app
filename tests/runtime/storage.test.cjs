const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
// Compile only the pure TypeScript storage dependencies; no renderer is started.
const cache = new Map();
function load(relative) {
  const filename = path.resolve(relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module);
  cache.set(filename, mod);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = request => request.startsWith('@/')
    ? load(`src/${request.slice(2)}.ts`) : require(request);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mod._compile(output, filename);
  return mod.exports;
}
const store = load('src/lib/storage/store.ts');
const key = 'invoice-app:v1';
function adapter(initial) {
  const values = new Map(initial === undefined ? [] : [[key, initial]]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('invalid existing data cannot initialize an empty store', () => {
  store.clearDataCache();
  const storage = adapter('{broken');
  assert.throws(() => store.loadData(storage), /ungültig/);
  assert.equal(storage.values.get(key), '{broken');
});
test('missing collections migrate additively but malformed collections are rejected', () => {
  const legacy = { schemaVersion: 1, settings: { customLegacySetting: 'keep' }, invoices: [] };
  const migrated = store.parsePersistedData(JSON.stringify(legacy));
  assert.equal(migrated.settings.customLegacySetting, 'keep');
  assert.deepEqual(migrated.customers, []);
  assert.equal(store.parsePersistedData(JSON.stringify({ ...legacy, customers: {} })), null);
  assert.equal(store.parsePersistedData(JSON.stringify({ ...legacy, invoices: [null] })), null);
});
test('import backs up exact previous bytes before replacing data', () => {
  store.clearDataCache();
  const storage = adapter('previous original bytes');
  assert.equal(store.importData(storage, JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [] })), true);
  const recovery = [...storage.values.entries()].find(([key]) => key.includes(':recovery:'));
  assert.equal(recovery[1], 'previous original bytes');
});
test('backup failure aborts import without replacing primary data', () => {
  const storage = adapter('original');
  storage.setItem = () => { throw new Error('disk full'); };
  assert.equal(store.importData(storage, JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [] })), false);
  assert.equal(storage.values.get(key), 'original');
});
