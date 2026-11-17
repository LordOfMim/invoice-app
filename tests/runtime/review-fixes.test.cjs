'use strict';
// Fixes from the usability review of 1.4: drafts, data entered once, the built-in declaration values.
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { isValidPersistedData } = require('../../electron/storage-validation.cjs');

const KEY = 'invoice-app:v1';
const load = createLoader();
const calc = load('src/lib/calc.ts');
const { invoiceStatus } = load('src/components/invoiceStatus.ts');
const derived = load('src/lib/einvoice/derived.ts');
const { prepareEInvoice } = load('src/lib/einvoice/index.ts');
const { currentSender } = load('src/lib/documents.ts');

function storeWith(seed) {
  const store = createLoader()('src/lib/storage/store.ts');
  const values = new Map([[KEY, JSON.stringify({ schemaVersion: 1, settings: {}, invoices: [], ...seed })]]);
  const adapter = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  store.loadData(adapter);
  return { store, adapter, values };
}
const line = (id, unitPrice, unit = 'Std') => ({ id, type: 'item', description: `Leistung ${id}`, quantity: 2, unitPrice, taxRate: 0.19, unit });
function invoice(extra = {}) {
  return {
    id: 'i', invoiceNumber: '2026-001', invoiceDate: '2026-11-02', dueDate: '2026-11-16', currency: 'EUR',
    sender: { name: 'Muster Innenausbau GmbH', address: 'Werkstattweg 12\n12345 Musterstadt', contact: 'Tel. 030 1234567\ninfo@muster.example' },
    recipient: { name: 'Beispiel Bau GmbH', address: 'Hauptstraße 5\n10115 Berlin', contact: '' },
    lineItems: [line('a', 50)], payments: [], attachments: [], tagIds: [], creditNoteIds: [],
    texts: { documentTitle: 'Rechnung' }, layout: { showLogo: false },
    einvoice: { seller: { taxId: '12/345/67890' }, iban: 'DE02120300000000202051' },
    ...extra,
  };
}

// ── Drafts ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('an invoice without number is a draft whatever its amount; payment or paid mark make it issued', () => {
  assert.equal(calc.isDraftInvoice({ invoiceNumber: '', payments: [] }), true);
  assert.equal(calc.isDraftInvoice({ invoiceNumber: '   ', payments: [] }), true);
  assert.equal(calc.isDraftInvoice({ invoiceNumber: '2026-1', payments: [] }), false);
  assert.equal(calc.isDraftInvoice({ invoiceNumber: '', payments: [{ amount: 10 }] }), false);
  assert.equal(calc.isDraftInvoice({ invoiceNumber: '', paid: true, payments: [] }), false);
  const draft = invoice({ invoiceNumber: '', dueDate: '2020-01-01' });
  const balance = calc.computeInvoiceBalance(draft, [], '2026-11-17');
  assert.equal(balance.isOverdue, true, 'the balance itself is unchanged');
  assert.equal(invoiceStatus(draft, balance, 'de').key, 'draft');
  assert.equal(invoiceStatus(draft, balance, 'de').label, 'Entwurf');
  const issued = invoice({ dueDate: '2020-01-01' });
  assert.equal(invoiceStatus(issued, calc.computeInvoiceBalance(issued, [], '2026-11-17'), 'de').key, 'overdue');
});

test('drafts are no receivables in the key figures', () => {
  const { store, adapter } = storeWith({
    invoices: [
      invoice({ id: 'issued', invoiceNumber: '2026-001', dueDate: '2020-01-01' }),
      invoice({ id: 'draft', invoiceNumber: '', dueDate: '2020-01-01', lineItems: [line('b', 1000)] }),
      invoice({ id: 'paid-without-number', invoiceNumber: '', paid: true }),
    ],
  });
  const stats = store.getDashboardStats(adapter);
  assert.equal(stats.unpaidTotal, 119, 'only the issued invoice is open (2 × 50 € + 19 %)');
  assert.equal(stats.openCount, 1);
  assert.equal(stats.overdueCount, 1);
  assert.equal(stats.invoiceCount, 2, 'the draft is not counted as an issued invoice');
  assert.equal(stats.statusCounts.paid, 1);
});

