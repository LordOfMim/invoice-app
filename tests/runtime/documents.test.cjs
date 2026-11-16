'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load-typescript.cjs');

const load = createLoader();
const documents = load('src/lib/documents.ts');
const calc = load('src/lib/calc.ts');
const defaults = load('src/lib/defaults.ts');
const { todayLocalISO, addDays } = load('src/lib/date.ts');

const settings = (overrides = {}) => ({ ...defaults.createDefaultSettings(), ...overrides });
const item = (id, quantity, unitPrice, taxRate) => ({ id, type: 'item', description: id, quantity, unitPrice, taxRate });
const header = (id) => ({ id, type: 'header', description: id, quantity: 0, unitPrice: 0 });
function invoice(overrides = {}) {
  return { ...defaults.createInvoiceFromDefaults(settings()), lineItems: [item('l1', 1, 1000, 0.19)], ...overrides };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Reverse charge ─────────────────────────────────────────────────────────────────────────────────────────────

test('reverse charge sets every position to 0 % and fills what the E-Rechnung needs', () => {
  const source = invoice({ lineItems: [item('a', 2, 100, 0.19), header('h'), item('b', 1, 50, 0.19)] });
  const on = documents.applyReverseCharge(source, true, 0.19);
  assert.equal(on.reverseCharge, true);
  assert.deepEqual(on.lineItems.map((line) => line.taxRate), [0, undefined, 0]);
  assert.equal(on.einvoice.taxCategory, 'AE');
  assert.equal(on.einvoice.taxExemptionReason, documents.REVERSE_CHARGE_NOTE);
  assert.deepEqual(calc.computeInvoiceTotals(on), { subtotal: 250, taxTotal: 0, total: 250 });
  // The source record is not changed in place.
  assert.equal(source.reverseCharge, undefined);
  assert.deepEqual(source.lineItems.map((line) => line.taxRate), [0.19, undefined, 0.19]);
  assert.equal(source.einvoice, undefined);
});

test('switching reverse charge on and off again restores a standard-rate invoice', () => {
  const source = invoice({ lineItems: [item('a', 2, 100, 0.19), header('h'), item('b', 1, 50, 0.19)], einvoice: { iban: 'DE02120300000000202051' } });
  const back = documents.applyReverseCharge(documents.applyReverseCharge(source, true, 0.19), false, 0.19);
  assert.equal(back.reverseCharge, undefined);
  assert.deepEqual(back.lineItems, source.lineItems);
  assert.deepEqual(calc.computeInvoiceTotals(back), calc.computeInvoiceTotals(source));
  assert.equal(back.einvoice.taxCategory, undefined);
  assert.equal(back.einvoice.taxExemptionReason, undefined);
  assert.equal(back.einvoice.iban, 'DE02120300000000202051');
  // Nothing is left behind that the persisted-data validator or JSON would see.
  assert.deepEqual(JSON.parse(JSON.stringify(back.einvoice)), { iban: 'DE02120300000000202051' });
});

test('reverse charge keeps a reason the user wrote and only removes its own', () => {
  const custom = invoice({ einvoice: { taxExemptionReason: 'Bauleistung nach § 13b Abs. 2 Nr. 4 UStG' } });
  const on = documents.applyReverseCharge(custom, true, 0.19);
  assert.equal(on.einvoice.taxExemptionReason, 'Bauleistung nach § 13b Abs. 2 Nr. 4 UStG');
  const off = documents.applyReverseCharge(on, false, 0.19);
  assert.equal(off.einvoice.taxCategory, undefined);
  assert.equal(off.einvoice.taxExemptionReason, 'Bauleistung nach § 13b Abs. 2 Nr. 4 UStG');
});

test('switching reverse charge off leaves an unrelated tax category alone', () => {
  const exempt = invoice({ lineItems: [item('a', 1, 100, 0)], einvoice: { taxCategory: 'E', taxExemptionReason: '§ 19 UStG' } });
  const off = documents.applyReverseCharge(exempt, false, undefined);
  assert.equal(off.einvoice.taxCategory, 'E');
  assert.equal(off.einvoice.taxExemptionReason, '§ 19 UStG');
  // Without a default rate the positions stay untaxed.
  assert.deepEqual(off.lineItems.map((line) => line.taxRate), [0]);
});

test('new positions start without tax on a reverse-charge invoice', () => {
  assert.equal(documents.lineTaxRateFor({ reverseCharge: true }, 0.19), 0);
  assert.equal(documents.lineTaxRateFor({ reverseCharge: false }, 0.19), 0.19);
  assert.equal(documents.lineTaxRateFor({}, 0.07), 0.07);
  assert.equal(documents.lineTaxRateFor({}, undefined), undefined);
});

// ── Advance and final invoices ─────────────────────────────────────────────────────────────────────────────────

const recipient = (name) => ({ name, address: '', contact: '' });
function advance(id, number, date, overrides = {}) {
  return invoice({ id, invoiceNumber: number, invoiceDate: date, invoiceKind: 'advance', customerId: 'c1', recipient: recipient('Bau GmbH'), ...overrides });
}

test('advance candidates: numbered advance invoices of the same customer, oldest first', () => {
  const target = invoice({ id: 'final', customerId: 'c1', recipient: recipient('Bau GmbH') });
  const all = [
    advance('a2', 'AR-2', '2026-03-01'),
    advance('a1', 'AR-1', '2026-02-01'),
    advance('a3', 'AR-3', '2026-02-01'),
    advance('draft', '  ', '2026-01-01'),
    advance('other', 'AR-9', '2026-01-01', { customerId: 'c2' }),
    advance('usd', 'AR-8', '2026-01-01', { currency: 'USD' }),
    invoice({ id: 'std', invoiceNumber: 'R-1', customerId: 'c1' }),
    invoice({ id: 'fin', invoiceNumber: 'SR-1', customerId: 'c1', invoiceKind: 'final' }),
    { ...target, invoiceKind: 'advance', invoiceNumber: 'SELF' },
  ];
  assert.deepEqual(documents.findAdvanceCandidates(all, target).map((entry) => entry.id), ['a1', 'a3', 'a2']);
});

test('advance candidates: the project narrows the list only when both sides name one', () => {
  const all = [
    advance('north', 'AR-1', '2026-01-01', { projectReference: ' bv nord ' }),
    advance('south', 'AR-2', '2026-01-02', { projectReference: 'BV Süd' }),
    advance('none', 'AR-3', '2026-01-03'),
  ];
  const target = invoice({ id: 'final', customerId: 'c1', projectReference: 'BV Nord' });
  assert.deepEqual(documents.findAdvanceCandidates(all, target).map((entry) => entry.id), ['north', 'none']);
  assert.deepEqual(documents.findAdvanceCandidates(all, { ...target, projectReference: undefined }).map((entry) => entry.id), ['north', 'south', 'none']);
});

test('advance candidates: without a customer link the recipient name decides, and an empty name matches nobody', () => {
  const all = [
    advance('same', 'AR-1', '2026-01-01', { customerId: undefined, recipient: recipient(' bau gmbh ') }),
    advance('else', 'AR-2', '2026-01-02', { customerId: undefined, recipient: recipient('Andere GmbH') }),
    advance('blank', 'AR-3', '2026-01-03', { customerId: undefined, recipient: recipient('') }),
  ];
  const target = invoice({ id: 'final', recipient: recipient('Bau GmbH') });
  assert.deepEqual(documents.findAdvanceCandidates(all, target).map((entry) => entry.id), ['same']);
  assert.deepEqual(documents.findAdvanceCandidates(all, { ...target, recipient: recipient('') }), []);
});

const credit = (id, linkedInvoiceId, amount, type = 'gutschrift') => ({ id, type, linkedInvoiceId, amount });

test('advance candidates: an advance invoice another final invoice already deducts is not offered again', () => {
  const target = invoice({ id: 'final', customerId: 'c1', invoiceKind: 'final' });
  const deduct = (invoiceId) => ({ id: `d-${invoiceId}`, invoiceId, invoiceNumber: 'x', invoiceDate: '2026-02-01', net: 1000, tax: 190 });
  const all = [
    advance('a1', 'AR-1', '2026-02-01'),
    advance('a2', 'AR-2', '2026-03-01'),
    advance('a3', 'AR-3', '2026-04-01'),
    advance('a4', 'AR-4', '2026-05-01'),
    invoice({ id: 'other-final', invoiceNumber: 'SR-1', customerId: 'c1', invoiceKind: 'final', advanceDeductions: [deduct('a1'), { ...deduct(undefined), id: 'by-hand' }] }),
    // A list kept on an invoice that is no longer final deducts nothing (computeAdvanceDeductions ignores it).
    invoice({ id: 'was-final', invoiceNumber: 'R-7', customerId: 'c1', advanceDeductions: [deduct('a2')] }),
    // A final invoice of another customer that deducts it still means: it has been deducted.
    invoice({ id: 'foreign-final', invoiceNumber: 'SR-9', customerId: 'c2', invoiceKind: 'final', advanceDeductions: [deduct('a4')] }),
    // Its own deductions do not hide a candidate; the editor filters those itself.
    { ...target, advanceDeductions: [deduct('a3')] },
  ];
  assert.deepEqual(documents.findAdvanceCandidates(all, target, []).map((entry) => entry.id), ['a2', 'a3']);
  assert.deepEqual(documents.findAdvanceCandidates(all, target).map((entry) => entry.id), ['a2', 'a3'], 'credit notes missing in old callers');
  // Making the invoice final pre-fills only what is still free.
  const final = documents.applyInvoiceKind(invoice({ id: 'final', customerId: 'c1' }), 'final', all, []);
  assert.deepEqual(final.advanceDeductions.map((entry) => entry.invoiceId), ['a2', 'a3']);
});

test('advance candidates: fully credited advance invoices are left out, partly credited ones are offered with the rest', () => {
  const target = invoice({ id: 'final', customerId: 'c1', lineItems: [item('l', 1, 5000, 0.19)] });
  const all = [
    advance('storno', 'AR-1', '2026-02-01'),                                              // 1190.00
    advance('twice', 'AR-2', '2026-02-02'),                                               // 1190.00, two credit notes
    advance('part', 'AR-3', '2026-02-03'),                                                // 1190.00, 297.50 credited
    advance('mixed', 'AR-4', '2026-02-04', { lineItems: [item('x', 1, 1000, 0.19), item('y', 1, 500, 0.07)] }), // 1725.00
    advance('free', 'AR-5', '2026-02-05'),
    advance('over', 'AR-6', '2026-02-06'),
  ];
  const creditNotes = [
    credit('c1', 'storno', 1190, 'storno'),
    credit('c2', 'twice', 600), credit('c3', 'twice', 590),
    credit('c4', 'part', 297.5),
    credit('c5', 'mixed', 575),
    credit('c6', 'over', 5000),
    credit('c7', 'elsewhere', 99999),
    credit('c8', 'free', -50), credit('c9', 'free', 0),
  ];
  assert.deepEqual(documents.findAdvanceCandidates(all, target, creditNotes).map((entry) => entry.id), ['part', 'mixed', 'free']);
  assert.deepEqual(documents.findAdvanceCandidates(all, target, []).length, 6);

  const amounts = (id) => { const { net, tax } = documents.advanceDeductionFrom(all.find((entry) => entry.id === id), creditNotes); return { net, tax }; };
  // 1190 − 297.50 = 892.50 gross, a quarter less of net and VAT alike.
  assert.deepEqual(amounts('part'), { net: 750, tax: 142.5 });
  // 1725 − 575 = 1150 gross = two thirds: VAT 225 → 150, net is the rest.
  assert.deepEqual(amounts('mixed'), { net: 1000, tax: 150 });
  assert.deepEqual(amounts('free'), { net: 1000, tax: 190 });
  assert.deepEqual(amounts('storno'), { net: 0, tax: 0 });
  // Without credit notes the full amounts, as before.
  assert.deepEqual({ net: documents.advanceDeductionFrom(all[2]).net, tax: documents.advanceDeductionFrom(all[2]).tax }, { net: 1000, tax: 190 });

  // The pre-filled final invoice demands exactly what is left, with the calc.ts rules.
  const final = documents.applyInvoiceKind(target, 'final', all, creditNotes);
  assert.deepEqual(final.advanceDeductions.map((entry) => [entry.invoiceId, entry.net, entry.tax]), [['part', 750, 142.5], ['mixed', 1000, 150], ['free', 1000, 190]]);
  const payable = calc.computeInvoicePayable(final);
  assert.deepEqual([payable.deducted, payable.deductedTax, payable.payable, payable.payableTax], [3232.5, 482.5, 2717.5, 467.5]);
});

test('advance candidates: a partial credit keeps gross = net + tax to the cent', () => {
  const source = advance('odd', 'AR-1', '2026-02-01', { lineItems: [item('x', 3, 333.33, 0.19), item('y', 1, 10, 0.07)] }); // 1009.99 + 190.70 = 1200.69
  const deduction = documents.advanceDeductionFrom(source, [credit('c1', 'odd', 100.01)]);
  assert.equal(Math.round((deduction.net + deduction.tax) * 100), 110068);
  assert.equal(deduction.tax, 174.82);
  assert.equal(deduction.net, 925.86);
});

test('a deduction is a snapshot of the advance invoice amounts', () => {
  const source = advance('a1', 'AR-1', '2026-02-01', { lineItems: [item('x', 3, 333.33, 0.19), header('h'), item('y', 1, 10, 0.07)] });
  const deduction = documents.advanceDeductionFrom(source);
  assert.match(deduction.id, UUID);
  assert.deepEqual({ ...deduction, id: '' }, { id: '', invoiceId: 'a1', invoiceNumber: 'AR-1', invoiceDate: '2026-02-01', net: 1009.99, tax: 190.7, sourceNet: 1009.99, sourceTax: 190.7 });
  // Later edits of the advance invoice do not reach the snapshot.
  source.lineItems[0].quantity = 100;
  assert.equal(deduction.net, 1009.99);
});

test('making an invoice final picks up the matching advance invoices and follows the standard title', () => {
  const all = [advance('a1', 'AR-1', '2026-02-01'), advance('a2', 'AR-2', '2026-03-01', { lineItems: [item('x', 1, 500, 0.19)] })];
  const target = invoice({ id: 'final', customerId: 'c1', lineItems: [item('l', 1, 5000, 0.19)] });
  const final = documents.applyInvoiceKind(target, 'final', all);
  assert.equal(final.invoiceKind, 'final');
  assert.equal(final.texts.documentTitle, 'Schlussrechnung');
  assert.deepEqual(final.advanceDeductions.map((entry) => [entry.invoiceNumber, entry.net, entry.tax]), [['AR-1', 1000, 190], ['AR-2', 500, 95]]);
  assert.deepEqual(calc.computeAdvanceDeductions(final), { net: 1500, tax: 285, gross: 1785 });
  assert.deepEqual(calc.computeInvoicePayable(final), { subtotal: 5000, taxTotal: 950, total: 5950, deducted: 1785, deductedTax: 285, payable: 4165, payableTax: 665 });
  assert.equal(target.invoiceKind, undefined);
  assert.equal(target.advanceDeductions, undefined);
});

test('a non-final invoice ignores stored deductions, and switching back loses nothing', () => {
  const all = [advance('a1', 'AR-1', '2026-02-01')];
  const final = documents.applyInvoiceKind(invoice({ id: 'final', customerId: 'c1', lineItems: [item('l', 1, 5000, 0.19)] }), 'final', all);
  const standard = documents.applyInvoiceKind(final, 'standard', all);
  assert.equal(standard.invoiceKind, undefined);
  assert.equal(standard.texts.documentTitle, 'Rechnung');
  assert.equal(standard.advanceDeductions.length, 1);
  assert.deepEqual(calc.computeAdvanceDeductions(standard), { net: 0, tax: 0, gross: 0 });
  assert.deepEqual(calc.computeInvoicePayable(standard), { subtotal: 5000, taxTotal: 950, total: 5950, deducted: 0, deductedTax: 0, payable: 5950, payableTax: 950 });
  const asAdvance = documents.applyInvoiceKind(standard, 'advance', all);
  assert.equal(asAdvance.texts.documentTitle, 'Abschlagsrechnung');
  assert.equal(calc.computeInvoicePayable(asAdvance).payable, 5950);
  // Back to final: the stored list is used again and not filled a second time.
  const again = documents.applyInvoiceKind(asAdvance, 'final', [...all, advance('a2', 'AR-2', '2026-03-01')]);
  assert.deepEqual(again.advanceDeductions, final.advanceDeductions);
  assert.equal(calc.computeInvoicePayable(again).payable, 4760);
});

test('a title the user wrote survives a change of the invoice kind', () => {
  const custom = invoice({ texts: { ...invoice().texts, documentTitle: 'Rechnung Nr. 1 zum Bauvorhaben' } });
  assert.equal(documents.applyInvoiceKind(custom, 'final', []).texts.documentTitle, 'Rechnung Nr. 1 zum Bauvorhaben');
  const empty = invoice({ texts: { ...invoice().texts, documentTitle: '  ' } });
  assert.equal(documents.applyInvoiceKind(empty, 'advance', []).texts.documentTitle, 'Abschlagsrechnung');
  assert.equal(documents.applyInvoiceKind(invoice(), 'final', []).advanceDeductions, undefined);
});

test('invoiceKindOf treats anything unknown as a standard invoice', () => {
  assert.equal(documents.invoiceKindOf({}), 'standard');
  assert.equal(documents.invoiceKindOf({ invoiceKind: 'standard' }), 'standard');
  assert.equal(documents.invoiceKindOf({ invoiceKind: 'advance' }), 'advance');
  assert.equal(documents.invoiceKindOf({ invoiceKind: 'final' }), 'final');
  assert.equal(documents.invoiceKindOf({ invoiceKind: 'teil' }), 'standard');
});

test('deductions tolerate broken amounts and may exceed the invoice total', () => {
  const final = invoice({ invoiceKind: 'final', lineItems: [item('l', 1, 100, 0.19)], advanceDeductions: [
    { id: 'd1', invoiceNumber: 'AR-1', invoiceDate: '2026-01-01', net: 0.1, tax: 0.02 },
    { id: 'd2', invoiceNumber: 'AR-2', invoiceDate: '2026-01-02', net: 0.2, tax: 0.04 },
    { id: 'd3', invoiceNumber: 'AR-3', invoiceDate: '2026-01-03', net: NaN, tax: undefined },
  ] });
  assert.deepEqual(calc.computeAdvanceDeductions(final), { net: 0.3, tax: 0.06, gross: 0.36 });
  const over = { ...final, advanceDeductions: [{ id: 'd', invoiceNumber: 'AR', invoiceDate: '2026-01-01', net: 200, tax: 38 }] };
  assert.equal(calc.computeInvoicePayable(over).payable, -119);
  assert.equal(calc.computeInvoicePayable(over).payableTax, -19);
  // The balance never asks for a negative amount.
  const balance = calc.computeInvoiceBalance(over, [], '2026-06-01');
  assert.equal(balance.remainingAmount, 0);
  assert.equal(balance.status, 'paid');
});

test('the open balance of a final invoice is what remains after the deducted advances', () => {
  const final = invoice({ invoiceKind: 'final', dueDate: '2026-05-01', lineItems: [item('l', 1, 5000, 0.19)], advanceDeductions: [{ id: 'd', invoiceNumber: 'AR', invoiceDate: '2026-01-01', net: 1000, tax: 190 }], payments: [{ id: 'p', amount: 760, date: '2026-04-01' }] });
  const balance = calc.computeInvoiceBalance(final, [], '2026-06-01');
  assert.equal(balance.invoiceTotal, 4760);
  assert.equal(balance.remainingAmount, 4000);
  assert.equal(balance.status, 'partial');
  assert.equal(calc.computeInvoiceBalance({ ...final, invoiceKind: undefined }, [], '2026-06-01').remainingAmount, 5190);
});

// ── Quotes ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('a new quote is an open quote that is valid for 30 days and carries quote wording', () => {
  const quote = documents.createQuoteFromDefaults(settings({ defaultPaymentTermDays: 14 }));
  assert.equal(quote.documentKind, 'quote');
  assert.equal(quote.quoteStatus, 'open');
  assert.equal(quote.invoiceNumber, '');
  assert.equal(quote.invoiceDate, todayLocalISO());
  assert.equal(quote.dueDate, addDays(quote.invoiceDate, documents.QUOTE_VALIDITY_DAYS));
  assert.deepEqual([quote.texts.documentTitle, quote.texts.invoiceNumberLabel, quote.texts.invoiceDateLabel, quote.texts.dueDateLabel], ['Angebot', 'Angebotsnummer', 'Angebotsdatum', 'Gültig bis']);
  assert.equal(quote.texts.totalLabel, 'Gesamt');
});

