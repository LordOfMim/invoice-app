const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const KEY = 'invoice-app:v1';
function harness() {
  let api, timer, failSync = false;
  const calls = [], deferred = [], events = {};
  const ipc = {
    sendSync(channel, ...args) { calls.push({ channel, args }); return failSync ? { ok: false, error: 'disk full' } : { ok: true, value: 'original' }; },
    invoke(channel, ...args) { calls.push({ channel, args }); return new Promise((resolve, reject) => deferred.push({ channel, resolve, reject })); },
    send(channel) { calls.push({ channel }); }, on() {}, removeListener() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../electron/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer: ipc }),
    window: { addEventListener: (name, callback) => { events[name] = callback; } }, process: { platform: 'darwin' },
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = undefined; },
  });
  const statuses = []; api.store.onStatus(status => statuses.push(status));
  return { api, calls, deferred, events, statuses, fail(value) { failSync = value; }, run() { const callback = timer; timer = undefined; assert.ok(callback); return callback(); } };
}
const patch = value => [{ op: 'set', path: ['settings', 'defaultFooterText'], value }];
const clone = value => JSON.parse(JSON.stringify(value));

test('incremental edits send only patches and A/B/A acknowledges the latest revision', async () => {
  const h = harness();
  h.api.store.applyPatches(patch('A'));
  const first = h.run();
  h.api.store.applyPatches(patch('B')); h.api.store.applyPatches(patch('A'));
  h.deferred[0].resolve(true); await first;
  assert.equal(h.statuses.at(-1), 'saving');
  const second = h.run();
  assert.deepEqual(clone(h.calls.filter(call => call.channel === 'store-commit')[1].args[0][0].operations), [
    { type: 'patch', patches: patch('B') }, { type: 'patch', patches: patch('A') },
  ]);
  h.deferred[1].resolve(true); await second;
  assert.equal(h.statuses.at(-1), 'saved');
  assert.ok(h.calls.every(call => call.channel !== 'store-set'));
});

test('lost acknowledgement retries the exact session and sequence before later patches', async () => {
  const h = harness(); h.api.store.applyPatches(patch('A'));
  const first = h.run(); const original = clone(h.calls[0].args[0]);
  h.deferred[0].reject(new Error('lost acknowledgement')); await first;
  assert.equal(h.statuses.at(-1), 'error');
  h.api.store.applyPatches(patch('B')); const retry = h.run();
  const batches = h.calls.filter(call => call.channel === 'store-commit')[1].args[0];
  assert.deepEqual(clone(batches[0]), original[0]); assert.ok(batches[1].sequence > batches[0].sequence);
  h.deferred[1].resolve(true); await retry; assert.equal(h.statuses.at(-1), 'saved');
});

test('failed synchronous flush preserves exact in-flight and pending batches for retry', async () => {
  const h = harness(); h.api.store.applyPatches(patch('A')); const first = h.run();
  h.api.store.applyPatches(patch('B')); h.fail(true);
  await assert.rejects(h.api.store.flush(), /disk full/);
  const failed = clone(h.calls.find(call => call.channel === 'store-flush-sync').args[0]);
  h.deferred[0].resolve(true); await first; assert.equal(h.statuses.at(-1), 'error');
  h.fail(false); assert.equal(await h.api.store.flush(), true);
  assert.deepEqual(clone(h.calls.filter(call => call.channel === 'store-flush-sync').at(-1).args[0]), failed);
  assert.equal(h.statuses.at(-1), 'saved');
});

test('late stale failure after successful close flush cannot change saved status', async () => {
  const h = harness(); h.api.store.applyPatches(patch('A')); const pending = h.run();
  assert.equal(await h.api.store.flush(), true);
  h.deferred[0].reject(new Error('stale failure')); await pending;
  assert.equal(h.statuses.at(-1), 'saved');
});

test('immediate beforeunload flushes queued patches and vetoes disk failure without losing them', () => {
  const h = harness(); h.api.store.applyPatches(patch('A')); h.fail(true);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  h.events.beforeunload(event); assert.equal(event.prevented, true); assert.equal(event.returnValue, false);
  const failed = clone(h.calls.find(call => call.channel === 'store-flush-sync').args[0]);
  h.fail(false); h.events.beforeunload({ preventDefault() { assert.fail('save succeeded'); } });
  assert.deepEqual(clone(h.calls.filter(call => call.channel === 'store-flush-sync').at(-1).args[0]), failed);
});

test('authoritative replacement rejects concurrent edits explicitly until confirmed, then unlocks', async () => {
  const h = harness();
  h.api.store.applyPatches(patch('before restore'));
  const restoring = h.api.store.set(KEY, 'restored snapshot');
  assert.equal(h.statuses.at(-1), 'saving');
  assert.throws(() => h.api.store.applyPatches(patch('must reject')), /Wiederherstell|Übernahme|warten|läuft/i);
  assert.throws(() => h.api.store.setCached(KEY, 'must reject'), /Wiederherstell|Übernahme|warten|läuft/i);
  assert.throws(() => h.api.store.setSync(KEY, 'must reject'), /Wiederherstell|Übernahme|warten|läuft/i);
  await assert.rejects(h.api.store.set(KEY, 'concurrent restore'), /Wiederherstell|Übernahme|warten|läuft/i);
  assert.equal(h.deferred.length, 1, 'only the authoritative replacement reaches async IPC');
  const closing = { prevented: false, preventDefault() { this.prevented = true; } };
  h.events.beforeunload(closing);
  assert.equal(closing.prevented, true, 'unconfirmed replacement must veto close');
  assert.equal(closing.returnValue, false);

  assert.notEqual(h.statuses.at(-1), 'saved');
  h.deferred[0].resolve(true); await restoring;
  assert.equal(h.statuses.at(-1), 'saved');
  assert.equal(h.api.store.applyPatches(patch('accepted after restore')), true);
  assert.equal(h.statuses.at(-1), 'saving');
  assert.equal(await h.api.store.flush(), true);
  const batches = h.calls.filter(call => call.channel === 'store-flush-sync').at(-1).args[0];
  assert.ok(batches.some(batch => batch.operations.some(operation => operation.type === 'patch' && operation.patches[0].value === 'accepted after restore')));
});

test('failed authoritative replacement reports error, unlocks editing and allows retry', async () => {
  const h = harness();
  const restoring = h.api.store.set(KEY, 'failed restored snapshot');
  assert.equal(h.statuses.at(-1), 'saving');
  h.deferred[0].reject(new Error('disk full'));
  await assert.rejects(restoring, /disk full/);
  assert.equal(h.statuses.at(-1), 'error');
  assert.equal(h.api.store.applyPatches(patch('accepted after failure')), true);
  assert.equal(await h.api.store.flush(), true);
  const retry = h.api.store.set(KEY, 'successful retry');
  assert.equal(h.statuses.at(-1), 'saving');
  h.deferred[1].resolve(true); assert.equal(await retry, true);
  assert.equal(h.statuses.at(-1), 'saved');
  assert.equal(h.api.store.getCached(KEY), 'successful retry');
});
