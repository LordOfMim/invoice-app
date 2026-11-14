'use strict';

// Application-owned publication for electron-store/Conf. Conf still serializes
// and encrypts (unchanged wire format, key and name), but only into a unique
// staging file next to the primary. The staged bytes are decrypted and compared
// with the exact serialization before the primary is replaced by one rename.
// Conf's direct fallbacks (EXDEV, SNAP) and atomically's unchecked short writes
// can therefore only damage the staging file, never the primary.
const nodeFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
// Filesystems without hard links (FAT/exFAT, some network shares) report these.
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS', 'EMLINK']);
// A filesystem that cannot fsync directories says so explicitly; EIO/ENOSPC etc. stay errors.
const DIRECTORY_SYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP']);
const WINDOWS_RENAME_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

class DurableStoreError extends Error {
  constructor(message, { code, phase, originalUnchanged, lastGoodPath, cause }) {
    super(message, { cause });
    this.name = 'DurableStoreError';
    this.code = code;
    this.phase = phase;
    this.originalUnchanged = originalUnchanged;
    this.lastGoodPath = lastGoodPath;
  }
}

function errorCode(error) {
  return error && typeof error === 'object' ? error.code : undefined;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// Returns 'synced', or 'unsupported' when the platform/filesystem cannot fsync
// a directory. Windows cannot open directories for flushing; NTFS journals the
// rename metadata instead. Every other failure is thrown.
function syncDirectory(directory, { fs = nodeFs, platform = process.platform } = {}) {
  if (platform === 'win32') return 'unsupported';
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
  } catch (error) {
    if (DIRECTORY_SYNC_UNSUPPORTED.has(errorCode(error))) return 'unsupported';
    throw error;
  }
  try {
    fs.fsyncSync(descriptor);
    return 'synced';
  } catch (error) {
    if (DIRECTORY_SYNC_UNSUPPORTED.has(errorCode(error))) return 'unsupported';
    throw error;
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncFile(file, { fs = nodeFs } = {}) {
  // Windows FlushFileBuffers requires a handle with write access.
  const descriptor = fs.openSync(file, 'r+');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

// Removes group/other access from the data directory on POSIX. The embedded
// encryption key is not an access boundary, so file modes are what protect data.
function ensurePrivateDirectory(directory, { fs = nodeFs, platform = process.platform } = {}) {
  if (platform === 'win32') return false;
  const stats = fs.statSync(directory);
  if (!stats.isDirectory()) throw new Error(`Data path is not a directory: ${directory}`);
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) return false;
  if ((stats.mode & 0o077) !== 0) fs.chmodSync(directory, PRIVATE_DIRECTORY_MODE);
  return true;
}

function lastGoodPathFor(target) {
  const extension = path.extname(target);
  return `${target.slice(0, target.length - extension.length)}.last-good${extension}`;
}

// Verifies a complete encrypted snapshot with the real Store decryption, using
// a disposable probe store in a private directory (never the primary path).
function createSnapshotVerifier(Store, { name, encryptionKey }, directory, { fs = nodeFs } = {}) {
  return (bytes) => {
    const probeDirectory = fs.mkdtempSync(path.join(directory, '.helferlein-verify-'));
    try {
      const probe = new Store({ name, configName: name, encryptionKey, cwd: probeDirectory });
      if (typeof probe._decryptData !== 'function') throw new Error('Store cannot verify encrypted snapshots');
      let parsed;
      try { parsed = JSON.parse(probe._decryptData(bytes)); } catch { return false; }
      return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    } finally {
      fs.rmSync(probeDirectory, { recursive: true, force: true });
    }
  };
}

function createDurableStoreClass(Store, { fs = nodeFs, platform = process.platform, onEvent = () => {} } = {}) {
  // The Conf constructor calls _write before subclass fields exist, so all
  // per-instance state lives here instead of in instance fields.
  const states = new WeakMap();
  function stateOf(store) {
    let state = states.get(store);
    if (!state) {
      state = { status: 'ok', directorySync: undefined, lastError: undefined, cleaned: false };
      states.set(store, state);
    }
    return state;
  }

  function removeFile(file) {
    try { fs.unlinkSync(file); } catch (error) {
      if (errorCode(error) !== 'ENOENT') onEvent('cleanup-failed', { file, error: String(error) });
    }
  }

  function removeStaleTemporaries(directory, base) {
    let names;
    try { names = fs.readdirSync(directory); } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    // Staging files are never the only copy: they only become data by rename.
    const prefixes = [`.${base}.staging-`, `.${base}.last-good-`];
    for (const name of names) {
      if (prefixes.some((prefix) => name.startsWith(prefix))) removeFile(path.join(directory, name));
    }
  }

  function removeStaging(staging) {
    removeFile(staging);
    // atomically stages its own temporary next to our staging path.
    try {
      const directory = path.dirname(staging);
      const prefix = `${path.basename(staging)}.tmp-`;
      for (const name of fs.readdirSync(directory)) if (name.startsWith(prefix)) removeFile(path.join(directory, name));
    } catch {}
  }

  function rename(source, destination) {
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(source, destination);
        return;
      } catch (error) {
        // Virus scanners and indexers briefly hold files open on Windows.
        if (platform !== 'win32' || !WINDOWS_RENAME_BUSY.has(errorCode(error)) || attempt >= 10) throw error;
        sleepSync(50);
      }
    }
  }

  // Keeps the current primary as the last-good generation. A hard link costs no
  // space; the old inode is never written again because publication renames.
  function preserveLastGood(target, lastGoodPath, token) {
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.last-good-${token}`);
    try {
      fs.linkSync(target, temporary);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false;
      if (!LINK_UNSUPPORTED.has(errorCode(error))) throw error;
      try {
        fs.copyFileSync(target, temporary, nodeFs.constants.COPYFILE_EXCL);
        syncFile(temporary, { fs });
        if (!fs.readFileSync(temporary).equals(fs.readFileSync(target))) throw new Error('Last-good copy is incomplete');
      } catch (copyError) {
        removeFile(temporary);
        throw copyError;
      }
    }
    try {
      if (platform !== 'win32') fs.chmodSync(temporary, PRIVATE_FILE_MODE);
      rename(temporary, lastGoodPath);
    } catch (error) {
      removeFile(temporary);
      throw error;
    }
    return true;
  }

  return class DurableStore extends Store {
    // 'ok' after a fully published write. 'failed' means the last write was
    // rejected with the primary untouched. 'ambiguous' means a rename happened
    // but durability was not confirmed; it persists until a write fully succeeds.
    get durability() {
      const state = stateOf(this);
      return {
        status: state.status,
        directorySync: state.directorySync,
        lastGoodPath: lastGoodPathFor(this.path),
        error: state.lastError ? String(state.lastError.message) : undefined,
      };
    }

    _write(value) {
      const state = stateOf(this);
      try {
        this.#publish(value, state);
        state.status = 'ok';
        state.lastError = undefined;
      } catch (error) {
        if (!error.originalUnchanged) state.status = 'ambiguous';
        else if (state.status !== 'ambiguous') state.status = 'failed';
        state.lastError = error;
        throw error;
      }
    }

    #publish(value, state) {
      const target = this.path;
      const directory = path.dirname(target);
      const base = path.basename(target);
      const lastGoodPath = lastGoodPathFor(target);
      const unchanged = (phase, cause) => new DurableStoreError(
        `Speichern fehlgeschlagen (${phase}); die bisherige Datei ist unverändert: ${target}. ${String(cause?.message ?? cause)}`,
        { code: 'HELFERLEIN_WRITE_FAILED', phase, originalUnchanged: true, lastGoodPath, cause },
      );
      if (!state.cleaned) {
        removeStaleTemporaries(directory, base);
        state.cleaned = true;
      }

      const token = crypto.randomUUID();
      const staging = path.join(directory, `.${base}.staging-${token}`);
      const serialize = this._serialize;
      let expected;
      this._serialize = (input) => (expected = serialize.call(this, input));
      this.path = staging;
      try {
        super._write(value);
      } catch (error) {
        removeStaging(staging);
        throw unchanged('staging', error);
      } finally {
        this.path = target;
        this._serialize = serialize;
      }

      let staged;
      try {
        if (typeof expected !== 'string') throw new Error('Store did not serialize the snapshot');
        const bytes = fs.readFileSync(staging);
        // Conf's decryption silently returns raw text on failure, so a short or
        // corrupt file can never equal the expected serialization.
        if (this._decryptData(bytes) !== expected) throw new Error('Staged snapshot is incomplete or does not decrypt to the expected data');
        if (platform !== 'win32') fs.chmodSync(staging, PRIVATE_FILE_MODE);
        syncFile(staging, { fs });
        staged = fs.statSync(staging);
        if (staged.size !== bytes.length) throw new Error('Staged snapshot changed during verification');
        // An earlier rename may have succeeded without a durability fence.
        // Do not rotate away the last confirmed generation until that current
        // primary has itself been fenced successfully.
        if (state.status === 'ambiguous') {
          syncFile(target, { fs });
          syncDirectory(directory, { fs, platform });
        }
        preserveLastGood(target, lastGoodPath, token);
        // Fence the last-good name before the primary name may point elsewhere.
        syncDirectory(directory, { fs, platform });
        rename(staging, target);
      } catch (error) {
        removeStaging(staging);
        throw unchanged('publish', error);
      }

      // The new primary name exists now. Any failure from here on cannot claim
      // the original is unchanged; the last-good generation stays available.
      try {
        state.directorySync = syncDirectory(directory, { fs, platform });
        const published = fs.statSync(target);
        if (published.size !== staged.size || (staged.ino && published.ino !== staged.ino)) {
          throw new Error('Published file does not match the verified staging file');
        }
      } catch (error) {
        throw new DurableStoreError(
          `Speichern nicht bestätigt: Die neue Datei wurde veröffentlicht, ihre Dauerhaftigkeit ist aber unklar. Vorheriger Stand: ${lastGoodPath}. ${String(error?.message ?? error)}`,
          { code: 'HELFERLEIN_COMMIT_AMBIGUOUS', phase: 'commit', originalUnchanged: false, lastGoodPath, cause: error },
        );
      }
      if (state.directorySync === 'unsupported') onEvent('directory-sync-unsupported', { directory, platform });
    }
  };
}

module.exports = {
  DurableStoreError,
  PRIVATE_FILE_MODE,
  createDurableStoreClass,
  createSnapshotVerifier,
  ensurePrivateDirectory,
  lastGoodPathFor,
  syncDirectory,
  syncFile,
};
