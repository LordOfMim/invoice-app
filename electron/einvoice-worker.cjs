'use strict';

// PDF construction and validation run outside Electron's UI process.
const { generateValidatedEInvoice } = require('./einvoice-validated.cjs');
process.once('message', async (payload) => {
  try {
    const result = await generateValidatedEInvoice(payload);
    process.send({ ok: true, bytes: result.bytes, extension: result.extension, mimeType: result.mimeType, sha256: result.sha256, validation: result.validation }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, error: error.message || 'E-Rechnungsexport fehlgeschlagen.' }, () => process.exit(1));
  }
});
