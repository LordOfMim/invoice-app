'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load-typescript.cjs');

const load = createLoader();
const { periodFor, customPeriod, collectExportRows, exportCsv } = load('src/lib/taxExport.ts');
const defaults = load('src/lib/defaults.ts');
const { todayLocalISO } = load('src/lib/date.ts');

const bounds = (period) => [period.from, period.to];
const item = (id, quantity, unitPrice, taxRate) => ({ id, type: 'item', description: id, quantity, unitPrice, taxRate });
function invoice(id, number, date, overrides = {}) {
  return {
    ...defaults.createInvoiceFromDefaults(defaults.createDefaultSettings()),
    id, invoiceNumber: number, invoiceDate: date, dueDate: date,
    recipient: { name: `Kunde ${id}`, address: '', contact: '' },
    lineItems: [item(`${id}-1`, 1, 1000, 0.19)],
    ...overrides,
  };
}
function creditNote(id, number, date, linked, amount, overrides = {}) {
  return {
    schemaVersion: 1, id, type: 'storno', creditNoteNumber: number, creditNoteDate: date,
    linkedInvoiceId: linked.id, linkedInvoiceNumber: linked.invoiceNumber, reason: '', amount,
    sender: linked.sender, recipient: linked.recipient, footerText: '', texts: defaults.createDefaultCreditNoteTextsDe(),
    createdAt: 'x', updatedAt: 'x', ...overrides,
  };
}
const Q1 = { from: '2026-01-01', to: '2026-03-31' };

// ── Periods ────────────────────────────────────────────────────────────────────────────────────────────────────

