const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const modules = new Map();
function load(relative) {
  const filename = path.resolve(relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = new Module(filename, module);
  modules.set(filename, mod); mod.filename = filename; mod.paths = module.paths;
  mod.require = request => request.startsWith('@/') ? load(`src/${request.slice(2)}.ts`) : Module.prototype.require.call(mod, request);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
const store = load('src/lib/storage/store.ts');
const calc = load('src/lib/calc.ts');
const { createInvoiceDirectory } = load('src/lib/invoiceDirectory.ts');
const KEY = 'invoice-app:v1';
const collections = ['invoices', 'customers', 'products', 'tags', 'creditNotes', 'recurringInvoices', 'templateVariants'];
function raw(overrides = {}) { return { schemaVersion: 1, settings: {}, invoices: [], ...overrides }; }
function parse(value) { return store.parsePersistedData(JSON.stringify(value)); }
function fixture() { return parse(raw({ invoices: [{ id: 'invoice-1', invoiceNumber: 'RE-1', invoiceDate: '2026-10-01', dueDate: '2026-10-20', lineItems: [{ id: 'line-1', quantity: 1.25, unitPrice: 80, taxRate: 0.19 }] }] })); }
function adapter(initial) {
  const values = new Map(initial === undefined ? [] : [[KEY, initial]]), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) { writes.push([key, value]); values.set(key, value); } };
}

test('native persistence accepts immutable edits before publication; synchronous rejection leaves cache untouched', () => {
  const before = fixture(); store.primeDataCache(before);
  const storage = adapter(JSON.stringify(before)); const events = [];
  storage.persistData = (next, previous) => { assert.equal(previous, before); assert.equal(store.loadData(storage), before); events.push('accepted'); assert.equal(next.invoices[0].notesText, 'new'); };
  const unsubscribe = store.subscribe(() => events.push(store.loadData(storage).invoices[0].notesText));
  const updated = store.updateInvoice(storage, 'invoice-1', inv => ({ ...inv, notesText: 'new' }));
  assert.deepEqual(events, ['accepted', 'new']); assert.equal(storage.writes.length, 0); assert.equal(store.loadData(storage).invoices[0], updated);
  const accepted = store.loadData(storage);
  storage.persistData = () => { throw new Error('queue unavailable'); };
  assert.throws(() => store.updateInvoice(storage, 'invoice-1', inv => ({ ...inv, notesText: 'rejected' })), /queue unavailable/);
  assert.equal(store.loadData(storage), accepted); assert.deepEqual(events, ['accepted', 'new']); unsubscribe();
});

test('semantic no-op updates preserve timestamps, references, notifications and durable write count', () => {
  const before = fixture(); store.primeDataCache(before); const storage = adapter(JSON.stringify(before)); let accepted = 0, notified = 0;
  storage.persistData = () => accepted++;
  const unsubscribe = store.subscribe(() => notified++);
  const original = before.invoices[0];
  assert.equal(store.updateInvoice(storage, original.id, inv => ({ ...inv, recipient: { ...inv.recipient }, lineItems: inv.lineItems.map(line => ({ ...line })) })), original);
  store.upsertInvoice(storage, { ...original, lineItems: original.lineItems.map(line => ({ ...line })) });
  assert.equal(store.updateSettings(storage, settings => ({ ...settings, defaultSender: { ...settings.defaultSender } })), before.settings);
  assert.equal(store.loadData(storage), before); assert.equal(accepted, 0); assert.equal(notified, 0); assert.equal(storage.writes.length, 0); unsubscribe();
});

test('legacy adapters still write synchronously and failed writes do not publish edits', () => {
  const before = fixture(); store.primeDataCache(before); const storage = adapter(JSON.stringify(before));
  store.updateInvoice(storage, 'invoice-1', inv => ({ ...inv, notesText: 'saved' }));
  assert.equal(JSON.parse(storage.values.get(KEY)).invoices[0].notesText, 'saved');
  const saved = store.loadData(storage); storage.setItem = () => { throw new Error('disk full'); };
  assert.throws(() => store.updateInvoice(storage, 'invoice-1', inv => ({ ...inv, notesText: 'lost' })), /disk full/); assert.equal(store.loadData(storage), saved);
});