function acceptedQuote() {
  const base = documents.createQuoteFromDefaults(settings());
  return {
    ...base,
    id: 'quote-1',
    invoiceNumber: 'AN-2026-007',
    invoiceDate: '2026-02-01',
    dueDate: '2026-03-03',
    quoteStatus: 'accepted',
    convertedInvoiceId: 'stale-invoice',
    customerId: 'c1',
    recipient: recipient('Bau GmbH'),
    projectReference: 'BV Nord',
    notesText: 'Hinweis',
    tagIds: ['t1'],
    lineItems: [item('q1', 2, 100, 0.19), header('qh'), item('q2', 1, 50, 0.07)],
    einvoice: { unitCodes: { q1: 'HUR', gone: 'C62' }, buyer: { city: 'Köln' } },
    paid: true,
    payments: [{ id: 'p', amount: 1, date: '2026-02-02' }],
    attachments: [{ id: 'at', name: 'a.pdf', type: 'application/pdf', size: 1, dataUrl: 'data:,', createdAt: 'x' }],
    creditNoteIds: ['cn'],
    reminders: [{ id: 'r', level: 1, date: '2026-02-01', dueDate: '2026-02-11', createdAt: 'x' }],
    createdAt: '2026-02-01T08:00:00.000Z',
    updatedAt: '2026-02-01T08:00:00.000Z',
  };
}

