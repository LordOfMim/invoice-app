'use strict';
// Attachments, logos and images as files beside the data: the references, the file store, and backups with them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const refs = require('../../electron/file-refs.cjs');
const { FileStore } = require('../../electron/file-store.cjs');
const files = require('../../electron/local-files.cjs');
const { isValidPersistedData } = require('../../electron/storage-validation.cjs');
const { createLoader } = require('./helpers/load-typescript.cjs');

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const dataUrl = (bytes, type = 'image/png') => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
const LOGO = Buffer.from('synthetic logo '.repeat(40));
const SCAN = Buffer.from('%PDF-1.4 synthetic scan '.repeat(400));
const PHOTO = crypto.randomBytes(5000);

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-file-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const storeIn = (directory, options) => new FileStore(path.join(directory, 'attachments'), options);

/** Data as version 1.3 wrote it: everything embedded as base64. */
function legacyData() {
  return {
    schemaVersion: 1,
    settings: { language: 'de', defaultLogoDataUrl: dataUrl(LOGO) },
    invoices: [
      { id: 'with-files', invoiceNumber: 'RE-1', logoDataUrl: dataUrl(LOGO), attachments: [
        { id: 'a1', name: 'Beleg.pdf', type: 'application/pdf', size: SCAN.length, dataUrl: dataUrl(SCAN, 'application/pdf'), createdAt: '2026-11-01T00:00:00.000Z' },
        { id: 'a2', name: 'Foto.jpg', type: 'image/jpeg', size: PHOTO.length, dataUrl: dataUrl(PHOTO, 'image/jpeg'), createdAt: '2026-11-02T00:00:00.000Z' },
      ] },
      { id: 'plain', invoiceNumber: 'RE-2', attachments: [] },
    ],
    quotes: [{ id: 'quote', logoDataUrl: dataUrl(LOGO), attachments: [{ id: 'a3', name: 'Beleg-Kopie.pdf', type: 'application/pdf', size: SCAN.length, dataUrl: dataUrl(SCAN, 'application/pdf'), createdAt: '2026-11-03T00:00:00.000Z' }] }],
  };
}

async function externalized(store, data = legacyData()) {
  const map = new Map();
  for (const url of refs.embeddedFiles(data)) map.set(url, await store.putDataUrl(url));
  return refs.externalizeFiles(data, map);
}

// ── References ───────────────────────────────────────────────────────────────────────────────────────────────────

test('file references: only a checksum, a media type and a size count as one', () => {
  const id = sha(LOGO);
  assert.equal(refs.isFileRef({ id, type: 'image/png', size: 10 }), true);
  for (const value of [null, 'x', [], { id }, { id, type: 'image/png' }, { id: id.toUpperCase(), type: 'image/png', size: 1 }, { id: `${id}0`, type: 'image/png', size: 1 },
    { id: '../../etc/passwd', type: 'image/png', size: 1 }, { id, type: 'image/png, text/html', size: 1 }, { id, type: 'image png', size: 1 }, { id, type: '', size: 1 },
    { id, type: 'image/png', size: -1 }, { id, type: 'image/png', size: 1.5 }, { id, type: 'image/png', size: '1' }]) {
    assert.equal(refs.isFileRef(value), false, JSON.stringify(value));
  }
});

test('file references: the storage validator accepts exactly what isFileRef accepts', () => {
  const id = sha(LOGO);
  const base = () => ({ schemaVersion: 1, settings: {}, invoices: [] });
  for (const file of [{ id, type: 'image/png', size: 3 }, { id, type: 'application/pdf', size: 0 }, { id: 'nope', type: 'image/png', size: 3 }, { id, type: 'a b', size: 3 }, { id, type: 'image/png', size: -3 }, 'text', null]) {
    const expected = refs.isFileRef(file);
    assert.equal(isValidPersistedData({ ...base(), settings: { defaultLogoFile: file } }), expected, `settings ${JSON.stringify(file)}`);
    assert.equal(isValidPersistedData({ ...base(), invoices: [{ id: 'i', logoFile: file }] }), expected, `invoice ${JSON.stringify(file)}`);
    assert.equal(isValidPersistedData({ ...base(), quotes: [{ id: 'q', attachments: [{ id: 'a', file }] }] }), expected, `attachment ${JSON.stringify(file)}`);
  }
});

