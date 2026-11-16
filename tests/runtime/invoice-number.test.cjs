'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./helpers/load-typescript.cjs');

const { suggestNextNumber, findDuplicateNumbers } = createLoader()('src/lib/invoiceNumber.ts');
const doc = (id, invoiceNumber, invoiceDate, createdAt) => ({ id, invoiceNumber, invoiceDate, createdAt });

test('the first number of an empty collection is <year>-001 behind the fallback prefix', () => {
  assert.equal(suggestNextNumber([], '2026-11-16'), '2026-001');
  assert.equal(suggestNextNumber([], '2026-11-16', 'AN-'), 'AN-2026-001');
});

test('drafts without a number and numbers without digits do not start a scheme', () => {
  const drafts = [doc('a', '', '2026-12-01'), doc('b', '   ', '2026-12-01'), doc('c', 'Entwurf', '2026-12-01'), { id: 'd' }];
  assert.equal(suggestNextNumber(drafts, '2026-12-02', 'AN-'), 'AN-2026-001');
  // A newer draft does not hide the numbered invoice before it.
  assert.equal(suggestNextNumber([doc('a', '', '2026-12-01'), doc('b', 'RE-0041', '2026-06-01')], '2026-12-02'), 'RE-0042');
});

test('the counter continues with its zero padding and grows past it', () => {
  assert.equal(suggestNextNumber([doc('a', '2026-048', '2026-03-01')], '2026-11-16'), '2026-049');
  assert.equal(suggestNextNumber([doc('a', 'RE-0099', '2026-03-01')], '2026-11-16'), 'RE-0100');
  assert.equal(suggestNextNumber([doc('a', 'RE-999', '2026-03-01')], '2026-11-16'), 'RE-1000');
  assert.equal(suggestNextNumber([doc('a', '7', '2026-03-01')], '2026-11-16'), '8');
  assert.equal(suggestNextNumber([doc('a', '  2026-048 ', '2026-03-01')], '2026-11-16'), '2026-049');
});

test('the year inside a number is never mistaken for the counter', () => {
  assert.equal(suggestNextNumber([doc('a', 'RE-2026-048', '2026-03-01')], '2026-11-16'), 'RE-2026-049');
  assert.equal(suggestNextNumber([doc('a', '48/2026', '2026-03-01')], '2026-11-16'), '49/2026');
  assert.equal(suggestNextNumber([doc('a', 'RE 2026/11/007', '2026-11-01')], '2026-11-16'), 'RE 2026/11/008');
  assert.equal(suggestNextNumber([doc('a', '2026-009a', '2026-11-01')], '2026-11-16'), '2026-010a');
  // A counter that reaches the range of year numbers keeps counting behind a year prefix.
  assert.equal(suggestNextNumber([doc('a', '2026-1999', '2026-11-01')], '2026-11-16'), '2026-2000');
  assert.equal(suggestNextNumber([doc('a', '2026-2000', '2026-11-01')], '2026-11-16'), '2026-2001');
});

test('the newest document decides the scheme, the highest counter of that scheme decides the number', () => {
  // The most recent invoice carries a lower counter than an older one: no duplicate is suggested.
  assert.equal(suggestNextNumber([doc('a', '2026-003', '2026-05-01'), doc('b', '2026-010', '2026-03-01')], '2026-12-02'), '2026-011');
  // Two schemes side by side: the more recent one continues, the other one is left alone.
  const mixed = [doc('a', 'RE-005', '2026-06-01'), doc('b', '2026-048', '2026-03-01'), doc('c', 'RE-002', '2026-01-01')];
  assert.equal(suggestNextNumber(mixed, '2026-12-02'), 'RE-006');
  // Same invoice date: the creation time breaks the tie.
  const sameDay = [doc('a', 'A-7', '2026-03-01', '2026-03-01T09:00:00.000Z'), doc('b', 'B-3', '2026-03-01', '2026-03-01T10:00:00.000Z')];
  assert.equal(suggestNextNumber(sameDay, '2026-12-02'), 'B-4');
  // Prefixes are compared without case; the spelling of the newest document is kept.
  assert.equal(suggestNextNumber([doc('a', 're-007', '2026-05-01'), doc('b', 'RE-010', '2026-03-01')], '2026-12-02'), 're-011');
});