test('authoritative import bypasses incremental persistence and backs up exact original bytes first', () => {
  const before = fixture(); store.primeDataCache(before); const storage = adapter('exact original bytes');
  storage.persistData = () => assert.fail('authoritative imports cannot be incremental edits');
  assert.equal(store.importData(storage, JSON.stringify(raw())), true);
  assert.match(storage.writes[0][0], /:recovery:.*:before-import$/); assert.equal(storage.writes[0][1], 'exact original bytes'); assert.equal(storage.writes[1][0], KEY);
  assert.equal(store.loadData(storage).invoices.length, 0);
});

test('primed startup data needs no second read, parse, write or notification', () => {
  const data = fixture(); let notified = 0; const unsubscribe = store.subscribe(() => notified++);
  store.primeDataCache(data);
  assert.equal(store.loadData({ getItem() { assert.fail('unexpected reread'); }, setItem() { assert.fail('unexpected write'); } }), data); assert.equal(notified, 0); unsubscribe();
});

test('known financial fields reject corrupt present types without replacing the existing snapshot', () => {
  const corrupt = [
    raw({ settings: { defaultTaxRate: '19' } }),
    raw({ invoices: [{ exchangeRate: null }] }),
    raw({ invoices: [{ lineItems: [{ quantity: '2', unitPrice: 5 }] }] }),
    raw({ invoices: [{ lineItems: [{ quantity: 2, unitPrice: null }] }] }),
    raw({ invoices: [{ lineItems: [{ taxRate: [] }] }] }),
    raw({ invoices: [{ payments: [{ amount: false }] }] }),
    raw({ products: [{ unitPrice: '12,50' }] }),
    raw({ products: [{ taxRate: {} }] }),
    raw({ creditNotes: [{ amount: '100' }] }),
    raw({ recurringInvoices: [{ lineItems: [{ unitPrice: '5' }] }] }),
  ];
  const storage = adapter('unchanged original');
  for (const value of corrupt) { assert.equal(parse(value), null); assert.equal(store.importData(storage, JSON.stringify(value)), false); }
  assert.equal(store.parsePersistedData('{"schemaVersion":1,"settings":{},"invoices":[{"lineItems":[{"unitPrice":1e400}]}]}'), null);
  assert.equal(storage.values.get(KEY), 'unchanged original'); assert.deepEqual(storage.writes, []);
});

test('all seven collections reject malformed records, unsupported record schemas and duplicate IDs', () => {
  for (const collection of collections) {
    for (const records of [null, {}, [null], [7], [{ schemaVersion: 2 }], [{ schemaVersion: '1' }], [{ id: 'duplicate' }, { id: 'duplicate' }]]) assert.equal(parse(raw({ [collection]: records })), null, collection);
  }
  // IDs are scoped to a collection, not globally unique across entity kinds.
  assert.ok(parse(raw(Object.fromEntries(collections.map(collection => [collection, [{ id: 'shared-across-types' }]])))));
});

test('known nested arrays, parties, E-invoice maps and metadata reject corruption', () => {
  const invoices = [
    { lineItems: [null] }, { payments: {} }, { attachments: [false] }, { tagIds: [42] }, { creditNoteIds: 'id' },
    { sender: [] }, { recipient: { name: 17 } }, { einvoice: { seller: 'seller' } }, { einvoice: { unitCodes: { line: 42 } } },
    { layout: { customization: { fontSizeScale: '1' } } }, { texts: { documentTitle: 7 } },
    { lineItems: [{ id: 'same' }, { id: 'same' }] }, { payments: [{ id: 'same' }, { id: 'same' }] }, { attachments: [{ id: 'same' }, { id: 'same' }] },
  ];
  for (const invoice of invoices) assert.equal(parse(raw({ invoices: [invoice] })), null);
  assert.equal(parse(raw({ recurringInvoices: [{ lineItems: {} }] })), null);
  assert.equal(parse(raw({ templateVariants: [{ customization: { lineSpacing: null } }] })), null);
});