test('embeddedFiles: finds each distinct data URL once and ignores everything that carries no content', () => {
  const data = legacyData();
  data.invoices.push({ id: 'odd', logoDataUrl: 'https://example.invalid/logo.png', attachments: [
    { id: 'empty', dataUrl: '' }, { id: 'no-payload', dataUrl: 'data:image/png;base64,' }, { id: 'not-base64', dataUrl: 'data:text/plain,hello' }, null, 'text',
  ] });
  const found = refs.embeddedFiles(data);
  assert.deepEqual(found.sort(), [dataUrl(LOGO), dataUrl(SCAN, 'application/pdf'), dataUrl(PHOTO, 'image/jpeg')].sort());
  assert.deepEqual(refs.embeddedFiles(null), []);
  assert.deepEqual(refs.embeddedFiles({ schemaVersion: 1, settings: {}, invoices: [] }), []);
});

test('externalizeFiles: swaps data URLs for references and leaves untouched records identical', async (t) => {
  const store = storeIn(tempDir(t));
  const data = legacyData();
  Object.freeze(data); Object.freeze(data.settings); for (const invoice of data.invoices) Object.freeze(invoice);
  const next = await externalized(store, data);
  const logo = { id: sha(LOGO), type: 'image/png', size: LOGO.length };
  const scan = { id: sha(SCAN), type: 'application/pdf', size: SCAN.length };
  assert.deepEqual(next.settings, { language: 'de', defaultLogoFile: logo });
  assert.deepEqual(next.invoices[0].logoFile, logo);
  assert.equal('logoDataUrl' in next.invoices[0], false);
  assert.deepEqual(next.invoices[0].attachments[0], { id: 'a1', name: 'Beleg.pdf', type: 'application/pdf', size: SCAN.length, createdAt: '2026-11-01T00:00:00.000Z', file: scan });
  assert.deepEqual(next.quotes[0].attachments[0].file, scan);
  assert.equal(next.invoices[1], data.invoices[1], 'an invoice without files keeps its identity');
  assert.equal(JSON.stringify(next).includes('base64'), false);
  assert.equal(isValidPersistedData(next), true);
  // The original is not modified, and nothing changes without confirmed references.
  assert.deepEqual(data, legacyData());
  assert.equal(refs.externalizeFiles(data, new Map()), data);
  assert.equal(refs.externalizeFiles(next, new Map([[dataUrl(LOGO), logo]])), next);
});

test('externalizeFiles: a file without a confirmed reference stays embedded', async (t) => {
  const store = storeIn(tempDir(t));
  const data = legacyData();
  const next = refs.externalizeFiles(data, new Map([[dataUrl(LOGO), await store.putDataUrl(dataUrl(LOGO))]]));
  assert.equal(next.invoices[0].attachments[0].dataUrl, dataUrl(SCAN, 'application/pdf'));
  assert.equal(next.invoices[0].attachments[0].file, undefined);
  assert.equal(next.invoices[0].attachments, data.invoices[0].attachments, 'untouched attachments keep their identity');
  assert.deepEqual(refs.embeddedFiles(next).sort(), [dataUrl(SCAN, 'application/pdf'), dataUrl(PHOTO, 'image/jpeg')].sort());
});