test('a new year restarts the counter when the scheme carries the year', () => {
  assert.equal(suggestNextNumber([doc('a', '2025-048', '2025-12-01')], '2026-01-02'), '2026-001');
  assert.equal(suggestNextNumber([doc('a', 'RE-2025-048', '2025-12-01')], '2026-01-02'), 'RE-2026-001');
  assert.equal(suggestNextNumber([doc('a', '48/2025', '2025-12-01')], '2026-01-02'), '01/2026');
  assert.equal(suggestNextNumber([doc('a', '2024-048', '2024-03-01')], '2026-11-16'), '2026-001');
  // A scheme without a year simply continues.
  assert.equal(suggestNextNumber([doc('a', 'RE-048', '2025-12-01')], '2026-01-02'), 'RE-049');
  assert.equal(suggestNextNumber([doc('a', '2025048', '2025-12-01')], '2026-01-02'), '2025049');
});

test('a two-digit year is recognised by the date of its document and rolls over with it', () => {
  assert.equal(suggestNextNumber([doc('a', '048/25', '2025-06-01')], '2025-11-16'), '049/25');
  assert.equal(suggestNextNumber([doc('a', '048/25', '2025-06-01')], '2026-01-02'), '001/26');
  assert.equal(suggestNextNumber([doc('a', '25-048', '2025-06-01')], '2026-01-02'), '26-001');
  assert.equal(suggestNextNumber([doc('a', '25-048', '2025-06-01')], '2025-11-16'), '25-049');
  assert.equal(suggestNextNumber([doc('a', 'RE-25-048', '2025-12-30')], '2026-01-02'), 'RE-26-001');
  // The year the new scheme opens with is continued once a document carries it.
  assert.equal(suggestNextNumber([doc('a', '048/25', '2025-12-01'), doc('b', '001/26', '2026-01-02')], '2026-01-05'), '002/26');
});

test('two digits that do not match the year of the document are an ordinary counter', () => {
  // "25" on a 2024 document is not a year: the counter behind it counts on and nothing rolls over.
  assert.equal(suggestNextNumber([doc('a', '25-048', '2024-06-01')], '2026-11-16'), '25-049');
  assert.equal(suggestNextNumber([doc('a', 'K25-048', '2023-06-01')], '2026-11-16'), 'K25-049');
  // Without a document date two digits are never taken for a year.
  assert.equal(suggestNextNumber([doc('a', '25-048')], '2026-11-16'), '25-049');
  assert.equal(suggestNextNumber([doc('a', '25-048', '')], '2026-11-16'), '25-049');
});

test('a four-digit run only counts as the year within one year of the document date', () => {
  // A counter that has reached 2000 keeps counting; it is not "the year 2000".
  assert.equal(suggestNextNumber([doc('a', 'K1-2000', '2026-03-01')], '2026-11-16'), 'K1-2001');
  assert.equal(suggestNextNumber([doc('a', 'K1-2025', '2026-03-01')], '2026-11-16'), 'K1-2026');
  assert.equal(suggestNextNumber([doc('a', '5-2010', '2026-03-01')], '2026-11-16'), '5-2011');
  assert.equal(suggestNextNumber([doc('a', '5-2010', '2026-03-01')], '2027-01-02'), '5-2011');
  // One year off still is the year: a December invoice numbered for January, or the reverse.
  assert.equal(suggestNextNumber([doc('a', '2026-003', '2025-12-30')], '2026-01-02'), '2026-004');
  assert.equal(suggestNextNumber([doc('a', '2025-048', '2026-01-02')], '2026-01-03'), '2026-001');
  // Without a document date any 20xx counts as the year.
  assert.equal(suggestNextNumber([doc('a', '2025-048')], '2026-01-02'), '2026-001');
  assert.equal(suggestNextNumber([doc('a', 'RE-2026-048')], '2026-11-16'), 'RE-2026-049');
});

test('a neighbouring year only stands in when no run carries the year of the document itself', () => {
  // "050/25" was still written into the old year in the first days of 2026: 25 is the year, the new year restarts.
  assert.equal(suggestNextNumber([doc('a', '049/25', '2025-12-20'), doc('b', '050/25', '2026-01-03')], '2026-01-10'), '001/26');
  // "25/26" in 2026: 26 is the year of the document, so 25 is the counter and not "last year".
  assert.equal(suggestNextNumber([doc('a', '25/26', '2026-03-01')], '2026-11-16'), '26/26');
  assert.equal(suggestNextNumber([doc('a', '26-25', '2026-03-01')], '2026-11-16'), '26-26');
  // Two digits are never stretched forwards: "27" on a 2026 document counts on.
  assert.equal(suggestNextNumber([doc('a', '14/27', '2026-03-01')], '2026-11-16'), '14/28');
  // Four digits reach one year in both directions.
  assert.equal(suggestNextNumber([doc('a', '003/2027', '2026-12-30')], '2026-12-31'), '004/2027');
  assert.equal(suggestNextNumber([doc('a', '050/2025', '2026-01-03')], '2026-01-10'), '001/2026');
});

