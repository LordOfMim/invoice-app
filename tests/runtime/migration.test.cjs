const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { applyDataPatches } = require('../../electron/data-patches.cjs');

async function reconcile(desktop, local, options = {}) {
  const writes = [];
  const alerts = [];
  const native = new Map([['invoice-app:v1', desktop], ['fachunternehmer-defaults', options.nativeAux]]);
  const primes = [];
  const api = { isElectron: true, store: {
    getCached: key => native.get(key),
    get: async key => {
      if (key === 'fachunternehmer-defaults' && options.failAux === 'read') throw new Error('AUX read failed');
      return native.get(key);
    },
    set: async (key, value) => {
      writes.push([key, value]);
      if (key === 'fachunternehmer-defaults' && options.failAux) return false;
      native.set(key, value); return true;
    },
    setSync: (key, value) => { writes.push([key, value]); return true; },
  } };
  if (options.applyPatches) api.store.applyPatches = () => true;
  const storage = { getItem: key => key === 'invoice-app:v1' ? local : (options.localAux ?? null) };
  const load = createLoader();
  const realStore = load('src/lib/storage/store.ts');
  const module = { exports: {} };
  const source = fs.readFileSync('src/lib/storage/useStore.ts', 'utf8') + '\nexport { loadFromElectronStore };';
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports,
    window: { electronAPI: api, alert: value => alerts.push(value) }, localStorage: storage,
    require: name => {
      if (name === 'react') return {};
      if (name.endsWith('/keys')) return { STORAGE_KEY: 'invoice-app:v1' };
      if (name.endsWith('/store')) return { ...realStore, primeDataCache(data) { primes.push(data); realStore.primeDataCache(data); } };
      if (name.endsWith('/patches')) return load('src/lib/storage/patches.ts');
      if (name.endsWith('/localStorageAdapter')) return {};
      throw new Error(name);
    },
  });
  await module.exports.loadFromElectronStore();
  return { writes, alerts, native, primes, current: realStore.getCurrentData(), parse: realStore.parsePersistedData };
}
const empty = JSON.stringify({ schemaVersion: 1, settings: { language: 'de', company: 'current' }, invoices: [], customers: [] });
const old = JSON.stringify({ schemaVersion: 1, settings: { company: 'stale' }, invoices: [{ id: 'deleted-invoice' }] });

test('intentionally empty desktop snapshot never resurrects stale local invoices or settings', async () => {
  const result = await reconcile(empty, old);
  assert.deepEqual(result.writes, []);
  assert.deepEqual(result.alerts, []);
});
test('absent desktop key imports browser data only after backing up source', async () => {
  const result = await reconcile(undefined, old);
  assert.match(result.writes[0][0], /:recovery:.*:before-local-migration$/);
  assert.equal(result.writes[0][1], old);
  assert.equal(result.writes[1][0], 'invoice-app:v1');
  assert.equal(result.writes[1][1], old);
});
test('present but malformed desktop key blocks browser adoption', async () => {
  const result = await reconcile('', old);
  assert.deepEqual(result.writes, []);
  assert.equal(result.alerts.length, 1);
});

test('incremental desktop adoption preserves source raw backup and aligns native primary with canonical cache', async () => {
  const result = await reconcile(old, null, { applyPatches: true });
  assert.deepEqual(result.alerts, []);
  assert.match(result.writes[0][0], /:recovery:.*:before-schema-adoption$/);
  assert.equal(result.writes[0][1], old);
  assert.equal(result.writes[1][0], 'invoice-app:v1');
  assert.deepEqual(JSON.parse(result.native.get('invoice-app:v1')), JSON.parse(JSON.stringify(result.current)));
  assert.equal(result.current.invoices[0].id, 'deleted-invoice');
  assert.equal(result.current.schemaVersion, 1);
  assert.equal(result.primes.length, 1);
});

