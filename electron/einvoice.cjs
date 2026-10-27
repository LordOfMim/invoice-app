'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { buildCii } = require('./einvoice-xml.cjs');
const { renderZugferdPdf } = require('./einvoice-pdf.cjs');
const MUSTANG_SHA256 = '42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736';
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parseValidationReport(output, format) {
  const start = output.indexOf('<validation '), end = output.lastIndexOf('</validation>');
  if (start < 0 || end < start) throw new Error('Der lokale E-Rechnungsvalidator hat keinen Prüfbericht geliefert.');
  const report = output.slice(start, end + '</validation>'.length);
  const statuses = [...report.matchAll(/<summary\s+status="([^"]+)"\s*\/>/g)].map(m => m[1]);
  const xmlPart = report.match(/<xml>([\s\S]*?)<\/xml>/)?.[1] ?? '';
  const pdfPart = report.match(/<pdf>([\s\S]*?)<\/pdf>/)?.[1] ?? '';
  const messages = [...report.matchAll(/<(error|warning|notice)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m => ({ severity: m[1], message: decode(m[2].replace(/<[^>]+>/g, '')).trim() }));
  // Mustang can downgrade PDF/A issues to warnings. Require veraPDF's actual
  // compliance flag as well as XML and aggregate validation status.
  const valid = statuses.length >= 2 && statuses.every(s => s === 'valid') && /<summary\s+status="valid"/.test(xmlPart) && (format !== 'zugferd' || /isCompliant=true/.test(pdfPart));
  return { valid, validator: 'Mustangproject 2.26.0 (inkl. veraPDF)', profile: format === 'zugferd' ? 'ZUGFeRD / Factur-X EN16931 · PDF/A-3b' : 'XRechnung 3.0 · CII', messages, report };
}
async function getEInvoiceRuntimeStatus({ runtimeDir = path.join(__dirname, 'einvoice-runtime'), assetsDir = path.join(__dirname, 'einvoice-assets') } = {}) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8'));
    if (manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.mustangVersion !== '2.26.0') throw new Error('Laufzeit passt nicht zu diesem Betriebssystem.');
    const java = path.join(runtimeDir, 'jre', process.platform === 'darwin' ? 'Contents/Home/bin/java' : process.platform === 'win32' ? 'bin/java.exe' : 'bin/java');
    await fs.access(java); await fs.access(path.join(assetsDir, 'NotoSans-Regular.ttf')); await fs.access(path.join(assetsDir, 'NotoSans-Bold.ttf'));
    if (digest(await fs.readFile(path.join(runtimeDir, 'mustang.jar'))) !== MUSTANG_SHA256) throw new Error('Prüfsumme des lokalen Validators stimmt nicht.');
    return { available: true, java, runtimeDir, assetsDir };
  } catch (error) { return { available: false, message: `Die lokale E-Rechnungsprüfung ist nicht vollständig installiert. ${error.code === 'ENOENT' ? 'Bitte die vollständige Desktop-App installieren.' : error.message}` }; }
}
function assertDocument(d) {
  if (!d || !Array.isArray(d.lines) || !d.lines.length || d.lines.length > 5000 || !Array.isArray(d.taxes) || !d.presentation || !d.seller || !d.buyer || !d.totals) throw new Error('Ungültige E-Rechnungsdaten.');
  if (JSON.stringify(d).length > 15 * 1024 * 1024) throw new Error('E-Rechnungsdaten sind zu groß.');
  for (const p of [d.seller, d.buyer]) if (![p.name, p.street, p.postalCode, p.city, p.countryCode].every(v => typeof v === 'string' && v.trim())) throw new Error('Strukturierte Adressdaten fehlen.');
  if (!['58', '30', '10'].includes(d.paymentMeansCode)) throw new Error('Zahlungsart ist ungültig.');
  if (d.lines.some(l => !['S', 'Z', 'E', 'AE', 'K', 'G', 'O'].includes(l.taxCategory) || (l.taxCategory === 'S' ? l.taxRate <= 0 : l.taxRate !== 0))) throw new Error('Steuerkategorie oder Steuersatz ist ungültig.');
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.000001;
  let subtotal = 0, taxTotal = 0;
  for (const l of d.lines) {
    if (![l.quantity, l.unitPrice, l.net, l.taxRate].every(Number.isFinite) || l.quantity <= 0 || l.unitPrice < 0 || !close(round(l.quantity * l.unitPrice), l.net)) throw new Error('Positionsbeträge sind ungültig oder stimmen nicht mit Menge und Preis überein.');
    subtotal += l.net;
  }
  for (const t of d.taxes) {
    const basis = round(d.lines.filter(l => l.taxRate === t.rate && l.taxCategory === t.category).reduce((s, l) => s + l.net, 0));
    if (!close(basis, t.basis) || !close(round(t.basis * t.rate / 100), t.amount)) throw new Error('Steuergruppen stimmen nicht mit den Positionen überein.');
    taxTotal += t.amount;
  }
  if (new Set(d.taxes.map(t => `${t.rate}:${t.category}`)).size !== d.taxes.length || d.lines.some(l => !d.taxes.some(t => t.rate === l.taxRate && t.category === l.taxCategory))) throw new Error('Steuergruppen fehlen oder sind doppelt vorhanden.');
  if (!close(round(subtotal), d.totals.subtotal) || !close(round(taxTotal), d.totals.taxTotal) || !close(round(subtotal + taxTotal), d.totals.total)) throw new Error('Rechnungssummen stimmen nicht mit Positionen und Steuern überein.');
}
async function exportEInvoice({ format, document, runtimeDir, assetsDir } = {}) {
  if (!['xrechnung', 'zugferd'].includes(format)) throw new Error('Unbekanntes E-Rechnungsformat.');
  assertDocument(document);
  const runtime = await getEInvoiceRuntimeStatus({ runtimeDir, assetsDir });
  if (!runtime.available) throw new Error(runtime.message);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'helferlein-einvoice-'));
  try {
    const extension = format === 'zugferd' ? 'pdf' : 'xml';
    const file = path.join(temporary, `rechnung.${extension}`);
    const bytes = format === 'zugferd' ? await renderZugferdPdf(document, runtime.assetsDir) : Buffer.from(buildCii(document, format), 'utf8');
    await fs.writeFile(file, bytes, { mode: 0o600 });
    let stdout;
    try { ({ stdout } = await run(runtime.java, ['-Djava.awt.headless=true', '-Xmx512m', '-jar', path.join(runtime.runtimeDir, 'mustang.jar'), '--action', 'validate', '--source', file, '--disable-file-logging'], { cwd: temporary, timeout: 90_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true })); }
    catch (error) {
      // A failed validation may deliberately use a nonzero process exit code.
      if (error.stdout?.includes('<validation ')) stdout = error.stdout;
      else throw new Error(error.killed ? 'Die lokale E-Rechnungsprüfung hat das Zeitlimit überschritten.' : 'Die lokale E-Rechnungsprüfung konnte nicht ausgeführt werden. Bitte die vollständige Desktop-App installieren.');
    }
    const validation = parseValidationReport(stdout, format);
    if (!validation.valid) {
      const failure = new Error(`E-Rechnung konnte nicht freigegeben werden: ${validation.messages.filter(m => m.severity !== 'notice').slice(0, 5).map(m => m.message).join('\n') || 'Die PDF/A- oder XML-Prüfung ist fehlgeschlagen.'}`);
      failure.validation = validation; throw failure;
    }
    return { bytes, extension, mimeType: format === 'zugferd' ? 'application/pdf' : 'application/xml', validation };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
module.exports = { exportEInvoice, getEInvoiceRuntimeStatus, parseValidationReport, assertDocument };
