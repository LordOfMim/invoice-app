const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function preload() {
  let api;
  let timer;
  const calls = [];
  const listeners = {};
  let fail = false;
  let rejectWrite;
  let delayWrite = false;
  const ipc = {
    sendSync(channel, key, value) {
      calls.push({ channel, key, value });
      return fail ? { ok: false, error: 'disk full' } : { ok: true, value: 'original' };
    },
    async invoke(channel, key, value) {
      calls.push({ channel, key, value });
      if (delayWrite) return new Promise((_resolve, reject) => { rejectWrite = reject; });
      return true;
    },
    send(channel) { calls.push({ channel }); }, on() {}, removeListener() {},
  };
  vm.runInNewContext(fs.readFileSync('electron/preload.js', 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer: ipc }),
    window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
    process: { platform: 'darwin' }, setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = undefined; },
  });
  return { get api() { return api; }, calls, listeners, run: () => timer(), fail: () => { fail = true; }, delay: () => { delayWrite = true; }, reject: () => rejectWrite(new Error('old write failed')) };
}

test('cached reads and rapid edits only persist the latest snapshot asynchronously', async () => {
  const env = preload();
  assert.equal(env.api.store.getCached('invoice-app:v1'), 'original');
  assert.equal(env.api.store.getCached('invoice-app:v1'), 'original');
  for (let i = 0; i < 100; i++) env.api.store.setCached('invoice-app:v1', String(i));
  assert.equal(env.calls.length, 1);
  await env.run();
  assert.equal(env.calls.length, 2);
  assert.equal(env.calls[1].channel, 'store-set');
  assert.equal(env.calls[1].value, '99');
});

test('closing flushes the latest edit before unloading', () => {
  const env = preload();
  env.api.store.setCached('invoice-app:v1', 'latest');
  env.listeners.beforeunload({ preventDefault() { assert.fail('successful save must allow close'); } });
  assert.equal(env.calls[0].value, 'latest');
  assert.equal(env.calls[0].channel, 'store-set-sync');
});

test('failed close flush blocks unload and retains pending changes for retry', () => {
  const env = preload();
  env.api.store.setCached('invoice-app:v1', 'latest');
  env.fail();
  let prevented = false;
  env.listeners.beforeunload({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(env.api.store.getCached('invoice-app:v1'), 'latest');
  assert.equal(env.calls.at(-1).channel, 'storage-write-error');
});

test('an obsolete async failure cannot undo a successful authoritative restore status', async () => {
  const env = preload();
  const statuses = [];
  env.api.store.onStatus((status) => statuses.push(status));
  env.delay();
  env.api.store.setCached('invoice-app:v1', 'old pending edit');
  const oldWrite = env.run();
  env.api.store.setSync('invoice-app:v1', 'restored snapshot');
  env.reject();
  await oldWrite;
  assert.equal(statuses.at(-1), 'saved');
  assert.equal(env.api.store.getCached('invoice-app:v1'), 'restored snapshot');
  assert.equal(env.calls.some((call) => call.channel === 'storage-write-error'), false);
});
