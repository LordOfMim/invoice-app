'use strict';
// Files Helferlein writes outside its own data folder: automatic backups and the archive for the tax advisor.
// Pure Node code without Electron, so it is covered by unit tests. The renderer never passes a path: targets come
// from native dialogs in main.js, and entry names are reduced to plain file names here.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { FILE_ID, referencedFileIds } = require('./file-refs.cjs');

const BACKUP_NAME = /^Helferlein-Sicherung-\d{4}-\d{2}-\d{2}\.json$/;
const DEFAULT_KEEP = 12;
/** Where a backup keeps its files: a folder beside the JSON, or the same path inside a ZIP. */
const ATTACHMENTS_FOLDER = 'attachments';
/** The data inside a backup archive. */
const ARCHIVE_DATA_NAME = 'Helferlein-Sicherung.json';
const MAX_BACKUP_JSON_BYTES = 512 * 1024 * 1024;

/** A plain file name: no directories, no control characters, no leading dots, bounded length. */
function safeEntryName(value, extension) {
  const ext = String(extension).toLowerCase();
  let name = String(value ?? '').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  if (name.toLowerCase().endsWith(`.${ext}`)) name = name.slice(0, -(ext.length + 1));
  // Bounded by characters and by bytes (file systems allow 255 bytes), never cutting through a character.
  let short = '';
  for (const character of name.replace(/[.\s]+$/, '')) {
    if (short.length + character.length > 120 || Buffer.byteLength(short + character) > 200) break;
    short += character;
  }
  name = short.replace(/[.\s]+$/, '') || 'Dokument';
  return `${name}.${ext}`;
}

/** Keep names unique inside one archive: "Rechnung-1.pdf", "Rechnung-1 (2).pdf", … */
function uniqueName(name, used) {
  const key = (value) => value.toLowerCase();
  if (!used.has(key(name))) { used.add(key(name)); return name; }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let counter = 2; counter < 100000; counter++) {
    const candidate = `${base} (${counter})${ext}`;
    if (!used.has(key(candidate))) { used.add(key(candidate)); return candidate; }
  }
  throw new Error('Zu viele gleichnamige Dateien.');
}

/** Write next to the target and rename: a reader never sees a half-written file, an old file survives a failure. */
async function writeFileAtomic(target, bytes) {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  try {
    const handle = await fs.promises.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    const stat = await fs.promises.stat(temporary);
    if (stat.size !== bytes.length) throw new Error('Die gespeicherte Datei ist unvollständig.');
    await fs.promises.rename(temporary, target);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
}

async function folderStatus(folder) {
  if (typeof folder !== 'string' || !folder || !path.isAbsolute(folder)) return { folder: null, available: false };
  try {
    const stat = await fs.promises.stat(folder);
    if (!stat.isDirectory()) return { folder, available: false };
    await fs.promises.access(folder, fs.constants.W_OK);
    return { folder, available: true };
  } catch { return { folder, available: false }; }
}

/**
 * Write one dated JSON backup into the chosen folder and keep only the newest `keep` automatic backups. Only files
 * that match the backup name pattern are ever removed; anything else in the folder is left alone.
 *
 * With a file store, the attachments, logos and images the data refers to are copied into "attachments" in the same
 * folder. Each file is copied once and shared by all dated backups; files there are never removed.
 */
async function writeBackup({ folder, json, today, keep = DEFAULT_KEEP, validate, store }) {
  if (typeof json !== 'string' || !json) throw new Error('Es liegen keine Daten für die Sicherung vor.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today))) throw new Error('Ungültiges Sicherungsdatum.');
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('Die Daten für die Sicherung sind nicht lesbar.'); }
  if (validate && !validate(parsed)) throw new Error('Die Daten für die Sicherung sind unvollständig. Es wurde nichts überschrieben.');
  const status = await folderStatus(folder);
  if (!status.available) throw new Error('Der Sicherungsordner ist nicht erreichbar. Bitte den Ordner prüfen oder neu auswählen.');
  const name = `Helferlein-Sicherung-${today}.json`;
  const target = path.join(folder, name);
  const bytes = Buffer.from(json, 'utf8');
  // Files first: a backup file never appears in the folder before the attachments it refers to.
  const files = store ? await store.copyInto(path.join(folder, ATTACHMENTS_FOLDER), referencedFileIds(parsed)) : { copied: 0, present: 0, missing: [] };
  await writeFileAtomic(target, bytes);
  if (!(await fs.promises.readFile(target)).equals(bytes)) throw new Error('Die Sicherung konnte nicht bestätigt werden.');
  let removed = 0;
  try {
    const backups = (await fs.promises.readdir(folder)).filter((entry) => BACKUP_NAME.test(entry)).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - Math.max(1, keep)))) {
      if (old === name) continue;
      await fs.promises.rm(path.join(folder, old), { force: true });
      removed++;
    }
  } catch { /* Pruning is best effort; the new backup is already safe. */ }
  return { file: name, folder, size: bytes.length, removed, ...(store ? { files: files.copied + files.present, missingFiles: files.missing.length } : {}) };
}

