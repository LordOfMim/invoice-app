const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const { StorageClient } = require('../../electron/storage-client.cjs');
const { lastGoodPathFor } = require('../../electron/durable-store.cjs');

const fixture = path.join(__dirname, 'fixtures/legacy-ae06259');
const historicalMain = fs.readFileSync(path.join(fixture, 'old-main.js'), 'utf8');
const encryptionKey = historicalMain.match(/encryptionKey:\s*'([^']+)'/)[1];
const name = 'invoice-app-data';
const key = 'invoice-app:v1';
const prefix = `${key}:recovery:`;
const ConfPromise = import('conf').then(module => module.default);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fixturePayload = JSON.parse(fs.readFileSync(path.join(fixture, 'payload.json'), 'utf8'));

// Use the exact frontend immutable-reference diff, not a second test implementation.
const patchFilename = path.resolve(__dirname, '../../src/lib/storage/patches.ts');
const patchModule = new Module(patchFilename, module);
patchModule._compile(ts.transpileModule(fs.readFileSync(patchFilename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, patchFilename);
const { createDataPatches } = patchModule.exports;

function options(directory) { return { directory, name, encryptionKey }; }
function confOptions(directory) { return { cwd: directory, configName: name, encryptionKey, configFileMode: 0o600 }; }
const clientsByDirectory = new Map();
async function directory(t, prepare) {
  const location = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-worker-real-'));
  clientsByDirectory.set(location, []);
  t.after(async () => {
    for (const client of clientsByDirectory.get(location)) {
      if (client.worker.threadId === -1) continue;
      try { await client.close(); } catch { await client.worker.terminate(); }
    }
    clientsByDirectory.delete(location);
    fs.rmSync(location, { recursive: true, force: true });
  });
  fs.copyFileSync(path.join(fixture, `${name}.json`), path.join(location, `${name}.json`), fs.constants.COPYFILE_EXCL);
  if (prepare) await prepare(new (await ConfPromise)(confOptions(location)), location);
  return location;
}
function clientAt(t, location) {
  const client = new StorageClient(options(location));
  clientsByDirectory.get(location).push(client);
  return client;
}
function batch(session, sequence, previous, next) {
  return { session, sequence, operations: [{ type: 'patch', patches: createDataPatches(previous, next) }] };
}
async function readConf(location) { return new (await ConfPromise)(confOptions(location)); }
const primary = location => path.join(location, `${name}.json`);

// All persistence, encryption, Conf publication and client messages are real;
// only synthetic fixtures/disposable directories are touched.
test('cold worker reads exact historical raw JSON without rewriting or normalizing the primary', async t => {
  const location = await directory(t);
  const before = sha(fs.readFileSync(primary(location)));
  const expected = (await readConf(location)).get(key);
  const client = clientAt(t, location);
  assert.equal(await client.get(key), expected);
  assert.equal(await client.flush(), true);
  assert.equal(sha(fs.readFileSync(primary(location))), before);
});

test('frontend reference patches match complete expected data through append, delete, metadata and unknown fields', async t => {
  const location = await directory(t);
  const client = clientAt(t, location);
  const original = JSON.parse(await client.get(key));
  const edited = {
    ...original,
    settings: { ...original.settings, defaultFooterText: 'DEMO – edited through actual worker' },
    invoices: original.invoices.map((invoice, index) => index === 0 ? { ...invoice, notesText: 'DEMO – independent invoice edit' } : invoice),
    qaAdditiveMetadata: { marker: 'preserved', removeLater: true, order: ['one', 'two'] },
  };
  const patches = createDataPatches(original, edited);
  assert.ok(patches.length > 0);
  assert.ok(patches.every(patch => patch.path.length > 0), 'do not send a whole-root replacement for shared-reference edits');
  assert.equal(await client.commit([batch('frontend-real', 1, original, edited)]), true);
  assert.deepEqual(JSON.parse(await client.get(key)), edited);
  const appended = {
    ...edited,
    products: [...edited.products, { id: 'worker-qa-added-product', name: 'DEMO added product', description: 'Synthetic worker test', unitPrice: 12.5, taxRate: 0.19 }],
  };
  assert.equal(await client.commit([batch('frontend-real', 2, edited, appended)]), true);
  const meta = { ...appended.qaAdditiveMetadata };
  delete meta.removeLater;
  const final = { ...appended, products: appended.products.filter(product => product.id !== 'worker-qa-added-product'), qaAdditiveMetadata: meta };
  assert.equal(await client.commit([batch('frontend-real', 3, appended, final)]), true);
  assert.deepEqual(JSON.parse(await client.get(key)), final);
  assert.equal(await client.flush(), true);
  await client.close();
  const oldReader = await readConf(location);
  assert.deepEqual(JSON.parse(oldReader.get(key)), final);
  for (const collection of ['customers', 'products', 'tags', 'creditNotes', 'recurringInvoices', 'templateVariants']) {
    assert.deepEqual(final[collection], original[collection], `${collection} unrelated records must remain exact`);
  }
  assert.deepEqual(final.invoices[0].attachments, original.invoices[0].attachments);
  const restarted = clientAt(t, location);
  assert.deepEqual(JSON.parse(await restarted.get(key)), final);
});

test('canonical replacement archives exact prior raw data outside the hot container before committing', async t => {
  const location = await directory(t);
  const client = clientAt(t, location);
  const old = await client.get(key);
  const next = JSON.stringify({ ...JSON.parse(old), qaReplacementMarker: 'synthetic' });
  assert.equal(await client.set(key, next), true);
  const entries = await client.listRecoveries();
  const originals = await Promise.all(entries.filter(entry => entry.kind === 'recovery').map(entry => client.getRecovery(entry.id)));
  assert.ok(originals.includes(old));
  assert.ok(!Object.keys((await readConf(location)).store).some(value => value.startsWith(prefix)));
  assert.equal(await client.get(key), next);
  assert.equal(await client.flush(), true);
});

test('same-session splice replay is idempotent after a lost acknowledgement, including worker restart', async t => {
  const location = await directory(t);
  const client = clientAt(t, location);
  const old = JSON.parse(await client.get(key));
  const baseline = { ...old, qaReplayOrder: ['alpha', 'beta', 'gamma'] };
  assert.equal(await client.set(key, JSON.stringify(baseline)), true);
  const operation = { session: 'lost-ack-real-worker', sequence: 1, operations: [{ type: 'patch', patches: [{ op: 'splice', path: ['qaReplayOrder'], start: 1, deleteCount: 1, items: ['inserted-1', 'inserted-2'] }] }] };
  assert.equal(await client.commit([operation]), true);
  const expected = { ...baseline, qaReplayOrder: ['alpha', 'inserted-1', 'inserted-2', 'gamma'] };
  assert.equal(await client.commit([operation]), true);
  assert.deepEqual(JSON.parse(await client.get(key)), expected);
  await client.close();
  const restarted = clientAt(t, location);
  assert.equal(await restarted.commit([operation]), true);
  assert.deepEqual(JSON.parse(await restarted.get(key)), expected);
  const outer = (await readConf(location)).store;
  assert.equal(outer.helferleinPersistence.protocol, 1);
  assert.ok(outer.helferleinPersistence.sessions.some(([session, sequence]) => session === operation.session && sequence === 1));
  assert.equal(JSON.parse(outer[key]).helferleinPersistence, undefined, 'protocol metadata must not change legacy APP schema');
});

test('invalid numeric, future-schema and malformed operations never alter disk or a later flush', async t => {
  const location = await directory(t);
  const client = clientAt(t, location);
  const original = await client.get(key);
  const before = sha(fs.readFileSync(primary(location)));
  const invalid = [
    { session: 'bad-number', sequence: 1, operations: [{ type: 'patch', patches: [{ op: 'set', path: ['invoices', 0, 'lineItems', 0, 'unitPrice'], value: NaN }] }] },
    { session: 'future-schema', sequence: 1, operations: [{ type: 'replace', value: JSON.stringify({ ...JSON.parse(original), schemaVersion: 999 }) }] },
    { session: 'nested-schema', sequence: 1, operations: [{ type: 'patch', patches: [{ op: 'set', path: ['invoices', 0, 'schemaVersion'], value: 999 }] }] },
    { session: 'bad-operation', sequence: 1, operations: [{ type: 'unknown', patches: [] }] },
    { session: 'bad-splice', sequence: 1, operations: [{ type: 'patch', patches: [{ op: 'splice', path: ['invoices'], start: -1, deleteCount: 0, items: [] }] }] },
  ];
  for (const operation of invalid) {
    await assert.rejects(client.commit([operation]));
    assert.deepEqual(JSON.parse(await client.get(key)), JSON.parse(original));
    assert.equal(await client.flush(), true);
    assert.equal(sha(fs.readFileSync(primary(location))), before);
  }
});

test('external primary-file modification blocks commit and close flush without replacing foreign bytes', async t => {
  const location = await directory(t);
  const client = clientAt(t, location);
  const old = JSON.parse(await client.get(key));
  fs.appendFileSync(primary(location), '\nSYNTHETIC EXTERNAL CHANGE');
  const changed = sha(fs.readFileSync(primary(location)));
  await assert.rejects(client.commit([batch('external-change', 1, old, { ...old, qaExternalConflict: true })]), /außerhalb|geändert/i);
  await assert.rejects(client.flush(), /außerhalb|geändert/i);
  await assert.rejects(client.set('windowBounds', { width: 1200, height: 800 }), /außerhalb|geändert/i);
  assert.equal(sha(fs.readFileSync(primary(location))), changed);
});

test('real historical dotted recovery keys remain readable cold and after verified off-hot archival', async t => {
  const historical = `${prefix}2024-03-04T12:34:56.000Z:before-import`;
  const sibling = `${prefix}2024-03-04T12:34:56.001Z:before-import`;
  const oldRaw = ` \n${JSON.stringify({ ...fixturePayload, qaHistoricalCopy: 'first' })}\n`;
  const otherRaw = JSON.stringify({ ...fixturePayload, qaHistoricalCopy: 'second' });
  const location = await directory(t, old => { old.set(historical, oldRaw); old.set(sibling, otherRaw); });
  const client = clientAt(t, location);
  assert.equal(await client.get(historical), oldRaw);
  assert.equal(await client.get(sibling), otherRaw);
  assert.equal(await client.set('windowBounds', { width: 1200, height: 800 }), true);
  assert.equal(await client.get(historical), oldRaw);
  assert.equal(await client.get(sibling), otherRaw);
  const archived = await Promise.all((await client.listRecoveries()).filter(entry => entry.kind === 'recovery').map(entry => client.getRecovery(entry.id)));
  assert.ok(archived.includes(oldRaw));
  assert.ok(archived.includes(otherRaw));
  assert.ok(!Object.keys((await readConf(location)).store).some(value => value.startsWith(prefix)));
});

test('only seven redundant daily generations rotate; user archives, upgrade and last-good remain readable', async t => {
  const location = await directory(t, (old, root) => {
    const recovery = path.join(root, 'recovery');
    fs.mkdirSync(recovery, { mode: 0o700 });
    for (let day = 1; day <= 9; day++) {
      const archived = path.join(recovery, `auto-2000-01-${String(day).padStart(2, '0')}.json`);
      fs.copyFileSync(primary(root), archived);
      fs.chmodSync(archived, 0o600);
    }
    fs.copyFileSync(primary(root), path.join(root, `${name}.before-worker-qa.json`));
  });
  const client = clientAt(t, location);
  const raw = await client.get(key);
  const archiveKey = `${prefix}user-kept-worker-qa`;
  assert.equal(await client.set(archiveKey, raw), true);
  assert.equal(await client.set(key, JSON.stringify({ ...JSON.parse(raw), qaRotation: true })), true);
  const entries = await client.listRecoveries();
  assert.equal(entries.filter(entry => entry.kind === 'automatic').length, 7);
  assert.ok(entries.some(entry => entry.kind === 'upgrade'));
  assert.ok(entries.some(entry => entry.kind === 'last-good'));
  assert.ok(entries.some(entry => entry.kind === 'recovery'));
  assert.equal(await client.get(archiveKey), raw);
  for (const entry of entries) assert.equal(typeof await client.getRecovery(entry.id), 'string');
  await assert.rejects(client.delete(archiveKey));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(primary(location)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(lastGoodPathFor(primary(location))).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(location, 'recovery')).mode & 0o777, 0o700);
    for (const entry of entries.filter(entry => entry.id.startsWith('archive:'))) {
      assert.equal(fs.statSync(path.join(location, 'recovery', entry.id.slice('archive:'.length))).mode & 0o777, 0o600);
    }
  }
});

