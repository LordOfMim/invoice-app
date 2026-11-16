'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { isValidPersistedData } = require('../../electron/storage-validation.cjs');

const KEY = 'invoice-app:v1';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SELLER = { seller: { taxId: '12/345/67890', vatId: 'DE123456789', city: 'Köln' }, iban: 'DE02120300000000202051', bic: 'BYLADEM1001', accountName: 'Meister Müller' };

/**
 * A fresh store module with an adapter that checks every snapshot it is handed: a snapshot the validator rejects
 * would block the app at its next start, so each test ends with `env.assertValid()`.
 */
function setup(seed = {}) {
  const load = createLoader();
  const store = load('src/lib/storage/store.ts');
  const values = new Map(); const invalid = []; let writes = 0;
  const storage = {
    values,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (key === KEY) { writes++; if (!isValidPersistedData(JSON.parse(value))) invalid.push(value); }
      values.set(key, value);
    },
  };
  values.set(KEY, JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [], ...seed }));
  const data = store.loadData(storage);
  return {
    load, store, storage, initial: data,
    date: load('src/lib/date.ts'), documents: load('src/lib/documents.ts'),
    data: () => store.loadData(storage),
    persisted: () => JSON.parse(values.get(KEY)),
    writes: () => writes,
    assertValid() {
      assert.equal(invalid.length, 0, 'a persisted snapshot was rejected by isValidPersistedData');
      assert.equal(isValidPersistedData(JSON.parse(values.get(KEY))), true, 'persisted snapshot must validate');
      assert.equal(isValidPersistedData(store.loadData(storage)), true, 'in-memory snapshot must validate');
      // What is on disk must come back through the real startup parser.
      assert.ok(store.parsePersistedData(values.get(KEY)), 'persisted snapshot must be readable at the next start');
    },
  };
}
const line = (id, unitPrice = 100, extra = {}) => ({ id, type: 'item', description: `Position ${id}`, quantity: 1, unitPrice, taxRate: 0.19, ...extra });
function recurring(overrides = {}) {
  return { id: 'rec-1', name: 'Wartung Heizung', frequency: 'monthly', nextRunDate: '2026-01-31', active: true, autoGenerate: true, reminderDays: 7,
    sender: { name: 'Meister Müller', address: 'Werkstr. 1\n50667 Köln', contact: '' }, recipient: { name: 'Kunde Schäfer', address: 'Am Hang 2', contact: '' },
    customerId: 'cust-1', lineItems: [line('rl-1', 80)], footerText: 'Fuß', currency: 'EUR', ...overrides };
}

// ─── createInvoice ──────────────────────────────────────────────────────────

test('createInvoice: tax number, VAT ID and bank details come from settings.defaultEInvoice, due date from the payment term', () => {
  const env = setup({ settings: { defaultEInvoice: SELLER, defaultPaymentTermDays: 14 } });
  const invoice = env.store.createInvoice(env.storage);
  const today = env.date.todayLocalISO();
  assert.equal(invoice.einvoice.seller.taxId, SELLER.seller.taxId);
  assert.equal(invoice.einvoice.seller.vatId, SELLER.seller.vatId);
  assert.equal(invoice.einvoice.iban, SELLER.iban);
  assert.equal(invoice.einvoice.bic, SELLER.bic);
  assert.equal(invoice.einvoice.accountName, SELLER.accountName);
  assert.equal(invoice.invoiceDate, today);
  assert.equal(invoice.dueDate, env.date.addDays(today, 14));
  assert.equal(invoice.invoiceNumber, '');
  assert.equal(invoice.documentKind, undefined);
  assert.equal(env.data().invoices[0], invoice);
  assert.equal(env.persisted().invoices[0].einvoice.iban, SELLER.iban);
  // The invoice owns its copy: editing it must not reach into the settings.
  assert.notEqual(invoice.einvoice, env.data().settings.defaultEInvoice);
  assert.notEqual(invoice.einvoice.seller, env.data().settings.defaultEInvoice.seller);
  env.assertValid();
});

test('createInvoice without seller defaults or payment term: no einvoice block, due on the invoice date', () => {
  const env = setup();
  const invoice = env.store.createInvoice(env.storage);
  assert.equal(invoice.einvoice, undefined);
  assert.equal(invoice.dueDate, invoice.invoiceDate);
  assert.equal('einvoice' in env.persisted().invoices[0], false);
  env.assertValid();
});

test('payment term: zero, negative and non-numeric mean "same day"; fractional values are rounded', () => {
  const { load } = setup();
  const { dueDateFor } = load('src/lib/defaults.ts');
  for (const days of [0, -5, undefined, NaN, Infinity]) assert.equal(dueDateFor('2026-01-31', { defaultPaymentTermDays: days }), '2026-01-31', String(days));
  assert.equal(dueDateFor('2026-01-31', { defaultPaymentTermDays: 30 }), '2026-03-02');
  assert.equal(dueDateFor('2024-01-31', { defaultPaymentTermDays: 30 }), '2024-03-01');
  assert.equal(dueDateFor('2026-03-20', { defaultPaymentTermDays: 14 }), '2026-04-03', 'across the clock change');
  assert.equal(dueDateFor('2026-12-20', { defaultPaymentTermDays: 13.6 }), '2027-01-03');
});

test('createInvoice from a template invoice: missing seller details are filled, existing ones win, links and money state are not copied', () => {
  const template = { id: 'tpl', invoiceNumber: 'RE-ALT-7', invoiceDate: '2025-03-01', dueDate: '2025-03-15', paid: true,
    lineItems: [line('tl-1')], payments: [{ id: 'p1', amount: 119, date: '2025-03-02' }],
    einvoice: { iban: 'DE00ALTESKONTO', seller: { taxId: '' }, unitCodes: { 'tl-1': 'HUR' }, serviceDate: '2025-02-28' },
    sourceQuoteId: 'q-old', invoiceKind: 'final', advanceDeductions: [{ id: 'd1', invoiceId: 'gone', invoiceNumber: 'AB-1', invoiceDate: '2025-01-01', net: 10, tax: 1.9 }],
    reminders: [{ id: 'r1', level: 1, date: '2025-04-01', dueDate: '2025-04-11', createdAt: '2025-04-01T08:00:00.000Z' }] };
  const env = setup({ settings: { defaultEInvoice: SELLER, defaultPaymentTermDays: 10, defaultInvoiceId: 'tpl' }, invoices: [template] });
  const invoice = env.store.createInvoice(env.storage);
  const today = env.date.todayLocalISO();
  assert.notEqual(invoice.id, 'tpl');
  assert.equal(invoice.invoiceNumber, '');
  assert.equal(invoice.invoiceDate, today);
  assert.equal(invoice.dueDate, env.date.addDays(today, 10));
  assert.equal(invoice.einvoice.iban, 'DE00ALTESKONTO', 'a value already on the document wins');
  assert.equal(invoice.einvoice.seller.taxId, SELLER.seller.taxId);
  assert.equal(invoice.einvoice.seller.vatId, SELLER.seller.vatId);
  assert.equal(invoice.einvoice.bic, SELLER.bic);
  assert.equal(invoice.einvoice.serviceDate, undefined);
  assert.deepEqual(Object.values(invoice.einvoice.unitCodes), ['HUR']);
  assert.deepEqual(Object.keys(invoice.einvoice.unitCodes), [invoice.lineItems[0].id]);
  assert.notEqual(invoice.lineItems[0].id, 'tl-1');
  assert.equal(invoice.paid, false);
  assert.deepEqual(invoice.payments, []);
  assert.equal(invoice.sourceQuoteId, undefined);
  assert.equal(invoice.advanceDeductions, undefined);
  assert.equal(invoice.reminders, undefined);
  assert.equal(env.data().invoices.length, 2);
  assert.equal(env.data().invoices.find(inv => inv.id === 'tpl').invoiceNumber, 'RE-ALT-7');
  env.assertValid();
});

test('withSellerDefaults and lacksSellerDefaults: fill only gaps, return the same object when nothing is missing', () => {
  const { documents } = setup();
  const settings = { defaultEInvoice: SELLER };
  const complete = { einvoice: structuredClone(SELLER) };
  assert.equal(documents.lacksSellerDefaults(complete, settings), false);
  assert.equal(documents.withSellerDefaults(complete, settings), complete);
  const bare = { id: 'x' };
  assert.equal(documents.withSellerDefaults(bare, undefined), bare);
  assert.equal(documents.withSellerDefaults(bare, {}), bare);
  const partial = { einvoice: { iban: '  ', bic: 'OWNBIC', seller: { vatId: 'DE999' }, buyerReference: 'keep' } };
  assert.equal(documents.lacksSellerDefaults(partial, settings), true);
  const filled = documents.withSellerDefaults(partial, settings);
  assert.equal(filled.einvoice.iban, SELLER.iban, 'blank counts as missing');
  assert.equal(filled.einvoice.bic, 'OWNBIC');
  assert.equal(filled.einvoice.seller.vatId, 'DE999');
  assert.equal(filled.einvoice.seller.taxId, SELLER.seller.taxId);
  assert.equal(filled.einvoice.buyerReference, 'keep');
  assert.equal(partial.einvoice.iban, '  ', 'the input is not mutated');
  assert.equal(filled.einvoice.seller.city, undefined, 'only tax numbers and bank details are defaults here');
});

// ─── Quotes ─────────────────────────────────────────────────────────────────

test('createQuote: lands in quotes only, open, valid for 30 days, with quote wording and seller details', () => {
  const env = setup({ settings: { defaultEInvoice: SELLER, defaultPaymentTermDays: 14 } });
  const quote = env.store.createQuote(env.storage);
  assert.equal(quote.documentKind, 'quote');
  assert.equal(quote.quoteStatus, 'open');
  assert.equal(quote.dueDate, env.date.addDays(quote.invoiceDate, env.documents.QUOTE_VALIDITY_DAYS));
  assert.equal(quote.texts.documentTitle, 'Angebot');
  assert.equal(quote.texts.invoiceNumberLabel, 'Angebotsnummer');
  assert.equal(quote.texts.dueDateLabel, 'Gültig bis');
  assert.equal(quote.einvoice.iban, SELLER.iban);
  assert.deepEqual(env.data().quotes.map(item => item.id), [quote.id]);
  assert.deepEqual(env.data().invoices, []);
  assert.equal(env.store.getInvoice(env.storage, quote.id), null, 'a quote is not an invoice');
  env.assertValid();
});

test('createQuote works on data from before 1.3 that has no quotes collection at all', () => {
  const env = setup();
  assert.deepEqual(env.initial.quotes, []);
  env.store.createQuote(env.storage);
  env.store.createQuote(env.storage);
  assert.equal(env.data().quotes.length, 2);
  assert.notEqual(env.data().quotes[0].id, env.data().quotes[1].id);
  env.assertValid();
});

