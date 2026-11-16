import type { 
  AppSettings, 
  CreditNote, 
  CreditNoteTexts, 
  Customer, 
  Invoice, 
  InvoiceLineItem, 
  InvoiceTexts, 
  LayoutPreferences, 
  Payment, 
  Product, 
  RecurringInvoice, 
  Tag, 
  TemplateCustomization, 
  TemplateVariant 
} from "@/lib/domain";
import { computeInvoicePayable } from "@/lib/calc";
import { addDays, dateToLocalISO } from "@/lib/date";

function isoDateToday(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function createDefaultTextsDe(): InvoiceTexts {
  return {
    documentTitle: "Rechnung",

    senderHeading: "Absender",
    recipientHeading: "Empfänger",

    invoiceNumberLabel: "Rechnungsnummer",
    invoiceDateLabel: "Rechnungsdatum",
    dueDateLabel: "Fällig am",

    itemsDescriptionLabel: "Beschreibung",
    itemsQuantityLabel: "Menge",
    itemsUnitPriceLabel: "Einzelpreis",
    itemsTaxRateLabel: "MwSt.",
    itemsLineTotalLabel: "Summe",

    subtotalLabel: "Zwischensumme",
    taxTotalLabel: "Steuer",
    totalLabel: "Gesamt",

    notesHeading: "Hinweise",
    footerHeading: "",
  };
}

export function createDefaultLayoutPreferences(templateId: LayoutPreferences["templateId"]): LayoutPreferences {
  return {
    templateId,
    showLogo: true,
    logoPosition: "left",
    logoSize: "medium",
    showFooter: true,
    senderPosition: "left",
    recipientPosition: "right",
  };
}

export function createDefaultSettings(): AppSettings {
  return {
    schemaVersion: 1,
    language: "de",
    currency: "EUR",
    defaultTaxRate: 0.19,
    defaultSender: {
      name: "",
      address: "",
      contact: "",
    },
    defaultFooterText: "",
    defaultTemplateId: "classic",
    defaultLayout: {
      showLogo: true,
      logoPosition: "left",
      logoSize: "medium",
      logoMaxHeight: 80,
      logoFitMode: "contain",
      showFooter: true,
      senderPosition: "left",
      recipientPosition: "right",
    },
    pdfFilenamePattern: "Rechnung-{invoiceNumber}.pdf",
    defaultTexts: createDefaultTextsDe(),
    backupEnabled: false,
    dashboardPeriod: "month",
    backgroundChoice: "auto",
  };
}

export function createDefaultTemplateCustomization(): TemplateCustomization {
  return {
    fontSizeScale: 1,
    lineSpacing: 1.4,
    tablePadding: "normal",
    showTaxColumn: true,
    showQuantityColumn: true,
    showUnitPriceColumn: true,
    footerColumns: 1,
    headerStyle: "simple",
  };
}

export function createDefaultLineItem(defaultTaxRate?: number, type: InvoiceLineItem["type"] = "item"): InvoiceLineItem {
  return {
    id: newId(),
    type,
    positionNumber: "",
    description: "",
    quantity: type === "item" ? 1 : 0,
    unitPrice: type === "item" ? 0 : 0,
    taxRate: type === "item" ? defaultTaxRate : undefined,
  };
}

export function createLineItemFromProduct(product: Product): InvoiceLineItem {
  return {
    id: newId(),
    type: "item",
    positionNumber: "",
    description: product.description || product.name,
    quantity: 1,
    unit: product.unit,
    unitPrice: product.unitPrice,
    taxRate: product.taxRate,
    productId: product.id,
  };
}

/** Due date of a new invoice: the invoice date plus the payment term from the settings (0 or unset = same day). */
export function dueDateFor(invoiceDate: string, settings: Pick<AppSettings, "defaultPaymentTermDays">): string {
  const days = settings.defaultPaymentTermDays;
  return typeof days === "number" && Number.isFinite(days) && days > 0 ? addDays(invoiceDate, Math.min(Math.round(days), 365)) : invoiceDate;
}

export function createInvoiceFromDefaults(settings: AppSettings): Invoice {
  const nowIso = new Date().toISOString();
  const today = isoDateToday();
  const layout: LayoutPreferences = {
    templateId: settings.defaultTemplateId,
    ...settings.defaultLayout,
  };

  return {
    schemaVersion: 1,
    id: newId(),

    invoiceNumber: "",
    invoiceDate: today,
    dueDate: dueDateFor(today, settings),

    sender: { ...settings.defaultSender },
    einvoice: settings.defaultEInvoice ? structuredClone(settings.defaultEInvoice) : undefined,
    recipient: { name: "", address: "", contact: "" },

    lineItems: [createDefaultLineItem(settings.defaultTaxRate)],

    notesText: "",
    footerText: settings.defaultFooterText,
    footerLeftText: "",
    footerRightText: "",
    paid: false,
    payments: [],
    
    tagIds: [],
    
    currency: settings.currency,
    attachments: [],
    creditNoteIds: [],

    texts: { ...settings.defaultTexts },
    layout,

    logoDataUrl: undefined,

    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function createInvoiceFromCustomer(settings: AppSettings, customer: Customer): Invoice {
  const invoice = createInvoiceFromDefaults(settings);
  return {
    ...invoice,
    customerId: customer.id,
    recipient: {
      name: customer.name,
      address: customer.address,
      contact: customer.contact,
    },
  };
}

/**
 * A record keyed by line id (unit codes, tax rates remembered for § 13b) for copies of those lines that received
 * new ids: `copies[i]` is the copy of `originals[i]`. Keys of lines that no longer exist are dropped.
 */
export function remapLineIdKeys<T>(
  record: Record<string, T> | undefined,
  originals: readonly { id: string }[],
  copies: readonly { id: string }[],
): Record<string, T> | undefined {
  if (!record) return undefined;
  const next: Record<string, T> = {};
  originals.forEach((line, index) => {
    if (copies[index] && Object.prototype.hasOwnProperty.call(record, line.id)) next[copies[index].id] = record[line.id];
  });
  return next;
}

export function duplicateInvoice(invoice: Invoice): Invoice {
  const nowIso = new Date().toISOString();
  const lineItems = invoice.lineItems.map((line) => ({ ...line, id: newId() }));
  const einvoice = invoice.einvoice ? structuredClone(invoice.einvoice) : undefined;
  if (einvoice?.unitCodes) einvoice.unitCodes = remapLineIdKeys(invoice.einvoice?.unitCodes, invoice.lineItems, lineItems);
  // The date of supply belongs to the original; the copy is for new work.
  if (einvoice?.serviceDate) einvoice.serviceDate = undefined;
  return {
    ...invoice,
    id: newId(),
    invoiceNumber: "",
    // A copied final invoice starts without deductions. Its advance invoices are not offered again while the
    // original still deducts them (the editor says so); they become free once the original is cancelled in full.
    advanceDeductions: undefined,
    // The tax rates remembered for switching § 13b off follow their positions to the new ids.
    reverseChargePreviousRates: remapLineIdKeys(invoice.reverseChargePreviousRates, invoice.lineItems, lineItems),
    paid: false,
    payments: [],
    attachments: [],
    creditNoteIds: [],
    // A copy is a new document: it carries no reminders and no link to a quote.
    reminders: undefined,
    // Nor is it a run of the schedule its original came from (that would block the schedule's own run on that day).
    recurringInvoiceId: undefined,
    convertedInvoiceId: undefined,
    sourceQuoteId: undefined,
    quoteStatus: invoice.documentKind === "quote" ? "open" : undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
    lineItems,
    einvoice,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer Defaults
// ─────────────────────────────────────────────────────────────────────────────

export function createDefaultCustomer(): Customer {
  const nowIso = new Date().toISOString();
  return {
    id: newId(),
    name: "",
    address: "",
    contact: "",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Product Defaults
// ─────────────────────────────────────────────────────────────────────────────

export function createDefaultProduct(defaultTaxRate?: number): Product {
  const nowIso = new Date().toISOString();
  return {
    id: newId(),
    name: "",
    description: "",
    unitPrice: 0,
    taxRate: defaultTaxRate,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag Defaults
// ─────────────────────────────────────────────────────────────────────────────

const TAG_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
];

export function createDefaultTag(): Tag {
  const nowIso = new Date().toISOString();
  return {
    id: newId(),
    name: "",
    color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)],
    createdAt: nowIso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment Defaults
// ─────────────────────────────────────────────────────────────────────────────

export function createDefaultPayment(amount: number = 0): Payment {
  const nowIso = new Date().toISOString();
  return {
    id: newId(),
    amount,
    date: isoDateToday(),
    createdAt: nowIso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit Note Defaults
// ─────────────────────────────────────────────────────────────────────────────

export function createDefaultCreditNoteTextsDe(): CreditNoteTexts {
  return {
    documentTitle: "Gutschrift",
    creditNoteNumberLabel: "Gutschriftnummer",
    creditNoteDateLabel: "Datum",
    linkedInvoiceLabel: "Zu Rechnung",
    reasonLabel: "Grund",
    amountLabel: "Betrag",
    footerHeading: "Hinweise",
  };
}

export function createCreditNoteFromInvoice(invoice: Invoice, type: "storno" | "gutschrift"): CreditNote {
  const nowIso = new Date().toISOString();
  // A cancellation reverses what this invoice demands (a final invoice minus its deducted advances).
  const invoiceTotal = Math.max(0, computeInvoicePayable(invoice).payable);
  return {
    schemaVersion: 1,
    id: newId(),
    type,
    creditNoteNumber: "",
    creditNoteDate: isoDateToday(),
    linkedInvoiceId: invoice.id,
    linkedInvoiceNumber: invoice.invoiceNumber,
    reason: "",
    amount: type === "storno" ? invoiceTotal : 0,
    sender: { ...invoice.sender },
    recipient: { ...invoice.recipient },
    footerText: invoice.footerText,
    texts: createDefaultCreditNoteTextsDe(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recurring Invoice Defaults
// ─────────────────────────────────────────────────────────────────────────────

export function createDefaultRecurringInvoice(settings: AppSettings): RecurringInvoice {
  const nowIso = new Date().toISOString();
  const layout: LayoutPreferences = {
    templateId: settings.defaultTemplateId,
    ...settings.defaultLayout,
  };
  
  // Calculate next month's first day
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextRunDate = dateToLocalISO(nextMonth);

  return {
    id: newId(),
    name: "",
    frequency: "monthly",
    nextRunDate,
    sender: { ...settings.defaultSender },
    recipient: { name: "", address: "", contact: "" },
    lineItems: [createDefaultLineItem(settings.defaultTaxRate)],
    footerText: settings.defaultFooterText,
    texts: { ...settings.defaultTexts },
    layout,
    currency: settings.currency,
    active: true,
    reminderDays: 7,
    autoGenerate: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Variant Defaults
// ─────────────────────────────────────────────────────────────────────────────

export function createDefaultTemplateVariant(baseTemplateId: string = "classic"): TemplateVariant {
  const nowIso = new Date().toISOString();
  return {
    id: newId(),
    name: "",
    baseTemplateId: baseTemplateId as "classic" | "modern" | "minimal",
    customization: createDefaultTemplateCustomization(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