// ── ZIP (store or deflate, UTF-8 names, no ZIP64) ────────────────────────────────────────────────────────────────

let crcTable;
function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const ZIP_LIMIT = 0xfffffffe;

/** One archive member: local header, name and body for the file, and the matching central directory record. */
function zipRecord(entryName, data, offset, time, date, level = 6) {
  const name = Buffer.from(String(entryName), 'utf8');
  if (!name.length || name.length > 0xffff) throw new Error('Ungültiger Dateiname im Archiv.');
  const deflated = zlib.deflateRawSync(data, { level });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const crc = crc32(data);
  if (data.length > ZIP_LIMIT || offset + body.length > ZIP_LIMIT) throw new Error('Das Archiv wird zu groß. Bitte einen kürzeren Zeitraum wählen.');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(useDeflate ? 8 : 0, 10); header.writeUInt16LE(time, 12); header.writeUInt16LE(date, 14);
  header.writeUInt32LE(crc, 16); header.writeUInt32LE(body.length, 20); header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
  return { parts: [local, name, body], central: [header, name], size: local.length + name.length + body.length };
}

function zipEnd(count, directoryLength, offset) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directoryLength, 12); end.writeUInt32LE(offset, 16);
  return end;
}

/** Build a ZIP archive in memory from `{ name, data }` entries. Names must already be safe and unique. */
function buildZip(entries, now = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Das Archiv enthält keine Dateien.');
  if (entries.length > 65000) throw new Error('Zu viele Dateien für ein Archiv.');
  const { time, date } = dosDateTime(now);
  const parts = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    if (/[\\/]/.test(String(entry.name))) throw new Error('Ungültiger Dateiname im Archiv.');
    const record = zipRecord(entry.name, data, offset, time, date);
    parts.push(...record.parts);
    central.push(...record.central);
    offset += record.size;
  }
  const directory = Buffer.concat(central);
  if (offset + directory.length > ZIP_LIMIT) throw new Error('Das Archiv wird zu groß. Bitte einen kürzeren Zeitraum wählen.');
  return Buffer.concat([...parts, directory, zipEnd(entries.length, directory.length, offset)]);
}

/** Collects the files of one export in memory until the archive is written in one atomic step. */
class ArchiveSession {
  constructor(target, { maxEntries = 5000, maxBytes = 1024 * 1024 * 1024 } = {}) {
    this.target = target; this.entries = []; this.used = new Set(); this.bytes = 0;
    this.maxEntries = maxEntries; this.maxBytes = maxBytes;
  }
  add(name, extension, data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!buffer.length) throw new Error('Leere Datei.');
    if (this.entries.length >= this.maxEntries) throw new Error('Zu viele Dateien für einen Export. Bitte einen kürzeren Zeitraum wählen.');
    if (this.bytes + buffer.length > this.maxBytes) throw new Error('Der Export wird zu groß. Bitte einen kürzeren Zeitraum wählen.');
    const entryName = uniqueName(safeEntryName(name, extension), this.used);
    this.entries.push({ name: entryName, data: buffer });
    this.bytes += buffer.length;
    return entryName;
  }
  async finish() {
    const bytes = buildZip(this.entries);
    await writeFileAtomic(this.target, bytes);
    return { path: this.target, count: this.entries.length, size: bytes.length };
  }
}

// ── Backup with attachments ──────────────────────────────────────────────────────────────────────────────────────
// One ZIP holds the data ("Helferlein-Sicherung.json") and, under "attachments/", every file the data refers to.
// It is written member by member into a temporary file, read back completely, and only then given its name.

async function writeAll(handle, buffer) {
  let written = 0;
  while (written < buffer.length) written += (await handle.write(buffer, written, buffer.length - written)).bytesWritten;
}

