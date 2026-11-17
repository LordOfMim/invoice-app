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
  const patches = [];
  if (options.applyPatches) api.store.applyPatches = (list) => { patches.push(list); return options.rejectPatches !== true; };
  if (options.files) api.files = options.files;
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
      if (name.endsWith('/file-refs.cjs')) return require('../../electron/file-refs.cjs');
      if (name.endsWith('/files')) return load('src/lib/storage/files.ts');
      throw new Error(name);
    },
  });
  await module.exports.loadFromElectronStore();
  return { writes, alerts, native, primes, patches, current: realStore.getCurrentData(), parse: realStore.parsePersistedData };
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

// ── Attachments, logos and images move out of the data into files ───────────────────────────────────────────────

const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { FileStore } = require('../../electron/file-store.cjs');
const { isValidPersistedData } = require('../../electron/storage-validation.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const asDataUrl = (bytes, type) => `data:${type};base64,${bytes.toString('base64')}`;
const LOGO = Buffer.from('synthetic logo '.repeat(30));
const SCAN = Buffer.from('%PDF-1.4 synthetic scan '.repeat(300));

function fileApi(t, { refuse } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-file-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new FileStore(path.join(directory, 'attachments'));
  const calls = [];
  return {
    store, calls,
    put: async (dataUrl) => {
      calls.push(dataUrl);
      if (refuse === 'throw') throw new Error('disk full');
      if (refuse && refuse(dataUrl)) return { ok: false, error: 'refused' };
      return { ok: true, file: await store.putDataUrl(dataUrl) };
    },
  };
}
/** Data with embedded files, already in the canonical form this version writes (so only the files need moving). */
function embeddedSnapshot() {
  const { parsePersistedData } = createLoader()('src/lib/storage/store.ts');
  return JSON.stringify(parsePersistedData(JSON.stringify({
    schemaVersion: 1,
    settings: { language: 'de', defaultLogoDataUrl: asDataUrl(LOGO, 'image/png') },
    invoices: [
      { id: 'with-files', invoiceNumber: 'RE-1', logoDataUrl: asDataUrl(LOGO, 'image/png'), attachments: [{ id: 'a1', name: 'Beleg.pdf', type: 'application/pdf', size: SCAN.length, dataUrl: asDataUrl(SCAN, 'application/pdf'), createdAt: '2026-11-01T00:00:00.000Z' }] },
      { id: 'plain', invoiceNumber: 'RE-2' },
    ],
  })));
}
const recoveryReason = ([key]) => key.replace(/:recovery:.*:/, ':recovery:');

test('startup moves embedded files into the file store and saves the data without them', async (t) => {
  const raw = embeddedSnapshot();
  const files = fileApi(t);
  const result = await reconcile(raw, null, { applyPatches: true, files });
  assert.deepEqual(result.alerts, []);
  // The untouched original is kept as a recovery copy before the data changes; the primary is not replaced wholesale.
  assert.equal(result.writes.length, 1);
  assert.match(result.writes[0][0], /:recovery:.*:before-file-extraction$/);
  assert.equal(result.writes[0][1], raw);
  // Two distinct files (the logo is used twice), each stored once and verified by its checksum.
  assert.equal(files.calls.length, 2);
  assert.deepEqual(fs.readdirSync(files.store.directory).sort(), [sha(LOGO), sha(SCAN)].sort());
  assert.ok(files.store.read(sha(SCAN)).equals(SCAN));

  const logo = { id: sha(LOGO), type: 'image/png', size: LOGO.length };
  assert.equal(JSON.stringify(result.current).includes('base64'), false);
  assert.deepEqual(result.current.settings.defaultLogoFile, logo);
  assert.deepEqual(result.current.invoices[0].logoFile, logo);
  assert.deepEqual(result.current.invoices[0].attachments[0].file, { id: sha(SCAN), type: 'application/pdf', size: SCAN.length });
  assert.equal(result.primes.length, 1);
  assert.equal(isValidPersistedData(JSON.parse(JSON.stringify(result.current))), true);

  // The storage worker receives small patches and arrives at exactly the state the window shows.
  assert.equal(result.patches.length, 1);
  assert.ok(JSON.stringify(result.patches).length < 1500, 'patches carry references, not file content');
  const applied = applyDataPatches(JSON.parse(raw), result.patches[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(applied)), JSON.parse(JSON.stringify(result.current)));
  assert.equal(isValidPersistedData(applied), true);
  assert.ok(JSON.stringify(applied).length < raw.length - SCAN.length - 2 * LOGO.length, 'the saved data no longer carries the file content');

  // The next start finds nothing to move and writes nothing.
  const again = await reconcile(JSON.stringify(result.current), null, { applyPatches: true, files: fileApi(t) });
  assert.deepEqual(again.writes, []);
  assert.deepEqual(again.patches, []);
  assert.deepEqual(JSON.parse(JSON.stringify(again.current)), JSON.parse(JSON.stringify(result.current)));
});

test('startup keeps one original when the schema is adopted in the same run', async (t) => {
  // A snapshot from an older version: not canonical, so it is rewritten once with its own recovery copy.
  const legacy = JSON.stringify({ schemaVersion: 1, settings: { defaultLogoDataUrl: asDataUrl(LOGO, 'image/png') }, invoices: [{ id: 'old' }] });
  const result = await reconcile(legacy, null, { applyPatches: true, files: fileApi(t) });
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.writes.map(recoveryReason), ['invoice-app:v1:recovery:before-schema-adoption', 'invoice-app:v1']);
  assert.equal(result.writes[0][1], legacy);
  assert.equal(result.patches.length, 1);
  assert.deepEqual(result.current.settings.defaultLogoFile, { id: sha(LOGO), type: 'image/png', size: LOGO.length });
  assert.equal('defaultLogoDataUrl' in JSON.parse(JSON.stringify(result.current.settings)), false);
});

