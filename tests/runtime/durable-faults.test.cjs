const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDurableStoreClass, lastGoodPathFor } = require('../../electron/durable-store.cjs');

const fixture = path.join(__dirname, 'fixtures/legacy-ae06259');
const historicalMain = fs.readFileSync(path.join(fixture, 'old-main.js'), 'utf8');
const encryptionKey = historicalMain.match(/encryptionKey:\s*'([^']+)'/)[1];
const key = 'invoice-app:v1';
const dependencies = Promise.all([import('conf'), import('stubborn-fs')]);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fault = code => Object.assign(new Error(`Synthetic ${code} fault`), { code });

async function setup(t, overrides = {}) {
  const [{ default: Conf }, { default: stubborn }] = await dependencies;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-durable-fault-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const primary = path.join(directory, 'invoice-app-data.json');
  fs.copyFileSync(path.join(fixture, 'invoice-app-data.json'), primary, fs.constants.COPYFILE_EXCL);
  const options = { cwd: directory, configName: 'invoice-app-data', encryptionKey, configFileMode: 0o600 };
  const Durable = createDurableStoreClass(Conf, { fs: { ...fs, ...overrides }, platform: process.platform });
  const store = new Durable(options);
  const original = fs.readFileSync(primary);
  const next = JSON.parse(store.get(key));
  next.settings.defaultFooterText = 'DEMO – next complete synthetic generation';
  return {
    store, stubborn, directory, primary, original, next: JSON.stringify(next),
    lastGood: lastGoodPathFor(primary),
    read(file = primary) {
      const plaintext = store._decryptData(fs.readFileSync(file));
      return JSON.parse(plaintext)[key];
    },
  };
}

function assertUnchanged(runtime) {
  assert.equal(hash(fs.readFileSync(runtime.primary)), hash(runtime.original));
  assert.equal(runtime.store.durability.status, 'failed');
  assert.equal(fs.readdirSync(runtime.directory).some(name => name.startsWith('.invoice-app-data.json.staging-')), false);
}
function captureFailure(action, { phase, unchanged = true, code = 'HELFERLEIN_WRITE_FAILED' }) {
  let caught;
  try { action(); } catch (error) { caught = error; }
  assert.ok(caught, 'failure must propagate rather than acknowledge a successful save');
  assert.equal(caught.code, code);
  assert.equal(caught.phase, phase);
  assert.equal(caught.originalUnchanged, unchanged);
  return caught;
}

// These are bounded process-local fault injections against actual Conf encryption
// and real disposable files. They do not simulate hardware power loss.
test('positive upstream short write is rejected before replacing the original', async t => {
  const runtime = await setup(t);
  const previous = runtime.stubborn.retry.writeSync;
  let shortWrites = 0;
  try {
    runtime.stubborn.retry.writeSync = () => (fd, data) => {
      shortWrites++;
      return fs.writeSync(fd, data, 0, 8, 0);
    };
    captureFailure(() => runtime.store.set(key, runtime.next), { phase: 'publish' });
  } finally { runtime.stubborn.retry.writeSync = previous; }
  assert.ok(shortWrites > 0);
  assertUnchanged(runtime);
});

test('corruption after upstream encrypted staging publication is detected', async t => {
  const runtime = await setup(t);
  const previous = runtime.stubborn.retry.renameSync;
  let corrupted = false;
  try {
    runtime.stubborn.retry.renameSync = () => (source, target) => {
      fs.renameSync(source, target);
      if (String(target).includes('.staging-')) {
        const bytes = fs.readFileSync(target);
        bytes[bytes.length - 1] ^= 0xff;
        fs.writeFileSync(target, bytes);
        corrupted = true;
      }
    };
    captureFailure(() => runtime.store.set(key, runtime.next), { phase: 'publish' });
  } finally { runtime.stubborn.retry.renameSync = previous; }
  assert.equal(corrupted, true);
  assertUnchanged(runtime);
});

test('ENOSPC after a partial encrypted staging write preserves the original', async t => {
  const runtime = await setup(t);
  const previous = runtime.stubborn.retry.writeSync;
  try {
    runtime.stubborn.retry.writeSync = () => (fd, data) => {
      fs.writeSync(fd, data, 0, 16, 0);
      throw fault('ENOSPC');
    };
    captureFailure(() => runtime.store.set(key, runtime.next), { phase: 'staging' });
  } finally { runtime.stubborn.retry.writeSync = previous; }
  assertUnchanged(runtime);
});