/**
 * Write a backup archive to `target`. `store` supplies the referenced files; a file that is missing there is left
 * out and counted, so one lost attachment does not prevent saving everything else.
 */
async function writeBackupArchive({ target, json, store, validate, now = new Date() }) {
  if (typeof json !== 'string' || !json) throw new Error('Es liegen keine Daten für die Sicherung vor.');
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('Die Daten für die Sicherung sind nicht lesbar.'); }
  if (validate && !validate(parsed)) throw new Error('Die Daten für die Sicherung sind unvollständig. Es wurde nichts überschrieben.');
  const tooLarge = 'Die Sicherung wird größer als 4 GB und passt nicht in eine ZIP-Datei. Bitte die automatische Sicherung in einen Ordner verwenden.';
  const ids = store ? referencedFileIds(parsed) : [];
  if (ids.length + 1 > 65000) throw new Error(tooLarge);
  const { time, date } = dosDateTime(now);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  const central = [], missing = [], expected = [];
  let offset = 0;
  try {
    const handle = await fs.promises.open(temporary, 'wx', 0o600);
    try {
      const add = async (name, data, level) => {
        let record;
        try { record = zipRecord(name, data, offset, time, date, level); } catch { throw new Error(tooLarge); }
        for (const part of record.parts) await writeAll(handle, part);
        central.push(...record.central);
        offset += record.size;
        expected.push({ name, size: data.length, crc: crc32(data) });
      };
      await add(ARCHIVE_DATA_NAME, Buffer.from(json, 'utf8'), 6);
      for (const id of ids) {
        let bytes;
        try { bytes = store.read(id); } catch { missing.push(id); continue; }
        // Photos and PDFs are compressed already; a light pass is enough to shrink the rest.
        await add(`${ATTACHMENTS_FOLDER}/${id}`, bytes, 1);
      }
      const directory = Buffer.concat(central);
      if (offset + directory.length > ZIP_LIMIT) throw new Error(tooLarge);
      await writeAll(handle, directory);
      await writeAll(handle, zipEnd(expected.length, directory.length, offset));
      await handle.sync();
    } finally { await handle.close(); }
    // Read the finished file back: every member must be there with its checksum before the backup counts.
    const archive = await openArchive(temporary);
    try {
      if (archive.entries.length !== expected.length) throw new Error('Die Sicherung konnte nicht bestätigt werden.');
      for (const [index, entry] of archive.entries.entries()) {
        const want = expected[index];
        if (entry.name !== want.name || entry.size !== want.size || entry.crc !== want.crc) throw new Error('Die Sicherung konnte nicht bestätigt werden.');
        await archive.read(entry, want.size);
      }
    } finally { await archive.close(); }
    await fs.promises.rename(temporary, target);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
  return { path: target, files: expected.length - 1, missingFiles: missing.length, size: (await fs.promises.stat(target)).size };
}

/**
 * Open a ZIP for reading through its central directory. Plain archives only: stored or deflated members, no
 * encryption, no ZIP64. `read` returns the content of one member after checking its length and checksum.
 */
async function openArchive(file) {
  const unreadable = 'Die Sicherungsdatei ist kein lesbares ZIP-Archiv.';
  const handle = await fs.promises.open(file, 'r');
  const readAt = async (position, length) => {
    const buffer = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
      if (!bytesRead) throw new Error(unreadable);
      done += bytesRead;
    }
    return buffer;
  };
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new Error(unreadable);
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = await readAt(size - tailLength, tailLength);
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { end = index; break; }
    }
    if (end < 0) throw new Error(unreadable);
    const count = tail.readUInt16LE(end + 10), directoryLength = tail.readUInt32LE(end + 12), directoryStart = tail.readUInt32LE(end + 16);
    if (count === 0xffff || directoryLength === 0xffffffff || directoryStart === 0xffffffff) throw new Error('Die Sicherungsdatei ist zu groß für diese Version (ZIP64).');
    if (directoryStart + directoryLength > size) throw new Error(unreadable);
    const directory = await readAt(directoryStart, directoryLength);
    const entries = [];
    let position = 0;
    for (let index = 0; index < count; index++) {
      if (position + 46 > directory.length || directory.readUInt32LE(position) !== 0x02014b50) throw new Error(unreadable);
      const nameLength = directory.readUInt16LE(position + 28), extra = directory.readUInt16LE(position + 30), comment = directory.readUInt16LE(position + 32);
      entries.push({
        name: directory.subarray(position + 46, position + 46 + nameLength).toString('utf8'),
        flags: directory.readUInt16LE(position + 8), method: directory.readUInt16LE(position + 10),
        crc: directory.readUInt32LE(position + 16), packed: directory.readUInt32LE(position + 20),
        size: directory.readUInt32LE(position + 24), offset: directory.readUInt32LE(position + 42),
      });
      position += 46 + nameLength + extra + comment;
    }
    return {
      entries,
      async read(entry, maxBytes) {
        if (entry.flags & 1) throw new Error('Verschlüsselte ZIP-Dateien lassen sich nicht einlesen.');
        if (entry.method !== 0 && entry.method !== 8) throw new Error(unreadable);
        if (entry.size > maxBytes || entry.packed === 0xffffffff || entry.size === 0xffffffff) throw new Error('Eine Datei in der Sicherung ist zu groß.');
        const local = await readAt(entry.offset, 30);
        if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(unreadable);
        const body = await readAt(entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28), entry.packed);
        let data;
        try { data = entry.method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: Math.max(1, entry.size) }) : body; }
        catch { throw new Error(unreadable); }
        if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error('Die Sicherungsdatei ist beschädigt.');
        return data;
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

