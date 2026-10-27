'use strict';

// PDF construction and validation run outside Electron's UI process.
const { exportEInvoice } = require('./einvoice.cjs');
process.once('message', async (payload) => {
  try {
    const result = await exportEInvoice(payload);
    process.send({ ok: true, bytes: result.bytes, extension: result.extension }, () => process.exit(0));
  } catch (error) {
    process.send({ ok: false, error: error.message || 'E-Rechnungsexport fehlgeschlagen.' }, () => process.exit(1));
  }
});
