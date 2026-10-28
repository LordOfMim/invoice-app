const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
// Compile only the pure TypeScript storage dependencies; no renderer is started.
const cache = new Map();
function load(relative) {
  const filename = path.resolve(relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module);
  cache.set(filename, mod);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = request => request.startsWith('@/')
    ? load(`src/${request.slice(2)}.ts`) : Module.prototype.require.call(mod, request);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mod._compile(output, filename);
  return mod.exports;
}
const store = load('src/lib/storage/store.ts');
const key = 'invoice-app:v1';
function adapter(initial) {
  const values = new Map(initial === undefined ? [] : [[key, initial]]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('invalid existing data cannot initialize an empty store', () => {
  store.clearDataCache();
  const storage = adapter('{broken');
  assert.throws(() => store.loadData(storage), /ungültig/);
  assert.equal(storage.values.get(key), '{broken');
});
test('missing collections migrate additively but malformed collections are rejected', () => {
  const legacy = { schemaVersion: 1, settings: { customLegacySetting: 'keep' }, invoices: [] };
  const migrated = store.parsePersistedData(JSON.stringify(legacy));
  assert.equal(migrated.settings.customLegacySetting, 'keep');
  assert.deepEqual(migrated.customers, []);
  assert.equal(store.parsePersistedData(JSON.stringify({ ...legacy, customers: {} })), null);
  assert.equal(store.parsePersistedData(JSON.stringify({ ...legacy, invoices: [null] })), null);
});
test('import backs up exact previous bytes before replacing data', () => {
  store.clearDataCache();
  const storage = adapter('previous original bytes');
  assert.equal(store.importData(storage, JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [] })), true);
  const recovery = [...storage.values.entries()].find(([key]) => key.includes(':recovery:'));
  assert.equal(recovery[1], 'previous original bytes');
});
test('backup failure aborts import without replacing primary data', () => {
  const storage = adapter('original');
  storage.setItem = () => { throw new Error('disk full'); };
  assert.equal(store.importData(storage, JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [] })), false);
  assert.equal(storage.values.get(key), 'original');
});

test('legacy invoices retain IDs, money, payments, logo, attachments and layout through import and export', () => {
  store.clearDataCache();
  const legacyInvoice = {
    schemaVersion: 1, id: 'father-invoice-001', invoiceNumber: 'RE-2025-017',
    invoiceDate: '2025-12-30', dueDate: '2026-01-15', currency: 'EUR', paid: true,
    sender: { name: 'Musterbetrieb', address: 'Straße 1\n12345 Musterstadt', contact: 'Kontakt' },
    recipient: { name: 'Kunde ÄÖÜ', address: 'Weg 2', contact: 'Altbestand' },
    lineItems: [{ id: 'existing-line', type: 'item', description: 'Montage\nund Wartung', quantity: 1.5, unitPrice: 123.45, taxRate: 0.19 }],
    payments: [{ id: 'paid-1', amount: 100, date: '2026-01-02', reference: 'Altzahlung' }],
    attachments: [{ id: 'old-attachment', name: 'Anlage.pdf', type: 'application/pdf', size: 7, dataUrl: 'data:application/pdf;base64,JVBERg==', createdAt: '2025-12-30T10:00:00Z' }],
    logoDataUrl: 'data:image/png;base64,bG9nbw==', footerText: 'Bisherige Fußzeile', notesText: 'Hinweis ÄÖÜ',
    layout: { templateId: 'modern', showLogo: true, showFooter: true, logoPosition: 'right', senderPosition: 'left', recipientPosition: 'right' },
    futureOptionalData: { preserved: true },
    createdAt: '2025-12-30T10:00:00Z', updatedAt: '2026-01-02T10:00:00Z',
  };
  const original = JSON.stringify({ schemaVersion: 1, settings: { language: 'de', defaultSender: legacyInvoice.sender }, invoices: [legacyInvoice], futureCollection: ['keep'] });
  const storage = adapter();
  assert.equal(store.importData(storage, original), true);
  const roundTrip = JSON.parse(store.exportData(storage));
  const actual = roundTrip.invoices[0];
  for (const key of ['id', 'invoiceNumber', 'currency', 'paid', 'logoDataUrl', 'footerText', 'notesText', 'createdAt', 'updatedAt']) assert.equal(actual[key], legacyInvoice[key], key);
  assert.equal(actual.lineItems[0].id, 'existing-line');
  assert.equal(actual.lineItems[0].quantity, 1.5);
  assert.equal(actual.lineItems[0].unitPrice, 123.45);
  assert.equal(actual.payments[0].reference, 'Altzahlung');
  assert.deepEqual(actual.attachments, legacyInvoice.attachments);
  assert.equal(actual.layout.templateId, 'modern');
  assert.equal(actual.layout.logoPosition, 'right');
  assert.deepEqual(actual.futureOptionalData, { preserved: true });
  assert.deepEqual(roundTrip.futureCollection, ['keep']);
});

test('duplicating an invoice remaps custom E-invoice units to the new line IDs', () => {
  const defaults = load('src/lib/defaults.ts');
  const original = defaults.createInvoiceFromDefaults(defaults.createDefaultSettings());
  original.lineItems[0].unit = 'm²';
  original.einvoice = { seller: { taxId: 'legacy-tax' }, unitCodes: { [original.lineItems[0].id]: 'MTK' } };
  const copy = defaults.duplicateInvoice(original);
  assert.notEqual(copy.lineItems[0].id, original.lineItems[0].id);
  assert.equal(copy.einvoice.unitCodes[copy.lineItems[0].id], 'MTK');
  assert.equal(copy.einvoice.unitCodes[original.lineItems[0].id], undefined);
  copy.einvoice.seller.taxId = 'changed';
  assert.equal(original.einvoice.seller.taxId, 'legacy-tax');
});