/** Text editors may put a byte order mark in front of a JSON file; JSON.parse does not accept it. */
function withoutByteOrderMark(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read a backup the user chose: a ZIP written by `writeBackupArchive`, or a JSON file (older backups, or one from
 * a backup folder with its "attachments" folder beside it). Files the data refers to are taken into `store`; they
 * are checked against their id, so a backup cannot plant different content. Returns the JSON and the ids of
 * referenced files that the backup did not contain.
 */
async function readBackup({ file, store, validate }) {
  const invalid = 'Die Datei ist keine gültige Helferlein-Sicherung.';
  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) throw new Error(invalid);
  const head = Buffer.alloc(4);
  const probe = await fs.promises.open(file, 'r');
  try { await probe.read(head, 0, 4, 0); } finally { await probe.close(); }
  const check = (json) => {
    let parsed;
    try { parsed = JSON.parse(json); } catch { throw new Error(invalid); }
    if (validate && !validate(parsed)) throw new Error(invalid);
    return referencedFileIds(parsed);
  };
  if (head.readUInt32LE(0) !== 0x04034b50) {
    if (stat.size > MAX_BACKUP_JSON_BYTES) throw new Error('Die Sicherungsdatei ist zu groß.');
    const json = withoutByteOrderMark(await fs.promises.readFile(file, 'utf8'));
    const ids = check(json);
    return { json, missingFiles: store ? await store.adoptFrom(path.join(path.dirname(file), ATTACHMENTS_FOLDER), ids) : [] };
  }
  const archive = await openArchive(file);
  try {
    // Tolerate an archive that was unpacked and zipped again: the data may sit in a folder, with system extras.
    const candidates = archive.entries.filter((entry) => /\.json$/i.test(entry.name) && !/(^|\/)(__MACOSX|attachments)\//.test(entry.name) && !/(^|\/)\._/.test(entry.name));
    const dataEntry = candidates.find((entry) => entry.name === ARCHIVE_DATA_NAME) ?? (candidates.length === 1 ? candidates[0] : null);
    if (!dataEntry) throw new Error(invalid);
    const json = withoutByteOrderMark((await archive.read(dataEntry, MAX_BACKUP_JSON_BYTES)).toString('utf8'));
    const ids = check(json);
    const missingFiles = [];
    if (store) {
      const stored = new Map();
      for (const entry of archive.entries) {
        const match = /(?:^|\/)attachments\/([a-f0-9]{64})$/.exec(entry.name);
        if (match && FILE_ID.test(match[1])) stored.set(match[1], entry);
      }
      for (const id of ids) {
        if (store.has(id)) { try { store.read(id); continue; } catch { /* Replace a damaged copy from the backup. */ } }
        try {
          const entry = stored.get(id);
          if (!entry) throw new Error('missing');
          await store.adopt(id, await archive.read(entry, store.maxBytes));
        } catch { missingFiles.push(id); }
      }
    }
    return { json, missingFiles };
  } finally { await archive.close(); }
}

module.exports = { ARCHIVE_DATA_NAME, ATTACHMENTS_FOLDER, ArchiveSession, BACKUP_NAME, buildZip, crc32, folderStatus, openArchive, readBackup, safeEntryName, uniqueName, writeBackup, writeBackupArchive, writeFileAtomic };
