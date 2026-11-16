'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isValidPersistedData } = require('../../electron/storage-validation.cjs');
const { createLoader } = require('./helpers/load-typescript.cjs');

const load = createLoader();
const defaults = load('src/lib/defaults.ts');
const documents = load('src/lib/documents.ts');
const { parsePersistedData } = load('src/lib/storage/store.ts');

const stored = (value) => JSON.parse(JSON.stringify(value));
const item = (id, quantity, unitPrice, taxRate) => ({ id, type: 'item', description: id, quantity, unitPrice, taxRate });

/** A small snapshot the way version 1.2.0 wrote it: every collection it knew, none of the 1.3 fields. */
function baseSnapshot() {
  const settings = defaults.createDefaultSettings();
  const invoice = { ...defaults.createInvoiceFromDefaults(settings), id: 'inv-1', invoiceNumber: 'RE-2026-001', invoiceDate: '2026-03-01', dueDate: '2026-03-15', customerId: 'cus-1', lineItems: [item('l1', 2, 100, 0.19)] };
  const customer = { ...defaults.createDefaultCustomer(), id: 'cus-1', name: 'Bau GmbH' };
  const recurring = { ...defaults.createDefaultRecurringInvoice(settings), id: 'rec-1', name: 'Wartung', lineItems: [item('r1', 1, 50, 0.19)] };
  return stored({
    schemaVersion: 1, settings, invoices: [invoice], customers: [customer],
    products: [{ ...defaults.createDefaultProduct(0.19), id: 'pro-1', name: 'Stunde' }],
    tags: [{ ...defaults.createDefaultTag(), id: 'tag-1', name: 'Projekt' }],
    creditNotes: [{ ...defaults.createCreditNoteFromInvoice(invoice, 'storno'), id: 'cn-1' }],
    recurringInvoices: [recurring],
    templateVariants: [{ ...defaults.createDefaultTemplateVariant(), id: 'tpl-1', name: 'Eigene' }],
  });
}
function withInvoice(patch) { const data = baseSnapshot(); Object.assign(data.invoices[0], patch); return data; }
function withQuote(patch) { const data = baseSnapshot(); data.quotes = [{ ...data.invoices[0], id: 'quo-1', documentKind: 'quote', quoteStatus: 'open', ...patch }]; return data; }
function withSettings(patch) { const data = baseSnapshot(); Object.assign(data.settings, patch); return data; }
function withCustomer(patch) { const data = baseSnapshot(); Object.assign(data.customers[0], patch); return data; }
function withRecurring(patch) { const data = baseSnapshot(); Object.assign(data.recurringInvoices[0], patch); return data; }
const declaration = (patch = {}) => ({ id: 'dec-1', date: '2026-05-05', senderAddress: 'Max GmbH · Weg 1', recipientName: 'Bau GmbH', recipientAddress: 'Ring 9', kommission: 'BV Nord', bodyText: 'Text', signatureName: 'Max', createdAt: '2026-05-05T08:00:00.000Z', updatedAt: '2026-05-05T08:00:00.000Z', ...patch });
function withDeclarations(list) { const data = baseSnapshot(); data.contractorDeclarations = list; return data; }

/** Every value in `good` must be accepted and every value in `bad` rejected when written by `build`. */
function check(label, build, good, bad) {
  for (const value of good) assert.equal(isValidPersistedData(build(value)), true, `${label} must accept ${JSON.stringify(value)}`);
  for (const value of bad) assert.equal(isValidPersistedData(build(value)), false, `${label} must reject ${JSON.stringify(value)}`);
}
const NOT_STRING = [5, true, null, {}, ['x']];
const NOT_BOOLEAN = ['true', 1, 0, null, {}];
const NOT_NUMBER = ['14', null, true, {}, [1]];

