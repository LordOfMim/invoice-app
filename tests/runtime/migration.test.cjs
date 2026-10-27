const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

async function reconcile(desktop, local) {
  const writes = [];
  const alerts = [];
  const api = { isElectron: true, store: {
    getCached: () => desktop,
    set: async (key, value) => { writes.push([key, value]); return true; },
    setSync: (key, value) => { writes.push([key, value]); return true; },
  } };
  const storage = { getItem: () => local };
  const parser = raw => {
    try { const parsed = JSON.parse(raw); return parsed?.schemaVersion === 1 ? parsed : null; } catch { return null; }
  };
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
      if (name.endsWith('/store')) return { parsePersistedData: parser, clearDataCache() {} };
      if (name.endsWith('/localStorageAdapter')) return {};
      throw new Error(name);
    },
  });
  await module.exports.loadFromElectronStore();
  return { writes, alerts };
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
