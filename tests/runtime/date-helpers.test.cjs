'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load-typescript.cjs');

const { addMonthsAnchored, addMonthsClamped, addDays, isDateOnly, formatDocumentDate, todayLocalISO } = createLoader()('src/lib/date.ts');

test('a schedule anchored on the 31st returns to the 31st after short months', () => {
  let date = '2026-01-31';
  const run = [];
  for (let step = 0; step < 12; step += 1) { date = addMonthsAnchored(date, 1, 31); run.push(date); }
  assert.deepEqual(run, [
    '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31',
    '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31',
  ]);
  // The clamped variant is the one that drifts; the anchor is what prevents it.
  assert.equal(addMonthsClamped('2026-02-28', 1), '2026-03-28');
  assert.equal(addMonthsAnchored('2026-02-28', 1), '2026-03-28');
});

test('anchored months respect leap years', () => {
  assert.equal(addMonthsAnchored('2024-01-31', 1, 31), '2024-02-29');
  assert.equal(addMonthsAnchored('2024-02-29', 1, 31), '2024-03-31');
  assert.equal(addMonthsAnchored('2024-02-29', 12, 29), '2025-02-28');
  assert.equal(addMonthsAnchored('2025-02-28', 12, 29), '2026-02-28');
  assert.equal(addMonthsAnchored('2027-02-28', 12, 29), '2028-02-29');
  assert.equal(addMonthsAnchored('2024-01-30', 1, 30), '2024-02-29');
  assert.equal(addMonthsAnchored('2026-01-30', 1, 30), '2026-02-28');
  assert.equal(addMonthsAnchored('1900-01-31', 1, 31), '1900-02-28'); // not a leap year
  assert.equal(addMonthsAnchored('2000-01-31', 1, 31), '2000-02-29');
});

test('anchored quarters and years cross the year end, and negative steps go back', () => {
  assert.equal(addMonthsAnchored('2026-11-30', 3, 31), '2027-02-28');
  assert.equal(addMonthsAnchored('2027-02-28', 3, 31), '2027-05-31');
  assert.equal(addMonthsAnchored('2026-01-31', 12, 31), '2027-01-31');
  assert.equal(addMonthsAnchored('2026-12-15', 1, 15), '2027-01-15');
  assert.equal(addMonthsAnchored('2026-03-31', -1, 31), '2026-02-28');
  assert.equal(addMonthsAnchored('2026-01-31', -2, 31), '2025-11-30');
  assert.equal(addMonthsAnchored('2026-05-31', 0, 31), '2026-05-31');
  // The anchor also applies when the current day is not the anchor day.
  assert.equal(addMonthsAnchored('2026-04-30', 0, 31), '2026-04-30');
  assert.equal(addMonthsAnchored('2026-04-10', 1, 1), '2026-05-01');
});

test('an unusable anchor falls back to the day of the date', () => {
  for (const anchor of [undefined, 0, -3, 32, NaN, 31.5]) {
    assert.equal(addMonthsAnchored('2026-02-28', 1, anchor), '2026-03-28', String(anchor));
  }
  assert.equal(addMonthsAnchored('2026-02-28', 1, 29.7), '2026-03-29');
});

test('unparseable input to the date arithmetic yields today instead of throwing', () => {
  assert.equal(addMonthsAnchored('31.01.2026', 1, 31), todayLocalISO());
  assert.equal(addDays('', 3), todayLocalISO());
});

test('addDays counts calendar days across both clock changes', () => {
  // 29 March 2026 has 23 hours, 25 October 2026 has 25 hours in Europe/Berlin.
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-03-30', -1), '2026-03-29');
  assert.equal(addDays('2026-03-30', -2), '2026-03-28');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(addDays('2026-10-26', -1), '2026-10-25');
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');
  // A payment term that spans a clock change lands on the same calendar day as without one.
  assert.equal(addDays('2026-03-20', 14), '2026-04-03');
  assert.equal(addDays('2026-10-20', 14), '2026-11-03');
  let date = '2026-01-01';
  for (let step = 0; step < 365; step += 1) date = addDays(date, 1);
  assert.equal(date, '2027-01-01');
});

test('addDays crosses month and year ends and leap days', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-01-01', 365), '2027-01-01');
  assert.equal(addDays('2024-01-01', 365), '2024-12-31');
  assert.equal(addDays('2026-06-15', 0), '2026-06-15');
});

test('addDays rounds fractional day counts', () => {
  assert.equal(addDays('2026-01-01', 1.4), '2026-01-02');
  assert.equal(addDays('2026-01-01', 1.5), '2026-01-03');
  assert.equal(addDays('2026-01-01', -0.4), '2026-01-01');
});