test('the base snapshot is valid and carries none of the 1.3 fields', () => {
  const data = baseSnapshot();
  assert.equal(isValidPersistedData(data), true);
  assert.equal('quotes' in data, false);
  assert.equal('contractorDeclarations' in data, false);
  const added = {
    invoices: ['projectReference', 'reverseCharge', 'invoiceKind', 'advanceDeductions', 'reminders', 'documentKind', 'quoteStatus', 'convertedInvoiceId', 'sourceQuoteId'],
    customers: ['reverseCharge'], recurringInvoices: ['anchorDay'],
  };
  for (const [collection, keys] of Object.entries(added)) for (const key of keys) assert.equal(key in data[collection][0], false, `${collection}.${key}`);
  for (const key of ['uiScale', 'defaultPaymentTermDays']) assert.equal(key in data.settings, false, key);
});

test('data written before 1.3 is still accepted and gains empty collections on load', () => {
  const data = baseSnapshot();
  const loaded = parsePersistedData(JSON.stringify(data));
  assert.notEqual(loaded, null);
  assert.deepEqual([loaded.quotes, loaded.contractorDeclarations], [[], []]);
  assert.deepEqual(loaded.invoices.map((invoice) => invoice.invoiceNumber), ['RE-2026-001']);
  assert.equal(isValidPersistedData(stored(loaded)), true);
  // An even older file with only the mandatory parts.
  assert.equal(isValidPersistedData({ schemaVersion: 1, settings: {}, invoices: [] }), true);
  assert.equal(isValidPersistedData({ schemaVersion: 1, settings: { language: 'de' }, invoices: [{ id: 'a' }], customers: [] }), true);
});

test('the recorded data set of the first release is still accepted', () => {
  const data = JSON.parse(fs.readFileSync('tests/runtime/fixtures/legacy-ae06259/payload.json', 'utf8'));
  assert.equal(isValidPersistedData(data), true);
  const loaded = parsePersistedData(JSON.stringify(data));
  assert.equal(loaded.invoices.length, data.invoices.length);
  assert.deepEqual([loaded.quotes, loaded.contractorDeclarations], [[], []]);
});

test('the envelope: schema version, settings and invoices are mandatory', () => {
  const data = baseSnapshot();
  for (const broken of [null, undefined, [], 'x', { ...data, schemaVersion: 2 }, { ...data, schemaVersion: '1' }, { ...data, schemaVersion: undefined }, { ...data, settings: undefined }, { ...data, settings: [] }, { ...data, invoices: undefined }, { ...data, invoices: {} }]) {
    assert.equal(isValidPersistedData(broken), false);
  }
  // Unknown additive fields of a newer version are kept, not rejected.
  assert.equal(isValidPersistedData({ ...data, futureCollection: [{ anything: true }], settings: { ...data.settings, futureFlag: 1 } }), true);
  assert.equal(isValidPersistedData(withInvoice({ futureField: { nested: [1, 2] } })), true);
});

test('Customer.reverseCharge', () => {
  check('customer.reverseCharge', (value) => withCustomer({ reverseCharge: value }), [true, false, undefined], NOT_BOOLEAN);
});

test('Invoice.projectReference', () => {
  check('projectReference', (value) => withInvoice({ projectReference: value }), ['BV Nord', '', 'Zeile 1\nZeile 2', undefined], NOT_STRING);
  check('texts.projectReferenceLabel', (value) => { const data = baseSnapshot(); data.invoices[0].texts.projectReferenceLabel = value; return data; }, ['Bauvorhaben', '', undefined], NOT_STRING);
  check('texts.serviceDateLabel', (value) => { const data = baseSnapshot(); data.invoices[0].texts.serviceDateLabel = value; return data; }, ['Leistungsdatum', undefined], NOT_STRING);
});

test('Invoice.reverseCharge', () => {
  check('reverseCharge', (value) => withInvoice({ reverseCharge: value }), [true, false, undefined], NOT_BOOLEAN);
});

test('Invoice.invoiceKind', () => {
  check('invoiceKind', (value) => withInvoice({ invoiceKind: value }), ['standard', 'advance', 'final', undefined], ['Final', 'abschlag', '', 1, null, true, ['final']]);
});