test('externalizeFiles: a newer data URL replaces a reference left behind by an older state', async (t) => {
  const store = storeIn(tempDir(t));
  const stale = { id: sha(SCAN), type: 'image/png', size: SCAN.length };
  const data = { schemaVersion: 1, settings: { defaultLogoFile: stale, defaultLogoDataUrl: dataUrl(LOGO) }, invoices: [] };
  const next = await externalized(store, data);
  assert.deepEqual(next.settings, { defaultLogoFile: { id: sha(LOGO), type: 'image/png', size: LOGO.length } });
});

test('referencedFileIds: every file the data refers to, each once', async (t) => {
  const next = await externalized(storeIn(tempDir(t)));
  assert.deepEqual(refs.referencedFileIds(next).sort(), [sha(LOGO), sha(SCAN), sha(PHOTO)].sort());
  assert.deepEqual(refs.referencedFileIds(legacyData()), []);
  assert.deepEqual(refs.referencedFileIds({ settings: { defaultLogoFile: { id: 'x' } }, invoices: [{ logoFile: 'no', attachments: [{ file: { id: '../x', type: 'a/b', size: 1 } }] }] }), []);
});

test('the renderer keeps references through its migration and drops only empty data URLs', async (t) => {
  const store = storeIn(tempDir(t));
  const { parsePersistedData } = createLoader()('src/lib/storage/store.ts');
  const legacy = legacyData();
  legacy.invoices[1].attachments.push({ id: 'empty', name: 'leer', type: '', size: 0, dataUrl: '', createdAt: '2026-11-04T00:00:00.000Z' });
  const loadedLegacy = parsePersistedData(JSON.stringify(legacy));
  assert.equal(loadedLegacy.invoices[0].attachments[0].dataUrl, dataUrl(SCAN, 'application/pdf'), 'embedded content survives loading');
  assert.equal('dataUrl' in loadedLegacy.invoices[1].attachments[0], false);
  // Data that needs no change is written back byte for byte, so loading it triggers no rewrite.
  const canonical = JSON.stringify(parsePersistedData(JSON.stringify(legacyData())));
  assert.equal(JSON.stringify(parsePersistedData(canonical)), canonical);

  const moved = await externalized(store, parsePersistedData(canonical));
  const stored = JSON.stringify(moved);
  const reloaded = parsePersistedData(stored);
  assert.equal(JSON.stringify(reloaded), stored, 'data with references is stable across a reload');
  assert.deepEqual(reloaded.invoices[0].attachments[0].file, { id: sha(SCAN), type: 'application/pdf', size: SCAN.length });
  assert.deepEqual(reloaded.settings.defaultLogoFile, { id: sha(LOGO), type: 'image/png', size: LOGO.length });
});

test('a copied invoice keeps its logo reference and, as before, none of the attachments', async (t) => {
  const store = storeIn(tempDir(t));
  const load = createLoader();
  const { parsePersistedData } = load('src/lib/storage/store.ts');
  const { duplicateInvoice } = load('src/lib/defaults.ts');
  const data = await externalized(store, parsePersistedData(JSON.stringify(legacyData())));
  const copy = duplicateInvoice(data.invoices[0]);
  assert.deepEqual(copy.logoFile, data.invoices[0].logoFile);
  assert.deepEqual(copy.attachments, []);
});

// ── File store ───────────────────────────────────────────────────────────────────────────────────────────────────

test('FileStore: stores content under its checksum, once, and returns it unchanged', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  const first = await store.put(SCAN, 'application/pdf');
  assert.deepEqual(first, { id: sha(SCAN), type: 'application/pdf', size: SCAN.length });
  assert.deepEqual(await store.put(SCAN, 'application/pdf'), first);
  assert.deepEqual(await store.putDataUrl(dataUrl(SCAN, 'application/pdf')), first);
  assert.deepEqual(fs.readdirSync(store.directory), [sha(SCAN)], 'one file, no temporary leftovers');
  assert.ok(store.read(first.id).equals(SCAN));
  assert.equal(store.dataUrl(first), dataUrl(SCAN, 'application/pdf'));
  assert.equal(store.has(first.id), true);
  assert.equal(store.has(sha(LOGO)), false);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(store.directory).mode & 0o077, 0, 'folder is private');
    assert.equal(fs.statSync(store.pathFor(first.id)).mode & 0o777, 0o600, 'file is private');
  }
});

