'use strict';
const path = require('node:path');
const { exportEInvoice } = require('./einvoice.cjs');
const { validateXRechnung, sha256 } = require('./einvoice-kosit.cjs');
async function generateValidatedEInvoice(payload) {
  const result = await exportEInvoice(payload);
  const kosit = payload.format === 'xrechnung'
    ? await validateXRechnung(result.bytes, payload.runtimeDir || path.join(__dirname, 'einvoice-runtime'))
    : undefined;
  const hash = sha256(result.bytes);
  return { ...result, sha256: hash, validation: { ...result.validation, artifactSha256: hash, ...(kosit ? { kosit } : {}) } };
}
module.exports = { generateValidatedEInvoice };