test('the invoice for a quote is a new, unnumbered invoice dated today with a link to the quote', () => {
  const quote = acceptedQuote();
  const before = structuredClone(quote);
  const result = documents.invoiceFromQuote(quote, settings({ defaultPaymentTermDays: 14 }), '2026-03-20');
  assert.match(result.id, UUID);
  assert.notEqual(result.id, quote.id);
  assert.equal(result.invoiceNumber, '');
  assert.equal(result.invoiceDate, '2026-03-20');
  assert.equal(result.dueDate, '2026-04-03');
  assert.equal(result.sourceQuoteId, 'quote-1');
  // No quote markers: neither the kind, the status nor the back link of the quote.
  assert.equal(result.documentKind, undefined);
  assert.equal(result.quoteStatus, undefined);
  assert.equal(result.convertedInvoiceId, undefined);
  const stored = JSON.parse(JSON.stringify(result));
  for (const key of ['documentKind', 'quoteStatus', 'convertedInvoiceId', 'reminders']) assert.equal(key in stored, false, key);
  // A fresh ledger.
  assert.equal(result.paid, false);
  assert.deepEqual([result.payments, result.attachments, result.creditNoteIds], [[], [], []]);
  assert.notEqual(result.createdAt, quote.createdAt);
  // Content is carried over.
  assert.deepEqual([result.customerId, result.recipient.name, result.projectReference, result.notesText, result.tagIds], ['c1', 'Bau GmbH', 'BV Nord', 'Hinweis', ['t1']]);
  assert.deepEqual(result.lineItems.map(({ id, ...rest }) => rest), quote.lineItems.map(({ id, ...rest }) => rest));
  assert.deepEqual(calc.computeInvoiceTotals(result), calc.computeInvoiceTotals(quote));
  // The quote itself is untouched.
  assert.deepEqual(quote, before);
});

