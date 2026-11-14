'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deliverEInvoice, buildEInvoiceEml } = require('../../electron/einvoice-delivery.cjs');
const { sha256 } = require('../../electron/einvoice-kosit.cjs');
function artifact(format = 'xrechnung') {
  const bytes = Buffer.from(format === 'xrechnung' ? '<?xml version="1.0"?><test>ä</test>' : '%PDF-1.7\n\0\u00ff');
  const hash = sha256(bytes);
  return { bytes, extension: format === 'xrechnung' ? 'xml' : 'pdf', mimeType: format === 'xrechnung' ? 'application/xml' : 'application/pdf', sha256: hash, validation: { valid: true, artifactSha256: hash, kosit: { valid: true, configuration: '2026-08-31', artifactSha256: hash } } };
}
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'helferlein-delivery-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test('download receives exact validated bytes; cancellation stays cancellation', async () => {
  const original = artifact();
  const result = await deliverEInvoice({ artifact: original, format: 'xrechnung', number: '../R-1' }, {
    saveDocument: async (name, bytes, extension) => {
      assert.equal(name, '-R-1-xrechnung.xml'); assert.equal(extension, 'xml');
      assert.equal(sha256(bytes), original.sha256);
      return { ok: false, canceled: true };
    },
  });
  assert.deepEqual(result, { ok: false, canceled: true });
});
test('download write failure is propagated without success', async () => {
  await assert.rejects(deliverEInvoice({ artifact: artifact(), format: 'xrechnung' }, { saveDocument: async () => { throw new Error('disk full'); } }), /disk full/);
});
test('mutated bytes, invalid validation, absent current KoSIT and wrong MIME are refused before delivery', async () => {
  for (const mutate of [a => { a.bytes = Buffer.from('changed'); }, a => { a.validation.valid = false; }, a => { delete a.validation.kosit; }, a => { a.mimeType = 'application/pdf'; }]) {
    const a = artifact(); mutate(a);
    await assert.rejects(deliverEInvoice({ artifact: a, format: 'xrechnung' }, { saveDocument: async () => assert.fail('must not save') }));
  }
});
test('email EML attachment decodes to exact validated XML/PDF; headers resist CRLF injection', async t => {
  const tempRoot = await directory(t);
  for (const format of ['xrechnung', 'zugferd']) {
    const a = artifact(format);
    const result = await deliverEInvoice({ artifact: a, format, number: 'R-Ä 1', delivery: 'email', email: { to: 'demo@example.invalid\r\nBcc: bad@example.invalid', subject: 'Rechnung\r\nX-Injected: yes', body: 'DEMO\r\n--fakeboundary' } }, {
      tempRoot,
      openPath: async file => {
        const eml = await fs.readFile(file, 'utf8');
        assert.ok(!eml.includes('\r\nBcc:')); assert.ok(!eml.includes('\r\nX-Injected:'));
        assert.ok(eml.includes(`Content-Type: ${a.mimeType}\r\n`));
        assert.ok(eml.includes(`-${format}.${a.extension}`));
        const part = eml.split('Content-Disposition: attachment;')[1].split('\r\n\r\n')[1].split('\r\n--')[0];
        assert.equal(sha256(Buffer.from(part.replace(/\s/g, ''), 'base64')), a.sha256);
        return '';
      },
    });
    assert.deepEqual(result, { ok: true, prepared: true });
  }
});
test('Apple Mail composer gets exact validated attachment and only prepared success', async t => {
  const a = artifact('zugferd'), tempRoot = await directory(t);
  const result = await deliverEInvoice({ artifact: a, format: 'zugferd', delivery: 'email', email: { subject: 'DEMO' } }, {
    tempRoot, composeWithAttachment: async ({ attachmentPath }) => assert.equal(sha256(await fs.readFile(attachmentPath)), a.sha256),
  });
  assert.deepEqual(result, { ok: true, prepared: true });
});
test('email open failure is not success and removes temporary files', async t => {
  const tempRoot = await directory(t);
  await assert.rejects(deliverEInvoice({ artifact: artifact(), format: 'xrechnung', delivery: 'email' }, { tempRoot, openPath: async () => 'No mail application' }), /No mail application/);
  assert.deepEqual(await fs.readdir(tempRoot), []);
});
test('partial write fails read-back hash check before opening a composer', async t => {
  const tempRoot = await directory(t);
  const original = fs.writeFile;
  t.after(() => { fs.writeFile = original; });
  fs.writeFile = async (name, bytes, options) => original(name, Buffer.from(bytes).subarray(0, 4), options);
  await assert.rejects(deliverEInvoice({ artifact: artifact(), format: 'xrechnung', delivery: 'email' }, { tempRoot, openPath: async () => assert.fail('must not open') }), /vollständig/);
  assert.deepEqual(await fs.readdir(tempRoot), []);
});
