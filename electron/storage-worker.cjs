'use strict';
// Only this worker owns mutable desktop persistence. Renderer messages contain
// small immutable-state deltas; JSON/encryption/fsync never run on the UI thread.
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDurableStoreClass, ensurePrivateDirectory, syncDirectory, syncFile, lastGoodPathFor } = require('./durable-store.cjs');
const { applyDataPatches } = require('./data-patches.cjs');
const { isValidPersistedData } = require('./storage-validation.cjs');
const DATA_KEY = 'invoice-app:v1';
const RECOVERY_PREFIX = `${DATA_KEY}:recovery:`;
const AUX_KEY = 'fachunternehmer-defaults';
const AUTO_LIMIT = 7;
let Store, store, config, mirror, mirrorLoaded = false, dirty = false, signature;
const sessions = new Map();
const directory = workerData.directory;
const recoveryDirectory = path.join(directory, 'recovery');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const errorText = error => String(error?.message || error);
function fileSignature(file) {
  // Our own hard-linked recovery generations change ctime. Only identity,
  // content length and modification time indicate an external data change.
  try { const stat = fs.statSync(file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}`; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function assertUnchanged() {
  if (fileSignature(store.path) !== signature) throw new Error('Die Datendatei wurde außerhalb dieser App geändert. Es wird nichts überschrieben. Bitte Änderungen zuerst exportieren und die App neu öffnen.');
}
function snapshot(raw) {
  if (typeof raw !== 'string') throw new Error('Unbekanntes Desktop-Datenformat. Original bleibt erhalten.');
  const parsed = JSON.parse(raw);
  if (!isValidPersistedData(parsed)) throw new Error('Ungültiger oder neuerer Datenbestand. Original bleibt erhalten.');
  return parsed;
}
function ensureMirror() {
  if (!mirrorLoaded) { mirror = snapshot(config[DATA_KEY]); mirrorLoaded = true; }
  return mirror;
}
function decodeFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsichere Sicherungsdatei.');
  return JSON.parse(store._decryptData(fs.readFileSync(file)));
}
function rawRecovery(file) {
  const value = decodeFile(file)[DATA_KEY];
  if (typeof value !== 'string') throw new Error('Die Sicherung enthält keinen vollständigen Rechnungsbestand.');
  return value;
}
function ensureRecoveryDirectory() {
  fs.mkdirSync(recoveryDirectory, { recursive: true, mode: 0o700 });
  ensurePrivateDirectory(recoveryDirectory);
}
function recoveryFile(key) { return path.join(recoveryDirectory, `recovery-${sha(key)}.json`); }
function writeRecovery(key, raw) {
  if (typeof raw !== 'string') throw new Error('Originaldaten lassen sich nicht unverändert sichern.');
  ensureRecoveryDirectory();
  const file = recoveryFile(key);
  if (fs.existsSync(file)) {
    const existing = decodeFile(file);
    if (existing.recoveryKey !== key || existing[DATA_KEY] !== raw) throw new Error('Eine vorhandene Originalsicherung darf nicht überschrieben werden.');
    return true;
  }
  const backup = new Store({ cwd: recoveryDirectory, configName: path.basename(file, '.json'), encryptionKey: workerData.encryptionKey, configFileMode: 0o600 });
  backup._write({ [DATA_KEY]: raw, recoveryKey: key, createdAt: new Date().toISOString() });
  if (rawRecovery(file) !== raw) throw new Error('Die Originalsicherung konnte nicht vollständig bestätigt werden.');
  syncDirectory(recoveryDirectory);
  return true;
}
function archiveHistoricalRecoveries() {
  function archive(key, value) {
    if (typeof value === 'string') { writeRecovery(key, value); return true; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    if (!entries.length) return false;
    // Conf's historical dot-notation splits the ISO timestamp at its decimal
    // point. Preserve each exact original lookup key and raw snapshot.
    return entries.map(([child, raw]) => archive(`${key}.${child}`, raw)).every(Boolean);
  }
  for (const key of Object.keys(config)) {
    if (!key.startsWith(RECOVERY_PREFIX)) continue;
    // Delete only the hot-container copy, after the immutable encrypted archive
    // has been verified. The lookup API continues to resolve the old key.
    if (archive(key, config[key])) delete config[key];
  }
}
function autoBackup() {
  if (!fs.existsSync(store.path) || typeof config[DATA_KEY] !== 'string') return;
  // Never rotate corrupt/future snapshots into the automatic generations.
  // An explicit, validated restoration may replace them only after preserving
  // the exact original separately. Patch/metadata writes cannot create a valid
  // mirror from an unreadable primary and continue to fail closed.
  try { snapshot(config[DATA_KEY]); }
  catch (error) {
    if (!mirrorLoaded || !isValidPersistedData(mirror)) throw error;
    writeRecovery(`${RECOVERY_PREFIX}before-replacement:${sha(config[DATA_KEY])}`, config[DATA_KEY]);
    return;
  }
  ensureRecoveryDirectory();
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const destination = path.join(recoveryDirectory, `auto-${day}.json`);
  if (!fs.existsSync(destination)) {
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      try { fs.linkSync(store.path, temporary); }
      catch (error) {
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EMLINK'].includes(error.code)) throw error;
        fs.copyFileSync(store.path, temporary, fs.constants.COPYFILE_EXCL);
      }
      fs.chmodSync(temporary, 0o600);
      syncFile(temporary);
      const primaryBytes = fs.readFileSync(store.path), copyBytes = fs.readFileSync(temporary);
      if (!primaryBytes.equals(copyBytes)) throw new Error('Automatische Sicherung ist unvollständig.');
      // A same-process single writer owns publication; wx copy/link never
      // replaces an existing date generation.
      try { fs.linkSync(temporary, destination); }
      catch (error) {
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EMLINK'].includes(error.code)) throw error;
        fs.copyFileSync(temporary, destination, fs.constants.COPYFILE_EXCL);
        syncFile(destination);
        if (!fs.readFileSync(destination).equals(copyBytes)) throw new Error('Automatische Sicherung ist unvollständig.');
      }
      syncDirectory(recoveryDirectory);
    } finally { try { fs.unlinkSync(temporary); } catch {} }
  }
  // Retain user/import/upgrade backups forever. Only the app's redundant daily
  // generations rotate, and only after today's complete copy is readable.
  snapshot(rawRecovery(destination));
  const generations = fs.readdirSync(recoveryDirectory).filter(name => /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
  for (const name of generations.slice(AUTO_LIMIT)) fs.unlinkSync(path.join(recoveryDirectory, name));
  if (generations.length > AUTO_LIMIT) syncDirectory(recoveryDirectory);
}
function persist() {
  if (!dirty) return true;
  assertUnchanged();
  // The old on-disk value is backed up before changing the candidate config.
  autoBackup();
  archiveHistoricalRecoveries();
  if (mirrorLoaded) config[DATA_KEY] = JSON.stringify(mirror);
  config.helferleinPersistence = { protocol: 1, sessions: [...sessions.entries()] };
  try {
    store._write(config);
    signature = fileSignature(store.path);
    dirty = false;
    return true;
  } catch (error) {
    // A post-rename failure is an ambiguous commit; the DurableStore keeps its
    // previously confirmed generation and permits an explicit retry.
    if (error.originalUnchanged === false) signature = fileSignature(store.path);
    throw error;
  }
}
function applyBatch(batch) {
  if (!batch || typeof batch.session !== 'string' || batch.session.length > 160 || !Number.isSafeInteger(batch.sequence) || batch.sequence < 1 || !Array.isArray(batch.operations)) throw new Error('Ungültige Speichersequenz.');
  if (batch.sequence <= (sessions.get(batch.session) ?? 0)) return;
  let candidate = mirrorLoaded ? mirror : undefined;
  for (const operation of batch.operations) {
    if (operation.type === 'replace') {
      const replacement = snapshot(operation.value);
      const previous = candidate !== undefined ? JSON.stringify(candidate) : (mirrorLoaded ? JSON.stringify(mirror) : config[DATA_KEY]);
      if (typeof previous === 'string' && previous !== operation.value) writeRecovery(`${RECOVERY_PREFIX}before-replacement:${sha(previous)}`, previous);
      candidate = replacement;
    }
    else if (operation.type === 'patch') candidate = applyDataPatches(candidate ?? ensureMirror(), operation.patches);
    else throw new Error('Unbekannte Speicheränderung.');
  }
  if (candidate !== undefined && !isValidPersistedData(candidate)) throw new Error('Ungültige Änderungen wurden nicht gespeichert.');
  if (candidate !== undefined) { mirror = candidate; mirrorLoaded = true; dirty = true; }
  sessions.set(batch.session, batch.sequence);
  if (sessions.size > 64) sessions.delete(sessions.keys().next().value);
}
function listRecoveries() {
  const entries = [];
  for (const [folder, prefix] of [[directory, 'root'], [recoveryDirectory, 'archive']]) {
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) {
      let kind;
      if (prefix === 'root' && name === path.basename(lastGoodPathFor(store.path))) kind = 'last-good';
      else if (prefix === 'root' && name.startsWith(`${workerData.name}.before-`) && name.endsWith('.json')) kind = 'upgrade';
      else if (prefix === 'archive' && /^recovery-[a-f0-9]{64}\.json$/.test(name)) kind = 'recovery';
      else if (prefix === 'archive' && /^auto-\d{4}-\d{2}-\d{2}\.json$/.test(name)) kind = 'automatic';
      if (!kind) continue;
      const stat = fs.lstatSync(path.join(folder, name));
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      entries.push({ id: `${prefix}:${name}`, kind, label: name, createdAt: stat.mtime.toISOString(), size: stat.size });
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function command(message) {
  switch (message.command) {
    case 'get': {
      if (message.key === DATA_KEY && mirrorLoaded) return JSON.stringify(mirror);
      if (String(message.key).startsWith(RECOVERY_PREFIX) && !Object.hasOwn(config, message.key)) {
        const file = recoveryFile(message.key);
        if (fs.existsSync(file)) return rawRecovery(file);
        let value = config;
        for (const key of String(message.key).split('.')) {
          if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
          value = value[key];
        }
        return value;
      }
      return config[message.key];
    }
    case 'set': {
      const { key, value } = message;
      if (String(key).startsWith(RECOVERY_PREFIX)) return writeRecovery(key, value);
      if (key === DATA_KEY) {
        const candidate = snapshot(value);
        const previous = mirrorLoaded ? JSON.stringify(mirror) : config[DATA_KEY];
        if (typeof previous === 'string' && previous !== value) writeRecovery(`${RECOVERY_PREFIX}before-replacement:${sha(previous)}`, previous);
        mirror = candidate; mirrorLoaded = true;
      } else if (key === AUX_KEY || key === 'windowBounds') {
        if (key === AUX_KEY && typeof value !== 'string') throw new Error('Ungültige Standardwerte.');
        if (config[DATA_KEY] !== undefined && !mirrorLoaded) snapshot(config[DATA_KEY]);
        config[key] = value;
      } else throw new Error('Nicht erlaubter Speicherschlüssel.');
      dirty = true;
      return persist();
    }
    case 'commit': {
      if (!Array.isArray(message.batches) || message.batches.length > 128) throw new Error('Ungültige Speicherbestätigung.');
      const previous = { mirror, mirrorLoaded, dirty, sessions: new Map(sessions) };
      try {
        for (const batch of message.batches) applyBatch(batch);
      } catch (error) {
        // Validate the entire request before publishing any of its batches.
        // Recovery copies are additive; a rejected delta must never become a
        // later flush. A disk error below deliberately retains valid changes
        // and their sequence IDs for a safe, idempotent retry.
        ({ mirror, mirrorLoaded, dirty } = previous);
        sessions.clear();
        for (const [session, sequence] of previous.sessions) sessions.set(session, sequence);
        throw error;
      }
      return persist();
    }
    case 'flush': return persist();
    case 'delete': throw new Error('Originalsicherungen werden nicht automatisch gelöscht.');
    case 'list-recoveries': return listRecoveries();
    case 'get-recovery': {
      const entry = listRecoveries().find(item => item.id === message.recoveryId);
      if (!entry) throw new Error('Sicherung nicht gefunden.');
      return rawRecovery(path.join(entry.id.startsWith('root:') ? directory : recoveryDirectory, entry.id.slice(entry.id.indexOf(':') + 1)));
    }
    default: throw new Error('Unbekannter Speicherauftrag.');
  }
}
(async () => {
  const Conf = (await import('conf')).default;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  ensurePrivateDirectory(directory);
  Store = createDurableStoreClass(Conf);
  store = new Store({ cwd: directory, configName: workerData.name, encryptionKey: workerData.encryptionKey, configFileMode: 0o600 });
  config = store.store;
  if (config.helferleinPersistence !== undefined) {
    const metadata = config.helferleinPersistence;
    if (!metadata || metadata.protocol !== 1 || !Array.isArray(metadata.sessions) || metadata.sessions.length > 64) throw new Error('Unbekannte Version der lokalen Speicherverwaltung. Original bleibt unverändert.');
    for (const entry of metadata.sessions) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !Number.isSafeInteger(entry[1]) || entry[1] < 1) throw new Error('Beschädigte Speicherbestätigungen. Original bleibt unverändert.');
      sessions.set(entry[0], entry[1]);
    }
  }
  signature = fileSignature(store.path);
  let queue = Promise.resolve();
  parentPort.on('message', message => {
    queue = queue.then(async () => {
      try { parentPort.postMessage({ id: message.id, ok: true, value: await command(message) }); }
      catch (error) { parentPort.postMessage({ id: message.id, ok: false, error: errorText(error), details: { code: error.code, phase: error.phase, originalUnchanged: error.originalUnchanged, lastGoodPath: error.lastGoodPath } }); }
    });
  });
  parentPort.postMessage({ ready: true });
})().catch(error => parentPort.postMessage({ fatal: true, error: errorText(error) }));
