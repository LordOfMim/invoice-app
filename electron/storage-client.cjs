'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');

class StorageClient {
  constructor(options) {
    this.nextId = 0;
    this.pending = new Map();
    this.failure = null;
    this.worker = new Worker(path.join(__dirname, 'storage-worker.cjs'), { workerData: options });
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.worker.on('message', message => {
      if (message.ready) { this.resolveReady(); return; }
      if (message.fatal) { this.fail(new Error(message.error)); return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else { const error = new Error(message.error || 'Lokales Speichern fehlgeschlagen.'); Object.assign(error, message.details); request.reject(error); }
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => { if (code !== 0 || this.pending.size) this.fail(new Error('Der lokale Speicherprozess wurde beendet. Ungespeicherte Änderungen bitte exportieren.')); });
  }
  fail(error) {
    if (this.failure) return;
    this.failure = error;
    this.rejectReady(error);
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    void this.worker.terminate();
  }
  async request(command, payload = {}) {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.pending.size >= 256) throw new Error('Der Speicher ist ausgelastet. Änderungen bleiben vorgemerkt; bitte kurz warten.');
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, command, ...payload }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  get(key) { return this.request('get', { key }); }
  set(key, value) { return this.request('set', { key, value }); }
  delete(key) { return this.request('delete', { key }); }
  commit(batches) { return this.request('commit', { batches }); }
  flush() { return this.request('flush'); }
  listRecoveries() { return this.request('list-recoveries'); }
  getRecovery(id) { return this.request('get-recovery', { recoveryId: id }); }
  async close() { try { await this.flush(); } finally { await this.worker.terminate(); } }
}
module.exports = { StorageClient };
