'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const files = require('../../electron/local-files.cjs');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-local-files-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Reads a ZIP through its central directory and checks every structural promise on the way. */
function readZip(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50, 'end record at the very end (no comment)');
  assert.equal(buffer.readUInt16LE(end + 20), 0, 'no archive comment');
  const count = buffer.readUInt16LE(end + 10);
  assert.equal(buffer.readUInt16LE(end + 8), count);
  const size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  assert.equal(start + size, end, 'central directory directly precedes the end record');
  const entries = [];
  let position = start, expectedLocal = 0;
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(position), 0x02014b50, 'central header signature');
    const flags = buffer.readUInt16LE(position + 8), method = buffer.readUInt16LE(position + 10);
    const time = buffer.readUInt16LE(position + 12), date = buffer.readUInt16LE(position + 14);
    const crc = buffer.readUInt32LE(position + 16), packed = buffer.readUInt32LE(position + 20), length = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28), extra = buffer.readUInt16LE(position + 30), comment = buffer.readUInt16LE(position + 32);
    const local = buffer.readUInt32LE(position + 42);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    assert.equal(flags, 0x0800, 'UTF-8 names, sizes in the headers');
    assert.ok(method === 0 || method === 8);
    assert.equal(local, expectedLocal, 'entries are stored back to back');
    // The local header repeats the central one.
    assert.equal(buffer.readUInt32LE(local), 0x04034b50, 'local header signature');
    assert.deepEqual(
      [buffer.readUInt16LE(local + 6), buffer.readUInt16LE(local + 8), buffer.readUInt16LE(local + 10), buffer.readUInt16LE(local + 12), buffer.readUInt32LE(local + 14), buffer.readUInt32LE(local + 18), buffer.readUInt32LE(local + 22), buffer.readUInt16LE(local + 26), buffer.readUInt16LE(local + 28)],
      [flags, method, time, date, crc, packed, length, nameLength, 0],
    );
    assert.equal(buffer.subarray(local + 30, local + 30 + nameLength).toString('utf8'), name);
    const body = buffer.subarray(local + 30 + nameLength, local + 30 + nameLength + packed);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, length);
    assert.equal(zlib.crc32(data) >>> 0, crc, `checksum of ${name}`);
    entries.push({ name, data, method, time, date });
    expectedLocal = local + 30 + nameLength + packed;
    position += 46 + nameLength + extra + comment;
  }
  assert.equal(position, end);
  assert.equal(expectedLocal, start);
  return entries;
}

const PDF = Buffer.from('%PDF-1.7\n' + 'Rechnung '.repeat(400));
const NOISE = crypto.randomBytes(4096);

// ── buildZip ───────────────────────────────────────────────────────────────────────────────────────────────────

test('buildZip: entries come back byte for byte, in order, compressed only when that helps', () => {
  const zip = files.buildZip([{ name: 'Rechnung-1.pdf', data: PDF }, { name: 'zufall.bin', data: NOISE }, { name: 'liste.csv', data: 'a;b\r\n' }], new Date(2026, 10, 16, 14, 5, 58));
  const entries = readZip(zip);
  assert.deepEqual(entries.map((entry) => entry.name), ['Rechnung-1.pdf', 'zufall.bin', 'liste.csv']);
  assert.ok(entries[0].data.equals(PDF));
  assert.ok(entries[1].data.equals(NOISE));
  assert.equal(entries[2].data.toString('utf8'), 'a;b\r\n');
  assert.deepEqual(entries.map((entry) => entry.method), [8, 0, 0]);
  assert.ok(zip.length < PDF.length + NOISE.length);
});