test('older v1 records retain finite negative, zero and decimal money, explicit empty arrays and additive fields', () => {
  const line = { id: 'line', type: 'header', description: 'Existing accounting data', quantity: -0.25, unitPrice: 19.999, taxRate: -0.07, futureLine: { keep: true } };
  const value = raw({ settings: { defaultSender: { name: 'Alt', futureParty: { keep: true } } },
    invoices: [{ id: 'legacy', invoiceNumber: 'ALT-1', lineItems: [line], payments: [{ id: 'payment', amount: -17.35 }], sender: { name: 'Alt', futureParty: ['keep'] }, attachments: [], tagIds: [], creditNoteIds: [], futureInvoice: true }, { id: 'empty', lineItems: [], payments: [], attachments: [] }],
    recurringInvoices: [{ id: 'recurring', lineItems: [] }], products: [{ id: 'product', unitPrice: -0.75, taxRate: 0 }], creditNotes: [{ id: 'credit', amount: -22.225 }], futureRoot: ['keep'] });
  const data = parse(value); assert.ok(data); const actual = data.invoices[0];
  for (const field of ['quantity', 'unitPrice', 'taxRate']) assert.equal(actual.lineItems[0][field], line[field]);
  assert.equal(actual.payments[0].amount, -17.35); assert.equal(data.products[0].unitPrice, -0.75); assert.equal(data.products[0].taxRate, 0); assert.equal(data.creditNotes[0].amount, -22.225);
  assert.deepEqual(actual.sender.futureParty, ['keep']); assert.deepEqual(data.settings.defaultSender.futureParty, { keep: true });
  assert.deepEqual(data.invoices[1].lineItems, []); assert.deepEqual(data.recurringInvoices[0].lineItems, []); assert.deepEqual(data.futureRoot, ['keep']);
  store.primeDataCache(data); const exported = parse(JSON.parse(store.exportData(adapter()))); assert.deepEqual(exported.invoices[0].lineItems, data.invoices[0].lineItems); assert.equal(exported.invoices[0].payments[0].amount, -17.35);
  assert.deepEqual(calc.computeInvoiceTotals(exported.invoices[0]), calc.computeInvoiceTotals(actual));
});

test('missing legacy tax remains absent while a fresh installation retains its explicit 19 percent default', () => {
  const legacy = parse(raw({ invoices: [{ id: 'one' }, { id: 'two' }] }));
  assert.equal(legacy.settings.defaultTaxRate, undefined); assert.equal(legacy.invoices[0].lineItems[0].taxRate, undefined);
  assert.notEqual(legacy.invoices[0].lineItems[0].id, legacy.invoices[1].lineItems[0].id);
  const storage = adapter(); store.clearDataCache(); assert.equal(store.loadData(storage).settings.defaultTaxRate, 0.19);
});

test('directory reuses unaffected rows and invalidates changed records, credits, locale and day', () => {
  const data = fixture(); const first = data.invoices[0], second = { ...first, id: 'invoice-2', invoiceNumber: 'RE-2' };
  const directory = createInvoiceDirectory(); const c1 = { id: 'credit-1', linkedInvoiceId: first.id, amount: 10 }, c2 = { id: 'credit-2', linkedInvoiceId: second.id, amount: 20 };
  const rows = directory.rows([first, second], [c1, c2], 'de-DE', 'de', '2026-10-20');
  const changedFirst = { ...first, recipient: { ...first.recipient, name: 'Changed' } };
  const changed = directory.rows([changedFirst, second], [c1, c2], 'de-DE', 'de', '2026-10-20');
  assert.notEqual(changed[0], rows[0]); assert.equal(changed[1], rows[1]); assert.match(changed[0].searchText, /changed/);
  const creditChanged = directory.rows([changedFirst, second], [{ ...c1, amount: 30 }, c2], 'de-DE', 'de', '2026-10-20');
  assert.notEqual(creditChanged[0], changed[0]); assert.equal(creditChanged[1], changed[1]); assert.equal(creditChanged[0].balance.creditTotal, 30);
  const rolled = directory.rows([changedFirst, second], [c1, c2], 'de-DE', 'de', '2026-10-21'); assert.notEqual(rolled[1], rows[1]); assert.equal(rolled[1].balance.isOverdue, true);
  const english = directory.rows([changedFirst, second], [c1, c2], 'en-US', 'en', '2026-10-21'); assert.notEqual(english[1], rolled[1]); assert.notEqual(english[1].dateLabel, rolled[1].dateLabel);
});