test('upstream file fsync failure cannot publish staged ciphertext', async t => {
  const runtime = await setup(t);
  const previous = runtime.stubborn.retry.fsyncSync;
  try {
    runtime.stubborn.retry.fsyncSync = () => () => { throw fault('EIO'); };
    captureFailure(() => runtime.store.set(key, runtime.next), { phase: 'staging' });
  } finally { runtime.stubborn.retry.fsyncSync = previous; }
  assertUnchanged(runtime);
});

test('application verification-fsync failure preserves the original', async t => {
  const opened = new Map();
  let injected = false;
  const runtime = await setup(t, {
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); opened.set(fd, String(file)); return fd; },
    closeSync(fd) { opened.delete(fd); return fs.closeSync(fd); },
    fsyncSync(fd) {
      if (opened.get(fd)?.includes('.staging-')) { injected = true; throw fault('EIO'); }
      return fs.fsyncSync(fd);
    },
  });
  captureFailure(() => runtime.store.set(key, runtime.next), { phase: 'publish' });
  assert.equal(injected, true);
  assertUnchanged(runtime);
});

for (const code of ['EIO', 'EXDEV']) {
  test(`${code} during final primary rename never falls back to a direct primary write`, async t => {
    let primary;
    let failedRenames = 0;
    const runtime = await setup(t, {
      renameSync(source, target) {
        if (target === primary) { failedRenames++; throw fault(code); }
        return fs.renameSync(source, target);
      },
    });
    primary = runtime.primary;
    captureFailure(() => runtime.store.set(key, runtime.next), { phase: 'publish' });
    assert.ok(failedRenames > 0);
    assertUnchanged(runtime);
    assert.equal(hash(fs.readFileSync(runtime.lastGood)), hash(runtime.original));
  });
}

test('Conf EXDEV fallback writes only staging; verified complete ciphertext can then publish safely', async t => {
  const runtime = await setup(t);
  const previousRename = runtime.stubborn.retry.renameSync;
  const previousWrite = fs.writeFileSync;
  const directTargets = [];
  try {
    runtime.stubborn.retry.renameSync = () => (source, target) => {
      if (String(target).includes('.staging-')) throw fault('EXDEV');
      return fs.renameSync(source, target);
    };
    fs.writeFileSync = (file, ...args) => { directTargets.push(String(file)); return previousWrite(file, ...args); };
    runtime.store.set(key, runtime.next);
  } finally {
    runtime.stubborn.retry.renameSync = previousRename;
    fs.writeFileSync = previousWrite;
  }
  assert.ok(directTargets.length > 0, 'exercise the real Conf direct-write fallback');
  assert.ok(directTargets.every(target => target.includes('.staging-')));
  assert.ok(!directTargets.includes(runtime.primary));
  assert.equal(runtime.read(), runtime.next);
  assert.equal(hash(fs.readFileSync(runtime.lastGood)), hash(runtime.original));
  assert.equal(runtime.store.durability.status, 'ok');
});

test('failure to fence last-good directory entry prevents replacing the primary', { skip: process.platform === 'win32' }, async t => {
  let injected = false;
  const runtime = await setup(t, {
    fsyncSync(fd) {
      if (fs.fstatSync(fd).isDirectory()) { injected = true; throw fault('EIO'); }
      return fs.fsyncSync(fd);
    },
  });
  captureFailure(() => runtime.store.set(key, runtime.next), { phase: 'publish' });
  assert.equal(injected, true);
  assertUnchanged(runtime);
});

test('post-rename directory fsync failure is ambiguous and keeps a readable previous generation', { skip: process.platform === 'win32' }, async t => {
  let primary;
  let published = false;
  const runtime = await setup(t, {
    renameSync(source, target) { fs.renameSync(source, target); if (target === primary) published = true; },
    fsyncSync(fd) { if (published && fs.fstatSync(fd).isDirectory()) throw fault('EIO'); return fs.fsyncSync(fd); },
  });
  primary = runtime.primary;
  const error = captureFailure(() => runtime.store.set(key, runtime.next), {
    phase: 'commit', unchanged: false, code: 'HELFERLEIN_COMMIT_AMBIGUOUS',
  });
  assert.equal(runtime.store.durability.status, 'ambiguous');
  assert.equal(error.lastGoodPath, runtime.lastGood);
  assert.equal(runtime.read(), runtime.next, 'new name is visible, but must not be acknowledged as durable');
  assert.equal(hash(fs.readFileSync(runtime.lastGood)), hash(runtime.original));
  assert.doesNotThrow(() => JSON.parse(runtime.read(runtime.lastGood)));
});

