'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const fixture = require('./fixture.cjs');
const { buildCii } = require('../../electron/einvoice-xml.cjs');
const { parseValidationReport, assertDocument, getEInvoiceRuntimeStatus } = require('../../electron/einvoice.cjs');
const { generateValidatedEInvoice: exportEInvoice } = require('../../electron/einvoice-validated.cjs');
const { validateXRechnung, parseKositReport } = require('../../electron/einvoice-kosit.cjs');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
function loadTs(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const ts = require('typescript');
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = name => name.startsWith('@/') ? loadTs(path.join(root, 'src', name.slice(2) + '.ts')) : name.startsWith('.') ? loadTs(path.resolve(path.dirname(filename), name + '.ts')) : require(name);
  vm.runInNewContext(code, { require: localRequire, module, exports: module.exports, Intl, Date, Map, Set, console }, { filename });
  return module.exports;
}
const { prepareEInvoice } = loadTs(path.join(root, 'src/lib/einvoice/index.ts'));
function invoice() {
  const d = fixture();
  return { invoiceNumber: d.number, invoiceDate: d.date, dueDate: d.dueDate, currency: d.currency, sender: { name: d.seller.name, address: 'Legacy address', contact: '' }, recipient: { name: d.buyer.name, address: '', contact: '' }, lineItems: [{ id: 'line', type: 'item', description: 'Beratung', quantity: 2, unit: 'Stunden', unitPrice: 100, taxRate: 0.19 }], einvoice: { seller: d.seller, buyer: d.buyer, buyerReference: d.buyerReference, iban: d.iban }, texts: { documentTitle: 'Rechnung' }, layout: { showLogo: false }, notesText: '', footerText: '' };
}
test('historical invoice stays unchanged and reports missing structured fields', () => {
  const i = invoice(); delete i.einvoice; const before = JSON.stringify(i);
  const result = prepareEInvoice(i, 'xrechnung');
  assert.equal(result.ok, false); assert.ok(result.errors.some(e => e.field === 'einvoice.seller.street')); assert.equal(JSON.stringify(i), before); assert.equal(result.document, undefined);
});
test('normalization shares invoice totals and maps unit codes', () => {
  const result = prepareEInvoice(invoice(), 'xrechnung');
  assert.equal(result.ok, true, JSON.stringify(result.errors)); assert.equal(result.document.lines[0].unitCode, 'HUR'); assert.equal(result.document.totals.total, 238);
  assertDocument(result.document);
});
test('tax-group versus per-line rounding mismatch blocks export', () => {
  const i = invoice(); i.lineItems = ['a', 'b'].map(id => ({ id, type: 'item', description: 'Mini', quantity: 1, unitPrice: 0.03, taxRate: 0.19 }));
  assert.ok(prepareEInvoice(i, 'zugferd').errors.some(e => e.message.includes('Steuerrundung')));
});
test('missing zero-tax category and unsupported units get actionable field errors', () => {
  const i = invoice(); i.lineItems[0].taxRate = 0; i.lineItems[0].unit = 'unbekannt';
  const errors = prepareEInvoice(i, 'zugferd').errors;
  assert.ok(errors.some(e => e.field === 'einvoice.taxCategory')); assert.ok(errors.some(e => e.field === 'einvoice.unitCodes.line'));
});
test('bad dates, unknown tax/payment category and header amounts are rejected', () => {
  const i = invoice(); i.invoiceDate = '2026-02-30'; i.einvoice.paymentMeansCode = 'oops'; i.einvoice.taxCategory = 'oops'; i.lineItems[0].taxRate = 0;
  i.lineItems.push({ id: 'header', type: 'header', description: 'Header', quantity: 1, unitPrice: 1 });
  const errors = prepareEInvoice(i, 'xrechnung').errors;
  for (const field of ['invoiceDate', 'einvoice.paymentMeansCode', 'einvoice.taxCategory', 'lineItems.1']) assert.ok(errors.some(e => e.field === field), field);
});
test('CII escapes user text and exposes standalone XRechnung profile', () => {
  const d = fixture(); d.seller.name = 'A & B <GmbH>'; const xml = buildCii(d, 'xrechnung');
  assert.ok(xml.includes('A &amp; B &lt;GmbH&gt;')); assert.ok(xml.includes('urn:xeinkauf.de:kosit:xrechnung_3.0')); assert.ok(!xml.includes('factur-x.xml'));
});
test('helper refuses manipulated invoice sums', () => { const d = fixture(); d.totals.total = 1; assert.throws(() => assertDocument(d), /Summen|summen/); });
test('PDF warning downgrades cannot bypass veraPDF compliance', () => {
  const output = '<validation filename="x"><pdf>isCompliant=false<summary status="valid"/></pdf><xml><summary status="valid"/></xml><summary status="valid"/></validation>';
  assert.equal(parseValidationReport(output, 'zugferd').valid, false);
  assert.throws(() => parseValidationReport('no report', 'xrechnung'), /Prüfbericht/);
});
test('missing validator blocks export instead of claiming conformance', async () => { await assert.rejects(exportEInvoice({ format: 'xrechnung', document: fixture(), runtimeDir: path.join(os.tmpdir(), 'missing-einvoice-runtime') }), /nicht vollständig installiert/); });
const runtimeDir = process.env.EINVOICE_RUNTIME_DIR || path.join(root, 'electron/einvoice-runtime');
const assetsDir = process.env.EINVOICE_ASSETS_DIR || path.join(root, 'electron/einvoice-assets');
const integrationAvailable = fs.existsSync(path.join(runtimeDir, 'manifest.json'));
if (process.env.EINVOICE_REQUIRE_INTEGRATION === '1' && !integrationAvailable) throw new Error('EINVOICE_REQUIRE_INTEGRATION=1, aber die gepinnte Runtime fehlt.');
test('real offline XML and PDF/A-3b exports pass the pinned validator', { skip: !integrationAvailable, timeout: 120000 }, async () => {
  const status = await getEInvoiceRuntimeStatus({ runtimeDir, assetsDir }); assert.equal(status.available, true, status.message);
  const d = fixture();
  for (const format of ['xrechnung', 'zugferd']) {
    const result = await exportEInvoice({ format, document: d, runtimeDir, assetsDir });
    assert.equal(result.validation.valid, true); assert.ok(result.bytes.length > 1000);
    const { deliverEInvoice } = require('../../electron/einvoice-delivery.cjs');
    const { sha256 } = require('../../electron/einvoice-kosit.cjs');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'real-einvoice-delivery-'));
    try {
      const saved = await deliverEInvoice({ artifact: result, format, number: d.number }, {
        saveDocument: async (filename, bytes) => {
          const destination = path.join(tempRoot, filename); fs.writeFileSync(destination, bytes);
          assert.equal(sha256(fs.readFileSync(destination)), result.sha256);
          return { ok: true };
        },
      });
      assert.equal(saved.ok, true);
      const prepared = await deliverEInvoice({ artifact: result, format, number: d.number, delivery: 'email', email: { subject: 'DEMO only' } }, {
        tempRoot,
        openPath: async file => {
          const eml = fs.readFileSync(file, 'utf8');
          const encoded = eml.split('Content-Disposition: attachment;')[1].split('\r\n\r\n')[1].split('\r\n--')[0];
          assert.equal(sha256(Buffer.from(encoded.replace(/\s/g, ''), 'base64')), result.sha256);
          return '';
        },
      });
      assert.deepEqual(prepared, { ok: true, prepared: true });
    } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }

    if (format === 'zugferd') { assert.ok(result.bytes.subarray(0, 8).toString().startsWith('%PDF-1.7')); assert.ok(result.validation.report.includes('isCompliant=true')); }
    else {
      assert.ok(result.bytes.toString().includes('xrechnung_3.0'));
      assert.equal(result.validation.kosit.configuration, '2026-08-31');
      assert.equal(result.validation.kosit.schematron, '2.6.0');
      assert.equal(result.validation.kosit.artifactSha256, result.sha256);
    }
  }
  const many = fixture();
  many.lines = Array.from({ length: 65 }, (_, i) => ({ ...many.lines[0], id: String(i + 1), description: `Handwerkerleistung ${i + 1}: Material prüfen, vorbereiten und fachgerecht montieren. Umfang und Arbeitszeit entsprechend dem Auftrag.`, quantity: 1, unitPrice: 10, net: 10 }));
  many.taxes[0].basis = 650; many.taxes[0].amount = 123.5;
  many.totals = { subtotal: 650, taxTotal: 123.5, total: 773.5 };
  const multipage = await exportEInvoice({ format: 'zugferd', document: many, runtimeDir, assetsDir });
  assert.equal(multipage.validation.valid, true);
  const pageCount = (multipage.bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pageCount >= 4, `Expected >=4 pages, got ${pageCount}`);
  if (process.env.EINVOICE_TEST_OUTPUT_DIR) {
    fs.mkdirSync(process.env.EINVOICE_TEST_OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.EINVOICE_TEST_OUTPUT_DIR, 'multipage-zugferd.pdf'), multipage.bytes);
  }
  const exempt = fixture(); exempt.lines[0].taxRate = 0; exempt.lines[0].taxCategory = 'E';
  exempt.taxes = [{ rate: 0, category: 'E', basis: 200, amount: 0 }]; exempt.totals = { subtotal: 200, taxTotal: 0, total: 200 };
  exempt.taxExemptionReason = 'Steuerbefreiung für Kleinunternehmer gemäß § 19 UStG.';
  assert.equal((await exportEInvoice({ format: 'zugferd', document: exempt, runtimeDir, assetsDir })).validation.valid, true);
  // A structurally plausible XML with a deliberately missing semantic field
  // must fail the actual validator, not merely our input checks.
  const invalid = fixture(); invalid.seller.taxId = ''; invalid.seller.vatId = '';
  await assert.rejects(exportEInvoice({ format: 'xrechnung', document: invalid, runtimeDir, assetsDir }), /nicht freigegeben/);
});


test('current KoSIT report requires its terminal acceptance assessment', () => {
  assert.equal(parseKositReport('<report><accept>true</accept></report>'), false);
  assert.equal(parseKositReport('<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1"><rep:assessment><rep:reject/></rep:assessment></rep:report>'), false);
});

test('official KoSIT 2026-08-31 rejects a well-formed CII without buyer reference', { skip: !integrationAvailable, timeout: 120000 }, async () => {
  const invalid = fixture(); invalid.buyerReference = '';
  await assert.rejects(validateXRechnung(Buffer.from(buildCii(invalid, 'xrechnung')), runtimeDir), /KoSIT|freigegeben/);
});