test('Invoice.advanceDeductions', () => {
  const deduction = (patch = {}) => ({ id: 'd1', invoiceId: 'inv-0', invoiceNumber: 'AR-1', invoiceDate: '2026-01-10', net: 1000, tax: 190, ...patch });
  check('advanceDeductions', (value) => withInvoice({ invoiceKind: 'final', advanceDeductions: value }), [
    undefined, [], [deduction()],
    [deduction(), deduction({ id: 'd2', invoiceId: undefined })],
    // A deduction typed in by hand starts empty; amounts may be zero, negative or have cents.
    [{ id: 'd3', invoiceNumber: '', invoiceDate: '', net: 0, tax: 0 }],
    [deduction({ net: -50.5, tax: 0 })],
    // Two deductions may point to the same advance invoice as long as their own ids differ.
    [deduction(), deduction({ id: 'd2' })],
  ], [
    null, {}, 'AR-1', [null], ['AR-1'], [[deduction()]],
    [deduction({ net: '1000' })], [deduction({ tax: null })], [deduction({ net: NaN })], [deduction({ tax: Infinity })],
    [deduction({ invoiceNumber: 7 })], [deduction({ invoiceDate: 20260110 })], [deduction({ invoiceId: 5 })], [deduction({ invoiceId: null })],
    [deduction({ id: 1 })], [deduction({ id: '' })],
    [deduction(), deduction()],
  ]);
  // Stored deductions are also accepted on an invoice that is not (or no longer) final.
  assert.equal(isValidPersistedData(withInvoice({ advanceDeductions: [deduction()] })), true);
});

test('Invoice.reminders', () => {
  const reminder = (patch = {}) => ({ id: 'r1', level: 1, date: '2026-04-01', dueDate: '2026-04-11', createdAt: '2026-04-01T08:00:00.000Z', ...patch });
  check('reminders', (value) => withInvoice({ reminders: value }), [
    undefined, [], [reminder()],
    [reminder(), reminder({ id: 'r2', level: 2, fee: 5 }), reminder({ id: 'r3', level: 3, fee: 7.5, text: 'letztmalig …\n\nbis {frist}' })],
    [reminder({ level: 3 }), reminder({ id: 'r2', level: 3 })],
    [reminder({ fee: undefined, text: undefined })], [reminder({ fee: 0 })], [reminder({ text: '' })],
  ], [
    null, {}, 'r1', [null], [reminder({ level: 0 })], [reminder({ level: 4 })], [reminder({ level: '1' })], [reminder({ level: 1.5 })], [reminder({ level: null })],
    [reminder({ date: 20260401 })], [reminder({ dueDate: null })], [reminder({ fee: '5' })], [reminder({ fee: NaN })], [reminder({ fee: null })],
    [reminder({ text: 5 })], [reminder({ createdAt: 1 })], [reminder({ id: '' })], [reminder({ id: 9 })],
    [reminder(), reminder()],
  ]);
});

test('Invoice.documentKind, quoteStatus and the links between quote and invoice', () => {
  check('documentKind', (value) => withQuote({ documentKind: value }), ['quote', undefined], ['invoice', 'Quote', '', true, null, 1]);
  check('quoteStatus', (value) => withQuote({ quoteStatus: value }), ['open', 'accepted', 'declined', undefined], ['Open', 'offen', 'converted', '', true, null, 0]);
  check('convertedInvoiceId', (value) => withQuote({ convertedInvoiceId: value }), ['inv-1', undefined], NOT_STRING);
  check('sourceQuoteId', (value) => withInvoice({ sourceQuoteId: value }), ['quo-1', 'a-quote-that-was-deleted', undefined], NOT_STRING);
  // The same optional fields are checked on records of the invoices collection.
  check('invoice.documentKind', (value) => withInvoice({ documentKind: value }), [undefined], ['invoice', null]);
  check('invoice.quoteStatus', (value) => withInvoice({ quoteStatus: value }), [undefined, 'open'], ['x', null]);
  check('invoice.convertedInvoiceId', (value) => withInvoice({ convertedInvoiceId: value }), [undefined, 'x'], NOT_STRING);
});