test('FileStore: a data URL is stored only when it decodes without loss', async (t) => {
  const store = storeIn(tempDir(t));
  const good = dataUrl(PHOTO, 'image/jpeg');
  assert.equal(store.dataUrl(await store.putDataUrl(good)), good);
  for (const bad of ['', 'text', 'data:image/png;base64,', 'data:text/plain,hello', `${good}!!`, `${good.slice(0, -4)}*`, 'data:image/png;base64,AAA', null, 5]) {
    await assert.rejects(store.putDataUrl(bad), /Ungültige Datei|nicht vollständig lesbar/, String(bad).slice(0, 40));
  }
  // An unusable media type falls back to a neutral one; the bytes are kept all the same.
  const odd = await store.putDataUrl(`data:;base64,${LOGO.toString('base64')}`);
  assert.deepEqual(odd, { id: sha(LOGO), type: 'application/octet-stream', size: LOGO.length });
  // A type with parameters is preserved exactly.
  const typed = await store.putDataUrl(`data:text/plain;charset=utf-8;base64,${Buffer.from('hallo').toString('base64')}`);
  assert.equal(typed.type, 'text/plain;charset=utf-8');
  assert.equal(store.dataUrl(typed), `data:text/plain;charset=utf-8;base64,${Buffer.from('hallo').toString('base64')}`);
});

test('FileStore: empty and oversized files are refused before anything is written', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory, { maxBytes: 1000 });
  await assert.rejects(store.put(Buffer.alloc(0), 'image/png'), /leer/);
  await assert.rejects(store.put(Buffer.alloc(1001), 'image/png'), /zu groß/);
  await assert.rejects(store.put('text', 'image/png'), /Ungültige Datei/);
  assert.equal(fs.existsSync(store.directory), false);
  assert.equal((await store.put(Buffer.alloc(1000, 1), 'image/png')).size, 1000);
});

test('FileStore: an id is never a path', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  fs.writeFileSync(path.join(directory, 'secret.txt'), 'private');
  for (const id of ['../secret.txt', '..\\secret.txt', 'secret.txt', '', `${sha(LOGO)}/..`, `${sha(LOGO)}.tmp`, sha(LOGO).toUpperCase(), null, undefined, 7, {}]) {
    assert.throws(() => store.pathFor(id), /Ungültige Dateikennung/, String(id));
    assert.throws(() => store.read(id), /Ungültige Dateikennung/, String(id));
    assert.equal(store.has(id), false);
    await assert.rejects(store.adopt(id, Buffer.from('x')), /Ungültige Dateikennung/);
  }
  assert.throws(() => store.dataUrl({ id: sha(LOGO), type: 'image/png, text/html', size: 1 }), /Ungültige Dateikennung/);
});

test('FileStore: a missing or damaged file is reported, and storing the content again repairs it', async (t) => {
  const store = storeIn(tempDir(t));
  const ref = await store.put(LOGO, 'image/png');
  assert.throws(() => store.read(sha(SCAN)), /nicht mehr vorhanden/);
  fs.writeFileSync(store.pathFor(ref.id), 'damaged');
  assert.throws(() => store.read(ref.id), /beschädigt/);
  assert.throws(() => store.dataUrl(ref), /beschädigt/);
  assert.deepEqual(await store.put(LOGO, 'image/png'), ref);
  assert.ok(store.read(ref.id).equals(LOGO));
  if (process.platform !== 'win32') {
    // A link in place of a file is not followed.
    fs.rmSync(store.pathFor(ref.id));
    fs.writeFileSync(path.join(store.directory, 'elsewhere'), LOGO);
    fs.symlinkSync(path.join(store.directory, 'elsewhere'), store.pathFor(ref.id));
    assert.equal(store.has(ref.id), false);
    assert.throws(() => store.read(ref.id), /nicht mehr vorhanden/);
  }
});