test('quotes are edited through updateInvoice/upsertInvoice with the "quotes" collection and never leak into invoices', () => {
  const env = setup();
  const quote = env.store.createQuote(env.storage);
  const updated = env.store.updateInvoice(env.storage, quote.id, prev => ({ ...prev, invoiceNumber: 'AN-2026-001', quoteStatus: 'declined' }), 'quotes');
  assert.equal(updated.invoiceNumber, 'AN-2026-001');
  assert.equal(env.store.updateInvoice(env.storage, quote.id, prev => ({ ...prev, notesText: 'x' })), null, 'not found among invoices');
  env.store.upsertInvoice(env.storage, { ...updated, notesText: 'Notiz' }, 'quotes');
  assert.equal(env.data().quotes.length, 1);
  assert.equal(env.data().quotes[0].notesText, 'Notiz');
  assert.equal(env.data().quotes[0].quoteStatus, 'declined');
  assert.equal(env.data().invoices.length, 0);
  env.assertValid();
});

test('duplicateQuoteById: an independent open quote without number or conversion link; unknown id changes nothing', () => {
  const env = setup({ quotes: [{ id: 'q1', documentKind: 'quote', quoteStatus: 'accepted', convertedInvoiceId: 'inv-9', invoiceNumber: 'AN-1', invoiceDate: '2026-01-10', dueDate: '2026-02-09',
    recipient: { name: 'Kunde Schäfer', address: 'Am Hang 2', contact: '' }, customerId: 'cust-1', lineItems: [line('ql-1'), line('ql-2', 50)],
    einvoice: { unitCodes: { 'ql-2': 'MTR' } }, attachments: [{ id: 'a1', name: 'plan.pdf', type: 'application/pdf', size: 3, dataUrl: 'data:application/pdf;base64,AAAA' }] }] });
  const writes = env.writes();
  assert.equal(env.store.duplicateQuoteById(env.storage, 'missing'), null);
  assert.equal(env.writes(), writes);
  const copy = env.store.duplicateQuoteById(env.storage, 'q1');
  assert.notEqual(copy.id, 'q1');
  assert.equal(copy.documentKind, 'quote');
  assert.equal(copy.quoteStatus, 'open');
  assert.equal(copy.convertedInvoiceId, undefined);
  assert.equal(copy.invoiceNumber, '');
  assert.equal(copy.customerId, 'cust-1');
  assert.deepEqual(copy.lineItems.map(item => item.description), ['Position ql-1', 'Position ql-2']);
  assert.equal(copy.lineItems.some(item => item.id === 'ql-1' || item.id === 'ql-2'), false);
  assert.deepEqual(copy.einvoice.unitCodes, { [copy.lineItems[1].id]: 'MTR' });
  assert.deepEqual(copy.attachments, []);
  assert.deepEqual(env.data().quotes.map(item => item.id), [copy.id, 'q1']);
  const original = env.data().quotes[1];
  assert.equal(original.quoteStatus, 'accepted');
  assert.equal(original.convertedInvoiceId, 'inv-9');
  assert.equal(original.attachments.length, 1);
  assert.equal(env.data().invoices.length, 0);
  env.assertValid();
});

test('convertQuoteToInvoice: quote stays and is linked, invoice is a clean unnumbered invoice with a back reference', () => {
  const env = setup({ settings: { defaultEInvoice: SELLER, defaultPaymentTermDays: 14 }, quotes: [{ id: 'q1', documentKind: 'quote', quoteStatus: 'open', invoiceNumber: 'AN-2026-004',
    invoiceDate: '2026-01-10', dueDate: '2026-02-09', recipient: { name: 'Kunde Schäfer', address: 'Am Hang 2', contact: '' }, customerId: 'cust-1',
    projectReference: 'Bad Schäfer', reverseCharge: true, notesText: 'Notiz', tagIds: ['t1'], lineItems: [line('ql-1', 250), line('ql-2', 50)],
    texts: { documentTitle: 'Angebot', invoiceNumberLabel: 'Angebotsnummer', invoiceDateLabel: 'Angebotsdatum', dueDateLabel: 'Bindefrist' },
    einvoice: { unitCodes: { 'ql-1': 'HUR' }, buyerReference: 'L-1' },
    attachments: [{ id: 'a1', name: 'plan.pdf', type: 'application/pdf', size: 3, dataUrl: 'data:application/pdf;base64,AAAA' }] }] });
  const today = env.date.todayLocalISO();
  const invoice = env.store.convertQuoteToInvoice(env.storage, 'q1');
  const data = env.data();

  assert.deepEqual(data.invoices.map(item => item.id), [invoice.id]);
  assert.notEqual(invoice.id, 'q1');
  assert.equal(invoice.sourceQuoteId, 'q1');
  assert.equal(invoice.invoiceNumber, '');
  assert.equal(invoice.documentKind, undefined);
  assert.equal(invoice.quoteStatus, undefined);
  assert.equal(invoice.convertedInvoiceId, undefined);
  assert.equal(invoice.invoiceDate, today);
  assert.equal(invoice.dueDate, env.date.addDays(today, 14));
  assert.equal(invoice.paid, false);
  assert.deepEqual(invoice.payments, []);
  assert.deepEqual(invoice.attachments, []);
  assert.equal(invoice.customerId, 'cust-1');
  assert.equal(invoice.projectReference, 'Bad Schäfer');
  assert.equal(invoice.reverseCharge, true);
  assert.equal(invoice.notesText, 'Notiz');
  assert.deepEqual(invoice.lineItems.map(item => [item.description, item.unitPrice]), [['Position ql-1', 250], ['Position ql-2', 50]]);
  assert.deepEqual(invoice.einvoice.unitCodes, { [invoice.lineItems[0].id]: 'HUR' });
  assert.equal(invoice.einvoice.buyerReference, 'L-1');
  assert.equal(invoice.einvoice.iban, SELLER.iban);
  assert.equal(invoice.einvoice.seller.taxId, SELLER.seller.taxId);
  // Standard quote wording becomes invoice wording; wording the user changed stays.
  assert.equal(invoice.texts.documentTitle, 'Rechnung');
  assert.equal(invoice.texts.invoiceNumberLabel, 'Rechnungsnummer');
  assert.equal(invoice.texts.invoiceDateLabel, 'Rechnungsdatum');
  assert.equal(invoice.texts.dueDateLabel, 'Bindefrist');

  const persisted = env.persisted().invoices[0];
  for (const key of ['documentKind', 'quoteStatus', 'convertedInvoiceId', 'reminders']) assert.equal(key in persisted, false, `${key} must not be persisted on the invoice`);
  assert.equal(persisted.sourceQuoteId, 'q1');

  assert.equal(data.quotes.length, 1);
  const quote = data.quotes[0];
  assert.equal(quote.id, 'q1');
  assert.equal(quote.convertedInvoiceId, invoice.id);
  assert.equal(quote.quoteStatus, 'accepted');
  assert.equal(quote.documentKind, 'quote');
  assert.equal(quote.invoiceNumber, 'AN-2026-004');
  assert.equal(quote.invoiceDate, '2026-01-10');
  assert.equal(quote.texts.documentTitle, 'Angebot');
  assert.equal(quote.attachments.length, 1);
  assert.deepEqual(quote.lineItems.map(item => item.id), ['ql-1', 'ql-2']);
  env.assertValid();
});

test('convertQuoteToInvoice twice returns the existing invoice instead of creating a second one; unknown quote is null', () => {
  const env = setup({ quotes: [{ id: 'q1', documentKind: 'quote', quoteStatus: 'open', lineItems: [line('ql-1')] }] });
  assert.equal(env.store.convertQuoteToInvoice(env.storage, 'missing'), null);
  const first = env.store.convertQuoteToInvoice(env.storage, 'q1');
  const writes = env.writes();
  const second = env.store.convertQuoteToInvoice(env.storage, 'q1');
  assert.equal(second.id, first.id);
  assert.equal(env.data().invoices.length, 1);
  assert.equal(env.writes(), writes, 'the repeated call writes nothing');
  // Edits to the invoice are what the second call hands back.
  env.store.updateInvoice(env.storage, first.id, prev => ({ ...prev, invoiceNumber: 'RE-1' }));
  assert.equal(env.store.convertQuoteToInvoice(env.storage, 'q1').invoiceNumber, 'RE-1');
  assert.equal(env.data().invoices.length, 1);
  env.assertValid();
});

test('deleting the converted invoice releases the quote: no dangling link, and it can be converted again', () => {
  const env = setup({ quotes: [{ id: 'q1', documentKind: 'quote', quoteStatus: 'open', lineItems: [line('ql-1')] }, { id: 'q2', documentKind: 'quote', quoteStatus: 'open', convertedInvoiceId: 'other', lineItems: [] }] });
  const first = env.store.convertQuoteToInvoice(env.storage, 'q1');
  env.store.deleteInvoice(env.storage, first.id);
  const quote = env.data().quotes.find(item => item.id === 'q1');
  assert.equal(quote.convertedInvoiceId, undefined);
  assert.equal('convertedInvoiceId' in env.persisted().quotes.find(item => item.id === 'q1'), false);
  assert.equal(env.data().quotes.find(item => item.id === 'q2').convertedInvoiceId, 'other', 'other quotes are untouched');
  assert.equal(env.data().invoices.length, 0);
  env.assertValid();

  const second = env.store.convertQuoteToInvoice(env.storage, 'q1');
  assert.notEqual(second.id, first.id);
  assert.equal(second.sourceQuoteId, 'q1');
  assert.equal(env.data().quotes.find(item => item.id === 'q1').convertedInvoiceId, second.id);
  assert.equal(env.data().invoices.length, 1);
  env.assertValid();
});

test('a quote whose convertedInvoiceId points to an invoice that no longer exists (old backup) is converted afresh', () => {
  const env = setup({ quotes: [{ id: 'q1', documentKind: 'quote', quoteStatus: 'accepted', convertedInvoiceId: 'vanished', lineItems: [line('ql-1')] }] });
  const invoice = env.store.convertQuoteToInvoice(env.storage, 'q1');
  assert.ok(invoice);
  assert.equal(env.data().quotes[0].convertedInvoiceId, invoice.id);
  assert.equal(env.data().invoices.length, 1);
  env.assertValid();
});

test('deleteQuote: the invoice made from it stays and loses only its back reference', () => {
  const env = setup({ quotes: [{ id: 'q1', documentKind: 'quote', quoteStatus: 'open', lineItems: [line('ql-1')] }, { id: 'q2', documentKind: 'quote', quoteStatus: 'open', lineItems: [] }] });
  const invoice = env.store.convertQuoteToInvoice(env.storage, 'q1');
  env.store.updateInvoice(env.storage, invoice.id, prev => ({ ...prev, invoiceNumber: 'RE-5' }));
  env.store.deleteQuote(env.storage, 'q1');
  assert.deepEqual(env.data().quotes.map(item => item.id), ['q2']);
  assert.equal(env.data().invoices.length, 1);
  assert.equal(env.data().invoices[0].invoiceNumber, 'RE-5');
  assert.equal(env.data().invoices[0].sourceQuoteId, undefined);
  assert.equal('sourceQuoteId' in env.persisted().invoices[0], false);
  env.store.deleteQuote(env.storage, 'missing');
  assert.deepEqual(env.data().quotes.map(item => item.id), ['q2']);
  env.assertValid();
});