test('the invoice for a quote gets its own position ids and keeps the unit codes attached to them', () => {
  const quote = acceptedQuote();
  const result = documents.invoiceFromQuote(quote, settings(), '2026-03-20');
  const ids = result.lineItems.map((line) => line.id);
  assert.equal(new Set([...ids, 'q1', 'qh', 'q2']).size, 6);
  assert.deepEqual(result.einvoice.unitCodes, { [ids[0]]: 'HUR' });
  assert.deepEqual(result.einvoice.buyer, { city: 'Köln' });
  assert.notEqual(result.einvoice.buyer, quote.einvoice.buyer);
  assert.deepEqual(quote.einvoice.unitCodes, { q1: 'HUR', gone: 'C62' });
});

test('quote wording turns into the invoice wording of the settings; edited wording stays', () => {
  const quote = acceptedQuote();
  const plain = documents.invoiceFromQuote(quote, settings(), '2026-03-20');
  assert.deepEqual([plain.texts.documentTitle, plain.texts.invoiceNumberLabel, plain.texts.invoiceDateLabel, plain.texts.dueDateLabel], ['Rechnung', 'Rechnungsnummer', 'Rechnungsdatum', 'Fällig am']);

  const base = settings();
  const english = settings({ defaultTexts: { ...base.defaultTexts, documentTitle: 'Invoice', invoiceNumberLabel: '  ', dueDateLabel: 'Due' } });
  const edited = { ...quote, texts: { ...quote.texts, documentTitle: 'Kostenvoranschlag', dueDateLabel: ' Gültig bis ' } };
  const result = documents.invoiceFromQuote(edited, english, '2026-03-20');
  assert.equal(result.texts.documentTitle, 'Kostenvoranschlag');
  assert.equal(result.texts.invoiceNumberLabel, 'Rechnungsnummer'); // blank setting falls back to the German default
  assert.equal(result.texts.dueDateLabel, 'Due');
  assert.equal(quote.texts.documentTitle, 'Angebot');
});

test('the invoice for a quote without payment term is due on the invoice date', () => {
  assert.equal(documents.invoiceFromQuote(acceptedQuote(), settings(), '2026-03-20').dueDate, '2026-03-20');
  assert.equal(documents.invoiceFromQuote(acceptedQuote(), settings({ defaultPaymentTermDays: 30 }), '2026-12-15').dueDate, '2027-01-14');
});

test('the invoice for a quote picks up tax number and bank details added to the settings since', () => {
  const quote = { ...acceptedQuote(), einvoice: { iban: 'DE00QUOTE', seller: { vatId: 'DE111111111' } } };
  const result = documents.invoiceFromQuote(quote, settings({ defaultEInvoice: { iban: 'DE00SETTINGS', bic: 'BYLADEM1001', accountName: 'Max GmbH', seller: { taxId: '12/345/67890', vatId: 'DE999999999' } } }), '2026-03-20');
  assert.deepEqual(result.einvoice, { iban: 'DE00QUOTE', bic: 'BYLADEM1001', accountName: 'Max GmbH', seller: { vatId: 'DE111111111', taxId: '12/345/67890' } });
  assert.deepEqual(quote.einvoice, { iban: 'DE00QUOTE', seller: { vatId: 'DE111111111' } });
});

// ── Reminders ──────────────────────────────────────────────────────────────────────────────────────────────────

test('reminder levels escalate from the highest level issued and stop at 3', () => {
  const reminder = (level) => ({ id: `r${level}`, level, date: '2026-01-01', dueDate: '2026-01-11', createdAt: 'x' });
  assert.equal(documents.nextReminderLevel({}), 1);
  assert.equal(documents.nextReminderLevel({ reminders: [] }), 1);
  assert.equal(documents.nextReminderLevel({ reminders: [reminder(1)] }), 2);
  assert.equal(documents.nextReminderLevel({ reminders: [reminder(2), reminder(1)] }), 3);
  assert.equal(documents.nextReminderLevel({ reminders: [reminder(1), reminder(2), reminder(3)] }), 3);
  assert.equal(documents.nextReminderLevel({ reminders: [reminder(3), reminder(3)] }), 3);
  // A deleted first reminder does not lower the level.
  assert.equal(documents.nextReminderLevel({ reminders: [reminder(2)] }), 3);
});

test('a new reminder is dated today and due ten days later, across the year end', () => {
  const first = documents.createReminder({}, '2026-12-25');
  assert.match(first.id, UUID);
  assert.deepEqual({ level: first.level, date: first.date, dueDate: first.dueDate }, { level: 1, date: '2026-12-25', dueDate: '2027-01-04' });
  assert.equal(Number.isNaN(Date.parse(first.createdAt)), false);
  assert.equal('fee' in first, false);
  assert.equal('text' in first, false);
  const second = documents.createReminder({ reminders: [first] }, '2026-03-25');
  assert.deepEqual({ level: second.level, dueDate: second.dueDate }, { level: 2, dueDate: '2026-04-04' });
  assert.notEqual(second.id, first.id);
  assert.equal(documents.createReminder({}).date, todayLocalISO());
});

test('reminder titles and standard wording per level', () => {
  assert.deepEqual([1, 2, 3].map(documents.reminderTitle), ['Zahlungserinnerung', '1. Mahnung', '2. Mahnung']);
  const texts = [1, 2, 3].map(documents.defaultReminderText);
  assert.equal(new Set(texts).size, 3);
  for (const text of texts) {
    assert.equal(text.split('{frist}').length, 2, 'exactly one deadline placeholder');
    assert.deepEqual(text.match(/\{[^}]*\}/g), ['{frist}']);
    assert.match(text, /^[a-zäöü]/, 'continues the salutation line in lower case');
  }
  assert.match(texts[2], /letztmalig/);
  assert.doesNotMatch(texts[0], /gerichtlich/);
});

