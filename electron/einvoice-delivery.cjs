'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { sha256, pins } = require('./einvoice-kosit.cjs');
const formats = { zugferd: { extension: 'pdf', mimeType: 'application/pdf' }, xrechnung: { extension: 'xml', mimeType: 'application/xml' } };
const header = value => String(value ?? '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim();
function encodedHeader(value) {
  const chunks = [];
  let chunk = '';
  for (const character of header(value)) {
    if (Buffer.byteLength(chunk + character) > 45) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  chunks.push(chunk);
  return chunks.map(text => `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`).join('\r\n ');
}
function attachmentName(number, format) {
  const name = header(number).replace(/[<>:"/\\|?*]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 110) || 'Rechnung';
  return `${name}-${format}.${formats[format].extension}`;
}
function assertValidatedArtifact(artifact, format) {
  const expected = formats[format];
  if (!expected || !artifact || artifact.extension !== expected.extension || artifact.mimeType !== expected.mimeType) throw new Error('Unpassendes E-Rechnungsformat.');
  const bytes = Buffer.from(artifact.bytes ?? []);
  if (!bytes.length || bytes.length > 100 * 1024 * 1024 || !artifact.validation?.valid || !artifact.sha256 || sha256(bytes) !== artifact.sha256 || artifact.validation.artifactSha256 !== artifact.sha256) throw new Error('Die E-Rechnung stimmt nicht mit dem geprüften Dokument überein.');
  if (format === 'xrechnung' && (!artifact.validation.kosit?.valid || artifact.validation.kosit.configuration !== pins.configurationVersion || artifact.validation.kosit.artifactSha256 !== artifact.sha256)) throw new Error('Aktuelle KoSIT-Freigabe fehlt.');
  return bytes;
}
function buildEInvoiceEml({ to, subject, body, filename, mimeType, bytes }) {
  // Header values cannot introduce MIME parts; body is base64, including any
  // user-supplied boundary-looking lines. Use RFC 2231 for Unicode filenames.
  const boundary = `helferlein-${require('node:crypto').randomUUID()}`;
  const base64 = value => Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  const encodedName = encodeURIComponent(filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return [
    'MIME-Version: 1.0', `To: ${header(to)}`, `Subject: ${encodedHeader(subject)}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', base64(String(body ?? '')), '',
    `--${boundary}`, `Content-Type: ${mimeType}`, 'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename*=UTF-8''${encodedName}`, '', base64(bytes), '', `--${boundary}--`, '',
  ].join('\r\n');
}
async function deliverEInvoice({ artifact, format, number, delivery = 'download', email = {} }, { saveDocument, composeWithAttachment, openPath, tempRoot = os.tmpdir() }) {
  const bytes = assertValidatedArtifact(artifact, format);
  const filename = attachmentName(number, format);
  if (delivery === 'download') {
    if (typeof saveDocument !== 'function') throw new Error('Speichern ist nicht verfügbar.');
    return await saveDocument(filename, bytes, artifact.extension);
  }
  if (delivery !== 'email') throw new Error('Unbekannte Dokumentaktion.');
  if (!composeWithAttachment && !openPath) throw new Error('Kein E-Mailprogramm verfügbar.');
  const directory = await fs.mkdtemp(path.join(tempRoot, 'helferlein-einvoice-email-'));
  try {
    const attachmentPath = path.join(directory, filename);
    await fs.writeFile(attachmentPath, bytes, { flag: 'wx', mode: 0o600 });
    if (sha256(await fs.readFile(attachmentPath)) !== artifact.sha256) throw new Error('Die E-Mailanlage konnte nicht vollständig gespeichert werden.');
    if (composeWithAttachment) {
      await composeWithAttachment({ to: header(email.to), subject: header(email.subject), body: String(email.body ?? ''), attachmentPath });
    } else {
      const emlPath = path.join(directory, 'rechnung-entwurf.eml');
      const eml = buildEInvoiceEml({ ...email, filename, mimeType: artifact.mimeType, bytes });
      await fs.writeFile(emlPath, eml, { flag: 'wx', mode: 0o600 });
      if (sha256(await fs.readFile(emlPath)) !== sha256(eml)) throw new Error('Der E-Mailentwurf konnte nicht vollständig gespeichert werden.');
      const error = await openPath(emlPath);
      if (error) throw new Error(`E-Mailentwurf konnte nicht geöffnet werden: ${error}`);
    }
    // Keep temporary attachment alive while the external composer uses it.
    return { ok: true, prepared: true };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { deliverEInvoice, assertValidatedArtifact, buildEInvoiceEml, attachmentName };
