const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { StorageClient } = require('../../electron/storage-client.cjs');
const { lastGoodPathFor } = require('../../electron/durable-store.cjs');
const { isValidPersistedData } = require('../../electron/storage-validation.cjs');

const fixture = path.join(__dirname, 'fixtures/legacy-ae06259');
const historicalMain = fs.readFileSync(path.join(fixture, 'old-main.js'), 'utf8');
// Same historical key and real encryption, without logging or duplicating it.
const encryptionKey = historicalMain.match(/encryptionKey:\s*'([^']+)'/)[1];
const originalPayload = JSON.parse(fs.readFileSync(path.join(fixture, 'payload.json'), 'utf8'));
const name = 'invoice-app-data', key = 'invoice-app:v1';
const ConfPromise = import('conf').then(module => module.default);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

for (const [label, makeRaw, explicitBackup] of [
  ['future schema', () => ` \n${JSON.stringify({ ...originalPayload, schemaVersion: 999 })}\n`, true],
  ['malformed JSON', () => ' \n{broken original payload\n', false],
  ['corrupt financial value', () => JSON.stringify({ ...originalPayload, invoices: originalPayload.invoices.map((invoice, index) => index ? invoice : { ...invoice, payments: [{ id: 'invalid-payment', amount: '12,50' }] }) }), true],
]) {
  test(`${label}: valid recovery replacement preserves exact original and survives worker restart`, { timeout: 20000 }, async t => {
    const Conf = await ConfPromise;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-recovery-restore-'));
    const clients = [];
    t.after(async () => {
      for (const client of clients) {
        if (client.worker.threadId === -1) continue;
        try { await client.close(); } catch { await client.worker.terminate(); }
      }
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const confOptions = { cwd: directory, configName: name, encryptionKey, configFileMode: 0o600 };
    const raw = makeRaw();
    const historicalWriter = new Conf(confOptions);
    historicalWriter.set(key, raw);
    const primary = path.join(directory, `${name}.json`);
    const originalHash = sha(fs.readFileSync(primary));
    const open = () => { const client = new StorageClient({ directory, name, encryptionKey }); clients.push(client); return client; };
    const client = open();
    assert.equal(await client.get(key), raw);
    await assert.rejects(client.set('windowBounds', { width: 1200, height: 800 }));
    assert.equal(sha(fs.readFileSync(primary)), originalHash, 'metadata may not rewrite a corrupt/future APP payload');

    if (explicitBackup) {
      // Matches RecoveryScreen: durable original first, then a validated replacement.
      const backupKey = `${key}:recovery:synthetic-before-recovery-${label}`;
      assert.equal(await client.set(backupKey, raw), true);
      assert.equal(await client.flush(), true);
      assert.equal(await client.get(backupKey), raw);
      assert.equal(sha(fs.readFileSync(primary)), originalHash, 'creating recovery must not replace primary');
    }
    const replacement = { ...originalPayload, qaRecoveryRestored: label };
    const replacementRaw = JSON.stringify(replacement);
    assert.equal(await client.set(key, replacementRaw), true);
    assert.equal(await client.flush(), true);
    assert.deepEqual(JSON.parse(await client.get(key)), replacement);
    assert.equal(sha(fs.readFileSync(lastGoodPathFor(primary))), originalHash, 'last-good preserves exact original encrypted bytes');
    const entries = await client.listRecoveries();
    const recovered = await Promise.all(entries.filter(entry => entry.kind === 'recovery').map(entry => client.getRecovery(entry.id)));
    assert.ok(recovered.includes(raw), 'the exact old raw bytes must be in a durable encrypted recovery');
    for (const entry of entries.filter(entry => entry.kind === 'automatic')) assert.equal(isValidPersistedData(JSON.parse(await client.getRecovery(entry.id))), true, 'invalid old data may not enter valid automatic generations');

    await client.close();
    const reopened = open();
    assert.deepEqual(JSON.parse(await reopened.get(key)), replacement);
    const oldReader = new Conf(confOptions);
    assert.deepEqual(JSON.parse(oldReader.get(key)), replacement, 'the same legacy encryption remains readable');
    const archivedAfterRestart = await Promise.all((await reopened.listRecoveries()).filter(entry => entry.kind === 'recovery').map(entry => reopened.getRecovery(entry.id)));
    assert.ok(archivedAfterRestart.includes(raw), 'original recovery survives restart');
    // Subsequent ordinary metadata writes can now create valid daily snapshots.
    assert.equal(await reopened.set('windowBounds', { width: 1200, height: 800 }), true);
    assert.deepEqual(JSON.parse(await reopened.get(key)), replacement);
  });
}
