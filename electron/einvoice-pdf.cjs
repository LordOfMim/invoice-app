'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { buildCii } = require('./einvoice-xml.cjs');

// PDFKit owns PDF/A colour management, font subsetting, associated files and XMP.
// An independent local validator is still required before this buffer is exported.
async function renderZugferdPdf(d, assetsDir) {
  const PDFDocument = require('pdfkit');
  const regular = path.join(assetsDir, 'NotoSans-Regular.ttf');
  const bold = path.join(assetsDir, 'NotoSans-Bold.ttf');
  for (const font of [regular, bold]) if (!fs.existsSync(font)) throw new Error('Die eingebetteten Rechnungsschriften fehlen. Bitte die App vollständig installieren.');
  const safeMetadata = value => String(value).replace(/[<>&]/g, ' ');
  const doc = new PDFDocument({ subset: 'PDF/A-3b', pdfVersion: '1.7', size: 'A4', margin: 48, font: regular,
    info: { Title: safeMetadata(`${d.presentation.title || 'Rechnung'} ${d.number}`), Author: safeMetadata(d.seller.name), Creator: 'Helferlein', Producer: 'Helferlein / PDFKit' } });
  doc.registerFont('Regular', regular); doc.registerFont('Bold', bold);
  const chunks = [];
  const result = new Promise((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  const moneyFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: d.currency });
  const money = n => moneyFormatter.format(n);
  const decimal = n => String(n).replace('.', ',');
  const unitLabel = code => ({ C62: 'Stk.', H87: 'Stk.', HUR: 'Std.', DAY: 'Tage', MON: 'Mon.', ANN: 'Jahre', KGM: 'kg', GRM: 'g', MTR: 'm', MTK: 'm²', MTQ: 'm³', KMT: 'km', LTR: 'l', MIN: 'Min.', SEC: 'Sek.' })[code] || code;
  const label = d.presentation.labels;
  const text = (v, x, y, width, options = {}) => doc.text(String(v || ''), x, y, { width, ...options });
  const nextPageIfNeeded = height => { if (doc.y + height > 775) { doc.addPage(); doc.y = 48; } };
  doc.fillColor('#182b35').font('Bold').fontSize(25);
  text(d.presentation.title || 'Rechnung', 48, 48, 380);
  if (d.presentation.logoDataUrl) {
    if (!/^data:image\/(png|jpe?g);base64,/.test(d.presentation.logoDataUrl)) throw new Error('Für das ZUGFeRD-PDF ein PNG- oder JPEG-Logo verwenden.');
    doc.image(d.presentation.logoDataUrl, 420, 44, { fit: [125, 54], align: 'right' });
  }
  doc.font('Regular').fontSize(10).fillColor('#52636c');
  text(`${label.invoiceNumberLabel || 'Rechnungsnummer'}: ${d.number}\n${label.invoiceDateLabel || 'Rechnungsdatum'}: ${d.date}\n${label.dueDateLabel || 'Fällig am'}: ${d.dueDate}`, 48, 91, 490, { lineGap: 3 });
  const partyText = p => `${p.name}\n${p.street}\n${p.postalCode} ${p.city}\n${p.countryCode}`;
  doc.font('Bold').fillColor('#182b35').fontSize(9);
  text(label.senderHeading || 'Rechnungssteller', 48, 164, 235); text(label.recipientHeading || 'Rechnungsempfänger', 315, 164, 230);
  doc.font('Regular').fontSize(10);
  const sellerH = doc.heightOfString(partyText(d.seller), { width: 235 });
  const buyerH = doc.heightOfString(partyText(d.buyer), { width: 230 });
  text(partyText(d.seller), 48, 184, 235, { lineGap: 2 }); text(partyText(d.buyer), 315, 184, 230, { lineGap: 2 });
  doc.y = 195 + Math.max(sellerH, buyerH) + 14;
  for (const line of [d.buyerReference && `Käuferreferenz: ${d.buyerReference}`, d.serviceDate && `Leistungsdatum: ${d.serviceDate}`].filter(Boolean)) { text(line, 48, doc.y, 499); doc.moveDown(0.4); }
  doc.moveDown(0.8);
  const header = () => {
    const y = doc.y;
    doc.rect(48, y - 5, 499, 27).fill('#edf2f4');
    doc.fillColor('#182b35').font('Bold').fontSize(8);
    text(label.itemsDescriptionLabel || 'Leistung', 56, y + 3, 225);
    text(label.itemsQuantityLabel || 'Menge', 286, y + 3, 47, { align: 'right' });
    text(label.itemsUnitPriceLabel || 'Einzelpreis', 341, y + 3, 70, { align: 'right' });
    text(label.itemsTaxRateLabel || 'USt.', 419, y + 3, 42, { align: 'right' });
    text(label.itemsLineTotalLabel || 'Gesamt', 468, y + 3, 72, { align: 'right' });
    doc.y = y + 30;
  };
  header();
  for (const l of d.lines) {
    doc.font('Regular').fontSize(9);
    const height = Math.max(30, doc.heightOfString(l.description, { width: 225 }) + 16);
    if (height > 645) throw new Error(`Position ${l.id}: Beschreibung ist für eine Tabellenzeile zu lang. Bitte in mehrere Positionen aufteilen.`);
    if (doc.y + height > 735) { doc.addPage(); doc.y = 48; header(); doc.font('Regular').fontSize(9); }
    const y = doc.y;
    text(l.description, 56, y, 225); text(`${decimal(l.quantity)} ${unitLabel(l.unitCode)}`, 286, y, 47, { align: 'right' }); text(money(l.unitPrice), 341, y, 70, { align: 'right' }); text(`${decimal(l.taxRate)} %`, 419, y, 42, { align: 'right' }); text(money(l.net), 468, y, 72, { align: 'right' });
    doc.moveTo(48, y + height - 6).lineTo(547, y + height - 6).strokeColor('#dfe5e8').stroke(); doc.y = y + height;
  }
  nextPageIfNeeded(Math.min(120, 60 + d.taxes.length * 21)); doc.y += 12;
  for (const [caption, value] of [[label.subtotalLabel || 'Nettosumme', d.totals.subtotal], ...d.taxes.map(t => [`${label.taxTotalLabel || 'Umsatzsteuer'} ${t.rate} %`, t.amount]), [label.totalLabel || 'Gesamtbetrag', d.totals.total]]) {
    nextPageIfNeeded(30);
    const y = doc.y; doc.font(caption === (label.totalLabel || 'Gesamtbetrag') ? 'Bold' : 'Regular').fontSize(10); text(caption, 270, y, 185, { align: 'right' }); text(money(value), 462, y, 78, { align: 'right' }); doc.y = y + 21;
  }
  const paragraphs = [d.taxExemptionReason, d.paymentTerms, d.iban && `IBAN: ${d.iban}${d.bic ? ` · BIC: ${d.bic}` : ''}${d.accountName ? `\nKontoinhaber: ${d.accountName}` : ''}`, d.seller.vatId && `USt-IdNr.: ${d.seller.vatId}`, d.seller.taxId && `Steuernummer: ${d.seller.taxId}`, d.seller.email && `Kontakt: ${d.seller.contactName || d.seller.name} · ${d.seller.email}${d.seller.contactPhone ? ` · ${d.seller.contactPhone}` : ''}`, d.presentation.notes && `${label.notesHeading || 'Hinweise'}\n${d.presentation.notes}`, d.presentation.footer].filter(Boolean);
  doc.font('Regular').fontSize(9).fillColor('#52636c');
  for (const paragraph of paragraphs) { const height = doc.heightOfString(paragraph, { width: 499 }) + 12; nextPageIfNeeded(Math.min(height, 680)); doc.moveDown(0.6); doc.text(paragraph, 48, doc.y, { width: 499, lineGap: 2 }); }
  const invoiceXml = buildCii(d, 'zugferd');
  doc.file(Buffer.from(invoiceXml, 'utf8'), { name: 'factur-x.xml', type: 'text/xml', description: 'Factur-X EN16931 invoice', relationship: 'Alternative' });
  doc.appendXML(`<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"><pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>${[['DocumentFileName','name of the embedded XML invoice file'],['DocumentType','INVOICE'],['Version','version of the Factur-X XML schema'],['ConformanceLevel','conformance level of the Factur-X XML invoice']].map(([name,description]) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`).join('')}</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>`);
  doc.end();
  return result;
}
module.exports = { renderZugferdPdf };