test('buildZip: the entry time is the local export time', () => {
  const [entry] = readZip(files.buildZip([{ name: 'a.txt', data: 'a' }], new Date(2026, 10, 16, 14, 5, 58)));
  assert.deepEqual([(entry.date >> 9) + 1980, (entry.date >> 5) & 15, entry.date & 31], [2026, 11, 16]);
  assert.deepEqual([entry.time >> 11, (entry.time >> 5) & 63, (entry.time & 31) * 2], [14, 5, 58]);
  // Dates the format cannot express, or no usable date at all, still give a valid archive.
  for (const when of [new Date(1975, 0, 1), new Date(2200, 0, 1), new Date('kein Datum'), undefined, 'gestern']) {
    const [odd] = readZip(files.buildZip([{ name: 'a.txt', data: 'a' }], when));
    const year = (odd.date >> 9) + 1980;
    assert.ok(year >= 1980 && year <= 2107, String(when));
  }
});

test('buildZip: names with umlauts, euro sign and emoji are stored as UTF-8', () => {
  const names = ['Rechnung Müller & Söhne (März).pdf', 'Straße 5 – Angebot 100 €.pdf', 'Größe 😀.txt', 'ü.pdf'];
  const entries = readZip(files.buildZip(names.map((name, index) => ({ name, data: `Inhalt ${index} äöü` }))));
  assert.deepEqual(entries.map((entry) => entry.name), names);
  assert.equal(entries[2].data.toString('utf8'), 'Inhalt 2 äöü');
});

test('buildZip: accepts buffers, strings and typed arrays; empty content is a valid entry', () => {
  const entries = readZip(files.buildZip([{ name: 'a', data: Buffer.from([1, 2, 3]) }, { name: 'b', data: new Uint8Array([4, 5]) }, { name: 'c', data: 'ä' }, { name: 'leer.txt', data: Buffer.alloc(0) }]));
  assert.deepEqual(entries.map((entry) => [...entry.data]), [[1, 2, 3], [4, 5], [0xc3, 0xa4], []]);
});

test('buildZip: an archive without files is refused', () => {
  assert.throws(() => files.buildZip([]), /keine Dateien/);
  assert.throws(() => files.buildZip(undefined), /keine Dateien/);
  assert.throws(() => files.buildZip('a.pdf'), /keine Dateien/);
});

test('buildZip: names that would leave the target folder or are unusable are refused', () => {
  for (const name of ['', '../evil.pdf', 'ordner/a.pdf', '/etc/passwd', 'C:\\Windows\\a.pdf', '..\\a.pdf', `${'ä'.repeat(40000)}.pdf`]) {
    assert.throws(() => files.buildZip([{ name: 'ok.pdf', data: 'x' }, { name, data: 'x' }]), /Ungültiger Dateiname/, name.slice(0, 30));
  }
});

test('buildZip: system tools accept the archive', (t) => {
  const directory = tempDir(t);
  const archive = path.join(directory, 'export.zip');
  const names = ['Rechnung Müller (März).pdf', 'Liste – 100 €.csv', 'zufall.bin'];
  fs.writeFileSync(archive, files.buildZip([{ name: names[0], data: PDF }, { name: names[1], data: 'a;b\r\n' }, { name: names[2], data: NOISE }]));

  const unzip = spawnSync('unzip', ['-t', archive], { encoding: 'utf8' });
  const script = 'import sys, json, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nbad = z.testzip()\nprint(json.dumps({"bad": bad, "names": z.namelist(), "sizes": [i.file_size for i in z.infolist()]}))';
  const python = spawnSync('python3', ['-I', '-c', script, archive], { encoding: 'utf8' });
  if (unzip.error && python.error) { t.skip('neither unzip nor python3 is installed'); return; }
  if (!unzip.error) {
    assert.equal(unzip.status, 0, unzip.stdout + unzip.stderr);
    assert.match(unzip.stdout, /No errors detected/);
  }
  if (!python.error) {
    assert.equal(python.status, 0, python.stderr);
    assert.deepEqual(JSON.parse(python.stdout), { bad: null, names, sizes: [PDF.length, 5, NOISE.length] });
  }
});

// ── safeEntryName / uniqueName ─────────────────────────────────────────────────────────────────────────────────