test('a quote and an invoice may share an id without being confused (ids are scoped per collection)', () => {
  const env = setup({ invoices: [{ id: 'same', invoiceNumber: 'RE-1', lineItems: [] }], quotes: [{ id: 'same', documentKind: 'quote', invoiceNumber: 'AN-1', lineItems: [] }] });
  env.store.deleteQuote(env.storage, 'same');
  assert.equal(env.data().invoices.length, 1);
  assert.equal(env.data().invoices[0].invoiceNumber, 'RE-1');
  assert.equal(env.data().quotes.length, 0);
  env.assertValid();
});

// ─── Contractor declarations ────────────────────────────────────────────────

const DEFAULTS = { senderAddress: 'Meister Müller · Werkstr. 1 · 50667 Köln', recipientName: '', recipientAddress: '', kommission: '', signatureName: 'Jörg Müller' };

test('declarations: create from defaults, add, update, delete', () => {
  const env = setup();
  assert.deepEqual(env.initial.contractorDeclarations, []);
  const created = env.store.createDeclarationFromDefaults(env.storage, DEFAULTS);
  assert.equal(created.date, env.date.todayLocalISO());
  assert.equal(created.senderAddress, DEFAULTS.senderAddress);
  assert.equal(created.signatureName, 'Jörg Müller');
  assert.equal(created.bodyText, env.documents.DECLARATION_BODY_TEXT);
  assert.equal(created.invoiceId, undefined);
  assert.ok(created.id && created.createdAt && created.updatedAt);
  env.assertValid();

  const added = env.store.addDeclaration(env.storage, { ...env.documents.createDeclaration(DEFAULTS, '2026-02-28'), kommission: 'Dachsanierung Weiß' });
  assert.equal(added.date, '2026-02-28');
  assert.deepEqual(env.data().contractorDeclarations.map(item => item.id), [added.id, created.id], 'newest first');
  env.assertValid();

  const updated = env.store.updateDeclaration(env.storage, created.id, prev => ({ ...prev, recipientName: 'Bauträger Groß GmbH', kommission: 'Straße 5 – Bäder' }));
  assert.equal(updated.recipientName, 'Bauträger Groß GmbH');
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(env.data().contractorDeclarations[1], updated);
  assert.equal(env.data().contractorDeclarations[0], added, 'other declarations keep their identity');
  assert.equal(env.persisted().contractorDeclarations[1].kommission, 'Straße 5 – Bäder');
  env.assertValid();

  const writes = env.writes();
  assert.equal(env.store.updateDeclaration(env.storage, created.id, prev => ({ ...prev })), updated, 'a no-op update returns the stored record');
  assert.equal(env.store.updateDeclaration(env.storage, 'missing', prev => ({ ...prev, kommission: 'x' })), null);
  assert.equal(env.writes(), writes, 'neither writes');

  env.store.deleteDeclaration(env.storage, created.id);
  assert.deepEqual(env.data().contractorDeclarations.map(item => item.id), [added.id]);
  env.store.deleteDeclaration(env.storage, 'missing');
  assert.equal(env.data().contractorDeclarations.length, 1);
  env.assertValid();
});

test('declarationFromInvoice takes recipient, project and sender from the invoice and stores cleanly', () => {
  const env = setup({ invoices: [
    { id: 'inv-1', invoiceNumber: 'RE-1', customerId: 'cust-1', projectReference: '  Bad Schäfer  ', sender: { name: 'Meister Müller', address: 'Werkstr. 1\r\n50667 Köln', contact: '' }, recipient: { name: 'Kunde Schäfer', address: 'Am Hang 2\n50668 Köln', contact: '' }, lineItems: [] },
    { id: 'inv-2', invoiceNumber: 'RE-2', sender: { name: '', address: '', contact: '' }, recipient: { name: '', address: '', contact: '' }, lineItems: [] },
  ] });
  const [full, empty] = env.data().invoices;
  const first = env.store.addDeclaration(env.storage, env.documents.declarationFromInvoice(full, DEFAULTS, '2026-03-01'));
  assert.equal(first.invoiceId, 'inv-1');
  assert.equal(first.customerId, 'cust-1');
  assert.equal(first.kommission, 'Bad Schäfer');
  assert.equal(first.recipientName, 'Kunde Schäfer');
  assert.equal(first.recipientAddress, 'Am Hang 2\n50668 Köln');
  assert.equal(first.senderAddress, 'Meister Müller · Werkstr. 1 · 50667 Köln');
  assert.equal(first.signatureName, 'Meister Müller');
  // An invoice without sender, project or customer falls back to the defaults and must still be storable.
  const second = env.store.addDeclaration(env.storage, env.documents.declarationFromInvoice(empty, DEFAULTS, '2026-03-01'));
  assert.equal(second.senderAddress, DEFAULTS.senderAddress);
  assert.equal(second.signatureName, 'Jörg Müller');
  assert.equal(second.kommission, '');
  assert.equal(second.customerId, undefined);
  env.assertValid();
});

// ─── Recurring invoices ─────────────────────────────────────────────────────

/** Call the automatic run once per given day and collect the dates of the invoices each call created. */
const runOn = (env, days) => days.map(day => env.store.runDueRecurringInvoices(env.storage, day).flatMap(run => run.invoices.map(inv => inv.invoiceDate)));

test('runDueRecurringInvoices: a schedule several months behind gets one draft for the most recent due date, the rest is skipped', () => {
  const env = setup({ settings: { defaultEInvoice: SELLER, defaultPaymentTermDays: 14 }, recurringInvoices: [recurring()] });
  const runs = env.store.runDueRecurringInvoices(env.storage, '2026-05-15');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].recurring.id, 'rec-1');
  assert.equal(runs[0].recurring.nextRunDate, '2026-01-31', 'the schedule as it was before the run');
  assert.deepEqual(runs[0].invoices.map(inv => inv.invoiceDate), ['2026-04-30']);
  assert.deepEqual([runs[0].runDate, runs[0].skippedRuns, runs[0].dueSince, runs[0].existingInvoice], ['2026-04-30', 3, '2026-01-31', undefined]);
  const data = env.data();
  assert.equal(data.invoices.length, 1);
  const invoice = data.invoices[0];
  assert.equal(invoice.id, runs[0].invoices[0].id);
  assert.equal(invoice.invoiceNumber, '', 'the user assigns the number');
  assert.equal(invoice.recurringInvoiceId, 'rec-1');
  assert.equal(invoice.customerId, 'cust-1');
  assert.equal(invoice.recipient.name, 'Kunde Schäfer');
  assert.equal(invoice.paid, false);
  assert.equal(invoice.dueDate, '2026-05-14');
  assert.equal(invoice.einvoice.iban, SELLER.iban);
  assert.equal(invoice.lineItems.length, 1);
  assert.notEqual(invoice.lineItems[0].id, 'rl-1');
  assert.equal(invoice.lineItems[0].unitPrice, 80);
  const schedule = data.recurringInvoices[0];
  assert.equal(schedule.nextRunDate, '2026-05-31', 'the first date after today, back on the 31st');
  assert.equal(schedule.lastRunDate, '2026-04-30');
  assert.equal(schedule.anchorDay, 31);
  assert.equal(schedule.lineItems[0].id, 'rl-1', 'the template itself is unchanged');
  env.assertValid();
});

test('a schedule years behind (the 1.2 switch that never ran) creates one invoice, once, and no back-dated pile', () => {
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: '2015-01-15' })] });
  const runs = env.store.runDueRecurringInvoices(env.storage, '2026-11-16');
  assert.deepEqual(runs.map(run => [run.invoices.map(inv => inv.invoiceDate), run.runDate, run.skippedRuns, run.dueSince]), [[['2026-11-15'], '2026-11-15', 142, '2015-01-15']]);
  assert.deepEqual(env.data().invoices.map(inv => inv.invoiceDate), ['2026-11-15']);
  assert.deepEqual([env.data().recurringInvoices[0].lastRunDate, env.data().recurringInvoices[0].nextRunDate, env.data().recurringInvoices[0].anchorDay], ['2026-11-15', '2026-12-15', 15]);
  // Every further page load on that day, and a fresh start, finds nothing to do.
  const snapshot = env.data(); const writes = env.writes();
  for (let load = 0; load < 5; load++) assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-11-16'), []);
  env.store.clearDataCache();
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-12-14'), []);
  assert.equal(env.writes(), writes);
  assert.equal(env.data().invoices.length, snapshot.invoices.length);
  // From here on the schedule runs normally: one invoice per period, nothing skipped.
  const next = env.store.runDueRecurringInvoices(env.storage, '2026-12-15');
  assert.deepEqual(next.map(run => [run.invoices.map(inv => inv.invoiceDate), run.skippedRuns, run.dueSince]), [[['2026-12-15'], 0, undefined]]);
  env.assertValid();
});

test('the most recent due date: today before, on and after the day of the month, for every frequency', () => {
  const latest = (overrides, today) => {
    const env = setup({ recurringInvoices: [recurring(overrides)] });
    const runs = env.store.runDueRecurringInvoices(env.storage, today);
    assert.ok(runs.length <= 1 && env.data().invoices.length <= 1, 'never more than one invoice per schedule and call');
    env.assertValid();
    return runs.length ? [runs[0].runDate, runs[0].skippedRuns, env.data().recurringInvoices[0].nextRunDate] : null;
  };
  assert.deepEqual(latest({ nextRunDate: '2024-02-01' }, '2026-11-16'), ['2026-11-01', 33, '2026-12-01']);
  assert.deepEqual(latest({ nextRunDate: '2026-01-20' }, '2026-03-19'), ['2026-02-20', 1, '2026-03-20']);
  assert.deepEqual(latest({ nextRunDate: '2026-01-20' }, '2026-03-20'), ['2026-03-20', 2, '2026-04-20']);
  assert.deepEqual(latest({ nextRunDate: '2026-01-20' }, '2026-03-21'), ['2026-03-20', 2, '2026-04-20']);
  assert.deepEqual(latest({ nextRunDate: '2026-01-20' }, '2026-02-19'), ['2026-01-20', 0, '2026-02-20']);
  // The 31st in short months: 28 February is the due date, and the schedule returns to the 31st.
  assert.deepEqual(latest({ nextRunDate: '2025-10-31' }, '2026-02-27'), ['2026-01-31', 3, '2026-02-28']);
  assert.deepEqual(latest({ nextRunDate: '2025-10-31' }, '2026-02-28'), ['2026-02-28', 4, '2026-03-31']);
  assert.deepEqual(latest({ nextRunDate: '2026-02-28', anchorDay: 30 }, '2026-04-29'), ['2026-03-30', 1, '2026-04-30']);
  assert.deepEqual(latest({ frequency: 'quarterly', nextRunDate: '2025-11-30' }, '2026-12-01'), ['2026-11-30', 4, '2027-02-28']);
  assert.deepEqual(latest({ frequency: 'quarterly', nextRunDate: '2025-11-30' }, '2026-11-29'), ['2026-08-30', 3, '2026-11-30']);
  assert.deepEqual(latest({ frequency: 'quarterly', nextRunDate: '2025-11-30' }, '2026-01-10'), ['2025-11-30', 0, '2026-02-28']);
  assert.deepEqual(latest({ frequency: 'yearly', nextRunDate: '2024-02-29' }, '2028-02-29'), ['2028-02-29', 4, '2029-02-28']);
  assert.deepEqual(latest({ frequency: 'yearly', nextRunDate: '2024-02-29' }, '2027-02-27'), ['2026-02-28', 2, '2027-02-28']);
  assert.deepEqual(latest({ frequency: 'yearly', nextRunDate: '2000-06-15' }, '2026-06-14'), ['2025-06-15', 25, '2026-06-15']);
  assert.equal(latest({ nextRunDate: '2026-11-17' }, '2026-11-16'), null);
});