test('top-level quotes: a list of invoice-shaped records with their own ids', () => {
  const data = baseSnapshot();
  const quote = (patch = {}) => ({ ...data.invoices[0], id: 'quo-1', invoiceNumber: 'AN-2026-001', documentKind: 'quote', quoteStatus: 'open', ...patch });
  check('quotes', (value) => ({ ...baseSnapshot(), quotes: value }), [
    undefined, [], [quote()], [quote(), quote({ id: 'quo-2', quoteStatus: 'accepted', convertedInvoiceId: 'inv-1' })],
    // A quote and an invoice live in different collections, so an id may coincide.
    [quote({ id: 'inv-1' })],
    // A quote carries everything an invoice can carry.
    [quote({ projectReference: 'BV Nord', reverseCharge: true, einvoice: { taxCategory: 'AE', taxExemptionReason: documents.REVERSE_CHARGE_NOTE } })],
  ], [
    null, {}, 'quotes', [null], ['quo-1'], [[quote()]],
    [quote(), quote()], [quote({ id: '' })], [quote({ id: 5 })],
    [quote({ quoteStatus: 'sent' })], [quote({ documentKind: 'offer' })], [quote({ invoiceNumber: 12 })], [quote({ lineItems: {} })],
    [quote({ lineItems: [{ id: 'l1', type: 'item', quantity: '2' }] })], [quote({ texts: { documentTitle: 5 } })], [quote({ recipient: 'Bau GmbH' })],
    [quote({ reminders: [{ id: 'r', level: 9 }] })], [quote({ advanceDeductions: [{ id: 'd', net: 'x' }] })], [quote({ schemaVersion: 2 })],
  ]);
});

test('top-level contractorDeclarations', () => {
  check('contractorDeclarations', withDeclarations, [
    undefined, [], [declaration()], [declaration(), declaration({ id: 'dec-2', invoiceId: 'inv-1', customerId: 'cus-1' })],
    [declaration({ kommission: '', bodyText: '', senderAddress: '', recipientAddress: 'Zeile 1\nZeile 2' })],
    [declaration({ invoiceId: undefined, customerId: undefined })],
  ], [
    null, {}, 'x', [null], ['dec-1'], [declaration(), declaration()], [declaration({ id: '' })], [declaration({ id: 1 })],
    ...['date', 'senderAddress', 'recipientName', 'recipientAddress', 'kommission', 'bodyText', 'signatureName', 'invoiceId', 'customerId', 'createdAt', 'updatedAt']
      .flatMap((key) => [[declaration({ [key]: 5 })], [declaration({ [key]: null })], [declaration({ [key]: ['x'] })]]),
  ]);
});

test('settings.uiScale and settings.defaultPaymentTermDays', () => {
  check('uiScale', (value) => withSettings({ uiScale: value }), ['normal', 'large', 'xlarge', undefined], ['Large', 'huge', '', 1, 1.25, null, true]);
  check('defaultPaymentTermDays', (value) => withSettings({ defaultPaymentTermDays: value }), [0, 7, 14, 30, 365, undefined], [...NOT_NUMBER, NaN, Infinity]);
});

test('RecurringInvoice.anchorDay', () => {
  check('anchorDay', (value) => withRecurring({ anchorDay: value }), [1, 15, 28, 31, undefined], [...NOT_NUMBER, NaN, -Infinity]);
});

// ── What the app itself writes must always be accepted ─────────────────────────────────────────────────────────

/** Accepted both as the live object (undefined-valued keys, as sent to the storage worker) and as stored JSON. */
function assertWritable(data, label) {
  assert.equal(isValidPersistedData(data), true, `${label} (live object)`);
  assert.equal(isValidPersistedData(structuredClone(data)), true, `${label} (structured clone)`);
  assert.equal(isValidPersistedData(stored(data)), true, `${label} (JSON)`);
  const reloaded = parsePersistedData(JSON.stringify(data));
  assert.notEqual(reloaded, null, `${label} (reload)`);
  assert.equal(isValidPersistedData(stored(reloaded)), true, `${label} (saved again after reload)`);
  return reloaded;
}
function liveSnapshot() {
  const settings = { ...defaults.createDefaultSettings(), defaultPaymentTermDays: 14, uiScale: 'large', defaultEInvoice: { iban: 'DE02120300000000202051', bic: 'BYLADEM1001', accountName: 'Max GmbH', seller: { taxId: '12/345/67890', vatId: 'DE123456789' } } };
  const customer = { ...defaults.createDefaultCustomer(), name: 'Bau GmbH', reverseCharge: true };
  return { schemaVersion: 1, settings, invoices: [], customers: [customer], products: [], tags: [], creditNotes: [], recurringInvoices: [], templateVariants: [], quotes: [], contractorDeclarations: [] };
}