test('addDays leaves the date unchanged for a day count that is not a number', () => {
  // An emptied "payment term" field arrives as NaN; the due date must not become "NaN-NaN-NaN".
  assert.equal(addDays('2026-03-15', NaN), '2026-03-15');
  assert.equal(addDays('2026-03-15', Number('')), '2026-03-15');
  assert.equal(addDays('2026-03-15', Number('abc')), '2026-03-15');
  assert.equal(addDays('2026-03-15', undefined), '2026-03-15');
  assert.equal(addDays('2026-03-15', Infinity), '2026-03-15');
  assert.equal(addDays('2026-03-15', -Infinity), '2026-03-15');
  assert.equal(addDays('2024-02-29', NaN), '2024-02-29');
  for (const days of [NaN, Infinity, undefined]) assert.equal(isDateOnly(addDays('2026-12-31', days)), true, String(days));
  // An unusable date still wins over an unusable count.
  assert.equal(addDays('', NaN), todayLocalISO());
});

test('isDateOnly accepts real calendar dates only', () => {
  for (const value of ['2026-01-01', '2026-12-31', '2024-02-29', '2000-02-29', '2026-03-29', '2026-10-25', '1999-06-15', '9999-12-31']) {
    assert.equal(isDateOnly(value), true, value);
  }
  for (const value of ['2026-02-30', '2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32']) {
    assert.equal(isDateOnly(value), false, value);
  }
});

test('isDateOnly rejects other notations and non-strings', () => {
  for (const value of ['', '2026-1-1', '26-01-01', '01.01.2026', '2026/01/01', ' 2026-01-01', '2026-01-01 ', '2026-01-01T00:00:00Z', '2026-01-01\n', 'heute']) {
    assert.equal(isDateOnly(value), false, JSON.stringify(value));
  }
  for (const value of [undefined, null, 20260101, new Date(2026, 0, 1), ['2026-01-01'], { toString: () => '2026-01-01' }, true]) {
    assert.equal(isDateOnly(value), false, String(value));
  }
});

test('formatDocumentDate prints two-digit days and months in the order of the locale', () => {
  assert.equal(formatDocumentDate('2026-11-14', 'de-DE'), '14.11.2026');
  assert.equal(formatDocumentDate('2026-01-05', 'de-DE'), '05.01.2026');
  assert.equal(formatDocumentDate('2026-01-05', 'de'), '05.01.2026');
  assert.equal(formatDocumentDate('2026-11-14', 'en'), '11/14/2026');
  assert.equal(formatDocumentDate('2026-01-05', 'en-US'), '01/05/2026');
  // The cached formatter of one locale is not reused for another.
  assert.equal(formatDocumentDate('2026-11-14', 'de-DE'), '14.11.2026');
});

test('formatDocumentDate is not shifted by clock changes or the year end', () => {
  assert.equal(formatDocumentDate('2026-03-29', 'de-DE'), '29.03.2026');
  assert.equal(formatDocumentDate('2026-10-25', 'de-DE'), '25.10.2026');
  assert.equal(formatDocumentDate('2026-12-31', 'de-DE'), '31.12.2026');
  assert.equal(formatDocumentDate('2027-01-01', 'de-DE'), '01.01.2027');
  assert.equal(formatDocumentDate('2024-02-29', 'de-DE'), '29.02.2024');
});

test('formatDocumentDate returns unusable input as typed and nothing for a missing date', () => {
  assert.equal(formatDocumentDate(undefined, 'de-DE'), '');
  assert.equal(formatDocumentDate('', 'de-DE'), '');
  assert.equal(formatDocumentDate('2026-02-30', 'de-DE'), '2026-02-30');
  assert.equal(formatDocumentDate('14.11.2026', 'de-DE'), '14.11.2026');
  assert.equal(formatDocumentDate('2026-11-14T10:00:00.000Z', 'de-DE'), '2026-11-14T10:00:00.000Z');
});

test('documents print German dates and amounts whatever language the app is shown in', () => {
  const fs = require('node:fs');
  const { createLoader } = require('./helpers/load-typescript.cjs');
  const load = createLoader();
  const date = load('src/lib/date.ts');
  const { formatMoney } = load('src/lib/money.ts');
  assert.equal(date.DOCUMENT_LOCALE, 'de-DE');
  assert.equal(date.formatDocumentDate('2026-11-14', date.DOCUMENT_LOCALE), '14.11.2026');
  assert.equal(formatMoney(1234.5, 'EUR', date.DOCUMENT_LOCALE).replace(/\s/g, ' '), '1.234,50 €');
  // The one entry point of the invoice templates takes no locale from its caller, and no caller passes one.
  const preview = fs.readFileSync('src/components/templates/InvoicePreview.tsx', 'utf8');
  assert.match(preview, /const locale = DOCUMENT_LOCALE;/);
  assert.doesNotMatch(preview, /locale: string/);
  for (const file of ['src/app/invoices/[id]/InvoiceEditorClient.tsx', 'src/app/export/page.tsx']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<InvoicePreview[^>]*locale=/, file);
  }
  // Templates are only rendered through that entry point.
  for (const file of ['src/app/invoices/[id]/reminder/ReminderClient.tsx', 'src/app/fachunternehmer/[id]/DeclarationClient.tsx']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /en-US/, file);
  }
});