// ── Seller defaults and legal footer ───────────────────────────────────────────────────────────────────────────

const sellerDefaults = { defaultEInvoice: { iban: 'DE02120300000000202051', bic: 'BYLADEM1001', accountName: 'Max GmbH', paymentTerms: '14 Tage', seller: { taxId: '12/345/67890', vatId: 'DE123456789', city: 'Köln' } } };

test('lacksSellerDefaults: only tax numbers and bank details count, blank values count as missing', () => {
  assert.equal(documents.lacksSellerDefaults({}, undefined), false);
  assert.equal(documents.lacksSellerDefaults({}, {}), false);
  assert.equal(documents.lacksSellerDefaults({}, { defaultEInvoice: {} }), false);
  assert.equal(documents.lacksSellerDefaults({}, { defaultEInvoice: { paymentTerms: '14 Tage', seller: { city: 'Köln' }, iban: '  ' } }), false);
  assert.equal(documents.lacksSellerDefaults({}, sellerDefaults), true);
  const complete = { einvoice: { iban: 'X', bic: 'Y', accountName: 'Z', seller: { taxId: '1', vatId: '2' } } };
  assert.equal(documents.lacksSellerDefaults(complete, sellerDefaults), false);
  assert.equal(documents.lacksSellerDefaults({ einvoice: { ...complete.einvoice, bic: '  ' } }, sellerDefaults), true);
  assert.equal(documents.lacksSellerDefaults({ einvoice: { ...complete.einvoice, seller: { taxId: '1' } } }, sellerDefaults), true);
});

test('withSellerDefaults fills the gaps and never replaces a value of the document', () => {
  const document = { id: 'i', einvoice: { iban: 'DE00OLDACCOUNT', bic: ' ', buyerReference: 'LW-1', seller: { vatId: 'DE000000000', street: 'Weg 1' } } };
  const before = structuredClone(document);
  const filled = documents.withSellerDefaults(document, sellerDefaults);
  assert.deepEqual(filled, { id: 'i', einvoice: { iban: 'DE00OLDACCOUNT', bic: 'BYLADEM1001', accountName: 'Max GmbH', buyerReference: 'LW-1', seller: { vatId: 'DE000000000', street: 'Weg 1', taxId: '12/345/67890' } } });
  // Other defaults (payment terms, address) are not copied by this helper.
  assert.equal(filled.einvoice.paymentTerms, undefined);
  assert.equal(filled.einvoice.seller.city, undefined);
  assert.deepEqual(document, before);
  assert.equal(documents.lacksSellerDefaults(filled, sellerDefaults), false);
});

test('withSellerDefaults returns the same record when nothing is missing or no defaults exist', () => {
  const document = { einvoice: { iban: 'X', bic: 'Y', accountName: 'Z', seller: { taxId: '1', vatId: '2' } } };
  assert.equal(documents.withSellerDefaults(document, sellerDefaults), document);
  const bare = {};
  assert.equal(documents.withSellerDefaults(bare, undefined), bare);
  assert.equal(documents.withSellerDefaults(bare, {}), bare);
  assert.deepEqual(documents.withSellerDefaults(bare, sellerDefaults).einvoice, { iban: 'DE02120300000000202051', bic: 'BYLADEM1001', accountName: 'Max GmbH', seller: { taxId: '12/345/67890', vatId: 'DE123456789' } });
  // The settings object is not shared with the document.
  assert.notEqual(documents.withSellerDefaults(bare, sellerDefaults).einvoice.seller, sellerDefaults.defaultEInvoice.seller);
});

test('formatIban groups in blocks of four without a trailing space', () => {
  assert.equal(documents.formatIban('de02120300000000202051'), 'DE02 1203 0000 0000 2020 51');
  assert.equal(documents.formatIban(' DE02 1203 0000\t0000 2020 51 '), 'DE02 1203 0000 0000 2020 51');
  assert.equal(documents.formatIban('DE021203'), 'DE02 1203');
  assert.equal(documents.formatIban('DE0212030'), 'DE02 1203 0');
  assert.equal(documents.formatIban(''), '');
  assert.equal(documents.formatIban(undefined), '');
});

test('the legal footer prints tax numbers and bank details, trimmed and in a fixed order', () => {
  assert.deepEqual(documents.legalFooterLines({}), []);
  assert.deepEqual(documents.legalFooterLines({ einvoice: {} }), []);
  const full = { einvoice: { seller: { taxId: ' 12/345/67890 ', vatId: 'DE123456789' }, iban: 'de02 1203 0000 0000 2020 51', bic: ' BYLADEM1001 ', accountName: ' Max GmbH ' } };
  assert.deepEqual(documents.legalFooterLines(full), [
    'Steuernummer: 12/345/67890 · USt-IdNr.: DE123456789',
    'Max GmbH · IBAN: DE02 1203 0000 0000 2020 51 · BIC: BYLADEM1001',
  ]);
  assert.deepEqual(documents.legalFooterLines({ einvoice: { seller: { vatId: 'DE123456789' }, iban: 'DE02120300000000202051' } }), ['USt-IdNr.: DE123456789', 'IBAN: DE02 1203 0000 0000 2020 51']);
  // Blank values and bank details without an IBAN print nothing.
  assert.deepEqual(documents.legalFooterLines({ einvoice: { seller: { taxId: '  ' }, iban: ' ', bic: 'BYLADEM1001', accountName: 'Max GmbH' } }), []);
});

test('the legal footer skips what the hand-typed footer already shows, however it is spaced', () => {
  const full = { einvoice: { seller: { taxId: '12/345/67890', vatId: 'DE123456789' }, iban: 'DE02120300000000202051', bic: 'BYLADEM1001' } };
  assert.deepEqual(documents.legalFooterLines(full, 'St.-Nr. 12 / 345 / 67890\nBank: de02 1203 0000 0000 2020 51'), ['USt-IdNr.: DE123456789']);
  assert.deepEqual(documents.legalFooterLines(full, 'USt-IdNr. de 123 456 789'), ['Steuernummer: 12/345/67890', 'IBAN: DE02 1203 0000 0000 2020 51 · BIC: BYLADEM1001']);
  assert.deepEqual(documents.legalFooterLines(full, 'Steuernummer 12/345/67890 · USt-IdNr. DE123456789 · IBAN DE02120300000000202051'), []);
  assert.equal(documents.legalFooterLines(full, 'Vielen Dank für Ihren Auftrag.').length, 2);
});

// ── Contractor declarations ────────────────────────────────────────────────────────────────────────────────────

const declarationDefaults = { senderAddress: 'Max GmbH · Weg 1 · 12345 Ort', recipientName: 'Stammkunde', recipientAddress: 'Allee 2', kommission: 'BV Standard', signatureName: 'Max Mustermann' };

test('senderLine joins name and address lines and drops empty parts', () => {
  assert.equal(documents.senderLine({ name: ' Max GmbH ', address: 'Weg 1\r\n\r\n 12345 Ort ' }), 'Max GmbH · Weg 1 · 12345 Ort');
  assert.equal(documents.senderLine({ name: '', address: 'Weg 1\n12345 Ort' }), 'Weg 1 · 12345 Ort');
  assert.equal(documents.senderLine({ name: 'Max GmbH', address: '' }), 'Max GmbH');
  assert.equal(documents.senderLine({ name: ' ', address: ' \n ' }), '');
});