test('a next-run date in an implausible year is treated like an invalid date: nothing is created or written', () => {
  for (const nextRunDate of ['0202-01-01', '0026-11-01', '1026-11-01', '1899-12-31', '1999-12-31']) {
    const env = setup({ recurringInvoices: [recurring({ nextRunDate }), recurring({ id: 'rec-ok', nextRunDate: '2026-11-01' })] });
    const started = Date.now();
    const runs = env.store.runDueRecurringInvoices(env.storage, '2026-11-16');
    assert.ok(Date.now() - started < 1000, `${nextRunDate}: returns at once`);
    assert.deepEqual(runs.map(run => [run.recurring.id, run.invoices.map(inv => inv.invoiceDate)]), [['rec-ok', ['2026-11-01']]], nextRunDate);
    assert.equal(env.data().invoices.length, 1);
    assert.deepEqual([env.data().recurringInvoices[0].nextRunDate, env.data().recurringInvoices[0].lastRunDate], [nextRunDate, undefined], 'waits for the user unchanged');

    const alone = setup({ recurringInvoices: [recurring({ nextRunDate })] });
    const before = alone.data(); const writes = alone.writes();
    assert.deepEqual(alone.store.runDueRecurringInvoices(alone.storage, '2026-11-16'), []);
    assert.equal(alone.data(), before);
    assert.equal(alone.writes(), writes);
  }
  // The first plausible year runs, and still creates a single invoice.
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: '2000-01-01' })] });
  assert.deepEqual(runOn(env, ['2026-11-16']), [['2026-11-01']]);
  assert.equal(env.data().invoices.length, 1);
  env.assertValid();
});

test('anchorDay: leap-year February, a stored anchor after a short month, quarterly and yearly schedules', () => {
  const leap = setup({ recurringInvoices: [recurring({ nextRunDate: '2024-01-31' })] });
  assert.deepEqual(runOn(leap, ['2024-01-31', '2024-02-29', '2024-03-31']), [['2024-01-31'], ['2024-02-29'], ['2024-03-31']]);
  leap.assertValid();

  // The schedule currently sits on Feb 28 but was set up for the 30th.
  const stored = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-02-28', anchorDay: 30 })] });
  assert.deepEqual(runOn(stored, ['2026-02-28', '2026-03-29', '2026-03-30', '2026-04-30']), [['2026-02-28'], [], ['2026-03-30'], ['2026-04-30']]);
  assert.equal(stored.data().recurringInvoices[0].anchorDay, 30);
  stored.assertValid();

  const quarterly = setup({ recurringInvoices: [recurring({ frequency: 'quarterly', nextRunDate: '2025-11-30' })] });
  assert.deepEqual(runOn(quarterly, ['2025-11-30', '2026-02-28', '2026-05-30', '2026-08-30', '2026-12-01']), [['2025-11-30'], ['2026-02-28'], ['2026-05-30'], ['2026-08-30'], ['2026-11-30']]);
  assert.equal(quarterly.data().recurringInvoices[0].nextRunDate, '2027-02-28');
  quarterly.assertValid();

  const yearly = setup({ recurringInvoices: [recurring({ frequency: 'yearly', nextRunDate: '2024-02-29' })] });
  assert.deepEqual(runOn(yearly, ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']), [['2024-02-29'], ['2025-02-28'], ['2026-02-28'], ['2027-02-28'], ['2028-02-29']]);
  yearly.assertValid();
});

test('a run due exactly today is created, one due tomorrow is not', () => {
  const env = setup({ recurringInvoices: [recurring({ id: 'today', nextRunDate: '2026-03-29' }), recurring({ id: 'tomorrow', nextRunDate: '2026-03-30' })] });
  const runs = env.store.runDueRecurringInvoices(env.storage, '2026-03-29');
  assert.deepEqual(runs.map(run => [run.recurring.id, run.invoices.length]), [['today', 1]]);
  assert.equal(env.data().recurringInvoices.find(item => item.id === 'tomorrow').nextRunDate, '2026-03-30');
  env.assertValid();
});

test('inactive schedules and schedules without "automatically create" generate nothing and are not touched', () => {
  const env = setup({ recurringInvoices: [recurring({ id: 'inactive', active: false }), recurring({ id: 'manual', autoGenerate: false }), recurring({ id: 'legacy', autoGenerate: undefined })] });
  const before = env.data();
  const writes = env.writes();
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-12-31'), []);
  assert.equal(env.data(), before);
  assert.equal(env.writes(), writes);
  env.assertValid();
});

test('running twice on the same day generates nothing new; a later day continues where the first run stopped', () => {
  const env = setup({ recurringInvoices: [recurring()] });
  assert.deepEqual(runOn(env, ['2026-03-15']), [['2026-02-28']]);
  const snapshot = env.data(); const writes = env.writes();
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-03-15'), []);
  assert.equal(env.data(), snapshot);
  assert.equal(env.writes(), writes);
  // A fresh app start on the same day reads the same data and still creates nothing.
  env.store.clearDataCache();
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-03-15'), []);
  assert.equal(env.data().invoices.length, 1);
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-04-01')[0].invoices.map(inv => inv.invoiceDate), ['2026-03-31']);
  assert.equal(env.data().invoices.length, 2);
  env.assertValid();
});

test('a schedule without a usable next date creates nothing and returns instead of looping', () => {
  for (const nextRunDate of ['', '   ', 'bald', '31.01.2026', '2026-1-5', '2026-01-31T00:00:00.000Z']) {
    const env = setup({ recurringInvoices: [recurring({ nextRunDate }), recurring({ id: 'rec-ok', nextRunDate: '2026-11-01' })] });
    const runs = env.store.runDueRecurringInvoices(env.storage, '2026-11-16');
    assert.deepEqual(runs.map(run => run.recurring.id), ['rec-ok'], JSON.stringify(nextRunDate));
    assert.equal(env.data().invoices.length, 1);
    assert.equal(env.data().recurringInvoices[0].nextRunDate, nextRunDate, 'the broken schedule waits for the user unchanged');
    env.assertValid();
  }
});

test('a missing nextRunDate in stored data is migrated to a future date, so nothing is created at startup', () => {
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: undefined })] });
  assert.match(env.data().recurringInvoices[0].nextRunDate, DATE_ONLY);
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage), []);
  assert.equal(env.data().invoices.length, 0);
});



test('several schedules are handled independently, each with at most one invoice per call', () => {
  const env = setup({ recurringInvoices: [recurring({ id: 'a', nextRunDate: '2026-09-01' }), recurring({ id: 'b', frequency: 'quarterly', nextRunDate: '2026-01-15' }), recurring({ id: 'c', nextRunDate: '2027-01-01' }), recurring({ id: 'd', nextRunDate: '2026-11-16' })] });
  const runs = env.store.runDueRecurringInvoices(env.storage, '2026-11-16');
  assert.deepEqual(runs.map(run => [run.recurring.id, run.invoices.map(inv => inv.invoiceDate), run.skippedRuns, run.dueSince]), [
    ['a', ['2026-11-01'], 2, '2026-09-01'],
    ['b', ['2026-10-15'], 3, '2026-01-15'],
    ['d', ['2026-11-16'], 0, undefined],
  ]);
  assert.equal(env.data().invoices.length, 3);
  assert.deepEqual(env.data().recurringInvoices.map(item => item.nextRunDate), ['2026-12-01', '2027-01-15', '2027-01-01', '2026-12-16']);
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-11-16'), []);
  env.assertValid();
});

test('an invoice that already exists for a run is not created a second time, and the skipped run is reported', () => {
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-03-31', anchorDay: 31 })], invoices: [{ id: 'made-by-hand', invoiceNumber: 'RE-9', invoiceDate: '2026-03-31', recurringInvoiceId: 'rec-1', lineItems: [] }] });
  const runs = env.store.runDueRecurringInvoices(env.storage, '2026-03-31');
  assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].recurring.id, runs[0].invoices, runs[0].runDate, runs[0].skippedRuns, runs[0].dueSince, runs[0].existingInvoice.id], ['rec-1', [], '2026-03-31', 0, undefined, 'made-by-hand']);
  assert.deepEqual(env.data().invoices.map(inv => inv.id), ['made-by-hand']);
  // The run counts as done: the schedule moves on instead of waiting on that day forever.
  const schedule = env.data().recurringInvoices[0];
  assert.deepEqual([schedule.lastRunDate, schedule.nextRunDate, schedule.anchorDay], ['2026-03-31', '2026-04-30', 31]);
  // It is reported once, not on every later page load.
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-03-31'), []);
  assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-04-29'), []);
  const next = env.store.runDueRecurringInvoices(env.storage, '2026-04-30');
  assert.deepEqual([next[0].invoices.map(inv => inv.invoiceDate), next[0].existingInvoice], [['2026-04-30'], undefined]);
  assert.deepEqual(env.data().invoices.map(inv => inv.invoiceDate), ['2026-04-30', '2026-03-31']);
  env.assertValid();
});