// ── Data entered once ────────────────────────────────────────────────────────────────────────────────────────────

test('splitPostalAddress reads street, postal code, city and country from a free-text address', () => {
  assert.deepEqual(derived.splitPostalAddress('Hauptstraße 5\n10115 Berlin'), { street: 'Hauptstraße 5', postalCode: '10115', city: 'Berlin', countryCode: 'DE' });
  assert.deepEqual(derived.splitPostalAddress('z. Hd. Frau Muster\nAm Hafen 9\n20457 Hamburg\nDeutschland'), { street: 'Am Hafen 9', postalCode: '20457', city: 'Hamburg', countryCode: 'DE' });
  assert.deepEqual(derived.splitPostalAddress('Ringstraße 1\nA-1010 Wien'), { street: 'Ringstraße 1', postalCode: '1010', city: 'Wien', countryCode: 'AT' });
  assert.deepEqual(derived.splitPostalAddress('Bahnhofstrasse 3\n8001 Zürich\nSchweiz'), { street: 'Bahnhofstrasse 3', postalCode: '8001', city: 'Zürich', countryCode: 'CH' });
  assert.deepEqual(derived.splitPostalAddress('Hauptstraße 5, 10115 Berlin'), { street: 'Hauptstraße 5', postalCode: '10115', city: 'Berlin', countryCode: 'DE' });
  assert.deepEqual(derived.splitPostalAddress('D-50667 Köln'), { postalCode: '50667', city: 'Köln', countryCode: 'DE' });
  assert.deepEqual(derived.splitPostalAddress(''), {});
  assert.deepEqual(derived.splitPostalAddress('Postfach irgendwo'), {}, 'nothing guessed without a postal code');
});

test('e-mail and telephone come from the contact lines', () => {
  assert.equal(derived.firstEmail('Tel. 030 1234567\ninfo@muster.example'), 'info@muster.example');
  assert.equal(derived.firstEmail('E-Mail: <buero@firma.example>.'), 'buero@firma.example');
  assert.equal(derived.firstEmail('kein Kontakt'), undefined);
  assert.equal(derived.firstPhone('Tel. 030 1234567\ninfo@muster.example'), '030 1234567');
  assert.equal(derived.firstPhone('Telefon: +49 (30) 123 456-7'), '+49 (30) 123 456-7');
  assert.equal(derived.firstPhone('info@muster.example'), undefined);
});

test('the e-invoice fills structured details from the invoice; entries in the tab win', () => {
  const plain = invoice();
  const seller = derived.effectiveParty(plain, 'seller');
  assert.equal(seller.party.street, 'Werkstattweg 12');
  assert.equal(seller.party.city, 'Musterstadt');
  assert.equal(seller.party.email, 'info@muster.example');
  assert.equal(seller.party.electronicAddress, 'info@muster.example');
  assert.equal(seller.party.electronicAddressScheme, 'EM');
  assert.equal(seller.party.contactName, 'Muster Innenausbau GmbH');
  assert.equal(seller.party.contactPhone, '030 1234567');
  assert.equal(seller.party.taxId, '12/345/67890', 'explicit values stay');
  assert.ok(seller.derived.has('street') && !seller.derived.has('taxId'));

  const overridden = derived.effectiveParty(invoice({ einvoice: { seller: { street: 'Lieferadresse 1', electronicAddress: '0204:991-1', electronicAddressScheme: '0204' } } }), 'seller');
  assert.equal(overridden.party.street, 'Lieferadresse 1');
  assert.equal(overridden.party.postalCode, '12345', 'gaps are still filled');
  assert.equal(overridden.party.electronicAddress, '0204:991-1');
  assert.equal(overridden.party.electronicAddressScheme, '0204', 'an own electronic address keeps its scheme');

  // ZUGFeRD needs nothing beyond the invoice itself, the tax number and the IBAN.
  const result = prepareEInvoice(invoice(), 'zugferd');
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.document.buyer.street, 'Hauptstraße 5');
  assert.equal(result.document.buyer.countryCode, 'DE');
  assert.equal(result.document.seller.postalCode, '12345');
  assert.equal(result.document.paymentTerms, 'Zahlbar ohne Abzug bis 16.11.2026.');
  // XRechnung additionally needs the buyer's electronic address and the reference.
  const xr = prepareEInvoice(invoice(), 'xrechnung');
  assert.deepEqual(xr.errors.map((error) => error.field).sort(), ['einvoice.buyer.electronicAddress', 'einvoice.buyer.electronicAddressScheme', 'einvoice.buyerReference'].sort());
  const complete = prepareEInvoice(invoice({ einvoice: { seller: { taxId: '12/345/67890' }, iban: 'DE02120300000000202051', buyer: { email: 'rechnung@beispielbau.example' }, buyerReference: '991-01234-56' } }), 'xrechnung');
  assert.equal(complete.ok, true, JSON.stringify(complete.errors));
  assert.equal(complete.document.buyer.electronicAddress, 'rechnung@beispielbau.example');
});