test('written by the app: new documents, quotes and their conversion', () => {
  const data = liveSnapshot();
  const quote = { ...documents.createQuoteFromDefaults(data.settings), invoiceNumber: 'AN-2026-001', customerId: data.customers[0].id, projectReference: 'BV Nord' };
  const invoice = documents.invoiceFromQuote(quote, data.settings, '2026-03-20');
  const accepted = { ...quote, quoteStatus: 'accepted', convertedInvoiceId: invoice.id };
  data.quotes = [accepted, defaults.duplicateInvoice(accepted), documents.createQuoteFromDefaults(data.settings)];
  data.invoices = [invoice, defaults.createInvoiceFromCustomer(data.settings, data.customers[0]), defaults.duplicateInvoice(invoice)];
  const reloaded = assertWritable(data, 'quotes');
  assert.deepEqual(reloaded.quotes.map((entry) => [entry.documentKind, entry.quoteStatus, entry.convertedInvoiceId]), [['quote', 'accepted', invoice.id], ['quote', 'open', undefined], ['quote', 'open', undefined]]);
  assert.equal(reloaded.invoices[0].sourceQuoteId, quote.id);
  assert.deepEqual([reloaded.settings.uiScale, reloaded.settings.defaultPaymentTermDays, reloaded.customers[0].reverseCharge], ['large', 14, true]);
});

test('written by the app: reverse charge switched on and off', () => {
  const data = liveSnapshot();
  const plain = { ...defaults.createInvoiceFromDefaults(data.settings), invoiceNumber: 'RE-1', lineItems: [item('a', 1, 100, 0.19)] };
  const on = documents.applyReverseCharge(plain, true, 0.19);
  const off = { ...documents.applyReverseCharge(on, false, 0.19), id: 'off' };
  const bare = { ...documents.applyReverseCharge({ ...plain, einvoice: undefined }, false, 0.19), id: 'bare' };
  data.invoices = [on, off, bare];
  const reloaded = assertWritable(data, 'reverse charge');
  assert.deepEqual(reloaded.invoices.map((entry) => entry.reverseCharge), [true, undefined, undefined]);
  assert.equal(reloaded.invoices[0].einvoice.taxCategory, 'AE');
});

