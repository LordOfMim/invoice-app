'use strict';
// Files Helferlein writes outside its own data folder: automatic backups and the archive for the tax advisor.
// Pure Node code without Electron, so it is covered by unit tests. The renderer never passes a path: targets come
// from native dialogs in main.js, and entry names are reduced to plain file names here.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const BACKUP_NAME = /^Helferlein-Sicherung-\d{4}-\d{2}-\d{2}\.json$/;
const DEFAULT_KEEP = 12;

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
 */
async function writeBackup({ folder, json, today, keep = DEFAULT_KEEP, validate }) {
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
  return { file: name, folder, size: bytes.length, removed };
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

/** Build a ZIP archive in memory from `{ name, data }` entries. Names must already be safe and unique. */
function buildZip(entries, now = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Das Archiv enthält keine Dateien.');
  if (entries.length > 65000) throw new Error('Zu viele Dateien für ein Archiv.');
  const { time, date } = dosDateTime(now);
  const parts = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    if (!name.length || name.length > 0xffff || /[\\/]/.test(String(entry.name))) throw new Error('Ungültiger Dateiname im Archiv.');
    const deflated = zlib.deflateRawSync(data, { level: 6 });
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
    parts.push(local, name, body);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  if (offset + directory.length > ZIP_LIMIT) throw new Error('Das Archiv wird zu groß. Bitte einen kürzeren Zeitraum wählen.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
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

module.exports = { ArchiveSession, BACKUP_NAME, buildZip, crc32, folderStatus, safeEntryName, uniqueName, writeBackup, writeFileAtomic };
