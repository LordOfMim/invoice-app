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
    dueDate: today,

    sender: { ...settings.defaultSender },
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

export function duplicateInvoice(invoice: Invoice): Invoice {
  const nowIso = new Date().toISOString();
  return {
    ...invoice,
    id: newId(),
    invoiceNumber: "",
    paid: false,
    payments: [],
    attachments: [],
    creditNoteIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    lineItems: invoice.lineItems.map((li) => ({ ...li, id: newId() })),
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
  return {
    schemaVersion: 1,
    id: newId(),
    type,
    creditNoteNumber: "",
    creditNoteDate: isoDateToday(),
    linkedInvoiceId: invoice.id,
    linkedInvoiceNumber: invoice.invoiceNumber,
    reason: "",
    amount: 0,
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
  const nextRunDate = nextMonth.toISOString().split("T")[0];

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