test('payment terms follow the due date unless the notes already state them', () => {
  assert.equal(derived.derivedPaymentTerms({ invoiceDate: '2026-11-02', dueDate: '2026-11-16', notesText: '' }), 'Zahlbar ohne Abzug bis 16.11.2026.');
  assert.equal(derived.derivedPaymentTerms({ invoiceDate: '2026-11-02', dueDate: '2026-11-02', notesText: '' }), 'Zahlbar sofort ohne Abzug.');
  assert.equal(derived.derivedPaymentTerms({ invoiceDate: '2026-11-02', dueDate: '2026-11-16', notesText: 'Zahlbar innerhalb von 14 Tagen.' }), undefined);
  const entered = prepareEInvoice(invoice({ einvoice: { seller: { taxId: '1' }, iban: 'DE02120300000000202051', paymentTerms: '2 % Skonto bis 9.11.' } }), 'zugferd');
  assert.equal(entered.document.paymentTerms, '2 % Skonto bis 9.11.');
});

test('units as craftsmen write them are recognised', () => {
  for (const [unit, code] of [['Std', 'HUR'], ['Std.', 'HUR'], ['Stk.', 'C62'], ['m²', 'MTK'], ['qm', 'MTK'], ['m2', 'MTK'], ['lfm', 'MTR'], ['lfd. m', 'MTR'], ['m³', 'MTQ'], ['psch', 'C62'], ['pauschal', 'C62'], ['t', 'TNE'], ['Woche', 'WEE'], ['', 'C62']]) {
    assert.equal(derived.unitCodeFor(unit), code, unit);
  }
  assert.equal(derived.unitCodeFor('Eimer'), undefined);
  const result = prepareEInvoice(invoice({ lineItems: [line('a', 10, 'm²'), line('b', 10, 'lfm'), line('c', 10, 'psch')] }), 'zugferd');
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.document.lines.map((entry) => entry.unitCode), ['MTK', 'MTR', 'C62']);
  assert.ok(prepareEInvoice(invoice({ lineItems: [line('a', 10, 'Eimer')] }), 'zugferd').errors.some((error) => error.field === 'einvoice.unitCodes.a'));
});

test('the sender of a new document comes from the settings once they have one', () => {
  const old = { name: 'Alt GmbH', address: 'Alter Weg 1\n10115 Berlin', contact: '' };
  assert.deepEqual(currentSender(old, { defaultSender: { name: 'Neu GmbH', address: 'Neuer Weg 2\n10115 Berlin', contact: '' } }).name, 'Neu GmbH');
  assert.deepEqual(currentSender(old, { defaultSender: { name: ' ', address: '', contact: '' } }), old);
  assert.deepEqual(currentSender(old, undefined), old);
});