test('failed retry after an ambiguous commit cannot rotate away the previously confirmed last-good', { skip: process.platform === 'win32' }, async t => {
  let primary;
  let primaryPublished = false;
  let mode = 'first-ambiguous';
  const runtime = await setup(t, {
    renameSync(source, target) { fs.renameSync(source, target); if (target === primary) primaryPublished = true; },
    fsyncSync(fd) {
      if (fs.fstatSync(fd).isDirectory() && (mode === 'retry-fails' || primaryPublished)) throw fault('EIO');
      return fs.fsyncSync(fd);
    },
  });
  primary = runtime.primary;
  captureFailure(() => runtime.store.set(key, runtime.next), {
    phase: 'commit', unchanged: false, code: 'HELFERLEIN_COMMIT_AMBIGUOUS',
  });
  assert.equal(hash(fs.readFileSync(runtime.lastGood)), hash(runtime.original));
  mode = 'retry-fails';
  const newer = JSON.parse(runtime.next);
  newer.settings.defaultFooterText = 'DEMO – retry must not discard last confirmed generation';
  assert.throws(() => runtime.store.set(key, JSON.stringify(newer)));
  assert.equal(runtime.store.durability.status, 'ambiguous');
  assert.equal(hash(fs.readFileSync(runtime.lastGood)), hash(runtime.original));
});

test('successful retry fences the ambiguous primary and its directory before rotating last-good', { skip: process.platform === 'win32' }, async t => {
  let primary;
  let published = false;
  let inject = true;
  const opened = new Map();
  const events = [];
  const runtime = await setup(t, {
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); opened.set(fd, String(file)); return fd; },
    closeSync(fd) { opened.delete(fd); return fs.closeSync(fd); },
    renameSync(source, target) {
      fs.renameSync(source, target);
      if (target === primary) { published = true; events.push('publish-primary'); }
      if (primary && target === lastGoodPathFor(primary)) events.push('rotate-last-good');
    },
    fsyncSync(fd) {
      const directory = fs.fstatSync(fd).isDirectory();
      if (inject && published && directory) throw fault('EIO');
      if (opened.get(fd) === primary) events.push('fence-primary');
      if (directory) events.push('fence-directory');
      return fs.fsyncSync(fd);
    },
  });
  primary = runtime.primary;
  captureFailure(() => runtime.store.set(key, runtime.next), {
    phase: 'commit', unchanged: false, code: 'HELFERLEIN_COMMIT_AMBIGUOUS',
  });
  inject = false;
  events.length = 0;
  const newer = JSON.parse(runtime.next);
  newer.settings.defaultFooterText = 'DEMO – successfully fenced retry';
  const raw = JSON.stringify(newer);
  runtime.store.set(key, raw);
  const fenced = events.indexOf('fence-primary');
  const rotated = events.indexOf('rotate-last-good');
  assert.ok(fenced >= 0, 'confirm the ambiguous primary file before calling it last-good');
  assert.ok(rotated > fenced);
  assert.ok(events.slice(fenced + 1, rotated).includes('fence-directory'), 'confirm the primary name before rotating last-good');
  assert.equal(runtime.read(runtime.lastGood), runtime.next);
  assert.equal(runtime.read(), raw);
  assert.equal(runtime.store.durability.status, 'ok');
});

test('successful publication and last-good use private POSIX 0600 files with valid legacy encryption', { skip: process.platform === 'win32' }, async t => {
  const runtime = await setup(t);
  runtime.store.set(key, runtime.next);
  assert.equal(fs.statSync(runtime.primary).mode & 0o777, 0o600);
  assert.equal(fs.statSync(runtime.lastGood).mode & 0o777, 0o600);
  assert.equal(runtime.read(), runtime.next);
  assert.equal(hash(fs.readFileSync(runtime.lastGood)), hash(runtime.original));
  assert.equal(runtime.store.durability.status, 'ok');
  assert.equal(fs.readdirSync(runtime.directory).some(name => name.startsWith('.invoice-app-data.json.')), false);
});