test('periodFor: the month around a date, with the real last day', () => {
  assert.deepEqual(periodFor('month', '2026-11-16'), { from: '2026-11-01', to: '2026-11-30', label: 'November 2026', fileLabel: '2026-11' });
  assert.deepEqual(bounds(periodFor('month', '2026-02-10')), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(bounds(periodFor('month', '2024-02-29')), ['2024-02-01', '2024-02-29']);
  assert.equal(periodFor('month', '2026-03-05').label, 'März 2026');
  // The last and the first day of a month stay in their month (no clock-change or overflow slip).
  assert.deepEqual(bounds(periodFor('month', '2026-03-31')), ['2026-03-01', '2026-03-31']);
  assert.deepEqual(bounds(periodFor('month', '2026-10-01')), ['2026-10-01', '2026-10-31']);
});

test('periodFor: month offsets cross year boundaries in both directions', () => {
  assert.deepEqual(periodFor('month', '2026-01-15', -1), { from: '2025-12-01', to: '2025-12-31', label: 'Dezember 2025', fileLabel: '2025-12' });
  assert.deepEqual(periodFor('month', '2026-12-31', 1), { from: '2027-01-01', to: '2027-01-31', label: 'Januar 2027', fileLabel: '2027-01' });
  assert.equal(periodFor('month', '2026-03-15', -14).fileLabel, '2025-01');
  assert.equal(periodFor('month', '2026-03-15', -15).fileLabel, '2024-12');
  assert.equal(periodFor('month', '2026-03-15', 22).fileLabel, '2028-01');
  // From the 31st into a shorter month: still the neighbouring month, not the one after.
  assert.deepEqual(bounds(periodFor('month', '2026-03-31', -1)), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(bounds(periodFor('month', '2026-01-31', 1)), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(bounds(periodFor('month', '2026-05-31', 1)), ['2026-06-01', '2026-06-30']);
});

test('periodFor: quarters', () => {
  assert.deepEqual(periodFor('quarter', '2026-02-15'), { from: '2026-01-01', to: '2026-03-31', label: '1. Quartal 2026', fileLabel: '2026-Q1' });
  assert.deepEqual(bounds(periodFor('quarter', '2026-06-30')), ['2026-04-01', '2026-06-30']);
  assert.deepEqual(bounds(periodFor('quarter', '2026-07-01')), ['2026-07-01', '2026-09-30']);
  assert.deepEqual(bounds(periodFor('quarter', '2026-12-31')), ['2026-10-01', '2026-12-31']);
  assert.deepEqual(periodFor('quarter', '2026-02-15', -1), { from: '2025-10-01', to: '2025-12-31', label: '4. Quartal 2025', fileLabel: '2025-Q4' });
  assert.deepEqual(periodFor('quarter', '2026-11-15', 1), { from: '2027-01-01', to: '2027-03-31', label: '1. Quartal 2027', fileLabel: '2027-Q1' });
  assert.equal(periodFor('quarter', '2026-05-31', -6).fileLabel, '2024-Q4');
  assert.equal(periodFor('quarter', '2026-05-31', -4).fileLabel, '2025-Q2');
  assert.equal(periodFor('quarter', '2026-05-31', 7).fileLabel, '2028-Q1');
});

test('periodFor: years', () => {
  assert.deepEqual(periodFor('year', '2026-05-31'), { from: '2026-01-01', to: '2026-12-31', label: 'Jahr 2026', fileLabel: '2026' });
  assert.deepEqual(bounds(periodFor('year', '2026-01-01', -1)), ['2025-01-01', '2025-12-31']);
  assert.deepEqual(bounds(periodFor('year', '2026-12-31', 2)), ['2028-01-01', '2028-12-31']);
});

test('periodFor: consecutive offsets tile the calendar without gaps or overlaps', () => {
  const { addDays } = load('src/lib/date.ts');
  for (const kind of ['month', 'quarter', 'year']) {
    for (let offset = -30; offset < 30; offset += 1) {
      const current = periodFor(kind, '2026-05-31', offset), next = periodFor(kind, '2026-05-31', offset + 1);
      assert.equal(addDays(current.to, 1), next.from, `${kind} ${offset}`);
      assert.ok(current.from <= current.to);
    }
  }
});

test('periodFor: an unusable anchor means the current period', () => {
  const today = todayLocalISO();
  assert.deepEqual(periodFor('month', 'gestern'), periodFor('month', today));
  assert.deepEqual(periodFor('year', ''), periodFor('year', today));
});

test('customPeriod: inclusive range with German label, or null', () => {
  assert.deepEqual(customPeriod('2026-01-15', '2026-02-03'), { from: '2026-01-15', to: '2026-02-03', label: '15.01.2026 bis 03.02.2026', fileLabel: '2026-01-15_bis_2026-02-03' });
  assert.deepEqual(bounds(customPeriod('2026-01-01', '2026-01-01')), ['2026-01-01', '2026-01-01']);
  assert.equal(customPeriod('2026-02-01', '2026-01-31'), null);
  assert.equal(customPeriod('', '2026-01-31'), null);
  assert.equal(customPeriod('2026-01-01', ''), null);
  assert.equal(customPeriod('01.01.2026', '31.01.2026'), null);
  assert.equal(customPeriod('2026-1-1', '2026-01-31'), null);
});

test('customPeriod: a date that does not exist in the calendar is not a bound', () => {
  assert.equal(customPeriod('2026-02-30', '2026-03-31'), null);
  assert.equal(customPeriod('2026-01-01', '2026-02-30'), null);
  assert.equal(customPeriod('2026-02-29', '2026-03-31'), null);
  assert.equal(customPeriod('2026-04-31', '2026-05-31'), null);
  assert.equal(customPeriod('2026-13-01', '2026-13-02'), null);
  assert.equal(customPeriod('0000-00-00', '2026-01-31'), null);
  // The leap day itself is fine.
  assert.deepEqual(bounds(customPeriod('2024-02-29', '2024-02-29')), ['2024-02-29', '2024-02-29']);
});

// ── Rows ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('rows: both bounds of the period are included, the days around it are not', () => {
  const invoices = [
    invoice('before', 'R-0', '2025-12-31'),
    invoice('first', 'R-1', '2026-01-01'),
    invoice('last', 'R-2', '2026-03-31'),
    invoice('after', 'R-3', '2026-04-01'),
    invoice('nodate', 'R-4', ''),
  ];
  const summary = collectExportRows(invoices, [], Q1);
  assert.deepEqual(summary.rows.map((row) => row.id), ['first', 'last']);
  assert.equal(summary.skippedDrafts, 0);
  assert.deepEqual(collectExportRows(invoices, [], { from: '2026-03-31', to: '2026-03-31' }).rows.map((row) => row.id), ['last']);
});

test('rows: drafts without a number are counted, not exported, and only inside the period', () => {
  const invoices = [
    invoice('ok', 'R-1', '2026-02-01'),
    invoice('draft1', '', '2026-02-02'),
    invoice('draft2', '   ', '2026-03-31'),
    invoice('draft-outside', '', '2026-04-01'),
  ];
  const summary = collectExportRows(invoices, [], Q1);
  assert.deepEqual(summary.rows.map((row) => row.id), ['ok']);
  assert.equal(summary.skippedDrafts, 2);
  assert.deepEqual(summary.totals, { net: 1000, tax: 190, gross: 1190, open: 1190 });
});

test('rows: an invoice row carries amounts, payment state and document details', () => {
  const paid = invoice('paid', ' R-7 ', '2026-02-01', {
    recipient: { name: ' Bau GmbH ', address: '', contact: '' }, projectReference: ' BV Nord ', einvoice: { serviceDate: '2026-01-20' },
    lineItems: [item('a', 3, 333.33, 0.19), item('b', 1, 10, 0.07)],
    payments: [{ id: 'p1', amount: 1000, date: '2026-02-20' }, { id: 'p2', amount: 200.69, date: '2026-02-10' }],
  });
  const [row] = collectExportRows([paid], [], Q1, 'EUR', '2026-06-01').rows;
  assert.equal(row.invoice, paid);
  const { invoice: _linked, ...plain } = row;
  assert.deepEqual(plain, {
    id: 'paid', kind: 'invoice', typeLabel: 'Rechnung', number: 'R-7', date: '2026-02-01', serviceDate: '2026-01-20', customer: 'Bau GmbH', project: 'BV Nord',
    net: 1009.99, tax: 190.7, gross: 1200.69, deducted: 0, deductedTax: 0, payable: 1200.69, payableNet: 1009.99, payableTax: 190.7, paid: 1200.69, paidOn: '2026-02-20', open: 0, note: '', currency: 'EUR',
  });
});

test('rows: payment date only once the invoice is settled; the paid flag alone counts as settled', () => {
  const partial = invoice('partial', 'R-1', '2026-02-01', { payments: [{ id: 'p', amount: 190, date: '2026-02-10' }] });
  const flagged = invoice('flagged', 'R-2', '2026-02-02', { paid: true });
  const open = invoice('open', 'R-3', '2026-02-03');
  const rows = collectExportRows([partial, flagged, open], [], Q1, 'EUR', '2026-06-01').rows;
  assert.deepEqual(rows.map((row) => [row.id, row.paid, row.paidOn, row.open]), [['partial', 190, '', 1000], ['flagged', 1190, '', 0], ['open', 0, '', 1190]]);
});

test('rows: invoice kinds, reverse charge and currency', () => {
  const invoices = [
    invoice('std', 'R-1', '2026-02-01', { invoiceKind: 'standard' }),
    invoice('adv', 'R-2', '2026-02-02', { invoiceKind: 'advance' }),
    invoice('rc', 'R-3', '2026-02-03', { reverseCharge: true, lineItems: [item('x', 1, 500, 0)] }),
    invoice('usd', 'R-4', '2026-02-04', { currency: 'USD' }),
    invoice('nocur', 'R-5', '2026-02-05', { currency: '' }),
  ];
  const rows = collectExportRows(invoices, [], Q1, 'CHF').rows;
  assert.deepEqual(rows.map((row) => [row.typeLabel, row.note, row.currency]), [
    ['Rechnung', '', 'EUR'], ['Abschlagsrechnung', '', 'EUR'], ['Rechnung', '§ 13b UStG', 'EUR'], ['Rechnung', '', 'USD'], ['Rechnung', '', 'CHF'],
  ]);
  assert.deepEqual([rows[2].net, rows[2].tax, rows[2].gross], [500, 0, 500]);
});

test('rows: a final invoice shows its full amounts, the deducted advances and what is still payable', () => {
  const final = invoice('final', 'SR-1', '2026-03-01', {
    invoiceKind: 'final', lineItems: [item('x', 1, 5000, 0.19)],
    advanceDeductions: [{ id: 'd1', invoiceNumber: 'AR-1', invoiceDate: '2026-01-10', net: 1000, tax: 190 }, { id: 'd2', invoiceNumber: 'AR-2', invoiceDate: '2026-02-10', net: 500, tax: 95 }],
    payments: [{ id: 'p', amount: 165, date: '2026-03-10' }],
  });
  const [row] = collectExportRows([final], [], Q1, 'EUR', '2026-06-01').rows;
  assert.deepEqual([row.typeLabel, row.net, row.tax, row.gross, row.deducted, row.payable, row.paid, row.open], ['Schlussrechnung', 5000, 950, 5950, 1785, 4165, 165, 4000]);
  // The deduction and the remaining amount are split into net and VAT.
  assert.deepEqual([row.deductedTax, row.payableNet, row.payableTax], [285, 3500, 665]);
  // The same list on an invoice that is not final is ignored.
  const [plain] = collectExportRows([{ ...final, invoiceKind: undefined }], [], Q1, 'EUR', '2026-06-01').rows;
  assert.deepEqual([plain.typeLabel, plain.deducted, plain.payable, plain.open], ['Rechnung', 0, 5950, 5785]);
  assert.deepEqual([plain.deductedTax, plain.payableNet, plain.payableTax], [0, 5000, 950]);
});

test('rows: corrections are negative rows dated by their own date', () => {
  const january = invoice('jan', 'R-1', '2026-01-15', { projectReference: 'BV Nord', currency: 'USD' });
  const previous = invoice('old', 'R-0', '2025-11-15');
  const notes = [
    creditNote('storno', ' ST-1 ', '2026-02-01', january, 1190),
    creditNote('credit', '', '2026-03-31', january, 100.005, { type: 'gutschrift', linkedInvoiceNumber: '' }),
    creditNote('late', 'ST-2', '2026-04-01', january, 50),
    creditNote('for-old', 'ST-3', '2026-01-01', previous, 119),
    creditNote('orphan', 'ST-4', '2026-01-02', { id: 'deleted', invoiceNumber: '', sender: january.sender, recipient: { name: 'Weg', address: '', contact: '' } }, 10),
  ];
  const summary = collectExportRows([january, previous], notes, Q1, 'EUR', '2026-06-01');
  const credits = summary.rows.filter((row) => row.kind === 'credit');
  assert.deepEqual(credits.map((row) => [row.id, row.typeLabel, row.number, row.gross, row.payable, row.note, row.currency, row.project]), [
    ['for-old', 'Storno', 'ST-3', -119, -119, 'zu Rechnung R-0', 'EUR', ''],
    ['orphan', 'Storno', 'ST-4', -10, -10, 'zu Rechnung ?', 'EUR', ''],
    ['storno', 'Storno', 'ST-1', -1190, -1190, 'zu Rechnung R-1', 'USD', 'BV Nord'],
    ['credit', 'Gutschrift', 'ohne Nummer', -100.01, -100.01, 'zu Rechnung R-1', 'USD', 'BV Nord'],
  ]);
  // Net and VAT in the proportion of the corrected invoice (also one dated outside the period); none without it.
  assert.deepEqual(credits.map((row) => [row.id, row.net, row.tax]), [['for-old', -100, -19], ['orphan', null, null], ['storno', -1000, -190], ['credit', -84.04, -15.97]]);
  for (const row of credits) {
    assert.deepEqual([row.payableNet, row.payableTax], [row.net, row.tax], row.id);
    assert.deepEqual([row.paid, row.open, row.deducted, row.deductedTax, row.serviceDate, row.invoice], [null, null, 0, 0, '', undefined]);
  }
  assert.equal(summary.unsplitCorrections, 1);
  // The cancelled invoice is listed with its own amounts and nothing left to pay.
  const invoiceRow = summary.rows.find((row) => row.id === 'jan');
  assert.deepEqual([invoiceRow.gross, invoiceRow.payable, invoiceRow.open], [1190, 1190, 0]);
});

test('rows: sorted by date, then by number in natural order', () => {
  const a = invoice('a', 'R-10', '2026-02-01'), b = invoice('b', 'R-2', '2026-02-01'), c = invoice('c', 'R-1', '2026-03-01'), d = invoice('d', 'R-99', '2026-01-05');
  const note = creditNote('n', 'R-3', '2026-02-01', a, 5);
  assert.deepEqual(collectExportRows([a, b, c, d], [note], Q1).rows.map((row) => row.number), ['R-99', 'R-2', 'R-3', 'R-10', 'R-1']);
  // The order of the stored records does not matter.
  assert.deepEqual(collectExportRows([d, c, b, a], [note], Q1).rows.map((row) => row.number), ['R-99', 'R-2', 'R-3', 'R-10', 'R-1']);
});

test('totals: sums over the listed rows, corrections reduce net, tax and gross', () => {
  const first = invoice('a', 'R-1', '2026-01-10', { lineItems: [item('x', 1, 0.1, 0.19)] });
  const second = invoice('b', 'R-2', '2026-01-11', { lineItems: [item('y', 1, 0.2, 0.19)], payments: [{ id: 'p', amount: 0.04, date: '2026-01-12' }] });
  const third = invoice('c', 'R-3', '2026-01-12', { lineItems: [item('z', 1, 100, 0.07)] });
  const summary = collectExportRows([first, second, third], [creditNote('n', 'G-1', '2026-01-20', third, 7, { type: 'gutschrift' })], Q1, 'EUR', '2026-06-01');
  // 0.1 + 0.2 must not surface as 0.30000000000000004.
  // 100.30 net and 7.06 VAT invoiced, less a credit of 7.00 on the 7 % invoice (6.54 net + 0.46 VAT).
  assert.deepEqual(summary.totals, { net: 93.76, tax: 6.6, gross: 100.36, open: 100.32 });
  assert.equal(summary.unsplitCorrections, 0);
  assert.deepEqual(collectExportRows([], [], Q1), { rows: [], skippedDrafts: 0, unsplitCorrections: 0, totals: { net: 0, tax: 0, gross: 0, open: 0 } });
});

test('totals: an advance invoice and the final invoice deducting it are not counted twice', () => {
  const advance = invoice('adv', 'AR-1', '2026-01-10', { invoiceKind: 'advance' });
  const final = invoice('final', 'SR-1', '2026-03-01', {
    invoiceKind: 'final', lineItems: [item('x', 1, 5000, 0.19)],
    advanceDeductions: [{ id: 'd1', invoiceNumber: 'AR-1', invoiceDate: '2026-01-10', net: 1000, tax: 190 }],
  });
  const summary = collectExportRows([advance, final], [], Q1, 'EUR', '2026-06-01');
  assert.deepEqual(summary.rows.map((row) => [row.number, row.net, row.tax, row.gross, row.deducted, row.deductedTax, row.payableNet, row.payableTax, row.payable]), [
    ['AR-1', 1000, 190, 1190, 0, 0, 1000, 190, 1190],
    ['SR-1', 5000, 950, 5950, 1190, 190, 4000, 760, 4760],
  ]);
  assert.deepEqual(summary.totals, { net: 5000, tax: 950, gross: 5950, open: 5950 });
  assert.equal('payable' in summary.totals, false);
  // Only the final invoice falls into the period: its remaining amount is all that counts.
  assert.deepEqual(collectExportRows([advance, final], [], { from: '2026-03-01', to: '2026-03-31' }, 'EUR', '2026-06-01').totals, { net: 4000, tax: 760, gross: 4760, open: 4760 });
});

test('totals: an invoice and its full Storno cancel out in net, tax and gross', () => {
  const cancelled = invoice('a', 'R-1', '2026-01-10');
  const summary = collectExportRows([cancelled], [creditNote('n', 'ST-1', '2026-01-20', cancelled, 1190)], Q1, 'EUR', '2026-06-01');
  assert.deepEqual(summary.rows.map((row) => [row.number, row.net, row.tax, row.gross, row.payableNet, row.payableTax, row.payable]), [
    ['R-1', 1000, 190, 1190, 1000, 190, 1190],
    ['ST-1', -1000, -190, -1190, -1000, -190, -1190],
  ]);
  assert.deepEqual(summary.totals, { net: 0, tax: 0, gross: 0, open: 0 });
  assert.equal(summary.unsplitCorrections, 0);
});

test('corrections: split in the proportion of the invoice, also for mixed tax rates and partial amounts', () => {
  // 1000 at 19 % and 1000 at 7 %: 2260 gross with 260 VAT.
  const mixed = invoice('m', 'R-1', '2026-01-10', { lineItems: [item('a', 1, 1000, 0.19), item('b', 1, 1000, 0.07)] });
  const taxFree = invoice('rc', 'R-2', '2026-01-11', { reverseCharge: true, lineItems: [item('c', 1, 500, 0)] });
  const notes = [
    creditNote('full', 'G-1', '2026-02-01', mixed, 2260),
    creditNote('part', 'G-2', '2026-02-02', mixed, 100, { type: 'gutschrift' }),
    creditNote('free', 'G-3', '2026-02-03', taxFree, 500),
  ];
  const credits = collectExportRows([mixed, taxFree], notes, Q1).rows.filter((row) => row.kind === 'credit');
  assert.deepEqual(credits.map((row) => [row.id, row.net, row.tax, row.gross]), [['full', -2000, -260, -2260], ['part', -88.5, -11.5, -100], ['free', -500, 0, -500]]);
  for (const row of credits) assert.equal(Math.round((row.net + row.tax) * 100), Math.round(row.gross * 100), row.id);
});

test('corrections: without the linked invoice the amount stays unsplit and is counted', () => {
  const kept = invoice('kept', 'R-1', '2026-01-10');
  const gone = { id: 'deleted', invoiceNumber: 'R-0', sender: kept.sender, recipient: kept.recipient };
  const notes = [creditNote('o1', 'ST-1', '2026-01-15', gone, 119), creditNote('o2', 'ST-2', '2026-01-16', gone, 11.9), creditNote('ok', 'ST-3', '2026-01-17', kept, 119)];
  const summary = collectExportRows([kept], notes, Q1, 'EUR', '2026-06-01');
  assert.equal(summary.unsplitCorrections, 2);
  assert.deepEqual(summary.rows.filter((row) => row.kind === 'credit').map((row) => [row.id, row.net, row.tax, row.payableNet, row.payableTax, row.gross, row.payable, row.note]), [
    ['o1', null, null, null, null, -119, -119, 'zu Rechnung R-0'],
    ['o2', null, null, null, null, -11.9, -11.9, 'zu Rechnung R-0'],
    ['ok', -100, -19, -100, -19, -119, -119, 'zu Rechnung R-1'],
  ]);
  // The unsplit amounts are missing from net and tax but not from gross.
  assert.deepEqual(summary.totals, { net: 900, tax: 171, gross: 940.1, open: 1071 });
  // A correction outside the period is not counted.
  assert.equal(collectExportRows([kept], notes, { from: '2026-01-17', to: '2026-01-31' }).unsplitCorrections, 0);
});

test('corrections: a linked invoice with a total of 0 gives no VAT instead of a division by zero', () => {
  const empty = invoice('zero', 'R-1', '2026-01-10', { lineItems: [item('x', 1, 0, 0.19)] });
  const none = invoice('none', 'R-2', '2026-01-11', { lineItems: [] });
  const summary = collectExportRows([empty, none], [creditNote('n1', 'G-1', '2026-01-20', empty, 50), creditNote('n2', 'G-2', '2026-01-21', none, 25)], Q1);
  assert.deepEqual(summary.rows.filter((row) => row.kind === 'credit').map((row) => [row.net, row.tax, row.gross, row.payableNet, row.payableTax]), [[-50, 0, -50, -50, 0], [-25, 0, -25, -25, 0]]);
  assert.equal(summary.unsplitCorrections, 0);
  assert.deepEqual(summary.totals, { net: -75, tax: 0, gross: -75, open: 0 });
  for (const value of Object.values(summary.totals)) assert.ok(Number.isFinite(value));
});

test('rows: the stored records are not modified', () => {
  const source = invoice('a', 'R-1', '2026-01-10', { payments: [{ id: 'p2', amount: 2, date: '2026-02-02' }, { id: 'p1', amount: 1, date: '2026-01-01' }] });
  const note = creditNote('n', 'G-1', '2026-01-20', source, 7);
  const invoices = Object.freeze([source]), notes = Object.freeze([note]);
  const before = structuredClone([source, note]);
  collectExportRows(invoices, notes, Q1);
  assert.deepEqual([source, note], before);
});

// ── CSV ────────────────────────────────────────────────────────────────────────────────────────────────────────

const HEADER = 'Art;Nummer;Datum;Leistungsdatum;Kunde;Bauvorhaben;Netto;Umsatzsteuer;Brutto;Abzug Abschläge brutto;darin Umsatzsteuer;Zahlbetrag netto;Zahlbetrag Umsatzsteuer;Zahlbetrag brutto;Bezahlt;Bezahlt am;Offen;Währung;Hinweis';
const COLUMNS = 19;
const csvRow = (overrides = {}) => ({
  id: 'x', kind: 'invoice', typeLabel: 'Rechnung', number: 'R-1', date: '2026-12-31', serviceDate: '', customer: 'Bau GmbH', project: '',
  net: 1000, tax: 190, gross: 1190, deducted: 0, deductedTax: 0, payable: 1190, payableNet: 1000, payableTax: 190, paid: 0, paidOn: '', open: 1190, note: '', currency: 'EUR', ...overrides,
});
const csvOf = (...rows) => exportCsv({ rows, skippedDrafts: 0, unsplitCorrections: 0, totals: { net: 0, tax: 0, gross: 0, open: 0 } });
/** Splits the CSV like a spreadsheet does: `;` separated, `"` quoted with doubled quotes, CRLF records. */
function parseCsv(text) {
  const records = [[]];
  let cell = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ';') { records.at(-1).push(cell); cell = ''; }
    else if (char === '\r' && text[index + 1] === '\n') { records.at(-1).push(cell); cell = ''; records.push([]); index += 1; }
    else cell += char;
  }
  assert.equal(quoted, false, 'unterminated quote');
  assert.deepEqual(records.pop(), [], 'file ends with a line end');
  assert.equal(cell, '');
  return records;
}