test('FileStore: adopt takes only content that matches its id', async (t) => {
  const store = storeIn(tempDir(t));
  await assert.rejects(store.adopt(sha(LOGO), SCAN), /beschädigt/);
  assert.equal(store.has(sha(LOGO)), false);
  assert.equal(await store.adopt(sha(LOGO), LOGO), true);
  assert.ok(store.read(sha(LOGO)).equals(LOGO));
});

// ── Backups with attachments ─────────────────────────────────────────────────────────────────────────────────────

test('folder backup: attachments are copied beside the dated file, each once, and never removed', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  const data = await externalized(store);
  const folder = path.join(directory, 'USB');
  fs.mkdirSync(folder);
  const first = await files.writeBackup({ folder, json: JSON.stringify(data), today: '2026-11-16', store, validate: isValidPersistedData });
  assert.equal(first.files, 3);
  assert.equal(first.missingFiles, 0);
  const attachmentFolder = path.join(folder, files.ATTACHMENTS_FOLDER);
  assert.deepEqual(fs.readdirSync(attachmentFolder).sort(), [sha(LOGO), sha(SCAN), sha(PHOTO)].sort());
  assert.ok(fs.readFileSync(path.join(attachmentFolder, sha(SCAN))).equals(SCAN));
  const stamp = fs.statSync(path.join(attachmentFolder, sha(SCAN))).mtimeMs;

  // The next backup refers to fewer files: nothing is copied again and nothing older disappears.
  const fewer = { ...data, invoices: [data.invoices[1]], quotes: [] };
  const second = await files.writeBackup({ folder, json: JSON.stringify(fewer), today: '2026-11-23', store, validate: isValidPersistedData });
  assert.equal(second.files, 1);
  assert.deepEqual(fs.readdirSync(attachmentFolder).sort(), [sha(LOGO), sha(SCAN), sha(PHOTO)].sort());
  assert.equal(fs.statSync(path.join(attachmentFolder, sha(SCAN))).mtimeMs, stamp);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['Helferlein-Sicherung-2026-11-16.json', 'Helferlein-Sicherung-2026-11-23.json', 'attachments']);
});

test('folder backup: a file that is gone locally is counted and does not stop the backup', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  const data = await externalized(store);
  fs.rmSync(store.pathFor(sha(PHOTO)));
  const folder = path.join(directory, 'USB');
  fs.mkdirSync(folder);
  const result = await files.writeBackup({ folder, json: JSON.stringify(data), today: '2026-11-16', store });
  assert.equal(result.files, 2);
  assert.equal(result.missingFiles, 1);
  assert.equal(fs.existsSync(path.join(folder, result.file)), true);
});

test('folder backup: restoring the JSON takes its attachments from the folder beside it', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  const data = await externalized(store);
  const folder = path.join(directory, 'USB');
  fs.mkdirSync(folder);
  const written = await files.writeBackup({ folder, json: JSON.stringify(data), today: '2026-11-16', store });

  const fresh = storeIn(path.join(directory, 'new-computer'));
  const restored = await files.readBackup({ file: path.join(folder, written.file), store: fresh, validate: isValidPersistedData });
  assert.equal(restored.json, JSON.stringify(data));
  assert.deepEqual(restored.missingFiles, []);
  assert.ok(fresh.read(sha(SCAN)).equals(SCAN));

  // A JSON that was moved away from its attachments restores the data and names what is missing.
  fs.mkdirSync(path.join(directory, 'Downloads'));
  const alone = path.join(directory, 'Downloads', 'alone.json');
  fs.copyFileSync(path.join(folder, written.file), alone);
  const partial = await files.readBackup({ file: alone, store: storeIn(path.join(directory, 'other')), validate: isValidPersistedData });
  assert.equal(partial.json, JSON.stringify(data));
  assert.deepEqual(partial.missingFiles.sort(), [sha(LOGO), sha(SCAN), sha(PHOTO)].sort());

  // A file in the backup folder that does not match its name is not taken over.
  fs.writeFileSync(path.join(folder, files.ATTACHMENTS_FOLDER, sha(PHOTO)), 'planted');
  const tampered = await files.readBackup({ file: path.join(folder, written.file), store: storeIn(path.join(directory, 'third')), validate: isValidPersistedData });
  assert.deepEqual(tampered.missingFiles, [sha(PHOTO)]);
});