test('a schedule whose run already has an invoice does not get stuck: the most recent due date is still created', () => {
  const byHand = (id, invoiceDate, extra = {}) => ({ id, invoiceNumber: `RE-${id}`, invoiceDate, recurringInvoiceId: 'rec-1', lineItems: [], ...extra });
  // The date the schedule waits on exists already; three more months have passed since.
  const first = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-03-31' })], invoices: [byHand('march', '2026-03-31')] });
  const firstRuns = first.store.runDueRecurringInvoices(first.storage, '2026-06-30');
  assert.equal(firstRuns.length, 1);
  assert.deepEqual([firstRuns[0].invoices.map(inv => inv.invoiceDate), firstRuns[0].skippedRuns, firstRuns[0].dueSince, firstRuns[0].existingInvoice], [['2026-06-30'], 3, '2026-03-31', undefined]);
  assert.deepEqual(first.data().invoices.map(inv => inv.invoiceDate).sort(), ['2026-03-31', '2026-06-30']);
  assert.equal(first.data().invoices.find(inv => inv.id === 'march').invoiceNumber, 'RE-march', 'the existing invoice is untouched');
  assert.deepEqual([first.data().recurringInvoices[0].lastRunDate, first.data().recurringInvoices[0].nextRunDate], ['2026-06-30', '2026-07-31']);
  first.assertValid();

  // The most recent due date already has its invoice (made by hand) while older dates were missed: nothing is
  // created, the existing invoice is reported together with the skipped dates, and the schedule is up to date.
  const latest = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-01-31' })], invoices: [byHand('march', '2026-03-31')] });
  const latestRuns = latest.store.runDueRecurringInvoices(latest.storage, '2026-04-15');
  assert.deepEqual(latestRuns.map(run => [run.invoices, run.runDate, run.skippedRuns, run.dueSince, run.existingInvoice.id]), [[[], '2026-03-31', 2, '2026-01-31', 'march']]);
  assert.deepEqual(latest.data().invoices.map(inv => inv.id), ['march']);
  assert.equal(latest.data().recurringInvoices[0].nextRunDate, '2026-04-30');
  latest.assertValid();

  // An older date with an invoice does not stand in for the most recent one.
  const middle = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-01-31' })], invoices: [byHand('feb', '2026-02-28')] });
  assert.deepEqual(runOn(middle, ['2026-04-15']), [['2026-03-31']]);
  assert.equal(middle.data().invoices.length, 2);
  assert.equal(middle.data().recurringInvoices[0].nextRunDate, '2026-04-30');
  middle.assertValid();

  // An invoice of another schedule, or one without a schedule, on the same day does not count as this run.
  const other = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-03-31' })], invoices: [byHand('foreign', '2026-03-31', { recurringInvoiceId: 'rec-2' }), byHand('copy', '2026-03-31', { recurringInvoiceId: undefined })] });
  const otherRuns = other.store.runDueRecurringInvoices(other.storage, '2026-03-31');
  assert.deepEqual([otherRuns[0].invoices.map(inv => inv.invoiceDate), otherRuns[0].existingInvoice], [['2026-03-31'], undefined]);
  assert.equal(other.data().invoices.length, 3);
  other.assertValid();
});

test('generateInvoiceFromRecurring: a run that already has its invoice returns that invoice and advances the schedule', () => {
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-08-31', frequency: 'quarterly' })], invoices: [{ id: 'made-by-hand', invoiceNumber: 'RE-9', invoiceDate: '2026-08-31', recurringInvoiceId: 'rec-1', lineItems: [] }] });
  const invoice = env.store.generateInvoiceFromRecurring(env.storage, 'rec-1');
  assert.equal(invoice.id, 'made-by-hand');
  assert.deepEqual(env.data().invoices.map(inv => inv.id), ['made-by-hand']);
  let schedule = env.data().recurringInvoices[0];
  assert.deepEqual([schedule.lastRunDate, schedule.nextRunDate, schedule.anchorDay], ['2026-08-31', '2026-11-30', 31]);
  assert.notEqual(schedule.updatedAt, undefined);
  // The next call creates the next period, with or without the expected date.
  const next = env.store.generateInvoiceFromRecurring(env.storage, 'rec-1', '2026-11-30');
  assert.notEqual(next.id, 'made-by-hand');
  assert.equal(next.invoiceDate, '2026-11-30');
  schedule = env.data().recurringInvoices[0];
  assert.deepEqual([schedule.lastRunDate, schedule.nextRunDate], ['2026-11-30', '2027-02-28']);
  assert.equal(env.data().invoices.length, 2);
  env.assertValid();
});

test('a schedule moved back onto a day it already ran on moves forward again without a second invoice', () => {
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-03-15' })] });
  const first = env.store.generateInvoiceFromRecurring(env.storage, 'rec-1');
  assert.equal(env.data().recurringInvoices[0].nextRunDate, '2026-04-15');
  // The user sets the next run back to the day that was just created (the page clears the anchor day with it).
  env.store.upsertRecurringInvoice(env.storage, { ...env.data().recurringInvoices[0], nextRunDate: '2026-03-15', anchorDay: undefined });
  const runs = env.store.runDueRecurringInvoices(env.storage, '2026-03-20');
  assert.deepEqual(runs.map(run => [run.invoices, run.runDate, run.existingInvoice.id]), [[[], '2026-03-15', first.id]]);
  assert.equal(env.data().invoices.length, 1);
  assert.equal(env.data().recurringInvoices[0].nextRunDate, '2026-04-15');
  assert.deepEqual(runOn(env, ['2026-04-14', '2026-04-15']), [[], ['2026-04-15']]);
  assert.equal(env.data().invoices.filter(inv => inv.invoiceDate === '2026-03-15').length, 1);
  assert.equal(env.data().recurringInvoices[0].nextRunDate, '2026-05-15');
  env.assertValid();
});

test('a duplicated run of a schedule is an ordinary invoice and does not stand in for a run', () => {
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-03-15' })] });
  const run = env.store.generateInvoiceFromRecurring(env.storage, 'rec-1');
  const copy = env.store.duplicateInvoiceById(env.storage, run.id);
  assert.equal(copy.recurringInvoiceId, undefined);
  assert.deepEqual(env.data().invoices.filter(inv => inv.recurringInvoiceId === 'rec-1').map(inv => inv.id), [run.id]);
  // A copy dated on the next run day does not keep the schedule from creating its own invoice for that day.
  env.store.upsertInvoice(env.storage, { ...copy, invoiceDate: '2026-04-15' });
  const runs = env.store.runDueRecurringInvoices(env.storage, '2026-04-15');
  assert.deepEqual(runs[0].invoices.map(inv => inv.invoiceDate), ['2026-04-15']);
  assert.equal(env.data().invoices.filter(inv => inv.invoiceDate === '2026-04-15').length, 2);
  env.assertValid();
});