test('csv: byte order mark, header, CRLF line ends and a final line end', () => {
  const csv = csvOf(csvRow());
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.charCodeAt(1), 'A'.charCodeAt(0));
  assert.deepEqual([...Buffer.from(csv, 'utf8').subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = csv.slice(1).split('\r\n');
  assert.deepEqual(lines, [HEADER, 'Rechnung;R-1;31.12.2026;;Bau GmbH;;1000,00;190,00;1190,00;;;1000,00;190,00;1190,00;0,00;;1190,00;EUR;', '']);
  assert.equal(csv.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(csvOf(), `﻿${HEADER}\r\n`);
  assert.equal(HEADER.split(';').length, COLUMNS);
});

test('csv: amounts with decimal comma, two places and no grouping; empty where there is no amount', () => {
  const [, invoiceRow, creditRow] = parseCsv(csvOf(
    csvRow({ net: 1234567.5, tax: 0, gross: 1234567.5, deducted: 1785, deductedTax: 285, payable: 0.1 + 0.2, payableNet: 1232782.5, payableTax: -285, paid: 1e-9, open: 5 }),
    csvRow({ kind: 'credit', typeLabel: 'Storno', net: null, tax: null, gross: -1190, payable: -1190, payableNet: null, payableTax: null, paid: null, open: null, note: 'zu Rechnung R-1' }),
  ).slice(1));
  assert.deepEqual(invoiceRow.slice(6, 17), ['1234567,50', '0,00', '1234567,50', '1785,00', '285,00', '1232782,50', '-285,00', '0,30', '0,00', '', '5,00']);
  // Negative amounts stay numbers a spreadsheet can add up.
  assert.deepEqual(creditRow.slice(6, 17), ['', '', '-1190,00', '', '', '', '', '-1190,00', '', '', '']);
  assert.equal(creditRow[18], 'zu Rechnung R-1');
});

test('csv: the deduction columns are empty when nothing is deducted, and filled together when something is', () => {
  const [, plain, taxFreeDeduction, split] = parseCsv(csvOf(
    csvRow(),
    csvRow({ deducted: 500, deductedTax: 0, payableNet: 500, payableTax: 190, payable: 690 }),
    csvRow({ kind: 'credit', typeLabel: 'Storno', net: -1000, tax: -190, gross: -1190, payable: -1190, payableNet: -1000, payableTax: -190, paid: null, open: null }),
  ).slice(1));
  assert.deepEqual(plain.slice(9, 14), ['', '', '1000,00', '190,00', '1190,00']);
  // A deduction without VAT (advance under § 13b) shows 0,00, not an empty cell.
  assert.deepEqual(taxFreeDeduction.slice(9, 14), ['500,00', '0,00', '500,00', '190,00', '690,00']);
  assert.deepEqual(split.slice(6, 14), ['-1000,00', '-190,00', '-1190,00', '', '', '-1000,00', '-190,00', '-1190,00']);
});

test('csv: German dates, and a date that is not one is passed through', () => {
  const [, row, odd] = parseCsv(csvOf(
    csvRow({ date: '2026-01-05', serviceDate: '2025-12-31', paidOn: '2026-03-29' }),
    csvRow({ date: '2026-02-30', serviceDate: 'KW 5', paidOn: '' }),
  ).slice(1));
  assert.deepEqual([row[2], row[3], row[15]], ['05.01.2026', '31.12.2025', '29.03.2026']);
  assert.deepEqual([odd[2], odd[3], odd[15]], ['2026-02-30', 'KW 5', '']);
});

test('csv: separators, quotes and line breaks inside text survive a round trip', () => {
  const customer = 'Müller; Söhne "Bau" GmbH', project = 'BV Nord\nHaus 2', note = 'a\r\nb', number = 'R"1';
  const csv = csvOf(csvRow({ customer, project, note, number }), csvRow({ customer: 'Zweiter' }));
  assert.ok(csv.includes(';"Müller; Söhne ""Bau"" GmbH";"BV Nord\nHaus 2";'));
  const records = parseCsv(csv.slice(1));
  assert.equal(records.length, 3);
  for (const record of records) assert.equal(record.length, COLUMNS);
  assert.deepEqual([records[1][1], records[1][4], records[1][5], records[1][18]], [number, customer, project, note]);
  assert.equal(records[2][4], 'Zweiter');
  // Plain text is not quoted needlessly.
  assert.ok(csv.includes(';Zweiter;'));
});

test('csv: text a spreadsheet would run as a formula is defused in every text column', () => {
  for (const dangerous of ['=HYPERLINK("http://x";"y")', '+49 221 123', '-2+3', '@SUM(A1)', '\tx', '=1+1']) {
    for (const column of ['typeLabel', 'number', 'customer', 'project', 'note', 'currency', 'date', 'serviceDate', 'paidOn']) {
      const [, record] = parseCsv(csvOf(csvRow({ [column]: dangerous })).slice(1));
      const index = { typeLabel: 0, number: 1, date: 2, serviceDate: 3, customer: 4, project: 5, paidOn: 15, currency: 17, note: 18 }[column];
      assert.equal(record[index], `'${dangerous}`, `${column}: ${dangerous}`);
      assert.equal(record.length, COLUMNS);
    }
  }
});

test('csv: a name that merely starts with a minus stays readable, harmless text is untouched', () => {
  const [, record] = parseCsv(csvOf(csvRow({ customer: '-Müller', project: 'A-B = C + D @ E', number: '2026-001', note: '§ 13b UStG' })).slice(1));
  assert.equal(record[4], "'-Müller");
  assert.equal(record[5], 'A-B = C + D @ E');
  assert.equal(record[1], '2026-001');
  assert.equal(record[18], '§ 13b UStG');
});

test('csv: the export of collected rows lines up with the header', () => {
  const final = invoice('final', 'SR-1', '2026-03-01', {
    invoiceKind: 'final', recipient: { name: '=cmd|x', address: '', contact: '' }, projectReference: 'Haus; Hof', lineItems: [item('x', 1, 5000, 0.19)], reverseCharge: false,
    advanceDeductions: [{ id: 'd1', invoiceNumber: 'AR-1', invoiceDate: '2026-01-10', net: 1000, tax: 190 }],
    payments: [{ id: 'p', amount: 4760, date: '2026-03-10' }], einvoice: { serviceDate: '2026-02-27' },
  });
  const summary = collectExportRows([final], [creditNote('n', 'ST-1', '2026-03-05', final, 4760)], Q1, 'EUR', '2026-06-01');
  const records = parseCsv(exportCsv(summary).slice(1));
  assert.deepEqual(records, [
    HEADER.split(';'),
    ['Schlussrechnung', 'SR-1', '01.03.2026', '27.02.2026', "'=cmd|x", 'Haus; Hof', '5000,00', '950,00', '5950,00', '1190,00', '190,00', '4000,00', '760,00', '4760,00', '4760,00', '10.03.2026', '0,00', 'EUR', ''],
    ['Storno', 'ST-1', '05.03.2026', '', "'=cmd|x", 'Haus; Hof', '-4000,00', '-760,00', '-4760,00', '', '', '-4000,00', '-760,00', '-4760,00', '', '', '', 'EUR', 'zu Rechnung SR-1'],
  ]);
  // The three "Zahlbetrag" columns of the file add up to the totals of the summary.
  const column = (index) => records.slice(1).reduce((sum, record) => sum + Number(record[index].replace(',', '.') || 0), 0);
  assert.deepEqual([column(11), column(12), column(13)], [summary.totals.net, summary.totals.tax, summary.totals.gross]);
  assert.deepEqual(summary.totals, { net: 0, tax: 0, gross: 0, open: 0 });
});