test('backup archive: one ZIP with the data and every referenced file, restorable on an empty computer', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  const data = await externalized(store);
  await store.put(Buffer.from('not referenced by the data'), 'text/plain');
  const json = JSON.stringify(data, null, 2);
  const target = path.join(directory, 'Helferlein-Sicherung-2026-11-17.zip');
  const result = await files.writeBackupArchive({ target, json, store, validate: isValidPersistedData });
  assert.equal(result.files, 3);
  assert.equal(result.missingFiles, 0);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['Helferlein-Sicherung-2026-11-17.zip', 'attachments'], 'no temporary file is left');

  const archive = await files.openArchive(target);
  try {
    assert.deepEqual(archive.entries.map((entry) => entry.name).sort(), [files.ARCHIVE_DATA_NAME, ...[sha(LOGO), sha(SCAN), sha(PHOTO)].map((id) => `attachments/${id}`)].sort());
    assert.equal(archive.entries[0].name, files.ARCHIVE_DATA_NAME, 'the data comes first');
    assert.equal((await archive.read(archive.entries[0], 1e6)).toString('utf8'), json);
  } finally { await archive.close(); }

  const fresh = storeIn(path.join(directory, 'new-computer'));
  const restored = await files.readBackup({ file: target, store: fresh, validate: isValidPersistedData });
  assert.equal(restored.json, json);
  assert.deepEqual(restored.missingFiles, []);
  assert.deepEqual(fs.readdirSync(fresh.directory).sort(), [sha(LOGO), sha(SCAN), sha(PHOTO)].sort(), 'only referenced files are taken over');
  for (const bytes of [LOGO, SCAN, PHOTO]) assert.ok(fresh.read(sha(bytes)).equals(bytes));
});

test('backup archive: a missing file is counted, an unreadable archive never replaces an existing backup', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  const data = await externalized(store);
  fs.rmSync(store.pathFor(sha(SCAN)));
  const target = path.join(directory, 'backup.zip');
  const result = await files.writeBackupArchive({ target, json: JSON.stringify(data), store });
  assert.equal(result.files, 2);
  assert.equal(result.missingFiles, 1);
  const restored = await files.readBackup({ file: target, store: storeIn(path.join(directory, 'fresh')) });
  assert.deepEqual(restored.missingFiles, [sha(SCAN)]);

  const before = fs.readFileSync(target);
  await assert.rejects(files.writeBackupArchive({ target, json: '{broken', store }), /nicht lesbar/);
  await assert.rejects(files.writeBackupArchive({ target, json: '', store }), /keine Daten/);
  await assert.rejects(files.writeBackupArchive({ target, json: JSON.stringify({ schemaVersion: 2 }), store, validate: isValidPersistedData }), /unvollständig/);
  assert.ok(fs.readFileSync(target).equals(before));
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')), []);
});