test('a next-run date that is not a real calendar date creates nothing, changes nothing and does not loop', () => {
  for (const nextRunDate of ['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '0000-00-00']) {
    const alone = setup({ recurringInvoices: [recurring({ nextRunDate })] });
    const before = alone.data(); const writes = alone.writes();
    assert.deepEqual(alone.store.runDueRecurringInvoices(alone.storage, '2026-11-16'), [], nextRunDate);
    assert.equal(alone.data(), before, `${nextRunDate}: nothing was saved`);
    assert.equal(alone.writes(), writes);
    assert.deepEqual(alone.store.runDueRecurringInvoices(alone.storage, '2030-01-01'), [], `${nextRunDate}: also on a later day`);
    assert.equal(alone.data().invoices.length, 0);

    // Other schedules are not held up by the broken one.
    const env = setup({ recurringInvoices: [recurring({ nextRunDate }), recurring({ id: 'rec-ok', nextRunDate: '2026-11-01' })] });
    assert.deepEqual(env.store.runDueRecurringInvoices(env.storage, '2026-11-16').map(run => [run.recurring.id, run.invoices.map(inv => inv.invoiceDate)]), [['rec-ok', ['2026-11-01']]], nextRunDate);
    assert.equal(env.data().recurringInvoices[0].nextRunDate, nextRunDate, 'the broken schedule waits for the user unchanged');
    assert.equal(env.data().recurringInvoices[0].lastRunDate, undefined);
  }
  // The real leap day is a date.
  const leap = setup({ recurringInvoices: [recurring({ nextRunDate: '2024-02-29', frequency: 'yearly' })] });
  assert.deepEqual(leap.store.runDueRecurringInvoices(leap.storage, '2024-02-29')[0].invoices.map(inv => inv.invoiceDate), ['2024-02-29']);
});

test('a schedule without anchor day runs on the day of its next-run date from then on', () => {
  // What the page stores when the user picks a new date for a schedule that used to run on the 31st.
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-03-15', anchorDay: undefined, lastRunDate: '2026-02-28' })] });
  const runs = env.store.runDueRecurringInvoices(env.storage, '2026-05-20');
  assert.deepEqual(runs[0].invoices.map(inv => inv.invoiceDate), ['2026-05-15']);
  const schedule = env.data().recurringInvoices[0];
  assert.deepEqual([schedule.lastRunDate, schedule.nextRunDate, schedule.anchorDay], ['2026-05-15', '2026-06-15', 15]);
  env.assertValid();

  const manual = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-03-15', anchorDay: undefined, autoGenerate: false })] });
  const dates = [1, 2, 3].map(() => manual.store.generateInvoiceFromRecurring(manual.storage, 'rec-1').invoiceDate);
  assert.deepEqual(dates, ['2026-03-15', '2026-04-15', '2026-05-15']);
  manual.assertValid();
});

test('generateInvoiceFromRecurring: one invoice per call, schedule advances; unknown id and stale expected date create nothing', () => {
  const env = setup({ settings: { defaultPaymentTermDays: 7 }, recurringInvoices: [recurring({ nextRunDate: '2026-08-31', texts: { documentTitle: 'Wartungsrechnung' } })] });
  assert.equal(env.store.generateInvoiceFromRecurring(env.storage, 'missing'), null);
  const first = env.store.generateInvoiceFromRecurring(env.storage, 'rec-1');
  assert.equal(first.invoiceDate, '2026-08-31');
  assert.equal(first.dueDate, '2026-09-07');
  assert.equal(first.recurringInvoiceId, 'rec-1');
  assert.equal(first.texts.documentTitle, 'Wartungsrechnung');
  assert.equal(first.footerText, 'Fuß');
  assert.equal(first.currency, 'EUR');
  assert.equal(first.einvoice, undefined);
  let schedule = env.data().recurringInvoices[0];
  assert.deepEqual([schedule.lastRunDate, schedule.nextRunDate, schedule.anchorDay], ['2026-08-31', '2026-09-30', 31]);

  // A second window that still believes August is due gets the existing invoice back.
  const writes = env.writes();
  assert.equal(env.store.generateInvoiceFromRecurring(env.storage, 'rec-1', '2026-08-31').id, first.id);
  assert.equal(env.store.generateInvoiceFromRecurring(env.storage, 'rec-1', '2026-07-31'), null);
  assert.equal(env.writes(), writes);
  assert.equal(env.data().invoices.length, 1);

  const second = env.store.generateInvoiceFromRecurring(env.storage, 'rec-1', '2026-09-30');
  assert.equal(second.invoiceDate, '2026-09-30');
  schedule = env.data().recurringInvoices[0];
  assert.deepEqual([schedule.lastRunDate, schedule.nextRunDate, schedule.anchorDay], ['2026-09-30', '2026-10-31', 31]);
  assert.equal(env.data().invoices.length, 2);
  env.assertValid();
});

test('generateInvoiceFromRecurring works for a manual, inactive schedule and for a template without customer or positions', () => {
  const env = setup({ recurringInvoices: [recurring({ active: false, autoGenerate: false, customerId: undefined, lineItems: [], nextRunDate: '2026-12-31', frequency: 'yearly' })] });
  const invoice = env.store.generateInvoiceFromRecurring(env.storage, 'rec-1');
  assert.equal(invoice.invoiceDate, '2026-12-31');
  assert.deepEqual(invoice.lineItems, []);
  assert.equal(invoice.customerId, undefined);
  assert.equal(env.data().recurringInvoices[0].nextRunDate, '2027-12-31');
  assert.equal(env.data().recurringInvoices[0].active, false);
  env.assertValid();
});

// ─── Deleting records other records point to ────────────────────────────────

function linkedSeed() {
  return {
    settings: { defaultInvoiceId: 'adv-1' },
    customers: [{ id: 'cust-1', name: 'Kunde Schäfer', address: 'Am Hang 2', contact: '' }, { id: 'cust-2', name: 'Andere', address: '', contact: '' }],
    invoices: [
      { id: 'final-1', invoiceNumber: 'RE-3', invoiceKind: 'final', customerId: 'cust-1', invoiceDate: '2026-03-01', dueDate: '2026-03-15', lineItems: [line('f-1', 1000)],
        advanceDeductions: [{ id: 'd-1', invoiceId: 'adv-1', invoiceNumber: 'AB-1', invoiceDate: '2026-01-10', net: 300, tax: 57 }, { id: 'd-2', invoiceId: 'adv-2', invoiceNumber: 'AB-2', invoiceDate: '2026-02-10', net: 200, tax: 38 }] },
      { id: 'adv-1', invoiceNumber: 'AB-1', invoiceKind: 'advance', customerId: 'cust-1', invoiceDate: '2026-01-10', dueDate: '2026-01-24', creditNoteIds: ['cn-1'], sourceQuoteId: 'q-1', lineItems: [line('a-1', 300)] },
      { id: 'adv-2', invoiceNumber: 'AB-2', invoiceKind: 'advance', customerId: 'cust-1', invoiceDate: '2026-02-10', dueDate: '2026-02-24', lineItems: [line('a-2', 200)] },
    ],
    quotes: [{ id: 'q-1', documentKind: 'quote', quoteStatus: 'accepted', convertedInvoiceId: 'adv-1', customerId: 'cust-1', lineItems: [line('q-l', 1000)] }, { id: 'q-2', documentKind: 'quote', quoteStatus: 'open', customerId: 'cust-2', lineItems: [] }],
    contractorDeclarations: [{ id: 'dec-1', date: '2026-03-02', invoiceId: 'adv-1', customerId: 'cust-1', kommission: 'Bad Schäfer' }, { id: 'dec-2', date: '2026-03-02', invoiceId: 'final-1', customerId: 'cust-2', kommission: 'Dach' }],
    creditNotes: [{ id: 'cn-1', type: 'gutschrift', linkedInvoiceId: 'adv-1', linkedInvoiceNumber: 'AB-1', amount: 10 }, { id: 'cn-2', type: 'storno', linkedInvoiceId: 'final-1', linkedInvoiceNumber: 'RE-3', amount: 5 }],
    recurringInvoices: [recurring({ nextRunDate: '2030-01-01' })],
  };
}

test('deleteInvoice of an advance invoice that a final invoice, a quote, a declaration and the settings point to', () => {
  const env = setup(linkedSeed());
  const calc = env.load('src/lib/calc.ts');
  const payableBefore = calc.computeInvoicePayable(env.data().invoices.find(inv => inv.id === 'final-1')).payable;
  env.store.deleteInvoice(env.storage, 'adv-1');
  const data = env.data();
  assert.deepEqual(data.invoices.map(inv => inv.id), ['final-1', 'adv-2']);
  assert.equal(data.settings.defaultInvoiceId, undefined);
  assert.deepEqual(data.creditNotes.map(cn => cn.id), ['cn-2'], 'credit notes of the deleted invoice go with it');
  assert.equal(data.quotes.find(q => q.id === 'q-1').convertedInvoiceId, undefined);
  const declaration = data.contractorDeclarations.find(d => d.id === 'dec-1');
  assert.equal(declaration.invoiceId, undefined);
  assert.equal(declaration.kommission, 'Bad Schäfer', 'the declaration keeps its content');
  assert.equal(declaration.customerId, 'cust-1');
  assert.equal(data.contractorDeclarations.find(d => d.id === 'dec-2').invoiceId, 'final-1');
  // The final invoice keeps the deducted amounts as a snapshot: its total must not change.
  const final = data.invoices.find(inv => inv.id === 'final-1');
  assert.deepEqual(final.advanceDeductions.map(d => [d.id, d.invoiceNumber, d.net, d.tax]), [['d-1', 'AB-1', 300, 57], ['d-2', 'AB-2', 200, 38]]);
  assert.equal(calc.computeInvoicePayable(final).payable, payableBefore);
  env.assertValid();

  // Everything that reads the data afterwards keeps working.
  assert.doesNotThrow(() => env.store.getDashboardStats(env.storage));
  assert.equal(env.store.searchInvoices(env.storage, 'RE-3').length, 1);
  assert.doesNotThrow(() => env.documents.findAdvanceCandidates(data.invoices, final));
  assert.ok(env.store.createInvoice(env.storage), 'creating an invoice works after the template invoice is gone');
  const reconverted = env.store.convertQuoteToInvoice(env.storage, 'q-1');
  assert.equal(reconverted.sourceQuoteId, 'q-1');
  env.assertValid();
});

test('deleteInvoice of a final invoice, of an unknown id, and of every invoice in turn', () => {
  const env = setup(linkedSeed());
  env.store.deleteInvoice(env.storage, 'missing');
  assert.equal(env.data().invoices.length, 3);
  env.assertValid();
  env.store.deleteInvoice(env.storage, 'final-1');
  assert.deepEqual(env.data().creditNotes.map(cn => cn.id), ['cn-1']);
  assert.equal(env.data().contractorDeclarations.find(d => d.id === 'dec-2').invoiceId, undefined);
  assert.equal(env.data().settings.defaultInvoiceId, 'adv-1');
  env.assertValid();
  for (const id of ['adv-1', 'adv-2']) { env.store.deleteInvoice(env.storage, id); env.assertValid(); }
  const data = env.data();
  assert.deepEqual(data.invoices, []);
  assert.deepEqual(data.creditNotes, []);
  assert.equal(data.quotes.length, 2);
  assert.equal(data.contractorDeclarations.length, 2);
  assert.equal(data.quotes.some(q => q.convertedInvoiceId), false);
  assert.equal(data.contractorDeclarations.some(d => d.invoiceId), false);
  assert.doesNotThrow(() => env.store.getDashboardStats(env.storage));
});

test('deleteCustomer unlinks invoices, quotes, declarations and schedules but keeps every document', () => {
  const env = setup(linkedSeed());
  env.store.deleteCustomer(env.storage, 'cust-1');
  const data = env.data();
  assert.deepEqual(data.customers.map(c => c.id), ['cust-2']);
  assert.equal(data.invoices.length, 3);
  assert.equal(data.invoices.some(inv => inv.customerId), false);
  assert.equal(data.quotes.find(q => q.id === 'q-1').customerId, undefined);
  assert.equal(data.quotes.find(q => q.id === 'q-2').customerId, 'cust-2');
  assert.equal(data.quotes.find(q => q.id === 'q-1').convertedInvoiceId, 'adv-1', 'other links survive');
  assert.equal(data.contractorDeclarations.find(d => d.id === 'dec-1').customerId, undefined);
  assert.equal(data.contractorDeclarations.find(d => d.id === 'dec-1').invoiceId, 'adv-1');
  assert.equal(data.contractorDeclarations.find(d => d.id === 'dec-2').customerId, 'cust-2');
  assert.equal(data.recurringInvoices[0].customerId, undefined);
  assert.equal(data.invoices.find(inv => inv.id === 'final-1').advanceDeductions.length, 2);
  for (const collection of ['invoices', 'quotes', 'contractorDeclarations', 'recurringInvoices']) {
    for (const record of env.persisted()[collection]) assert.notEqual(record.customerId, 'cust-1', collection);
  }
  env.assertValid();
  env.store.deleteCustomer(env.storage, 'missing');
  env.store.deleteCustomer(env.storage, 'cust-2');
  assert.deepEqual(env.data().customers, []);
  env.assertValid();
  // The final invoice still finds its advance invoices by recipient name once the customer link is gone.
  assert.doesNotThrow(() => env.documents.findAdvanceCandidates(env.data().invoices, env.data().invoices[0]));
});

test('deleting products, tags and template variants also cleans quotes', () => {
  const env = setup({
    products: [{ id: 'prod-1', name: 'Stunde', unitPrice: 60 }], tags: [{ id: 'tag-1', name: 'Bad', color: '#fff' }], templateVariants: [{ id: 'var-1', name: 'Blau', baseTemplateId: 'classic' }],
    invoices: [{ id: 'inv-1', tagIds: ['tag-1'], layout: { templateVariantId: 'var-1' }, lineItems: [line('i-1', 60, { productId: 'prod-1' })] }],
    quotes: [{ id: 'q-1', documentKind: 'quote', tagIds: ['tag-1', 'tag-2'], layout: { templateVariantId: 'var-1' }, lineItems: [line('q-l', 60, { productId: 'prod-1' }), line('q-m', 5)] }],
  });
  env.store.deleteProduct(env.storage, 'prod-1'); env.assertValid();
  env.store.deleteTag(env.storage, 'tag-1'); env.assertValid();
  env.store.deleteTemplateVariant(env.storage, 'var-1'); env.assertValid();
  const quote = env.data().quotes[0];
  assert.deepEqual(quote.lineItems.map(item => item.productId), [undefined, undefined]);
  assert.deepEqual(quote.lineItems.map(item => item.unitPrice), [60, 5], 'prices on the document stay');
  assert.deepEqual(quote.tagIds, ['tag-2']);
  assert.equal(quote.layout.templateVariantId, undefined);
  assert.equal(env.data().invoices[0].lineItems[0].productId, undefined);
  assert.deepEqual(env.data().invoices[0].tagIds, []);
});

// ─── Every mutation keeps the snapshot startable; export/import ─────────────

test('a long mixed sequence of mutations never produces a snapshot the validator rejects', () => {
  const env = setup({ settings: { defaultEInvoice: SELLER, defaultPaymentTermDays: 14, defaultTaxRate: 0.19 } });
  const { store, storage, documents } = env;
  const step = (label, action) => { const result = action(); assert.doesNotThrow(() => env.assertValid(), label); return result; };
  const customer = step('createCustomer', () => store.createCustomer(storage));
  step('upsertCustomer', () => store.upsertCustomer(storage, { ...customer, name: 'Bäckerei Çelik & Söhne', reverseCharge: true }));
  const advance = step('createInvoice', () => store.createInvoice(storage));
  step('advance kind', () => store.updateInvoice(storage, advance.id, prev => ({ ...documents.applyInvoiceKind(prev, 'advance', []), invoiceNumber: 'AB-1', customerId: customer.id, lineItems: [{ ...prev.lineItems[0], unitPrice: 500 }] })));
  const final = step('createInvoice 2', () => store.createInvoice(storage));
  step('final kind', () => store.updateInvoice(storage, final.id, prev => documents.applyInvoiceKind({ ...prev, customerId: customer.id }, 'final', store.listInvoices(storage))));
  assert.equal(store.getInvoice(storage, final.id).advanceDeductions.length, 1);
  assert.equal(store.getInvoice(storage, final.id).advanceDeductions[0].invoiceId, advance.id);
  step('reverse charge on', () => store.updateInvoice(storage, final.id, prev => documents.applyReverseCharge(prev, true, 0.19)));
  step('reverse charge off', () => store.updateInvoice(storage, final.id, prev => documents.applyReverseCharge(prev, false, 0.19)));
  for (let level = 0; level < 4; level++) step(`reminder ${level}`, () => store.updateInvoice(storage, advance.id, prev => ({ ...prev, reminders: [...(prev.reminders ?? []), documents.createReminder(prev, '2026-05-01')] })));
  assert.deepEqual(store.getInvoice(storage, advance.id).reminders.map(item => item.level), [1, 2, 3, 3]);
  step('standard kind', () => store.updateInvoice(storage, final.id, prev => documents.applyInvoiceKind(prev, 'standard', [])));
  step('togglePaid', () => store.togglePaid(storage, advance.id));
  step('togglePaid back', () => store.togglePaid(storage, advance.id));
  const quote = step('createQuote', () => store.createQuote(storage));
  step('quote edit', () => store.updateInvoice(storage, quote.id, prev => ({ ...prev, quoteStatus: 'declined', customerId: customer.id }), 'quotes'));
  const copy = step('duplicateQuote', () => store.duplicateQuoteById(storage, quote.id));
  const converted = step('convert', () => store.convertQuoteToInvoice(storage, copy.id));
  step('duplicate converted invoice', () => store.duplicateInvoiceById(storage, converted.id));
  step('credit note', () => store.createCreditNote(storage, converted.id, 'storno'));
  step('declaration', () => store.addDeclaration(storage, documents.declarationFromInvoice(store.getInvoice(storage, converted.id), DEFAULTS)));
  const declaration = step('declaration defaults', () => store.createDeclarationFromDefaults(storage, DEFAULTS));
  step('declaration update', () => store.updateDeclaration(storage, declaration.id, prev => ({ ...prev, customerId: customer.id })));
  const schedule = step('createRecurring', () => store.createRecurringInvoice(storage));
  step('recurring edit', () => store.upsertRecurringInvoice(storage, { ...schedule, name: 'Miete', autoGenerate: true, nextRunDate: '2026-08-31', customerId: customer.id }));
  step('run recurring', () => store.runDueRecurringInvoices(storage, '2026-11-16'));
  step('generate recurring', () => store.generateInvoiceFromRecurring(storage, schedule.id));
  step('settings', () => store.updateSettings(storage, prev => ({ ...prev, lastBackupDate: '2026-11-16', uiScale: 'large', defaultPaymentTermDays: 30 })));
  step('deleteQuote', () => store.deleteQuote(storage, copy.id));
  step('deleteInvoice converted', () => store.deleteInvoice(storage, converted.id));
  step('deleteInvoice advance', () => store.deleteInvoice(storage, advance.id));
  step('deleteCustomer', () => store.deleteCustomer(storage, customer.id));
  step('deleteDeclaration', () => store.deleteDeclaration(storage, declaration.id));
  step('deleteRecurring', () => store.deleteRecurringInvoice(storage, schedule.id));
  assert.equal(store.getInvoice(storage, final.id).advanceDeductions.length, 1, 'inactive deductions stay stored');
});

test('export → import round trip keeps quotes, declarations and every new field', () => {
  const env = setup({ ...linkedSeed(), settings: { defaultEInvoice: SELLER, defaultPaymentTermDays: 21, lastBackupDate: '2026-11-01', uiScale: 'xlarge' } });
  env.store.createQuote(env.storage);
  env.store.createDeclarationFromDefaults(env.storage, DEFAULTS);
  env.store.updateInvoice(env.storage, 'adv-2', prev => ({ ...prev, reverseCharge: true, projectReference: 'Bad Schäfer', reminders: [env.documents.createReminder(prev, '2026-04-01')] }));
  env.store.runDueRecurringInvoices(env.storage, '2026-11-16');
  const before = env.data();
  const exported = env.store.exportData(env.storage);
  assert.equal(isValidPersistedData(JSON.parse(exported)), true);

  const target = setup();
  assert.equal(target.store.importData(target.storage, exported), true);
  const after = target.data();
  for (const collection of ['invoices', 'quotes', 'contractorDeclarations', 'customers', 'creditNotes', 'recurringInvoices']) {
    assert.deepEqual(JSON.parse(JSON.stringify(after[collection])), JSON.parse(JSON.stringify(before[collection])), collection);
  }
  assert.equal(after.quotes.length, 3);
  assert.equal(after.contractorDeclarations.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(after.settings)), JSON.parse(JSON.stringify(before.settings)));
  assert.equal(after.invoices.find(inv => inv.id === 'final-1').advanceDeductions[0].invoiceId, 'adv-1');
  assert.equal(after.invoices.find(inv => inv.id === 'adv-2').reminders[0].level, 1);
  assert.equal(target.store.exportData(target.storage), exported, 'a second export is byte-identical');
  target.assertValid();
  // The pre-import data is kept as a recovery entry.
  assert.ok([...target.storage.values.keys()].some(key => /:recovery:.*:before-import$/.test(key)));

  // The imported data stays fully usable.
  const quote = after.quotes.find(q => q.id === 'q-2');
  assert.ok(target.store.convertQuoteToInvoice(target.storage, quote.id));
  target.assertValid();
});