test('incremental local adoption canonicalizes primary but preserves the exact source backup', async () => {
  const result = await reconcile(undefined, old, { applyPatches: true, localAux: 'synthetic defaults' });
  assert.deepEqual(result.alerts, []);
  assert.equal(result.writes[0][1], old);
  assert.match(result.writes[0][0], /:before-local-migration$/);
  assert.deepEqual(JSON.parse(result.native.get('invoice-app:v1')), JSON.parse(JSON.stringify(result.current)));
  assert.equal(result.current.invoices[0].id, 'deleted-invoice');
  assert.equal(result.current.schemaVersion, 1);
  assert.equal(result.native.get('fachunternehmer-defaults'), 'synthetic defaults');

  // This legacy invoice lacks lineItems. Migration creates one blank row;
  // the very next renderer edit appends at index 1. The actual worker patch
  // applier must receive the same canonical shape, not the raw legacy value.
  assert.equal(result.current.invoices[0].lineItems.length, 1);
  const invoice = result.current.invoices[0];
  const next = { ...result.current, invoices: [{ ...invoice, lineItems: [
    ...invoice.lineItems, { ...invoice.lineItems[0], id: 'adoption-new-line', description: 'DEMO added after adoption' },
  ] }] };
  const { createDataPatches } = createLoader()('src/lib/storage/patches.ts');
  const applied = applyDataPatches(JSON.parse(result.native.get('invoice-app:v1')), createDataPatches(result.current, next));
  assert.deepEqual(JSON.parse(JSON.stringify(applied)), JSON.parse(JSON.stringify(next)));
});

test('auxiliary defaults adopt on every valid startup path including no primary data', async () => {
  for (const [desktop, local] of [[empty, old], [undefined, old], [undefined, null]]) {
    const result = await reconcile(desktop, local, { localAux: 'synthetic legacy AUX' });
    assert.deepEqual(result.alerts, []);
    assert.equal(result.native.get('fachunternehmer-defaults'), 'synthetic legacy AUX');
    assert.equal(result.writes.filter(([key]) => key === 'fachunternehmer-defaults').length, 1);
  }
});

test('existing empty native auxiliary value remains authoritative over stale local defaults', async () => {
  const result = await reconcile(empty, old, { nativeAux: '', localAux: 'stale AUX' });
  assert.deepEqual(result.alerts, []);
  assert.equal(result.native.get('fachunternehmer-defaults'), '');
  assert.ok(!result.writes.some(([key]) => key === 'fachunternehmer-defaults'));
});

test('auxiliary read or adoption failure blocks startup without priming a partially loaded cache', async () => {
  for (const failAux of ['read', 'write']) {
    for (const [desktop, local] of [[empty, old], [undefined, old], [undefined, null]]) {
      const result = await reconcile(desktop, local, { applyPatches: true, localAux: 'synthetic AUX', failAux });
      assert.equal(result.alerts.length, 1);
      assert.equal(result.primes.length, 0);
      assert.equal(result.current, null);
      assert.equal(result.native.get('fachunternehmer-defaults'), undefined);
    }
  }
});

test('unknown native auxiliary format blocks startup and preserves its original value', async () => {
  const nativeAux = { futureFormat: 2, data: 'untouched' };
  const result = await reconcile(empty, old, { applyPatches: true, nativeAux, localAux: 'stale AUX' });
  assert.equal(result.alerts.length, 1);
  assert.equal(result.primes.length, 0);
  assert.equal(result.current, null);
  assert.equal(result.native.get('fachunternehmer-defaults'), nativeAux);
  assert.ok(!result.writes.some(([key]) => key === 'fachunternehmer-defaults'));
});

test('server survives cancellable quit and stops only after confirmed will-quit', () => {
  const handlers = {};
  let kills = 0;
  const app = {
    isPackaged: true, on: (event, handler) => { handlers[event] = handler; },
    requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }),
  };
  const context = {
    require: name => name === 'electron' ? { app, ipcMain: { handle() {}, on() {} } } : require(name),
    process, console, URL, __dirname: require('node:path').resolve('electron'),
  };
  vm.runInNewContext(fs.readFileSync('electron/main.js', 'utf8') + '\nglobalThis.setTestServer = value => { nextServer = value; };', context);
  context.setTestServer({ kill() { kills++; } });
  // Electron emits before-quit before the renderer may veto via beforeunload.
  handlers['before-quit']?.();
  assert.equal(kills, 0, 'cancelled quit must leave the local server usable');
  handlers['will-quit']();
  assert.equal(kills, 1);
});
