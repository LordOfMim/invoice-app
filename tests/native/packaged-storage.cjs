'use strict';
// Runs under the unpacked app's own Electron/Node, without a GUI or real data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const appDir = process.argv[2];
const { StorageClient } = require(path.join(appDir, 'electron/storage-client.cjs'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-packaged-store-'));
const fixture = path.join(__dirname, '../runtime/fixtures/legacy-ae06259');
fs.copyFileSync(path.join(fixture, 'invoice-app-data.json'), path.join(directory, 'invoice-app-data.json'));
const encryptionKey = fs.readFileSync(path.join(fixture, 'old-main.js'), 'utf8').match(/encryptionKey:\s*'([^']+)'/)[1];
const options = { directory, name: 'invoice-app-data', encryptionKey };
let client;
(async () => {
  client = new StorageClient(options);
  await client.ready;
  const before = JSON.parse(await client.get('invoice-app:v1'));
  const batch = { session: 'packaged-smoke', sequence: 1, operations: [{ type: 'patch', patches: [{ op: 'set', path: ['settings', 'defaultFooterText'], value: 'DEMO packaged durable commit' }] }] };
  assert.equal(await client.commit([batch]), true);
  assert.equal(await client.commit([batch]), true);
  assert.ok((await client.listRecoveries()).length >= 2);
  await client.close();
  client = new StorageClient(options);
  await client.ready;
  const after = JSON.parse(await client.get('invoice-app:v1'));
  assert.equal(after.settings.defaultFooterText, 'DEMO packaged durable commit');
  for (const collection of ['invoices', 'customers', 'products', 'tags', 'creditNotes', 'recurringInvoices', 'templateVariants']) assert.deepEqual(after[collection], before[collection]);
  console.log('PASS packaged storage: real Worker + Conf + historical ciphertext; durable edit/replay/reopen and all collections/attachments unchanged.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (client) await client.close().catch(() => {});
  fs.rmSync(directory, { recursive: true, force: true });
});
