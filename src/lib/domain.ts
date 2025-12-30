export type Language = "de" | "en";

export type InvoiceTemplateId = "classic" | "modern" | "minimal";

export type LogoPosition = "left" | "center" | "right";

export type LogoSize = "small" | "medium" | "large";

export type LogoFitMode = "contain" | "cover" | "fill";

export type PartyDetails = {
  salutation?: string; // Anrede, e.g. "Sehr geehrte Damen und Herren"
  name: string;
  address: string;
  contact: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Customer Directory
// ─────────────────────────────────────────────────────────────────────────────

export type Customer = {
  id: string;
  salutation?: string; // Anrede
  name: string;
  address: string;
  contact: string;
  email?: string;
  phone?: string;
  taxId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Products/Services Catalog
// ─────────────────────────────────────────────────────────────────────────────

export type Product = {
  id: string;
  name: string;
  description: string;
  unit?: string; // e.g., "Stunde", "Stück", "Pauschal"
  unitPrice: number;
  taxRate?: number;
  category?: string;
  createdAt: string;
  updatedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tags / Projects
// ─────────────────────────────────────────────────────────────────────────────

export type Tag = {
  id: string;
  name: string;
  color: string; // hex color
  createdAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Payments (Partial Payments)
// ─────────────────────────────────────────────────────────────────────────────

export type Payment = {
  id: string;
  amount: number;
  currency?: string; // Currency code, defaults to invoice currency
  date: string; // ISO date
  method?: "bank_transfer" | "cash" | "card" | "paypal" | "other" | string;
  reference?: string; // Transaction ID, check number, etc.
  notes?: string;
  createdAt?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Attachments
// ─────────────────────────────────────────────────────────────────────────────

export type Attachment = {
  id: string;
  name: string;
  type: string; // MIME type
  size: number; // bytes
  dataUrl: string; // base64 data URL
  createdAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Credit Notes
// ─────────────────────────────────────────────────────────────────────────────

export type CreditNoteType = "storno" | "gutschrift";

export type CreditNote = {
  schemaVersion: 1;
  id: string;
  type: CreditNoteType;
  creditNoteNumber: string;
  creditNoteDate: string; // ISO date
  linkedInvoiceId: string;
  linkedInvoiceNumber: string;
  reason: string;
  amount: number; // credit amount
  sender: PartyDetails;
  recipient: PartyDetails;
  footerText: string;
  texts: CreditNoteTexts;
  createdAt: string;
  updatedAt: string;
};

export type CreditNoteTexts = {
  documentTitle: string;
  creditNoteNumberLabel: string;
  creditNoteDateLabel: string;
  linkedInvoiceLabel: string;
  reasonLabel: string;
  amountLabel: string;
  footerHeading: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Recurring Invoices
// ─────────────────────────────────────────────────────────────────────────────

export type RecurringFrequency = "monthly" | "quarterly" | "yearly";

export type RecurringInvoice = {
  id: string;
  name: string;
  frequency: RecurringFrequency;
  nextRunDate: string; // ISO date
  lastRunDate?: string; // ISO date
  
  // Template data
  customerId?: string;
  sender: PartyDetails;
  recipient: PartyDetails;
  lineItems: InvoiceLineItem[];
  footerText: string;
  texts: InvoiceTexts;
  layout: LayoutPreferences;
  currency: string;
  
  active: boolean;
  reminderDays: number; // days before nextRunDate to remind
  autoGenerate: boolean; // auto-generate or just remind
  
  createdAt: string;
  updatedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Template Variants
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateCustomization = {
  fontSizeScale: number; // 0.8 - 1.2
  lineSpacing: number; // 1 - 2
  tablePadding: "compact" | "normal" | "spacious";
  showTaxColumn: boolean;
  showQuantityColumn: boolean;
  showUnitPriceColumn: boolean;
  footerColumns: 1 | 2 | 3;
  headerStyle: "simple" | "boxed" | "underlined";
  accentColor?: string; // hex
};

export type TemplateVariant = {
  id: string;
  name: string;
  baseTemplateId: InvoiceTemplateId;
  customization: TemplateCustomization;
  createdAt: string;
  updatedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Line Items
// ─────────────────────────────────────────────────────────────────────────────

export type LineItemType = "header" | "subheader" | "item";

export type InvoiceLineItem = {
  id: string;
  type: LineItemType; // "header" = section header, "subheader" = sub-section, "item" = normal position
  positionNumber?: string; // e.g., "01", "01.001"
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  taxRate?: number; // e.g. 0.19 for 19%
  productId?: string; // link to product catalog
};

export type InvoiceTexts = {
  documentTitle: string;

  senderHeading: string;
  recipientHeading: string;

  invoiceNumberLabel: string;
  invoiceDateLabel: string;
  dueDateLabel: string;

  itemsDescriptionLabel: string;
  itemsQuantityLabel: string;
  itemsUnitPriceLabel: string;
  itemsTaxRateLabel: string;
  itemsLineTotalLabel: string;

  subtotalLabel: string;
  taxTotalLabel: string;
  totalLabel: string;

  notesHeading: string; // "Hinweise" - shown under positions
  footerHeading: string; // Legacy, can be empty now
};

export type LayoutPreferences = {
  templateId: InvoiceTemplateId;
  templateVariantId?: string; // optional custom variant

  showLogo: boolean;
  logoPosition: LogoPosition;
  logoSize?: LogoSize;
  logoMaxHeight?: number; // pixels
  logoFitMode?: LogoFitMode;

  showFooter: boolean;
  senderPosition: "left" | "right";
  recipientPosition: "left" | "right";
  
  customization?: TemplateCustomization;
};

export type Invoice = {
  schemaVersion: 1;
  id: string;

  invoiceNumber: string;
  invoiceDate: string; // ISO date
  dueDate: string; // ISO date

  sender: PartyDetails;
  recipient: PartyDetails;
  customerId?: string; // link to customer directory

  lineItems: InvoiceLineItem[];

  // Notes displayed directly under positions (Hinweise)
  notesText: string;
  
  // Footer text (legacy, now split into left/right)
  footerText: string;
  footerLeftText?: string;
  footerRightText?: string;
  
  // Payment tracking (replaces simple paid boolean)
  paid: boolean; // kept for backwards compatibility
  payments: Payment[];
  
  // Tags/Projects
  tagIds: string[];

  // Multi-currency
  currency: string; // ISO 4217
  exchangeRate?: number; // rate to base currency
  exchangeRateNote?: string;

  // Attachments
  attachments: Attachment[];

  // Every visible text on the invoice is editable via this object.
  texts: InvoiceTexts;

  layout: LayoutPreferences;

  // Optional per-invoice logo override (Data URL)
  logoDataUrl?: string;

  // Credit notes linked to this invoice
  creditNoteIds: string[];

  // Recurring invoice reference
  recurringInvoiceId?: string;

  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type AppSettings = {
  schemaVersion: 1;

  language: Language;
  currency: string; // ISO 4217, e.g. EUR
  defaultTaxRate?: number;

  defaultSender: PartyDetails;
  defaultFooterText: string;

  defaultTemplateId: InvoiceTemplateId;
  defaultLayout: Omit<LayoutPreferences, "templateId">;

  // Global logo (Data URL)
  defaultLogoDataUrl?: string;

  // PDF filename pattern, supports tokens: {invoiceNumber}, {invoiceDate}, {dueDate}
  pdfFilenamePattern: string;

  // Default texts for invoice labels/headings
  defaultTexts: InvoiceTexts;

  // If set, new invoices will be created by duplicating this invoice as a starting point.
  defaultInvoiceId?: string;

  // Backup settings
  backupEnabled: boolean;
  backupPath?: string;
  lastBackupDate?: string;

  // Dashboard preferences
  dashboardPeriod: "month" | "quarter" | "year";
};

// ─────────────────────────────────────────────────────────────────────────────
// Persisted Data Structure (Schema V2)
// ─────────────────────────────────────────────────────────────────────────────

export type PersistedDataV1 = {
  schemaVersion: 1;
  settings: AppSettings;
  invoices: Invoice[];
  customers: Customer[];
  products: Product[];
  tags: Tag[];
  creditNotes: CreditNote[];
  recurringInvoices: RecurringInvoice[];
  templateVariants: TemplateVariant[];
};