test('a new declaration starts from the defaults with the standard wording', () => {
  const declaration = documents.createDeclaration(declarationDefaults, '2026-05-05');
  assert.match(declaration.id, UUID);
  assert.equal(declaration.createdAt, declaration.updatedAt);
  const { id, createdAt, updatedAt, ...content } = declaration;
  assert.deepEqual(content, { date: '2026-05-05', ...declarationDefaults, bodyText: documents.DECLARATION_BODY_TEXT });
  assert.equal('invoiceId' in declaration, false);
  assert.notEqual(documents.createDeclaration(declarationDefaults).id, declaration.id);
  assert.equal(documents.createDeclaration(declarationDefaults).date, todayLocalISO());
});

test('a declaration for an invoice takes recipient, project and sender from the invoice', () => {
  const source = invoice({ id: 'inv-1', customerId: 'c1', projectReference: '  BV Nord ', sender: { name: 'Bau & Söhne', address: 'Hof 3\n54321 Dorf', contact: '' }, recipient: { name: 'Bau GmbH', address: 'Ring 9\n50667 Köln', contact: '' } });
  const { id, createdAt, updatedAt, ...content } = documents.declarationFromInvoice(source, declarationDefaults, '2026-05-05');
  assert.match(id, UUID);
  assert.deepEqual(content, {
    date: '2026-05-05', senderAddress: 'Bau & Söhne · Hof 3 · 54321 Dorf', recipientName: 'Bau GmbH', recipientAddress: 'Ring 9\n50667 Köln',
    kommission: 'BV Nord', bodyText: documents.DECLARATION_BODY_TEXT, signatureName: 'Bau & Söhne', invoiceId: 'inv-1', customerId: 'c1',
  });
});

test('a declaration for an invoice falls back to the defaults for an empty sender, never for the project', () => {
  const source = invoice({ id: 'inv-2', sender: { name: '', address: '', contact: '' }, recipient: recipient('Bau GmbH') });
  const declaration = documents.declarationFromInvoice(source, declarationDefaults, '2026-05-05');
  assert.equal(declaration.senderAddress, declarationDefaults.senderAddress);
  assert.equal(declaration.signatureName, declarationDefaults.signatureName);
  // The project of another customer must not leak into this declaration.
  assert.equal(declaration.kommission, '');
  assert.equal(declaration.customerId, undefined);
});

// ── Duplicating ────────────────────────────────────────────────────────────────────────────────────────────────

