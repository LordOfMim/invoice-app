// Pure validation only: no persistence, migration, Node or browser APIs.
const stringValue = (value) => typeof value === "string";
const numberValue = (value) => typeof value === "number" && Number.isFinite(value);
const booleanValue = (value) => typeof value === "boolean";
const choices = (...values) => (value) => values.includes(value);
const stringArray = (value) => Array.isArray(value) && value.every(stringValue);
function recordGuard(fields) {
  const entries = Object.entries(fields);
  return (value) => isRecord(value)
    && (value.schemaVersion === undefined || value.schemaVersion === 1)
    && entries.every(([key, guard]) => value[key] === undefined || guard(value[key]));
}
const identityFields = { id: stringValue, createdAt: stringValue, updatedAt: stringValue };
const partyFields = { salutation: stringValue, name: stringValue, address: stringValue, contact: stringValue };
const validParty = recordGuard(partyFields);
const validTexts = recordGuard(Object.fromEntries([
  "documentTitle", "senderHeading", "recipientHeading", "invoiceNumberLabel", "invoiceDateLabel", "dueDateLabel",
  "itemsDescriptionLabel", "itemsQuantityLabel", "itemsUnitPriceLabel", "itemsTaxRateLabel", "itemsLineTotalLabel",
  "subtotalLabel", "taxTotalLabel", "totalLabel", "notesHeading", "footerHeading", "creditNoteNumberLabel",
  "creditNoteDateLabel", "linkedInvoiceLabel", "reasonLabel", "amountLabel",
].map((key) => [key, stringValue])));
const validCustomization = recordGuard({
  fontSizeScale: numberValue, lineSpacing: numberValue, tablePadding: choices("compact", "normal", "spacious"),
  showTaxColumn: booleanValue, showQuantityColumn: booleanValue, showUnitPriceColumn: booleanValue,
  footerColumns: choices(1, 2, 3), headerStyle: choices("simple", "boxed", "underlined"), accentColor: stringValue,
});
const validLayout = recordGuard({
  templateId: choices("classic", "modern", "minimal"), templateVariantId: stringValue,
  showLogo: booleanValue, showFooter: booleanValue, logoPosition: choices("left", "center", "right"),
  logoSize: choices("small", "medium", "large"), logoMaxHeight: numberValue, logoFitMode: choices("cover", "contain", "fill"),
  senderPosition: choices("left", "right"), recipientPosition: choices("left", "right"), customization: validCustomization,
});
const validEInvoiceParty = recordGuard(Object.fromEntries([
  "street", "postalCode", "city", "countryCode", "email", "electronicAddress", "electronicAddressScheme",
  "vatId", "taxId", "contactName", "contactPhone",
].map((key) => [key, stringValue])));
const validEInvoice = recordGuard({
  seller: validEInvoiceParty, buyer: validEInvoiceParty, buyerReference: stringValue,
  paymentMeansCode: choices("58", "30", "10"), iban: stringValue, bic: stringValue, accountName: stringValue,
  paymentTerms: stringValue, serviceDate: stringValue, taxExemptionReason: stringValue,
  taxCategory: choices("S", "Z", "E", "AE", "K", "G", "O"),
  unitCodes: (codes) => isRecord(codes) && Object.values(codes).every(stringValue),
});
function validRecords(value, guard) {
  if (!Array.isArray(value))
    return false;
  const ids = new Set();
  return value.every((record) => {
    if (!guard(record) || !isRecord(record))
      return false;
    if (record.id !== undefined) {
      if (typeof record.id !== "string" || !record.id || ids.has(record.id))
        return false;
      ids.add(record.id);
    }
    return true;
  });
}
const validLineItem = recordGuard({
  ...identityFields, type: choices("item", "header", "subheader"), positionNumber: stringValue,
  description: stringValue, quantity: numberValue, unitPrice: numberValue, taxRate: numberValue,
  unit: stringValue, productId: stringValue,
});
const validPayment = recordGuard({
  ...identityFields, amount: numberValue, currency: stringValue, date: stringValue,
  method: stringValue, reference: stringValue, notes: stringValue,
});
const validAttachment = recordGuard({
  ...identityFields, name: stringValue, type: stringValue, size: numberValue, dataUrl: stringValue,
});
const documentFields = {
  ...identityFields, sender: validParty, recipient: validParty,
  lineItems: (value) => validRecords(value, validLineItem),
  currency: stringValue, footerText: stringValue, texts: validTexts, layout: validLayout, customerId: stringValue,
};
const validInvoice = recordGuard({
  ...documentFields, invoiceNumber: stringValue, invoiceDate: stringValue, dueDate: stringValue,
  notesText: stringValue, footerLeftText: stringValue, footerRightText: stringValue,
  paid: booleanValue, exchangeRate: numberValue, exchangeRateNote: stringValue, logoDataUrl: stringValue,
  tagIds: stringArray, creditNoteIds: stringArray, recurringInvoiceId: stringValue, einvoice: validEInvoice,
  payments: (items) => validRecords(items, validPayment), attachments: (items) => validRecords(items, validAttachment),
});
const validSettings = recordGuard({
  language: choices("de", "en"), currency: stringValue, defaultTaxRate: numberValue,
  defaultSender: validParty, defaultEInvoice: validEInvoice, defaultFooterText: stringValue,
  defaultTemplateId: choices("classic", "modern", "minimal"), defaultLayout: validLayout,
  defaultLogoDataUrl: stringValue, pdfFilenamePattern: stringValue, defaultTexts: validTexts,
  defaultInvoiceId: stringValue, backupEnabled: booleanValue, backupPath: stringValue, lastBackupDate: stringValue,
  dashboardPeriod: choices("month", "quarter", "year"),
  backgroundChoice: choices("auto", "off", "threads", "light-rays", "shape-grid", "beams"),
});
const collectionGuards = {
  invoices: validInvoice,
  customers: recordGuard({ ...identityFields, ...partyFields, email: stringValue, phone: stringValue, taxId: stringValue, notes: stringValue }),
  products: recordGuard({ ...identityFields, name: stringValue, description: stringValue, unit: stringValue, unitPrice: numberValue, taxRate: numberValue, category: stringValue }),
  tags: recordGuard({ ...identityFields, name: stringValue, color: stringValue }),
  creditNotes: recordGuard({
    ...identityFields, type: choices("storno", "gutschrift"), creditNoteNumber: stringValue, creditNoteDate: stringValue,
    linkedInvoiceId: stringValue, linkedInvoiceNumber: stringValue, reason: stringValue, amount: numberValue,
    sender: validParty, recipient: validParty, footerText: stringValue, texts: validTexts,
  }),
  recurringInvoices: recordGuard({
    ...documentFields, name: stringValue, frequency: choices("monthly", "quarterly", "yearly"),
    nextRunDate: stringValue, lastRunDate: stringValue, active: booleanValue, reminderDays: numberValue, autoGenerate: booleanValue,
  }),
  templateVariants: recordGuard({
    ...identityFields, name: stringValue, baseTemplateId: choices("classic", "modern", "minimal"), customization: validCustomization,
  }),
};
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/** Strict shape validation shared by renderer migration and the storage worker.
 * Missing legacy fields and unknown additive fields are preserved; nothing is normalized here. */
function isValidPersistedData(value) {
  if (!isRecord(value) || value.schemaVersion !== 1)
    return false;
  if (!validSettings(value.settings) || !Array.isArray(value.invoices))
    return false;
  return Object.entries(collectionGuards).every(([key, guard]) => value[key] === undefined || validRecords(value[key], guard));
}

module.exports = { isValidPersistedData };