test('importing a backup from before 1.3 (no quotes, no declarations) yields empty collections that can be used at once', () => {
  const env = setup(linkedSeed());
  const old = JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [{ id: 'old-1', invoiceNumber: 'RE-2019-1', lineItems: [line('o-1')] }] });
  assert.equal(env.store.importData(env.storage, old), true);
  assert.deepEqual(env.data().quotes, []);
  assert.deepEqual(env.data().contractorDeclarations, []);
  env.store.createQuote(env.storage);
  env.store.createDeclarationFromDefaults(env.storage, DEFAULTS);
  assert.equal(env.data().quotes.length, 1);
  assert.equal(env.data().invoices.length, 1);
  env.assertValid();
});

test('import rejects corrupt quotes and declarations and leaves the current data alone', () => {
  const env = setup(linkedSeed());
  const before = env.storage.values.get(KEY);
  const base = { schemaVersion: 1, settings: {}, invoices: [] };
  for (const bad of [
    { quotes: {} }, { quotes: [null] }, { quotes: [{ id: 'a' }, { id: 'a' }] }, { quotes: [{ id: 'a', quoteStatus: 'maybe' }] }, { quotes: [{ id: 'a', documentKind: 'invoice' }] },
    { quotes: [{ id: 'a', convertedInvoiceId: 7 }] }, { quotes: [{ id: 'a', lineItems: [{ unitPrice: '5' }] }] },
    { contractorDeclarations: 'x' }, { contractorDeclarations: [{ id: 'a', kommission: 5 }] }, { contractorDeclarations: [{ id: '' }] },
    { invoices: [{ id: 'a', advanceDeductions: [{ id: 'd', net: '1' }] }] }, { invoices: [{ id: 'a', reminders: [{ id: 'r', level: 4 }] }] }, { invoices: [{ id: 'a', invoiceKind: 'partial' }] },
    { recurringInvoices: [{ id: 'r', anchorDay: '31' }] }, { settings: { defaultPaymentTermDays: '14' } },
  ]) {
    assert.equal(env.store.importData(env.storage, JSON.stringify({ ...base, ...bad })), false, JSON.stringify(bad));
  }
  assert.equal(env.storage.values.get(KEY), before);
  assert.equal(env.data().quotes.length, 2);
});

// ─── sessionTasks: pure parts ───────────────────────────────────────────────

test('daysSinceBackup: whole calendar days, null without a usable date, never negative', () => {
  const { load } = setup();
  const { daysSinceBackup } = load('src/lib/sessionTasks.ts');
  assert.equal(daysSinceBackup({}, '2026-11-16'), null);
  assert.equal(daysSinceBackup({ lastBackupDate: undefined }, '2026-11-16'), null);
  assert.equal(daysSinceBackup({ lastBackupDate: '' }, '2026-11-16'), null);
  assert.equal(daysSinceBackup({ lastBackupDate: 'gestern' }, '2026-11-16'), null);
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-02-30' }, '2026-11-16'), null, 'not a calendar date');
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-11-16' }, '2026-11-16'), 0);
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-11-15' }, '2026-11-16'), 1);
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-11-09' }, '2026-11-16'), 7);
  assert.equal(daysSinceBackup({ lastBackupDate: '2025-11-16' }, '2026-11-16'), 365);
  assert.equal(daysSinceBackup({ lastBackupDate: '2024-02-28' }, '2024-03-01'), 2, 'leap day');
  // Clock changes in Europe/Berlin must not lose or add a day.
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-03-28' }, '2026-03-30'), 2);
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-10-24' }, '2026-10-26'), 2);
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-03-22' }, '2026-03-29'), 7);
  // Older versions stored a full timestamp; its date part counts.
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-11-02T09:15:00.000Z' }, '2026-11-16'), 14);
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-12-24' }, '2026-11-16'), 0, 'a date in the future (clock was wrong) is not negative');
  assert.equal(typeof daysSinceBackup({ lastBackupDate: '2020-01-01' }), 'number', 'today is the default');
});

test('backupAgeText: German wording for never, today, yesterday and older', () => {
  const { load } = setup();
  const { backupAgeText, daysSinceBackup, AUTO_BACKUP_INTERVAL_DAYS, BACKUP_HINT_AFTER_DAYS } = load('src/lib/sessionTasks.ts');
  assert.equal(backupAgeText(null), 'Es gibt noch keine Sicherung.');
  assert.equal(backupAgeText(0), 'Letzte Sicherung: heute.');
  assert.equal(backupAgeText(1), 'Letzte Sicherung: gestern.');
  assert.equal(backupAgeText(2), 'Letzte Sicherung vor 2 Tagen.');
  assert.equal(backupAgeText(14), 'Letzte Sicherung vor 14 Tagen.');
  assert.equal(backupAgeText(daysSinceBackup({ lastBackupDate: '2026-11-15' }, '2026-11-16')), 'Letzte Sicherung: gestern.');
  assert.equal(backupAgeText(daysSinceBackup({}, '2026-11-16')), 'Es gibt noch keine Sicherung.');
  assert.ok(AUTO_BACKUP_INTERVAL_DAYS < BACKUP_HINT_AFTER_DAYS, 'the automatic backup runs before the hint would appear');
});