test('safeEntryName: a plain file name with exactly one extension', () => {
  assert.equal(files.safeEntryName('Rechnung-2026-001', 'pdf'), 'Rechnung-2026-001.pdf');
  assert.equal(files.safeEntryName('Rechnung-2026-001.pdf', 'pdf'), 'Rechnung-2026-001.pdf');
  assert.equal(files.safeEntryName('Rechnung.PDF', 'pdf'), 'Rechnung.pdf');
  assert.equal(files.safeEntryName('Rechnung', 'PDF'), 'Rechnung.pdf');
  assert.equal(files.safeEntryName('Rechnung.pdf.pdf', 'pdf'), 'Rechnung.pdf.pdf');
  assert.equal(files.safeEntryName('Liste.csv', 'pdf'), 'Liste.csv.pdf');
  assert.equal(files.safeEntryName('  Angebot   Müller  &  Söhne ', 'pdf'), 'Angebot Müller & Söhne.pdf');
});

test('safeEntryName: no directories, drive letters, control characters, hidden or reserved-character names', () => {
  const cases = ['../../etc/passwd', '..\\..\\Windows\\win.ini', '/absolut/pfad', 'C:\\Users\\x', 'a/b\\c:d*e?f"g<h>i|j', '.versteckt', '...', '. .', 'Zeile1\nZeile2\r\tTab\0Null\x7f', 'RE 48/2026', '~/x'];
  for (const value of cases) {
    const name = files.safeEntryName(value, 'pdf');
    assert.doesNotMatch(name, /[\\/:*?"<>|\x00-\x1f\x7f]/, JSON.stringify(value));
    assert.doesNotMatch(name, /^[.\s]/, JSON.stringify(value));
    assert.match(name, /[^.\s]\.pdf$/, JSON.stringify(value));
    assert.equal(path.basename(name), name);
    assert.equal(path.win32.basename(name), name);
    // Whatever comes out can go straight into an archive.
    assert.doesNotThrow(() => files.buildZip([{ name, data: 'x' }]));
  }
  assert.equal(files.safeEntryName('RE 48/2026', 'pdf'), 'RE 48-2026.pdf');
  assert.equal(files.safeEntryName('.versteckt', 'pdf'), 'versteckt.pdf');
});

test('safeEntryName: nothing usable becomes "Dokument"', () => {
  for (const value of ['', '   ', '...', '. . .', undefined, null, '.pdf']) {
    assert.equal(files.safeEntryName(value, 'pdf'), value === '.pdf' ? 'pdf.pdf' : 'Dokument.pdf', JSON.stringify(value));
  }
  assert.equal(files.safeEntryName('Helferlein-Export', 'zip'), 'Helferlein-Export.zip');
});

test('safeEntryName: bounded length, composed characters', () => {
  // At most 120 UTF-16 units and at most 200 bytes, whichever is reached first.
  assert.equal(files.safeEntryName('a'.repeat(500), 'pdf'), `${'a'.repeat(120)}.pdf`);
  const long = files.safeEntryName('ä'.repeat(500), 'pdf');
  assert.equal(long, `${'ä'.repeat(100)}.pdf`);
  assert.ok(Buffer.byteLength(long, 'utf8') <= 255, 'fits the file name limit of common file systems');
  assert.equal(files.safeEntryName('€'.repeat(500), 'pdf'), `${'€'.repeat(66)}.pdf`);
  // Names at the limits are kept whole.
  assert.equal(files.safeEntryName('a'.repeat(120), 'pdf'), `${'a'.repeat(120)}.pdf`);
  assert.equal(files.safeEntryName('ä'.repeat(100), 'pdf'), `${'ä'.repeat(100)}.pdf`);
  // "u" + combining diaeresis (as macOS stores it) and the composed "ü" give the same name.
  assert.equal(files.safeEntryName('Mu\u0308ller', 'pdf'), files.safeEntryName('M\u00fcller', 'pdf'));
  assert.equal(files.safeEntryName('Mu\u0308ller', 'pdf'), 'M\u00fcller.pdf');
});

test('safeEntryName: the cut never goes through a surrogate pair', () => {
  const emoji = '\u{1F600}'; // two UTF-16 units, four bytes
  const wellFormed = (name) => assert.equal(Buffer.from(name, 'utf8').toString('utf8'), name, 'no lone surrogate');
  // 50 emoji are 200 bytes; the 51st would exceed the byte limit.
  const onlyEmoji = files.safeEntryName(emoji.repeat(300), 'pdf');
  assert.equal(onlyEmoji, `${emoji.repeat(50)}.pdf`);
  wellFormed(onlyEmoji);
  // 119 units are used: the pair does not fit into the one unit left and is dropped whole.
  const odd = files.safeEntryName(`${'a'.repeat(119)}${emoji}${emoji}`, 'pdf');
  assert.equal(odd, `${'a'.repeat(119)}.pdf`);
  wellFormed(odd);
  // 118 units are used: the pair fits exactly.
  assert.equal(files.safeEntryName(`${'a'.repeat(118)}${emoji}${emoji}`, 'pdf'), `${'a'.repeat(118)}${emoji}.pdf`);
  // Every cut position stays well-formed and within both limits.
  for (let lead = 0; lead <= 130; lead += 1) {
    const name = files.safeEntryName(`${'x'.repeat(lead)}${emoji.repeat(80)}`, 'pdf');
    const base = name.slice(0, -4);
    wellFormed(name);
    assert.ok(base.length <= 120, `units at ${lead}`);
    assert.ok(Buffer.byteLength(base, 'utf8') <= 200, `bytes at ${lead}`);
    assert.ok(base.length >= Math.min(lead, 120), `nothing lost needlessly at ${lead}`);
  }
});

test('safeEntryName: dots and spaces left at the end by the cut are removed', () => {
  assert.equal(files.safeEntryName(`${'a'.repeat(119)} b`, 'pdf'), `${'a'.repeat(119)}.pdf`);
  assert.equal(files.safeEntryName(`${'a'.repeat(118)}..b`, 'pdf'), `${'a'.repeat(118)}.pdf`);
  assert.equal(files.safeEntryName(`${'a'.repeat(117)}. .b`, 'pdf'), `${'a'.repeat(117)}.pdf`);
  assert.equal(files.safeEntryName(`${'ä'.repeat(99)} ${'ä'.repeat(50)}`, 'pdf'), `${'ä'.repeat(99)}.pdf`);
  // The extension is recognised before the cut, so a long name does not end in ".pdf.pdf" or a cut-off ".pd".
  assert.equal(files.safeEntryName(`${'a'.repeat(300)}.pdf`, 'pdf'), `${'a'.repeat(120)}.pdf`);
  assert.equal(files.safeEntryName(`${'a'.repeat(118)}.pdf`, 'pdf'), `${'a'.repeat(118)}.pdf`);
  // A dot inside the kept part stays.
  assert.equal(files.safeEntryName(`${'a'.repeat(60)}.${'b'.repeat(100)}`, 'pdf'), `${'a'.repeat(60)}.${'b'.repeat(59)}.pdf`);
});

test('uniqueName: repeated names are numbered before the extension, without regard to case', () => {
  const used = new Set();
  assert.equal(files.uniqueName('Rechnung-1.pdf', used), 'Rechnung-1.pdf');
  assert.equal(files.uniqueName('Rechnung-1.pdf', used), 'Rechnung-1 (2).pdf');
  assert.equal(files.uniqueName('RECHNUNG-1.PDF', used), 'RECHNUNG-1 (3).PDF');
  assert.equal(files.uniqueName('Rechnung-1 (2).pdf', used), 'Rechnung-1 (2) (2).pdf');
  assert.equal(files.uniqueName('ohne-endung', used), 'ohne-endung');
  assert.equal(files.uniqueName('ohne-endung', used), 'ohne-endung (2)');
  assert.equal(files.uniqueName('Liste.csv', used), 'Liste.csv');
  assert.equal(used.size, 7);
});

// ── ArchiveSession ─────────────────────────────────────────────────────────────────────────────────────────────

test('ArchiveSession: collects files under safe, unique names and writes one valid archive', async (t) => {
  const directory = tempDir(t);
  const target = path.join(directory, 'Export 2026-Q1.zip');
  const session = new files.ArchiveSession(target);
  assert.equal(session.add('RE 48/2026', 'pdf', PDF), 'RE 48-2026.pdf');
  assert.equal(session.add('RE 48:2026', 'pdf', NOISE), 'RE 48-2026 (2).pdf');
  assert.equal(session.add('re 48-2026.PDF', 'pdf', 'drei'), 're 48-2026 (3).pdf');
  assert.equal(session.add('../../Übersicht', 'csv', 'a;b\r\n'), '-..-Übersicht.csv');
  assert.equal(session.add('', 'pdf', new Uint8Array([1])), 'Dokument.pdf');
  // Nothing touches the disk before the export is finished.
  assert.deepEqual(fs.readdirSync(directory), []);

  const result = await session.finish();
  assert.deepEqual(fs.readdirSync(directory), ['Export 2026-Q1.zip']);
  const written = fs.readFileSync(target);
  assert.deepEqual(result, { path: target, count: 5, size: written.length });
  const entries = readZip(written);
  assert.deepEqual(entries.map((entry) => entry.name), ['RE 48-2026.pdf', 'RE 48-2026 (2).pdf', 're 48-2026 (3).pdf', '-..-Übersicht.csv', 'Dokument.pdf']);
  assert.ok(entries[0].data.equals(PDF));
  assert.ok(entries[1].data.equals(NOISE));
  assert.equal(new Set(entries.map((entry) => entry.name.toLowerCase())).size, 5);
});

test('ArchiveSession: a cancelled export leaves nothing behind', (t) => {
  const directory = tempDir(t);
  const session = new files.ArchiveSession(path.join(directory, 'export.zip'));
  session.add('Rechnung-1', 'pdf', PDF);
  session.add('Rechnung-2', 'pdf', PDF);
  // Cancelling means dropping the session: there is no file, temporary or final.
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('ArchiveSession: the limits on count and size reject the file that would exceed them', () => {
  const session = new files.ArchiveSession('/unused.zip', { maxEntries: 2, maxBytes: 10 });
  assert.equal(session.add('a', 'txt', '12345'), 'a.txt');
  assert.throws(() => session.add('b', 'txt', '123456'), /Export wird zu groß/);
  // The refused file is not half-registered: its name and bytes are free again.
  assert.equal(session.bytes, 5);
  assert.equal(session.add('b', 'txt', '12345'), 'b.txt');
  assert.equal(session.bytes, 10);
  assert.throws(() => session.add('c', 'txt', '1'), /Zu viele Dateien/);
  assert.deepEqual(session.entries.map((entry) => entry.name), ['a.txt', 'b.txt']);

  const bySize = new files.ArchiveSession('/unused.zip', { maxBytes: 3 });
  assert.throws(() => bySize.add('a', 'txt', '1234'), /Export wird zu groß/);
  assert.equal(bySize.add('a', 'txt', '123'), 'a.txt');
  assert.throws(() => bySize.add('b', 'txt', '1'), /Export wird zu groß/);
});

test('ArchiveSession: an empty file is refused and does not take a name', () => {
  const session = new files.ArchiveSession('/unused.zip');
  assert.throws(() => session.add('Rechnung-1', 'pdf', Buffer.alloc(0)), /Leere Datei/);
  assert.throws(() => session.add('Rechnung-1', 'pdf', ''), /Leere Datei/);
  assert.equal(session.add('Rechnung-1', 'pdf', 'x'), 'Rechnung-1.pdf');
  assert.equal(session.entries.length, 1);
});

test('ArchiveSession: finishing replaces an older archive in one step and leaves no temporary file', async (t) => {
  const directory = tempDir(t);
  const target = path.join(directory, 'export.zip');
  fs.writeFileSync(target, 'alter Export');
  fs.writeFileSync(path.join(directory, 'notizen.txt'), 'bleibt');
  const session = new files.ArchiveSession(target);
  session.add('Rechnung-1', 'pdf', PDF);
  await session.finish();
  assert.deepEqual(fs.readdirSync(directory).sort(), ['export.zip', 'notizen.txt']);
  assert.deepEqual(readZip(fs.readFileSync(target)).map((entry) => entry.name), ['Rechnung-1.pdf']);
  assert.equal(fs.readFileSync(path.join(directory, 'notizen.txt'), 'utf8'), 'bleibt');
});

test('ArchiveSession: a failed finish keeps the older archive and leaves no debris', async (t) => {
  const directory = tempDir(t);
  const target = path.join(directory, 'export.zip');
  fs.writeFileSync(target, 'alter Export');
  // Nothing to export.
  await assert.rejects(new files.ArchiveSession(target).finish(), /keine Dateien/);
  assert.deepEqual(fs.readdirSync(directory), ['export.zip']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'alter Export');
  // The target folder disappeared (USB stick pulled).
  const lost = new files.ArchiveSession(path.join(directory, 'weg', 'export.zip'));
  lost.add('Rechnung-1', 'pdf', PDF);
  await assert.rejects(lost.finish(), { code: 'ENOENT' });
  // The target is a folder: the rename fails after the temporary file was written.
  const blocked = path.join(directory, 'ordner.zip');
  fs.mkdirSync(blocked);
  fs.writeFileSync(path.join(blocked, 'inhalt.txt'), 'bleibt');
  const session = new files.ArchiveSession(blocked);
  session.add('Rechnung-1', 'pdf', PDF);
  await assert.rejects(session.finish());
  assert.deepEqual(fs.readdirSync(directory).sort(), ['export.zip', 'ordner.zip']);
  assert.deepEqual(fs.readdirSync(blocked), ['inhalt.txt']);
});

test('writeFileAtomic: writes exactly the bytes, replaces an existing file, cleans up', async (t) => {
  const directory = tempDir(t);
  const target = path.join(directory, 'datei.bin');
  await files.writeFileAtomic(target, NOISE);
  assert.ok(fs.readFileSync(target).equals(NOISE));
  await files.writeFileAtomic(target, Buffer.from('neu'));
  assert.equal(fs.readFileSync(target, 'utf8'), 'neu');
  assert.deepEqual(fs.readdirSync(directory), ['datei.bin']);
});

// ── Backups ────────────────────────────────────────────────────────────────────────────────────────────────────

const JSON_DATA = JSON.stringify({ schemaVersion: 1, settings: { language: 'de' }, invoices: [{ id: 'i1', invoiceNumber: 'RE-1', notesText: 'Größe äöü €' }] });
const backupName = (date) => `Helferlein-Sicherung-${date}.json`;

test('folderStatus: only an existing, writable, absolute folder is available', async (t) => {
  const directory = tempDir(t);
  assert.deepEqual(await files.folderStatus(directory), { folder: directory, available: true });
  const missing = path.join(directory, 'nicht-da');
  assert.deepEqual(await files.folderStatus(missing), { folder: missing, available: false });
  const file = path.join(directory, 'datei.txt');
  fs.writeFileSync(file, 'x');
  assert.deepEqual(await files.folderStatus(file), { folder: file, available: false });
  for (const value of ['', 'relativ/ordner', '.', undefined, null, 42, {}]) {
    assert.deepEqual(await files.folderStatus(value), { folder: null, available: false }, String(value));
  }
});

test('folderStatus: a read-only folder is not available', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async (t) => {
  const directory = tempDir(t);
  const locked = path.join(directory, 'nur-lesen');
  fs.mkdirSync(locked, { mode: 0o500 });
  try {
    assert.deepEqual(await files.folderStatus(locked), { folder: locked, available: false });
    await assert.rejects(files.writeBackup({ folder: locked, json: JSON_DATA, today: '2026-11-16' }), /Sicherungsordner ist nicht erreichbar/);
    assert.deepEqual(fs.readdirSync(locked), []);
  } finally { fs.chmodSync(locked, 0o700); }
});

test('writeBackup: one dated file with exactly the given bytes', async (t) => {
  const directory = tempDir(t);
  const result = await files.writeBackup({ folder: directory, json: JSON_DATA, today: '2026-11-16' });
  assert.deepEqual(result, { file: 'Helferlein-Sicherung-2026-11-16.json', folder: directory, size: Buffer.byteLength(JSON_DATA, 'utf8'), removed: 0 });
  assert.deepEqual(fs.readdirSync(directory), ['Helferlein-Sicherung-2026-11-16.json']);
  assert.equal(fs.readFileSync(path.join(directory, result.file), 'utf8'), JSON_DATA);
  assert.match(result.file, files.BACKUP_NAME);
});

test('writeBackup: a second backup on the same day replaces the first', async (t) => {
  const directory = tempDir(t);
  await files.writeBackup({ folder: directory, json: JSON_DATA, today: '2026-11-16' });
  const later = JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [] });
  const result = await files.writeBackup({ folder: directory, json: later, today: '2026-11-16' });
  assert.equal(result.removed, 0);
  assert.deepEqual(fs.readdirSync(directory), [backupName('2026-11-16')]);
  assert.equal(fs.readFileSync(path.join(directory, backupName('2026-11-16')), 'utf8'), later);
});

test('writeBackup: keeps the newest backups and removes only older automatic backups', async (t) => {
  const directory = tempDir(t);
  const dates = ['2026-09-30', '2026-10-01', '2026-10-15', '2026-11-01', '2025-12-31'];
  for (const date of dates) fs.writeFileSync(path.join(directory, backupName(date)), date);
  const foreign = ['Steuer 2025.pdf', 'Helferlein-Sicherung-2020-01-01.json.bak', 'helferlein-sicherung-2020-01-01.json', 'Helferlein-Sicherung-manuell.json', 'Kopie von Helferlein-Sicherung-2020-01-01.json', '.Helferlein-Sicherung-2020-01-01.json.abc.tmp'];
  for (const name of foreign) fs.writeFileSync(path.join(directory, name), 'fremd');
  fs.mkdirSync(path.join(directory, 'Unterordner'));

  const result = await files.writeBackup({ folder: directory, json: JSON_DATA, today: '2026-11-16', keep: 3 });
  assert.equal(result.removed, 3);
  const left = fs.readdirSync(directory).sort();
  assert.deepEqual(left.filter((name) => files.BACKUP_NAME.test(name)), ['2026-10-15', '2026-11-01', '2026-11-16'].map(backupName));
  for (const name of [...foreign, 'Unterordner']) assert.ok(left.includes(name), `${name} must be left alone`);
  assert.equal(fs.readFileSync(path.join(directory, backupName('2026-11-01')), 'utf8'), '2026-11-01');
});

test('writeBackup: twelve backups are kept by default, and at least the new one always', async (t) => {
  const directory = tempDir(t);
  for (let month = 1; month <= 14; month += 1) {
    const date = `${month > 12 ? 2026 : 2025}-${String(month > 12 ? month - 12 : month).padStart(2, '0')}-01`;
    fs.writeFileSync(path.join(directory, backupName(date)), date);
  }
  const result = await files.writeBackup({ folder: directory, json: JSON_DATA, today: '2026-03-01' });
  assert.equal(result.removed, 3);
  const left = fs.readdirSync(directory).sort();
  assert.equal(left.length, 12);
  assert.deepEqual([left[0], left.at(-1)], [backupName('2025-04-01'), backupName('2026-03-01')]);

  for (const keep of [0, -5]) {
    const again = await files.writeBackup({ folder: directory, json: JSON_DATA, today: '2026-03-02', keep });
    assert.deepEqual(fs.readdirSync(directory), [backupName('2026-03-02')], `keep ${keep}`);
    assert.ok(again.removed >= 1);
    fs.writeFileSync(path.join(directory, backupName('2026-01-01')), 'alt');
  }
});

test('writeBackup: the backup just written is never pruned, even when the clock was set back', async (t) => {
  const directory = tempDir(t);
  for (const date of ['2026-11-14', '2026-11-15', '2026-11-16']) fs.writeFileSync(path.join(directory, backupName(date)), date);
  const result = await files.writeBackup({ folder: directory, json: JSON_DATA, today: '2020-01-01', keep: 2 });
  assert.equal(result.file, backupName('2020-01-01'));
  assert.equal(fs.readFileSync(path.join(directory, result.file), 'utf8'), JSON_DATA);
  assert.ok(fs.existsSync(path.join(directory, backupName('2026-11-16'))));
});

test('writeBackup: refuses unusable data before touching the folder', async (t) => {
  const directory = tempDir(t);
  const existing = path.join(directory, backupName('2026-11-16'));
  fs.writeFileSync(existing, 'gute alte Sicherung');
  fs.writeFileSync(path.join(directory, backupName('2020-01-01')), 'alt');
  const attempt = (overrides) => files.writeBackup({ folder: directory, json: JSON_DATA, today: '2026-11-16', keep: 1, ...overrides });
  for (const json of ['', undefined, null, { schemaVersion: 1 }, Buffer.from(JSON_DATA)]) await assert.rejects(attempt({ json }), /keine Daten/);
  for (const json of ['{"schemaVersion":1', 'kein JSON', '{"a":1}{']) await assert.rejects(attempt({ json }), /nicht lesbar/);
  await assert.rejects(attempt({ validate: () => false }), /unvollständig\. Es wurde nichts überschrieben/);
  for (const today of ['', '16.11.2026', '2026-11-16T10:00', '../2026-11-16', '2026-11-16/../../x', undefined, null, 20261116]) {
    await assert.rejects(attempt({ today }), /Ungültiges Sicherungsdatum/, String(today));
  }
  assert.deepEqual(fs.readdirSync(directory).sort(), [backupName('2020-01-01'), backupName('2026-11-16')]);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'gute alte Sicherung');
});

test('writeBackup: the validator sees the parsed data and decides', async (t) => {
  const directory = tempDir(t);
  const seen = [];
  const result = await files.writeBackup({ folder: directory, json: JSON_DATA, today: '2026-11-16', validate: (data) => { seen.push(data); return true; } });
  assert.deepEqual(seen, [JSON.parse(JSON_DATA)]);
  assert.equal(result.file, backupName('2026-11-16'));
  const { isValidPersistedData } = require('../../electron/storage-validation.cjs');
  await assert.rejects(files.writeBackup({ folder: directory, json: '{"schemaVersion":2,"settings":{},"invoices":[]}', today: '2026-11-17', validate: isValidPersistedData }), /unvollständig/);
  await assert.rejects(files.writeBackup({ folder: directory, json: '[]', today: '2026-11-17', validate: isValidPersistedData }), /unvollständig/);
  assert.deepEqual(fs.readdirSync(directory), [backupName('2026-11-16')]);
});

test('writeBackup: a missing, relative or non-folder target is reported, nothing is created', async (t) => {
  const directory = tempDir(t);
  const missing = path.join(directory, 'nicht-da');
  await assert.rejects(files.writeBackup({ folder: missing, json: JSON_DATA, today: '2026-11-16' }), /Sicherungsordner ist nicht erreichbar/);
  assert.equal(fs.existsSync(missing), false);
  const file = path.join(directory, 'datei.txt');
  fs.writeFileSync(file, 'x');
  await assert.rejects(files.writeBackup({ folder: file, json: JSON_DATA, today: '2026-11-16' }), /nicht erreichbar/);
  for (const folder of ['', 'relativ', undefined, null]) {
    await assert.rejects(files.writeBackup({ folder, json: JSON_DATA, today: '2026-11-16' }), /nicht erreichbar/, String(folder));
  }
  assert.deepEqual(fs.readdirSync(directory), ['datei.txt']);
  assert.equal(fs.existsSync(path.resolve('relativ')), false);
});
