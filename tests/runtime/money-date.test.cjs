'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const source = ts.transpileModule(
    fs.readFileSync(path.resolve(__dirname, '../../src/lib', file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function (module, exports, require) {${source}\n})`)(module, module.exports, require);
  return module.exports;
}

test('an incomplete or unknown currency code formats without throwing', () => {
  const { formatMoney } = load('money.ts');
  assert.match(formatMoney(1234.5, 'EUR', 'de-DE'), /1\.234,50/);
  for (const currency of ['', 'EU', 'EURO', '€']) {
    const text = formatMoney(1234.5, currency, 'de-DE');
    assert.match(text, /^1\.234,50/);
    if (currency) assert.ok(text.endsWith(currency));
  }
});

test('day differences count calendar days across both clock changes', () => {
  const { daysBetweenDateOnly } = load('date.ts');
  assert.equal(daysBetweenDateOnly('2026-03-28', '2026-03-29'), 1);
  assert.equal(daysBetweenDateOnly('2026-03-29', '2026-03-30'), 1); // 23-hour day
  assert.equal(daysBetweenDateOnly('2026-03-01', '2026-04-01'), 31);
  assert.equal(daysBetweenDateOnly('2026-10-25', '2026-10-26'), 1); // 25-hour day
  assert.equal(daysBetweenDateOnly('2026-10-01', '2026-11-01'), 31);
  assert.equal(daysBetweenDateOnly('2026-04-01', '2026-03-01'), -31);
  assert.equal(daysBetweenDateOnly('2026-05-05', '2026-05-05'), 0);
});