test('backup archive: content that does not match its name is not taken over', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  const data = await externalized(store);
  // Build an archive whose attachment entries carry other bytes than their names promise.
  const planted = storeIn(path.join(directory, 'planted'));
  planted.ensureDirectory();
  for (const id of refs.referencedFileIds(data)) fs.writeFileSync(path.join(planted.directory, id), `planted ${id}`);
  planted.read = (id) => fs.readFileSync(path.join(planted.directory, id));
  const target = path.join(directory, 'planted.zip');
  await files.writeBackupArchive({ target, json: JSON.stringify(data), store: planted });
  const fresh = storeIn(path.join(directory, 'fresh'));
  const restored = await files.readBackup({ file: target, store: fresh, validate: isValidPersistedData });
  assert.deepEqual(restored.missingFiles.sort(), refs.referencedFileIds(data).sort());
  assert.equal(fs.existsSync(fresh.directory), false);
});

test('readBackup: older JSON backups with embedded files are read unchanged', async (t) => {
  const directory = tempDir(t);
  const legacy = JSON.stringify(legacyData(), null, 2);
  const file = path.join(directory, 'invoice-app-backup-2026-10-01.json');
  fs.writeFileSync(file, legacy);
  const store = storeIn(directory);
  const restored = await files.readBackup({ file, store, validate: isValidPersistedData });
  assert.equal(restored.json, legacy);
  assert.deepEqual(restored.missingFiles, []);
  assert.equal(fs.existsSync(store.directory), false, 'embedded files are moved when the app loads the data, not here');
  // A byte order mark in front of the JSON is tolerated.
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(legacy)]));
  assert.equal((await files.readBackup({ file, store, validate: isValidPersistedData })).json, legacy);
});

test('readBackup: files that are no Helferlein backup are refused', async (t) => {
  const directory = tempDir(t);
  const store = storeIn(directory);
  const write = (name, content) => { const file = path.join(directory, name); fs.writeFileSync(file, content); return file; };
  await assert.rejects(files.readBackup({ file: write('text.json', 'hello'), store, validate: isValidPersistedData }), /keine gültige Helferlein-Sicherung/);
  await assert.rejects(files.readBackup({ file: write('other.json', '{"schemaVersion":2}'), store, validate: isValidPersistedData }), /keine gültige Helferlein-Sicherung/);
  await assert.rejects(files.readBackup({ file: directory, store }), /keine gültige Helferlein-Sicherung/);
  // A ZIP without the data, with two candidates, or with damaged content.
  const zip = (entries) => files.buildZip(entries);
  await assert.rejects(files.readBackup({ file: write('pdfs.zip', zip([{ name: 'Rechnung.pdf', data: '%PDF-' }])), store }), /keine gültige Helferlein-Sicherung/);
  await assert.rejects(files.readBackup({ file: write('two.zip', zip([{ name: 'a.json', data: '{}' }, { name: 'b.json', data: '{}' }])), store }), /keine gültige Helferlein-Sicherung/);
  const good = zip([{ name: files.ARCHIVE_DATA_NAME, data: JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [] }) }]);
  assert.equal(JSON.parse((await files.readBackup({ file: write('good.zip', good), store, validate: isValidPersistedData })).json).schemaVersion, 1);
  // The data under another name is accepted when it is the only JSON in the archive.
  const renamed = zip([{ name: 'Meine Sicherung.json', data: JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [] }) }, { name: 'Notiz.txt', data: 'x' }]);
  assert.equal(JSON.parse((await files.readBackup({ file: write('renamed.zip', renamed), store, validate: isValidPersistedData })).json).schemaVersion, 1);
  // One flipped byte inside the stored data is noticed (the member starts after its 30-byte header and its name).
  const damaged = Buffer.from(good); damaged[30 + Buffer.byteLength(files.ARCHIVE_DATA_NAME) + 5] ^= 0xff;
  await assert.rejects(files.readBackup({ file: write('damaged.zip', damaged), store, validate: isValidPersistedData }), /beschädigt|kein lesbares ZIP/);
  await assert.rejects(files.readBackup({ file: write('cut.zip', good.subarray(0, good.length - 10)), store }), /kein lesbares ZIP/);
});