test('counter and year of the same value: the other numbers of the collection say where the year stands', () => {
  // Year behind the counter: 25/26, 26/26 → 27/26, not 26/27.
  const suffix = [doc('a', '25/26', '2026-10-01'), doc('b', '26/26', '2026-11-02')];
  assert.equal(suggestNextNumber(suffix, '2026-11-16'), '27/26');
  assert.equal(suggestNextNumber([...suffix].reverse(), '2026-11-16'), '27/26');
  // Year in front: 26-24, 26-25, 26-26 → 26-27.
  const prefix = [doc('a', '26-24', '2026-09-01'), doc('b', '26-25', '2026-10-01'), doc('c', '26-26', '2026-11-02')];
  assert.equal(suggestNextNumber(prefix, '2026-11-16'), '26-27');
  assert.equal(suggestNextNumber(prefix.slice(1), '2026-11-16'), '26-27');
  // The ambiguous number may also be an older one; the newest still decides the scheme.
  assert.equal(suggestNextNumber([...prefix, doc('d', '26-27', '2026-11-10')], '2026-11-16'), '26-28');
  assert.equal(suggestNextNumber([...suffix, doc('d', '27/26', '2026-11-10')], '2026-11-16'), '28/26');
  // Without a number that leaves no doubt, the last run is the year.
  assert.equal(suggestNextNumber([doc('a', '26/26', '2026-11-02')], '2026-11-16'), '27/26');
  assert.equal(suggestNextNumber([doc('a', 'RE 26/26', '2026-11-02')], '2026-11-16'), 'RE 27/26');
  assert.equal(suggestNextNumber([doc('a', '2026/2026', '2026-11-02')], '2026-11-16'), '2027/2026');
  // The same holds across the turn of the year.
  assert.equal(suggestNextNumber([doc('a', '25/26', '2026-10-01'), doc('b', '26/26', '2026-11-02')], '2027-01-04'), '01/27');
  assert.equal(suggestNextNumber([doc('a', '26-25', '2026-10-01'), doc('b', '26-26', '2026-11-02')], '2027-01-04'), '27-01');
});

test('a year that was already opened by another document is continued, not restarted', () => {
  const opened = [doc('a', 'RE-2025-048', '2025-12-01'), doc('b', 'RE-2026-003', '2025-11-30')];
  assert.equal(suggestNextNumber(opened, '2026-01-02'), 'RE-2026-004');
  const regular = [doc('a', 'RE-2025-048', '2025-12-01'), doc('b', 'RE-2026-003', '2026-01-01')];
  assert.equal(suggestNextNumber(regular, '2026-01-02'), 'RE-2026-004');
});

test('a number dated ahead of today is not rolled back to an earlier year', () => {
  assert.equal(suggestNextNumber([doc('a', '2027-002', '2027-01-03')], '2026-12-30'), '2027-003');
});

test('a counter too large for exact arithmetic is ignored instead of producing a wrong number', () => {
  assert.equal(suggestNextNumber([doc('a', '99999999999999999999', '2026-12-01')], '2026-12-02'), '2026-001');
});