test('markBackupDone stores a date-only value that daysSinceBackup reads back as "today", and writes once per day', () => {
  const env = setup();
  const tasks = env.load('src/lib/sessionTasks.ts');
  tasks.markBackupDone(env.storage, '2026-11-16');
  assert.equal(env.data().settings.lastBackupDate, '2026-11-16');
  assert.equal(tasks.daysSinceBackup(env.data().settings, '2026-11-16'), 0);
  const writes = env.writes();
  tasks.markBackupDone(env.storage, '2026-11-16');
  assert.equal(env.writes(), writes);
  env.assertValid();
});

// ─── Review fixes (1.3) ─────────────────────────────────────────────────────

test('generateInvoiceFromRecurring: a next-run date that is no calendar date returns null and writes nothing; the schedule is not listed as due', () => {
  for (const nextRunDate of ['2026-02-30', '2026-04-31', '2026-13-01', 'bald']) {
    const env = setup({ recurringInvoices: [recurring({ nextRunDate, autoGenerate: false }), recurring({ id: 'rec-ok', nextRunDate: '2020-01-15', autoGenerate: false })] });
    const before = env.data(); const writes = env.writes();
    assert.equal(env.store.generateInvoiceFromRecurring(env.storage, 'rec-1'), null, nextRunDate);
    assert.equal(env.store.generateInvoiceFromRecurring(env.storage, 'rec-1', nextRunDate), null, nextRunDate);
    assert.equal(env.data(), before, `${nextRunDate}: nothing was saved`);
    assert.equal(env.writes(), writes);
    assert.equal(env.persisted().invoices.length, 0);
    assert.equal(env.persisted().recurringInvoices[0].nextRunDate, nextRunDate);
    assert.deepEqual(env.store.getDueRecurringInvoices(env.storage).map(item => item.id), ['rec-ok'], nextRunDate);
  }
});

test('generateInvoiceFromRecurring (the "create now" button) creates exactly the scheduled run, however far behind', () => {
  const env = setup({ recurringInvoices: [recurring({ nextRunDate: '2024-02-01', autoGenerate: false })] });
  const dates = [1, 2, 3].map(() => env.store.generateInvoiceFromRecurring(env.storage, 'rec-1').invoiceDate);
  assert.deepEqual(dates, ['2024-02-01', '2024-03-01', '2024-04-01']);
  assert.equal(env.data().recurringInvoices[0].nextRunDate, '2024-05-01');
  assert.equal(env.data().invoices.length, 3);
  env.assertValid();
});

test('recurringNotice: says in plain German which dates were skipped and which run already had its invoice', () => {
  const { recurringNotice } = createLoader()('src/lib/sessionTasks.ts');
  assert.equal(recurringNotice([]), null);

  const behind = setup({ recurringInvoices: [recurring({ nextRunDate: '2024-02-01' })] });
  const skipped = recurringNotice(behind.store.runDueRecurringInvoices(behind.storage, '2026-11-16'), 'n1');
  assert.equal(skipped.id, 'n1');
  assert.equal(skipped.title, 'Eine wiederkehrende Rechnung wurde als Entwurf angelegt.');
  assert.equal(skipped.text, '„Wartung Heizung“ war seit dem 01.02.2024 fällig. Helferlein hat nur die Rechnung für den 01.11.2026 angelegt; frühere Termine wurden übersprungen. Bitte prüfen, eine Rechnungsnummer vergeben und versenden.');
  assert.equal(skipped.href, `/invoices/${behind.data().invoices[0].id}`);
  assert.equal(skipped.linkLabel, 'Rechnung öffnen');

  const onTime = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-11-16' })] });
  const plain = recurringNotice(onTime.store.runDueRecurringInvoices(onTime.storage, '2026-11-16'));
  assert.match(plain.id, /^recurring-\d+$/);
  assert.equal(plain.text, 'Wartung Heizung. Bitte prüfen, eine Rechnungsnummer vergeben und versenden.');

  const done = setup({ recurringInvoices: [recurring({ nextRunDate: '2026-12-01' })], invoices: [{ id: 'made-by-hand', invoiceNumber: 'RE-9', invoiceDate: '2026-12-01', recurringInvoiceId: 'rec-1', lineItems: [] }] });
  const existing = recurringNotice(done.store.runDueRecurringInvoices(done.storage, '2026-12-01'));
  assert.equal(existing.title, 'Es wurde keine neue wiederkehrende Rechnung angelegt.');
  assert.equal(existing.text, 'Für den 01.12.2026 gab es bereits eine Rechnung aus „Wartung Heizung“; es wurde keine weitere angelegt.');
  assert.equal(existing.href, '/invoices/made-by-hand');
  assert.equal(existing.linkLabel, 'Vorhandene Rechnung öffnen');

  // Several schedules in one notice: created ones are counted, the special cases are spelled out, a schedule without a name still reads as a sentence.
  const mixed = setup({
    recurringInvoices: [recurring({ id: 'a', name: 'Miete', nextRunDate: '2026-11-16' }), recurring({ id: 'b', name: '  ', nextRunDate: '2026-08-10' }), recurring({ id: 'c', name: 'Wartung', nextRunDate: '2026-11-05' }), recurring({ id: 'd', name: 'Pacht', nextRunDate: '2026-11-02' })],
    invoices: [{ id: 'made-by-hand', invoiceNumber: 'RE-9', invoiceDate: '2026-11-05', recurringInvoiceId: 'c', lineItems: [] }],
  });
  const all = recurringNotice(mixed.store.runDueRecurringInvoices(mixed.storage, '2026-11-16'));
  assert.equal(all.title, '3 wiederkehrende Rechnungen wurden als Entwurf angelegt.');
  assert.equal(all.text, 'Miete, Pacht. Eine wiederkehrende Rechnung war seit dem 10.08.2026 fällig. Helferlein hat nur die Rechnung für den 10.11.2026 angelegt; frühere Termine wurden übersprungen. '
    + 'Für den 05.11.2026 gab es bereits eine Rechnung aus „Wartung“; es wurde keine weitere angelegt. Bitte prüfen, eine Rechnungsnummer vergeben und versenden.');
  assert.deepEqual([all.href, all.linkLabel], ['/invoices', 'Zu den Rechnungen']);
});

test('isAutoBackupDue: a last backup dated in the future (wrong clock once) does not stop the automatic backup', () => {
  const { isAutoBackupDue, daysSinceBackup, AUTO_BACKUP_INTERVAL_DAYS } = createLoader()('src/lib/sessionTasks.ts');
  assert.equal(AUTO_BACKUP_INTERVAL_DAYS, 7);
  assert.equal(isAutoBackupDue({ lastBackupDate: '2026-12-24' }, '2026-11-16'), true, 'future date');
  assert.equal(isAutoBackupDue({ lastBackupDate: '2026-11-17' }, '2026-11-16'), true, 'one day ahead');
  assert.equal(isAutoBackupDue({ lastBackupDate: '2031-01-01T08:00:00.000Z' }, '2026-11-16'), true);
  assert.equal(isAutoBackupDue({ lastBackupDate: '2026-11-16' }, '2026-11-16'), false);
  assert.equal(isAutoBackupDue({ lastBackupDate: '2026-11-10' }, '2026-11-16'), false);
  assert.equal(isAutoBackupDue({ lastBackupDate: '2026-11-09' }, '2026-11-16'), true);
  assert.equal(isAutoBackupDue({}, '2026-11-16'), true);
  assert.equal(isAutoBackupDue({ lastBackupDate: '2026-02-30' }, '2026-11-16'), true);
  assert.equal(isAutoBackupDue({ lastBackupDate: '2026-11-15' }, '2026-11-16', 1), true);
  assert.equal(typeof isAutoBackupDue({ lastBackupDate: '2020-01-01' }), 'boolean', 'today is the default');
  // The displayed age stays a plain number.
  assert.equal(daysSinceBackup({ lastBackupDate: '2026-12-24' }, '2026-11-16'), 0);
});

// ─── Recurring invoices and § 13b ───────────────────────────────────────────

test('runDueRecurringInvoices: a schedule for a customer marked for § 13b creates the draft without VAT', () => {
  const customer = { id: 'cust-1', name: 'Bau GmbH', address: 'Am Hang 2', contact: '', taxId: 'de 123456789', reverseCharge: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const env = setup({
    settings: { defaultEInvoice: SELLER, defaultTaxRate: 0.19 }, customers: [customer],
    recurringInvoices: [recurring({ nextRunDate: '2026-11-01', lineItems: [line('rl-1', 80, { taxRate: 0.07 }), line('rl-2', 100)] })],
  });
  const [run] = env.store.runDueRecurringInvoices(env.storage, '2026-11-16');
  const invoice = run.invoices[0];
  assert.equal(invoice.reverseCharge, true);
  assert.deepEqual(invoice.lineItems.map(item => item.taxRate), [0, 0]);
  assert.equal(invoice.einvoice.taxCategory, 'AE');
  assert.equal(invoice.einvoice.taxExemptionReason, env.documents.REVERSE_CHARGE_NOTE);
  assert.equal(invoice.einvoice.buyer.vatId, 'DE123456789');
  assert.equal(invoice.einvoice.iban, SELLER.iban);
  assert.deepEqual(env.load('src/lib/calc.ts').computeInvoiceTotals(invoice), { subtotal: 180, taxTotal: 0, total: 180 });
  // The switch can be taken back on the draft: the rates of the schedule return.
  assert.deepEqual(env.documents.switchReverseCharge(env.data().invoices[0], false, 0.19).lineItems.map(item => item.taxRate), [0.07, 0.19]);
  // The schedule itself and the settings keep their rates and defaults.
  assert.deepEqual(env.data().recurringInvoices[0].lineItems.map(item => item.taxRate), [0.07, 0.19]);
  assert.equal(env.data().settings.defaultEInvoice.taxCategory, undefined);
  env.assertValid();
});

test('runDueRecurringInvoices: without the § 13b mark, or without a customer, the draft carries VAT as before', () => {
  for (const customers of [[], [{ id: 'cust-1', name: 'Kunde Schäfer', address: '', contact: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]]) {
    const env = setup({ customers, recurringInvoices: [recurring({ nextRunDate: '2026-11-01' })] });
    const invoice = env.store.runDueRecurringInvoices(env.storage, '2026-11-16')[0].invoices[0];
    assert.equal(invoice.reverseCharge, undefined);
    assert.deepEqual(invoice.lineItems.map(item => item.taxRate), [0.19]);
    assert.equal(invoice.reverseChargePreviousRates, undefined);
    env.assertValid();
  }
});