test('dashboard credits retain their invoice association, totals and cash flow after indexed lookup', () => {
  const base = fixture().invoices[0];
  const data = parse(raw({ invoices: [base, { ...base, id: 'invoice-2', lineItems: [{ id: 'line-2', quantity: 2, unitPrice: 100, taxRate: 0 }], payments: [{ id: 'payment-2', amount: 50, date: '2026-10-02' }] }],
    creditNotes: [{ id: 'credit-1', linkedInvoiceId: base.id, amount: 10, creditNoteDate: '2026-10-03' }, { id: 'credit-2', linkedInvoiceId: 'invoice-2', amount: 20, creditNoteDate: '2026-10-03' }, { id: 'orphan', linkedInvoiceId: 'missing', amount: 99, creditNoteDate: '2026-10-03' }] }));
  store.primeDataCache(data); const stats = store.getDashboardStats(adapter());
  assert.equal(stats.unpaidTotal, 239); assert.equal(stats.collectionRate, 17); assert.equal(stats.invoiceCount, 2);
  assert.equal(stats.revenueByMonth.find(month => month.month === '2026-10').revenue, 20);
});

test('the worker validator accepts legacy data without migration and rejects raw nonfinite commits', () => {
  const { isValidPersistedData } = require('../../electron/storage-validation.cjs');
  const legacy = raw({ invoices: [{ id: 'old', lineItems: [], payments: [{ amount: -1.125 }], sender: { futureParty: { preserve: true } } }] });
  const original = structuredClone(legacy);
  Object.freeze(legacy.settings); Object.freeze(legacy.invoices[0].lineItems); Object.freeze(legacy.invoices[0]); Object.freeze(legacy.invoices); Object.freeze(legacy);
  assert.equal(isValidPersistedData(legacy), true); assert.deepEqual(legacy, original); assert.equal(Object.hasOwn(legacy.settings, 'defaultTaxRate'), false);
  for (const amount of [NaN, Infinity, -Infinity]) assert.equal(isValidPersistedData(raw({ invoices: [{ payments: [{ amount }] }] })), false);
  assert.equal(isValidPersistedData(JSON.parse('{"schemaVersion":1,"settings":{},"invoices":[{"exchangeRate":1e400}]}')), false);
});

test('renderer and dependency-free worker validation agree on supported and corrupt snapshots', () => {
  const vm = require('node:vm'); const isolated = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve('electron/storage-validation.cjs'), 'utf8'), { module: isolated });
  const validate = isolated.exports.isValidPersistedData;
  const candidates = [raw(), raw({ invoices: [{ lineItems: [], payments: [{ amount: -0.5 }] }] }), raw({ products: [{ unitPrice: 0, taxRate: 0 }] }), raw({ settings: { defaultTaxRate: null } }), raw({ invoices: [{ lineItems: [{ unitPrice: '5' }] }] })];
  for (const collection of collections) candidates.push(raw({ [collection]: [{ schemaVersion: 2 }] }), raw({ [collection]: [{ id: 'duplicate' }, { id: 'duplicate' }] }));
  for (const value of candidates) assert.equal(validate(value), parse(value) !== null);
});