test('duplicates ignore case and outer spaces and never report the document itself', () => {
  const documents = [doc('a', ' re-1 '), doc('b', 'RE-1'), doc('c', 'RE-10'), doc('d', ''), { id: 'e' }];
  assert.deepEqual(findDuplicateNumbers(documents, 'RE-1 ', 'b').map((item) => item.id), ['a']);
  assert.deepEqual(findDuplicateNumbers(documents, 'RE-1', 'new').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(findDuplicateNumbers(documents, 'RE-10', 'c'), []);
  assert.deepEqual(findDuplicateNumbers(documents, 'RE-2', 'x'), []);
});

test('an empty number is never a duplicate, and inner spaces are significant', () => {
  const documents = [doc('a', ''), doc('b', '   '), { id: 'c' }, doc('d', 'RE 1')];
  assert.deepEqual(findDuplicateNumbers(documents, '', 'x'), []);
  assert.deepEqual(findDuplicateNumbers(documents, '   ', 'x'), []);
  assert.deepEqual(findDuplicateNumbers(documents, 'RE  1', 'x'), []);
  assert.deepEqual(findDuplicateNumbers(documents, 're 1', 'x').map((item) => item.id), ['d']);
});

test('a plain counter that happens to equal last year is not taken for the year', () => {
  // Nothing confirms "25" as a year: no document of 2025 carries it at that place.
  assert.equal(suggestNextNumber([doc('a', 'K12-25', '2026-03-01')], '2026-11-16'), 'K12-26');
  assert.equal(suggestNextNumber([doc('a', 'K12-24', '2026-02-01'), doc('b', 'K12-25', '2026-03-01')], '2026-11-16'), 'K12-26');
  assert.equal(suggestNextNumber([doc('a', 'K12-23', '2025-11-01'), doc('b', 'K12-24', '2025-12-01'), doc('c', 'K12-25', '2026-03-01')], '2026-11-16'), 'K12-26');
  // Confirmed by a document of 2025 with the same two digits: "25" is the year, the new year restarts.
  assert.equal(suggestNextNumber([doc('a', 'K12-25', '2025-12-20'), doc('b', 'K13-25', '2026-01-03')], '2026-01-10'), 'K01-26');
});

test('a run that moves while everything else stands still is the counter, even when it reaches the year', () => {
  assert.equal(suggestNextNumber([doc('a', 'A1-25', '2026-10-01'), doc('b', 'A1-26', '2026-11-02')], '2026-11-16'), 'A1-27');
  assert.equal(suggestNextNumber([doc('a', '1001-25', '2026-10-01'), doc('b', '1001-26', '2026-11-02')], '2026-11-16'), '1001-27');
  assert.equal(suggestNextNumber([doc('b', '1001-26', '2026-11-02'), doc('a', '1001-25', '2026-10-01')], '2026-11-16'), '1001-27');
  // The counter has passed the year: nothing rolls over in the new year either.
  assert.equal(suggestNextNumber([doc('a', 'A1-25', '2026-10-01'), doc('b', 'A1-26', '2026-11-02')], '2027-01-04'), 'A1-27');
  assert.equal(suggestNextNumber([doc('a', 'A1-2025', '2026-10-01'), doc('b', 'A1-2026', '2026-11-02')], '2026-11-16'), 'A1-2027');
  // Never a number that already exists.
  const taken = [doc('a', 'A1-24', '2026-09-01'), doc('b', 'A1-25', '2026-10-01'), doc('c', 'A1-26', '2026-11-02'), doc('d', 'A1-27', '2026-11-10')];
  assert.equal(suggestNextNumber(taken, '2026-11-16'), 'A1-28');
  // A year that stands still while the counter moves stays the year.
  assert.equal(suggestNextNumber([doc('a', '025-26', '2026-10-01'), doc('b', '026-26', '2026-11-02')], '2026-11-16'), '027-26');
  assert.equal(suggestNextNumber([doc('a', '025-26', '2026-10-01'), doc('b', '026-26', '2026-11-02')], '2027-01-04'), '001-27');
});

test('a number already written for the coming year continues that year', () => {
  const docs = (list) => list.map(([invoiceNumber, invoiceDate], index) => ({ id: `n${index}`, invoiceNumber, invoiceDate, createdAt: invoiceDate }));
  assert.equal(suggestNextNumber(docs([['047/25', '2025-11-05'], ['048/25', '2025-12-05'], ['001/26', '2025-12-30']]), '2026-01-05'), '002/26');
  assert.equal(suggestNextNumber(docs([['48/25', '2025-12-05'], ['1/26', '2025-12-30']]), '2026-01-05'), '2/26');
});

test('the suggestion is never a number that already exists', () => {
  const docs = (list) => list.map(([invoiceNumber, invoiceDate], index) => ({ id: `n${index}`, invoiceNumber, invoiceDate, createdAt: invoiceDate }));
  const list = docs([['27-26', '2025-06-01'], ['26-26', '2026-06-01']]);
  const suggestion = suggestNextNumber(list, '2026-11-16');
  assert.deepEqual(findDuplicateNumbers(list, suggestion, ''), []);
});