test('a duplicate is a new unnumbered document without history, payments, links or date of supply', () => {
  const source = invoice({
    id: 'orig', invoiceNumber: 'RE-2026-010', invoiceKind: 'final', reverseCharge: true, projectReference: 'BV Nord', customerId: 'c1',
    lineItems: [item('l1', 1, 100, 0), header('h'), item('l2', 2, 50, 0)],
    advanceDeductions: [{ id: 'd', invoiceNumber: 'AR-1', invoiceDate: '2026-01-01', net: 10, tax: 0 }],
    paid: true, payments: [{ id: 'p', amount: 1, date: '2026-01-01' }],
    attachments: [{ id: 'at', name: 'a.pdf', type: 'application/pdf', size: 1, dataUrl: 'data:,', createdAt: 'x' }],
    creditNoteIds: ['cn'],
    reminders: [{ id: 'r', level: 2, date: '2026-02-01', dueDate: '2026-02-11', createdAt: 'x' }],
    sourceQuoteId: 'quote-1', convertedInvoiceId: 'stale', quoteStatus: 'accepted',
    einvoice: { serviceDate: '2026-01-15', taxCategory: 'AE', iban: 'DE02', unitCodes: { l2: 'HUR', gone: 'C62' } },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const before = structuredClone(source);
  const copy = defaults.duplicateInvoice(source);
  assert.match(copy.id, UUID);
  assert.equal(copy.invoiceNumber, '');
  assert.equal(copy.paid, false);
  assert.deepEqual([copy.payments, copy.attachments, copy.creditNoteIds], [[], [], []]);
  for (const key of ['advanceDeductions', 'reminders', 'sourceQuoteId', 'convertedInvoiceId', 'quoteStatus', 'documentKind']) assert.equal(copy[key], undefined, key);
  assert.equal(copy.einvoice.serviceDate, undefined);
  assert.notEqual(copy.createdAt, source.createdAt);
  // What describes the work stays.
  assert.deepEqual([copy.invoiceKind, copy.reverseCharge, copy.projectReference, copy.customerId], ['final', true, 'BV Nord', 'c1']);
  assert.deepEqual([copy.einvoice.taxCategory, copy.einvoice.iban], ['AE', 'DE02']);
  const ids = copy.lineItems.map((line) => line.id);
  assert.equal(new Set([...ids, 'l1', 'h', 'l2']).size, 6);
  assert.deepEqual(copy.einvoice.unitCodes, { [ids[2]]: 'HUR' });
  assert.deepEqual(copy.lineItems.map(({ id, ...rest }) => rest), source.lineItems.map(({ id, ...rest }) => rest));
  assert.deepEqual(source, before);
  // A copied final invoice deducts nothing until advances are chosen again.
  assert.equal(calc.computeInvoicePayable(copy).deducted, 0);
});

test('a duplicate of an invoice from a recurring schedule does not belong to that schedule', () => {
  const source = invoice({ id: 'run-1', invoiceNumber: 'RE-2026-011', invoiceDate: '2026-03-31', recurringInvoiceId: 'rec-1' });
  const copy = defaults.duplicateInvoice(source);
  assert.equal(copy.recurringInvoiceId, undefined);
  assert.equal(source.recurringInvoiceId, 'rec-1', 'the original keeps its link');
  // Stored as JSON the copy carries no trace of the schedule.
  assert.equal('recurringInvoiceId' in JSON.parse(JSON.stringify(copy)), false);
  // An invoice without a schedule stays without one.
  assert.equal(defaults.duplicateInvoice(invoice()).recurringInvoiceId, undefined);
});

test('a duplicated quote is an open quote again without a link to an invoice', () => {
  const quote = { ...documents.createQuoteFromDefaults(settings()), invoiceNumber: 'AN-1', quoteStatus: 'declined', convertedInvoiceId: 'inv-1' };
  const copy = defaults.duplicateInvoice(quote);
  assert.deepEqual([copy.documentKind, copy.quoteStatus, copy.convertedInvoiceId, copy.invoiceNumber], ['quote', 'open', undefined, '']);
  assert.equal(copy.texts.documentTitle, 'Angebot');
});

// ── Second review round ────────────────────────────────────────────────────────────────────────────────────────

const creditOf = (id, linkedInvoiceId, amount, type = 'storno') => ({ id, type, linkedInvoiceId, amount, creditNoteNumber: id, creditNoteDate: '2026-11-01' });

test('advance candidates: a final invoice cancelled in full no longer blocks the advance invoices it deducted', () => {
  // Advance A 5.950 gross; final F 14.280 deducting A (payable 8.330); F is cancelled; the replacement must deduct A again.
  const advance = invoice({ id: 'adv', invoiceKind: 'advance', invoiceNumber: '2026-012', invoiceDate: '2026-05-01', customerId: 'c1', lineItems: [item('a', 1, 5000, 0.19)] });
  const final = invoice({ id: 'fin', invoiceKind: 'final', invoiceNumber: '2026-020', customerId: 'c1', lineItems: [item('f', 1, 12000, 0.19)] });
  final.advanceDeductions = [documents.advanceDeductionFrom(advance)];
  assert.equal(calc.computeInvoicePayable(final).payable, 8330);
  const replacement = invoice({ id: 'new', invoiceKind: 'final', customerId: 'c1', lineItems: [item('n', 1, 12000, 0.19)] });
  const all = [advance, final, replacement];

  // Still valid: the original deducts it, nothing is offered, and the editor can say why.
  assert.deepEqual(documents.findAdvanceCandidates(all, replacement, []), []);
  assert.deepEqual(documents.findAdvancesDeductedElsewhere(all, replacement, []).map((entry) => [entry.advance.id, entry.deductedBy.id]), [['adv', 'fin']]);
  // A partial Gutschrift on the final invoice does not free the advance.
  assert.deepEqual(documents.findAdvanceCandidates(all, replacement, [creditOf('g', 'fin', 1000, 'gutschrift')]), []);

  // Cancelled in full (the Storno covers the payable 8.330): the advance is offered and deducted again.
  const storno = [creditOf('s', 'fin', 8330)];
  assert.deepEqual(documents.findAdvanceCandidates(all, replacement, storno).map((entry) => entry.id), ['adv']);
  assert.deepEqual(documents.findAdvancesDeductedElsewhere(all, replacement, storno), []);
  const asFinal = documents.applyInvoiceKind({ ...replacement, invoiceKind: undefined }, 'final', all, storno);
  assert.equal(calc.computeInvoicePayable(asFinal).payable, 8330);
  // Several credit notes that add up count the same.
  assert.deepEqual(documents.findAdvanceCandidates(all, replacement, [creditOf('s1', 'fin', 8000), creditOf('s2', 'fin', 330)]).map((entry) => entry.id), ['adv']);
});

test('a copy of a valid final invoice gets no deductions offered; a copy of a cancelled one does', () => {
  const advance = invoice({ id: 'adv', invoiceKind: 'advance', invoiceNumber: '2026-012', customerId: 'c1', lineItems: [item('a', 1, 5000, 0.19)] });
  const final = invoice({ id: 'fin', invoiceKind: 'final', invoiceNumber: '2026-020', customerId: 'c1', lineItems: [item('f', 1, 12000, 0.19)] });
  final.advanceDeductions = [documents.advanceDeductionFrom(advance)];
  const copy = defaults.duplicateInvoice(final);
  assert.equal(copy.advanceDeductions, undefined);
  assert.deepEqual(documents.findAdvanceCandidates([advance, final, copy], copy, []), []);
  assert.equal(documents.findAdvancesDeductedElsewhere([advance, final, copy], copy, [])[0].deductedBy.id, 'fin');
  assert.deepEqual(documents.findAdvanceCandidates([advance, final, copy], copy, [creditOf('s', 'fin', 8330)]).map((entry) => entry.id), ['adv']);
});

test('checkAdvanceDeductions reports deductions whose advance invoice was cancelled, reduced, edited or deleted', () => {
  const advance = invoice({ id: 'adv', invoiceKind: 'advance', invoiceNumber: '2026-012', invoiceDate: '2026-05-01', customerId: 'c1', lineItems: [item('a', 1, 5000, 0.19)] });
  const deduction = documents.advanceDeductionFrom(advance);
  const manual = { id: 'manual', invoiceNumber: 'alt-7', invoiceDate: '2026-01-01', net: 100, tax: 19 };
  const final = invoice({ id: 'fin', invoiceKind: 'final', customerId: 'c1', lineItems: [item('f', 1, 12000, 0.19)], advanceDeductions: [deduction, manual] });
  const before = JSON.stringify(final);

  // Unchanged source, and deductions typed in by hand: nothing to report.
  assert.deepEqual(documents.checkAdvanceDeductions(final, [advance, final], []), []);

  // Storno of the advance invoice.
  assert.deepEqual(documents.checkAdvanceDeductions(final, [advance, final], [creditOf('s', 'adv', 5950)]),
    [{ deductionId: deduction.id, kind: 'cancelled', invoiceNumber: '2026-012', deductedGross: 5950, currentGross: 0 }]);
  // … a deduction already set to zero by hand is not reported again.
  const zeroed = { ...final, advanceDeductions: [{ ...deduction, net: 0, tax: 0 }] };
  assert.deepEqual(documents.checkAdvanceDeductions(zeroed, [advance, zeroed], [creditOf('s', 'adv', 5950)]), []);

  // Gutschrift over 1.190: 4.760 gross remain; "Abzug aktualisieren" takes exactly what a new deduction would be.
  const reduced = documents.checkAdvanceDeductions(final, [advance, final], [creditOf('g', 'adv', 1190, 'gutschrift')]);
  assert.deepEqual(reduced, [{ deductionId: deduction.id, kind: 'changed', invoiceNumber: '2026-012', deductedGross: 5950, currentGross: 4760,
    current: { invoiceNumber: '2026-012', invoiceDate: '2026-05-01', net: 4000, tax: 760, sourceNet: 4000, sourceTax: 760 } }]);
  const fresh = documents.advanceDeductionFrom(advance, [creditOf('g', 'adv', 1190, 'gutschrift')]);
  assert.deepEqual([reduced[0].current.net, reduced[0].current.tax], [fresh.net, fresh.tax]);
  const updated = { ...final, advanceDeductions: [{ ...deduction, ...reduced[0].current }, manual] };
  assert.deepEqual(documents.checkAdvanceDeductions(updated, [advance, updated], [creditOf('g', 'adv', 1190, 'gutschrift')]), []);

  // The advance invoice was edited afterwards.
  const edited = { ...advance, invoiceNumber: '2026-012a', lineItems: [item('a', 1, 6000, 0.19)] };
  const changed = documents.checkAdvanceDeductions(final, [edited, final], []);
  assert.deepEqual([changed[0].kind, changed[0].invoiceNumber, changed[0].currentGross, changed[0].current.net], ['changed', '2026-012a', 7140, 6000]);

  // The advance invoice was deleted: the link points nowhere.
  assert.deepEqual(documents.checkAdvanceDeductions(final, [final], []),
    [{ deductionId: deduction.id, kind: 'missing', invoiceNumber: '2026-012', deductedGross: 5950, currentGross: 0 }]);

  // A final invoice that was itself cancelled in full is history and reports nothing.
  assert.deepEqual(documents.checkAdvanceDeductions(final, [final], [creditOf('sf', 'fin', calc.computeInvoicePayable(final).payable)]), []);
  // An invoice that is not final deducts nothing and reports nothing; the check never changes a record.
  assert.deepEqual(documents.checkAdvanceDeductions({ ...final, invoiceKind: undefined }, [final], []), []);
  assert.equal(JSON.stringify(final), before);
});

test('reverse charge remembers the tax category and reason of a Kleinunternehmer invoice and puts both back', () => {
  const exempt = invoice({ lineItems: [item('a', 1, 100, 0)], einvoice: { taxCategory: 'E', taxExemptionReason: 'Kein Ausweis von Umsatzsteuer (§ 19 UStG).', iban: 'DE02120300000000202051' } });
  const on = documents.switchReverseCharge(exempt, true, 0.19);
  assert.equal(on.einvoice.taxCategory, 'AE');
  assert.equal(on.einvoice.taxExemptionReason, documents.REVERSE_CHARGE_NOTE);
  assert.deepEqual(on.reverseChargePreviousTax, { taxCategory: 'E', taxExemptionReason: 'Kein Ausweis von Umsatzsteuer (§ 19 UStG).' });
  // Switching it on a second time must not overwrite what was remembered.
  assert.deepEqual(documents.applyReverseCharge(on, true, 0.19).reverseChargePreviousTax, on.reverseChargePreviousTax);
  // It survives a reload.
  const off = documents.switchReverseCharge(JSON.parse(JSON.stringify(on)), false, 0.19);
  assert.deepEqual(JSON.parse(JSON.stringify(off.einvoice)), exempt.einvoice);
  assert.equal(off.reverseCharge, undefined);
  assert.equal(off.reverseChargePreviousTax, undefined);
  assert.equal(off.reverseChargePreviousRates, undefined);
  assert.deepEqual(off.lineItems, exempt.lineItems);
});

test('switching reverse charge off never leaves the § 13b wording behind', () => {
  // No category before: the reason typed while § 13b was on goes with it.
  const plain = invoice({ einvoice: { iban: 'DE02120300000000202051' } });
  const on = documents.applyReverseCharge(plain, true, 0.19);
  const reworded = { ...on, einvoice: { ...on.einvoice, taxExemptionReason: 'Bauleistung, Steuerschuld beim Empfänger (§ 13b Abs. 2 Nr. 4 UStG)' } };
  assert.deepEqual(JSON.parse(JSON.stringify(documents.applyReverseCharge(reworded, false, 0.19).einvoice)), { iban: 'DE02120300000000202051' });
  // Switched on by the previous version (nothing remembered): the standard note still goes.
  const legacy = invoice({ reverseCharge: true, lineItems: [item('a', 1, 100, 0)], einvoice: { taxCategory: 'AE', taxExemptionReason: documents.REVERSE_CHARGE_NOTE } });
  assert.deepEqual(JSON.parse(JSON.stringify(documents.applyReverseCharge(legacy, false, 0.19).einvoice)), {});
  // "AE" chosen by hand before the switch is not what the invoice returns to.
  const manualAe = invoice({ einvoice: { taxCategory: 'AE', taxExemptionReason: documents.REVERSE_CHARGE_NOTE } });
  const back = documents.applyReverseCharge(documents.applyReverseCharge(manualAe, true, 0.19), false, 0.19);
  assert.deepEqual(JSON.parse(JSON.stringify(back.einvoice)), {});
  // A category chosen by hand while § 13b was on stays; only the § 13b note goes.
  const other = documents.applyReverseCharge({ ...on, einvoice: { ...on.einvoice, taxCategory: 'K' } }, false, 0.19);
  assert.equal(other.einvoice.taxCategory, 'K');
  assert.equal(other.einvoice.taxExemptionReason, undefined);
});

test('a duplicate of a § 13b invoice gets its 7 % and 19 % back when § 13b is switched off', () => {
  const source = invoice({ lineItems: [item('a', 1, 100, 0.07), header('h'), item('b', 1, 100, 0.19), item('c', 1, 100, undefined)], einvoice: { unitCodes: { a: 'HUR', b: 'C62' } } });
  const on = documents.switchReverseCharge(source, true, 0.19);
  const copy = defaults.duplicateInvoice(on);
  assert.equal(copy.reverseCharge, true);
  assert.deepEqual(Object.keys(copy.reverseChargePreviousRates).sort(), [copy.lineItems[0].id, copy.lineItems[2].id, copy.lineItems[3].id].sort());
  assert.deepEqual(copy.einvoice.unitCodes, { [copy.lineItems[0].id]: 'HUR', [copy.lineItems[2].id]: 'C62' });
  const off = documents.switchReverseCharge(copy, false, 0.19);
  assert.deepEqual(off.lineItems.map((line) => line.taxRate), [0.07, undefined, 0.19, undefined]);
  // The original keeps its own memory.
  assert.deepEqual(documents.switchReverseCharge(on, false, 0.19).lineItems.map((line) => line.taxRate), [0.07, undefined, 0.19, undefined]);
});

test('the invoice for a § 13b quote gets its tax rates back when § 13b is switched off', () => {
  const quote = documents.switchReverseCharge({ ...documents.createQuoteFromDefaults(settings()), lineItems: [item('a', 1, 100, 0.07), item('b', 1, 100, 0.19)] }, true, 0.19);
  const converted = documents.invoiceFromQuote(quote, settings(), '2026-11-16');
  assert.deepEqual(Object.keys(converted.reverseChargePreviousRates).sort(), converted.lineItems.map((line) => line.id).sort());
  assert.deepEqual(documents.switchReverseCharge(converted, false, 0.19).lineItems.map((line) => line.taxRate), [0.07, 0.19]);
});

test('remapLineIdKeys moves keys to the copies and drops keys of lines that are gone', () => {
  assert.equal(defaults.remapLineIdKeys(undefined, [{ id: 'a' }], [{ id: 'x' }]), undefined);
  assert.deepEqual(defaults.remapLineIdKeys({ a: 0.07, b: null, gone: 1 }, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'x' }, { id: 'y' }, { id: 'z' }]), { x: 0.07, y: null });
});