test('a recurring run takes the current sender, the current customer and the customer\'s e-invoice details', () => {
  const { store, adapter, values } = storeWith({
    settings: { defaultSender: { name: 'Neu GmbH', address: 'Neuer Weg 2\n10115 Berlin', contact: '' }, defaultEInvoice: { seller: { taxId: '12/345/67890' }, iban: 'DE02120300000000202051' }, defaultFooterLeftText: 'Geschäftsführung: Max Muster' },
    customers: [{ id: 'c', name: 'Kunde Neu', salutation: 'Sehr geehrte Frau Muster,', address: 'Umzugsweg 3\n20457 Hamburg', contact: '', email: 'rechnung@kunde.example', buyerReference: '991-77', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    recurringInvoices: [{ id: 'r', name: 'Wartung', frequency: 'monthly', nextRunDate: '2026-11-01', active: true, autoGenerate: true, reminderDays: 3, customerId: 'c', sender: { name: 'Alt GmbH', address: 'Alter Weg 1', contact: '' }, recipient: { name: 'Kunde Alt', address: 'Alte Adresse', contact: '' }, lineItems: [line('a', 100)], footerText: '', texts: {}, layout: {}, currency: 'EUR', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  });
  const runs = store.runDueRecurringInvoices(adapter, '2026-11-17');
  assert.equal(runs.length, 1);
  const created = store.loadData(adapter).invoices[0];
  assert.equal(created.sender.name, 'Neu GmbH');
  assert.equal(created.recipient.name, 'Kunde Neu');
  assert.equal(created.recipient.salutation, 'Sehr geehrte Frau Muster,');
  assert.equal(created.einvoice.buyer.email, 'rechnung@kunde.example');
  assert.equal(created.einvoice.buyerReference, '991-77');
  assert.equal(created.einvoice.seller.taxId, '12/345/67890');
  assert.equal(created.footerLeftText, 'Geschäftsführung: Max Muster');
  assert.equal(isValidPersistedData(JSON.parse(values.get(KEY))), true);
});

test('new invoices start with the footer columns from the settings; customers keep a Leitweg-ID', () => {
  const { store, adapter, values } = storeWith({ settings: { defaultFooterLeftText: 'Links', defaultFooterRightText: 'Rechts' } });
  const created = store.createInvoice(adapter);
  assert.equal(created.footerLeftText, 'Links');
  assert.equal(created.footerRightText, 'Rechts');
  const customer = { ...store.createCustomer(adapter), name: 'Amt', buyerReference: '991-01234-56' };
  store.upsertCustomer(adapter, customer);
  const saved = JSON.parse(values.get(KEY));
  assert.equal(isValidPersistedData(saved), true);
  assert.equal(saved.customers[0].buyerReference, '991-01234-56');
  assert.equal(isValidPersistedData({ ...saved, customers: [{ ...saved.customers[0], buyerReference: 5 }] }), false);
});

// ── Built-in declaration values ──────────────────────────────────────────────────────────────────────────────────

test('the built-in declaration values belong to the original installation only', () => {
  const { loadDeclarationDefaults } = createLoader()('src/lib/declarationDefaults.ts');
  const empty = { getItem: () => null };
  const fresh = loadDeclarationDefaults(empty, { settings: { defaultSender: { name: 'Muster Innenausbau GmbH', address: '', contact: '' } }, invoices: [] });
  assert.equal(fresh.senderAddress, '');
  assert.equal(fresh.recipientName, '');
  assert.equal(fresh.signatureName, '');
  assert.equal(loadDeclarationDefaults(empty, null).senderAddress, '', 'no data: empty, never a foreign business');
  const original = loadDeclarationDefaults(empty, { settings: { defaultSender: { name: '', address: '', contact: '' } }, invoices: [{ sender: { name: 'Fa. Dembiany', address: '', contact: '' } }] });
  assert.match(original.senderAddress, /Dembiany/);
  const bySettings = loadDeclarationDefaults(empty, { settings: { defaultSender: { name: 'Fa.Dembiany', address: '', contact: '' } } });
  assert.match(bySettings.signatureName, /Dembiany/);
  // Saved standard values always win.
  const saved = loadDeclarationDefaults({ getItem: () => JSON.stringify({ senderAddress: 'Eigene Firma', recipientName: '', recipientAddress: '', kommission: '', signatureName: 'Ich', signatureImage: null }) }, null);
  assert.equal(saved.senderAddress, 'Eigene Firma');
});