test('recovery access is list-whitelisted and rejects traversal, unrelated files and symlinks', async t => {
  const location = await directory(t);
  const client = clientAt(t, location);
  const raw = await client.get(key);
  await client.set(`${prefix}whitelist-test`, raw);
  const outside = path.join(location, 'unrelated.json');
  fs.writeFileSync(outside, 'SYNTHETIC UNRELATED FILE');
  let symlinkCreated = false;
  try { fs.symlinkSync(outside, path.join(location, `${name}.before-symlink.json`)); symlinkCreated = true; }
  catch (error) { if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error; }
  for (const id of ['root:../unrelated.json', 'archive:../../unrelated.json', 'root:unrelated.json', `root:${name}.json`]) await assert.rejects(client.getRecovery(id));
  if (symlinkCreated) {
    assert.ok(!(await client.listRecoveries()).some(entry => entry.id.includes('symlink')));
    await assert.rejects(client.getRecovery(`root:${name}.before-symlink.json`));
  }
  assert.equal(fs.readFileSync(outside, 'utf8'), 'SYNTHETIC UNRELATED FILE');
});

test('unknown future worker persistence protocol fails closed before rewriting legacy data', async t => {
  const location = await directory(t, old => old.set('helferleinPersistence', { protocol: 999, sessions: [] }));
  const before = sha(fs.readFileSync(primary(location)));
  const client = clientAt(t, location);
  await assert.rejects(client.ready, /protocol|Protokoll|neuer|unbekannt/i);
  assert.equal(sha(fs.readFileSync(primary(location))), before);
});

test('a rejected multi-batch commit cannot publish an earlier partial batch during later flush', async t => {
  const location = await directory(t);
  const client = clientAt(t, location);
  const original = JSON.parse(await client.get(key));
  const before = sha(fs.readFileSync(primary(location)));
  const changed = { ...original, qaRejectedTransaction: 'must never publish' };
  await assert.rejects(client.commit([
    batch('rejected-multi-batch', 1, original, changed),
    { session: 'rejected-multi-batch', sequence: 2, operations: [{ type: 'unknown' }] },
  ]));
  assert.deepEqual(JSON.parse(await client.get(key)), original);
  assert.equal(await client.flush(), true);
  assert.equal(sha(fs.readFileSync(primary(location))), before);
});