test('a deduction lowered by hand is the user\'s decision and is not reported; a later change of the advance still is', () => {
  const adv = advance('a1', '2026-012', '2026-05-01', { lineItems: [item('a', 1, 5000, 0.19)] });
  const taken = documents.advanceDeductionFrom(adv);
  const lowered = { ...taken, net: 4000, tax: 760 };
  const final = invoice({ id: 'f', customerId: 'c1', invoiceKind: 'final', lineItems: [item('l', 1, 12000, 0.19)], advanceDeductions: [lowered] });
  assert.deepEqual(documents.checkAdvanceDeductions(final, [adv, final], []), []);
  // The advance invoice itself changes afterwards: reported, with the hand-set amount as what is deducted.
  const edited = { ...adv, lineItems: [item('a', 1, 6000, 0.19)] };
  const issues = documents.checkAdvanceDeductions(final, [edited, final], []);
  assert.deepEqual([issues[0].kind, issues[0].deductedGross, issues[0].currentGross], ['changed', 4760, 7140]);
  // "Abzug so lassen" stores what the advance is now and keeps the amounts; the note is gone.
  const kept = { ...final, advanceDeductions: [{ ...lowered, sourceNet: issues[0].current.sourceNet, sourceTax: issues[0].current.sourceTax }] };
  assert.deepEqual(documents.checkAdvanceDeductions(kept, [edited, kept], []), []);
  assert.deepEqual([kept.advanceDeductions[0].net, kept.advanceDeductions[0].tax], [4000, 760]);
  // Deductions stored before these fields existed compare with their own amounts, as before.
  const legacy = { ...final, advanceDeductions: [{ id: 'd', invoiceId: 'a1', invoiceNumber: '2026-012', invoiceDate: '2026-05-01', net: 5000, tax: 950 }] };
  assert.deepEqual(documents.checkAdvanceDeductions(legacy, [adv, legacy], []), []);
});

test('a cancelled final invoice whose advances covered everything frees those advances again', () => {
  const adv = advance('a1', '2026-012', '2026-05-01', { lineItems: [item('a', 1, 5000, 0.19)] });
  const covered = invoice({ id: 'f1', customerId: 'c1', invoiceKind: 'final', lineItems: [item('l', 1, 5000, 0.19)], advanceDeductions: [documents.advanceDeductionFrom(adv)] });
  const next = invoice({ id: 'f2', customerId: 'c1', lineItems: [item('l', 1, 5000, 0.19)] });
  assert.deepEqual(documents.findAdvanceCandidates([adv, covered, next], next, []).map((entry) => entry.id), []);
  const storno = { id: 's', type: 'storno', linkedInvoiceId: 'f1', amount: 0 };
  assert.deepEqual(documents.findAdvanceCandidates([adv, covered, next], next, [storno]).map((entry) => entry.id), ['a1']);
});
