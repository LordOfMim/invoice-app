'use strict';
// The folder "attachments/" beside the data file: attachments, logos and the signature image as plain files, named
// by the SHA-256 of their bytes. Pure Node code without Electron, so it is covered by unit tests.
//
// - Equal content is stored once, whatever it is called and wherever it is used.
// - A file is complete or absent: it is written next to its place, read back, and only then renamed.
// - Nothing is ever deleted here. Recovery points and older backups may still refer to a file whose attachment
//   was removed from its invoice.
// - The window never names a path: it passes an id, which is checked before it becomes a file name.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensurePrivateDirectory, syncDirectory } = require('./durable-store.cjs');
const { FILE_ID, FILE_TYPE, DEFAULT_TYPE, isFileRef, splitDataUrl } = require('./file-refs.cjs');

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

class FileStore {
  constructor(directory, { maxBytes = MAX_FILE_BYTES } = {}) {
    this.directory = directory;
    this.maxBytes = maxBytes;
  }

  ensureDirectory() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    ensurePrivateDirectory(this.directory);
  }

  pathFor(id) {
    if (typeof id !== 'string' || !FILE_ID.test(id)) throw new Error('Ungültige Dateikennung.');
    return path.join(this.directory, id);
  }

  has(id) {
    try {
      const stat = fs.lstatSync(this.pathFor(id));
      return stat.isFile() && !stat.isSymbolicLink();
    } catch { return false; }
  }

  /** The bytes of a stored file. Throws when the file is missing or no longer matches its id. */
  read(id) {
    const file = this.pathFor(id);
    let bytes;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
      bytes = fs.readFileSync(file);
    } catch { throw new Error('Die Datei ist nicht mehr vorhanden. Bitte eine Sicherung mit Anhängen wiederherstellen.'); }
    if (sha256(bytes) !== id) throw new Error('Die Datei ist beschädigt. Bitte eine Sicherung mit Anhängen wiederherstellen.');
    return bytes;
  }

  /** Store bytes and return their reference. Storing the same content again changes nothing. */
  async put(bytes, type) {
    if (!Buffer.isBuffer(bytes)) throw new Error('Ungültige Datei.');
    if (!bytes.length) throw new Error('Die Datei ist leer.');
    if (bytes.length > this.maxBytes) throw new Error(`Die Datei ist zu groß (höchstens ${Math.round(this.maxBytes / 1024 / 1024)} MB).`);
    const id = sha256(bytes);
    const ref = { id, type: typeof type === 'string' && FILE_TYPE.test(type) ? type : DEFAULT_TYPE, size: bytes.length };
    const target = this.pathFor(id);
    if (this.has(id)) {
      try { this.read(id); return ref; } catch { /* A damaged copy is replaced below. */ }
    }
    this.ensureDirectory();
    const temporary = path.join(this.directory, `.${id}.${crypto.randomUUID()}.tmp`);
    try {
      const handle = await fs.promises.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      // Only a copy that reads back with the right checksum may take the file's name.
      if (sha256(await fs.promises.readFile(temporary)) !== id) throw new Error('Die Datei wurde unvollständig gespeichert.');
      await fs.promises.rename(temporary, target);
      syncDirectory(this.directory);
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
    }
    return ref;
  }

  /**
   * Store the content of a base64 data URL. It is accepted only when it decodes without loss, so the stored file
   * is exactly what the data URL held.
   */
  async putDataUrl(dataUrl) {
    const parts = splitDataUrl(dataUrl);
    if (!parts) throw new Error('Ungültige Datei.');
    const bytes = Buffer.from(parts.base64, 'base64');
    if (bytes.toString('base64') !== parts.base64) throw new Error('Die Datei ist nicht vollständig lesbar.');
    return this.put(bytes, parts.type);
  }

  /** The stored file as a data URL, as the templates and the e-invoice expect a logo. */
  dataUrl(ref) {
    if (!isFileRef(ref)) throw new Error('Ungültige Dateikennung.');
    return `data:${ref.type};base64,${this.read(ref.id).toString('base64')}`;
  }

  /** Take over a file from outside (a backup). It must have exactly the content its id promises. */
  async adopt(id, bytes) {
    this.pathFor(id);
    if (!Buffer.isBuffer(bytes) || sha256(bytes) !== id) throw new Error('Die Datei aus der Sicherung ist beschädigt.');
    await this.put(bytes);
    return true;
  }

  /**
   * Copy the named files into `folder` (the "attachments" folder of a backup). Files that are already there with
   * the right size are kept; nothing in the folder is removed. Returns how many were copied and which are missing
   * here.
   */
  async copyInto(folder, ids) {
    const missing = [];
    let copied = 0, present = 0;
    let prepared = false;
    for (const id of ids) {
      let bytes;
      try { bytes = this.read(id); } catch { missing.push(id); continue; }
      const target = path.join(folder, id);
      try {
        const stat = await fs.promises.stat(target);
        if (stat.isFile() && stat.size === bytes.length) { present++; continue; }
      } catch { /* Not there yet. */ }
      if (!prepared) { await fs.promises.mkdir(folder, { recursive: true }); prepared = true; }
      const temporary = path.join(folder, `.${id}.${crypto.randomUUID()}.tmp`);
      try {
        const handle = await fs.promises.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        if (sha256(await fs.promises.readFile(temporary)) !== id) throw new Error('Ein Anhang wurde unvollständig gesichert.');
        await fs.promises.rename(temporary, target);
        copied++;
      } finally {
        await fs.promises.rm(temporary, { force: true }).catch(() => {});
      }
    }
    return { copied, present, missing };
  }

  /**
   * Take over the named files from `folder` (the "attachments" folder beside a JSON backup) unless they are
   * already here. Returns the ids that could not be found or did not match.
   */
  async adoptFrom(folder, ids) {
    const missing = [];
    for (const id of ids) {
      this.pathFor(id); // rejects anything that is not a plain id before it becomes part of a path
      if (this.has(id)) { try { this.read(id); continue; } catch { /* Replace a damaged copy from the backup. */ } }
      try {
        const source = path.join(folder, id);
        const stat = await fs.promises.lstat(source);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > this.maxBytes) throw new Error('unusable');
        await this.adopt(id, await fs.promises.readFile(source));
      } catch { missing.push(id); }
    }
    return missing;
  }
}

module.exports = { FileStore, MAX_FILE_BYTES, sha256 };