test('written by the app: advance and final invoices, reminders, declarations, recurring schedule', () => {
  const data = liveSnapshot();
  const base = { ...defaults.createInvoiceFromCustomer(data.settings, data.customers[0]), lineItems: [item('a', 1, 1000, 0.19)] };
  const advance = documents.applyInvoiceKind({ ...base, id: 'adv', invoiceNumber: 'AR-1' }, 'advance', []);
  const final = documents.applyInvoiceKind({ ...base, id: 'fin', invoiceNumber: 'SR-1' }, 'final', [advance]);
  final.advanceDeductions = [...final.advanceDeductions, { id: defaults.newId(), invoiceNumber: '', invoiceDate: '', net: 0, tax: 0 }];
  const backToStandard = { ...documents.applyInvoiceKind(final, 'standard', [advance]), id: 'std' };
  const first = documents.createReminder(final, '2026-04-01');
  const second = { ...documents.createReminder({ reminders: [first] }, '2026-04-15'), fee: 5, text: documents.defaultReminderText(2) };
  const third = { ...documents.createReminder({ reminders: [first, second] }, '2026-05-01'), fee: undefined, text: undefined };
  final.reminders = [first, second, third];
  data.invoices = [advance, final, backToStandard];
  const declarationDefaults = { senderAddress: 'Max GmbH', recipientName: '', recipientAddress: '', kommission: '', signatureName: 'Max' };
  data.contractorDeclarations = [documents.createDeclaration(declarationDefaults), documents.declarationFromInvoice(final, declarationDefaults), documents.declarationFromInvoice({ ...final, customerId: undefined, projectReference: undefined }, declarationDefaults)];
  data.recurringInvoices = [{ ...defaults.createDefaultRecurringInvoice(data.settings), anchorDay: 31 }, { ...defaults.createDefaultRecurringInvoice(data.settings), anchorDay: undefined }];
  const reloaded = assertWritable(data, 'kinds');
  assert.equal(final.advanceDeductions.length, 2);
  assert.deepEqual(reloaded.invoices.map((entry) => [entry.invoiceKind, entry.advanceDeductions?.length, entry.reminders?.length]), [['advance', undefined, undefined], ['final', 2, 3], [undefined, 2, undefined]]);
  assert.deepEqual(reloaded.invoices[1].reminders.map((entry) => [entry.level, entry.fee]), [[1, undefined], [2, 5], [3, undefined]]);
  assert.deepEqual(reloaded.contractorDeclarations.map((entry) => [entry.invoiceId, entry.kommission]), [[undefined, ''], ['fin', ''], ['fin', '']]);
  assert.deepEqual(reloaded.recurringInvoices.map((entry) => entry.anchorDay), [31, undefined]);
});

test('a reload keeps every 1.3 field exactly as stored', () => {
  const data = baseSnapshot();
  Object.assign(data.invoices[0], {
    projectReference: 'BV Nord', reverseCharge: true, invoiceKind: 'final', sourceQuoteId: 'quo-1',
    advanceDeductions: [{ id: 'd1', invoiceId: 'inv-0', invoiceNumber: 'AR-1', invoiceDate: '2026-01-10', net: 1000, tax: 190 }],
    reminders: [{ id: 'r1', level: 2, date: '2026-04-01', dueDate: '2026-04-11', fee: 5, text: 'Text', createdAt: '2026-04-01T08:00:00.000Z' }],
  });
  data.quotes = [{ ...data.invoices[0], id: 'quo-1', documentKind: 'quote', quoteStatus: 'accepted', convertedInvoiceId: 'inv-1', sourceQuoteId: undefined }];
  data.contractorDeclarations = [declaration({ invoiceId: 'inv-1', customerId: 'cus-1' })];
  data.customers[0].reverseCharge = true;
  data.recurringInvoices[0].anchorDay = 31;
  Object.assign(data.settings, { uiScale: 'xlarge', defaultPaymentTermDays: 30 });
  const expected = stored(data);
  assert.equal(isValidPersistedData(expected), true);
  const reloaded = stored(parsePersistedData(JSON.stringify(expected)));
  const pick = (record, keys) => Object.fromEntries(keys.map((key) => [key, record[key]]));
  const documentKeys = ['id', 'projectReference', 'reverseCharge', 'invoiceKind', 'advanceDeductions', 'reminders', 'documentKind', 'quoteStatus', 'convertedInvoiceId', 'sourceQuoteId'];
  assert.deepEqual(pick(reloaded.invoices[0], documentKeys), pick(expected.invoices[0], documentKeys));
  assert.deepEqual(pick(reloaded.quotes[0], documentKeys), pick(expected.quotes[0], documentKeys));
  assert.equal(reloaded.invoices[0].documentKind, undefined);
  assert.deepEqual(reloaded.contractorDeclarations, expected.contractorDeclarations);
  assert.deepEqual(reloaded.customers, expected.customers);
  assert.equal(reloaded.recurringInvoices[0].anchorDay, 31);
  assert.deepEqual([reloaded.settings.uiScale, reloaded.settings.defaultPaymentTermDays], ['xlarge', 30]);
  // Loading twice changes nothing more.
  assert.deepEqual(stored(parsePersistedData(JSON.stringify(reloaded))), reloaded);
});