test('a file the store does not confirm stays in the data; nothing is lost and nothing blocks the start', async (t) => {
  const raw = embeddedSnapshot();
  // Only the scan is refused: the logo moves, the scan stays embedded.
  const partial = await reconcile(raw, null, { applyPatches: true, files: fileApi(t, { refuse: (url) => url.startsWith('data:application/pdf') }) });
  assert.deepEqual(partial.alerts, []);
  assert.equal(partial.current.invoices[0].attachments[0].dataUrl, asDataUrl(SCAN, 'application/pdf'));
  assert.equal(partial.current.invoices[0].attachments[0].file, undefined);
  assert.deepEqual(partial.current.settings.defaultLogoFile, { id: sha(LOGO), type: 'image/png', size: LOGO.length });

  // The disk refuses everything: the data is loaded exactly as it was, without a write.
  for (const refuse of ['throw', () => true]) {
    const result = await reconcile(raw, null, { applyPatches: true, files: fileApi(t, { refuse }) });
    assert.deepEqual(result.alerts, []);
    assert.deepEqual(result.writes, []);
    assert.deepEqual(result.patches, []);
    assert.equal(JSON.stringify(result.current), raw);
    assert.equal(result.primes.length, 1);
  }

  // The worker refuses the patches: the window keeps showing the embedded data that is on disk.
  const rejected = await reconcile(raw, null, { applyPatches: true, rejectPatches: true, files: fileApi(t) });
  assert.deepEqual(rejected.alerts, []);
  assert.equal(JSON.stringify(rejected.current), raw);

  // An older preload without the file store, or without incremental saving, changes nothing.
  for (const options of [{ applyPatches: true }, { files: fileApi(t) }]) {
    const result = await reconcile(raw, null, options);
    assert.deepEqual(result.alerts, []);
    assert.deepEqual(result.writes, []);
    assert.equal(JSON.stringify(result.current), raw);
  }
});

test('data adopted from the browser store moves its files in the same start', async (t) => {
  const raw = embeddedSnapshot();
  const result = await reconcile(undefined, raw, { applyPatches: true, files: fileApi(t) });
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(result.writes.map(recoveryReason), ['invoice-app:v1:recovery:before-local-migration', 'invoice-app:v1']);
  assert.equal(result.writes[0][1], raw);
  assert.equal(result.patches.length, 1);
  assert.equal(JSON.stringify(result.current).includes('base64'), false);
  const applied = applyDataPatches(JSON.parse(result.native.get('invoice-app:v1')), result.patches[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(applied)), JSON.parse(JSON.stringify(result.current)));
});

test('the signature image of the declarations moves into a file; other defaults stay as they are', async (t) => {
  const signature = Buffer.from('synthetic signature '.repeat(20));
  const defaults = { senderAddress: 'Musterweg 1', recipientName: 'Beispiel GmbH', recipientAddress: '', kommission: '', signatureName: 'Muster', signatureImage: asDataUrl(signature, 'image/png'), futureField: { keep: true } };
  const files = fileApi(t);
  const result = await reconcile(empty, null, { applyPatches: true, files, nativeAux: JSON.stringify(defaults) });
  assert.deepEqual(result.alerts, []);
  assert.deepEqual(JSON.parse(result.native.get('fachunternehmer-defaults')), { ...defaults, signatureImage: null, signatureFile: { id: sha(signature), type: 'image/png', size: signature.length } });
  assert.ok(files.store.read(sha(signature)).equals(signature));
  // The page reads both forms.
  const { loadDeclarationDefaults } = createLoader()('src/lib/declarationDefaults.ts');
  const loaded = loadDeclarationDefaults({ getItem: () => result.native.get('fachunternehmer-defaults') });
  assert.deepEqual(loaded.signatureFile, { id: sha(signature), type: 'image/png', size: signature.length });
  assert.equal(loaded.signatureImage, null);
  assert.equal(loadDeclarationDefaults({ getItem: () => JSON.stringify(defaults) }).signatureImage, defaults.signatureImage);
  assert.equal(loadDeclarationDefaults({ getItem: () => JSON.stringify({ ...defaults, signatureFile: { id: '../x', type: 'image/png', size: 1 } }) }).signatureFile, undefined);

  // Defaults without an image, in another format, or with a refused file are left untouched.
  for (const [nativeAux, options] of [[JSON.stringify({ ...defaults, signatureImage: null }), {}], ['synthetic defaults', {}], [JSON.stringify(defaults), { refuse: 'throw' }], [JSON.stringify(defaults), { refuse: () => true }]]) {
    const untouched = await reconcile(empty, null, { applyPatches: true, files: fileApi(t, options), nativeAux });
    assert.deepEqual(untouched.alerts, []);
    assert.equal(untouched.native.get('fachunternehmer-defaults'), nativeAux);
    assert.ok(!untouched.writes.some(([key]) => key === 'fachunternehmer-defaults'));
  }
});
