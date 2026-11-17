export type Language = "de" | "en";

export type InvoiceTemplateId = "classic" | "modern" | "minimal";

export type AppBackgroundChoice = "auto" | "off" | "threads" | "light-rays" | "shape-grid" | "beams";

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
  /** § 13b UStG: invoices to this customer shift the VAT liability to the recipient. */
  reverseCharge?: boolean;
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

/**
 * A file kept in the folder "attachments" beside the data file. The data holds only this reference: `id` is the
 * SHA-256 of the bytes, so equal files (the same logo on many invoices) are stored once.
 */
export type FileRef = {
  id: string;
  type: string; // MIME type
  size: number; // bytes
};

export type Attachment = {
  id: string;
  name: string;
  type: string; // MIME type
  size: number; // bytes
  /** The stored file (desktop app). */
  file?: FileRef;
  /** The content as a base64 data URL: data from versions up to 1.3 until it is moved into a file, and the browser. */
  dataUrl?: string;
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
  autoGenerate: boolean; // create the invoice automatically on the run date instead of only reminding
  /** Day of month the schedule was set up for; keeps "the 31st" from drifting to the 28th after February. */
  anchorDay?: number;
  
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

  // Optional labels added later; templates fall back to German defaults when missing.
  serviceDateLabel?: string;
  projectReferenceLabel?: string;
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

/** Structured fields are optional so historical invoices remain readable/printable. */
export type EInvoiceParty = {
  street?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string; // ISO 3166-1 alpha-2
  email?: string;
  electronicAddress?: string;
  electronicAddressScheme?: string; // e.g. EM for email
  vatId?: string;
  taxId?: string;
  contactName?: string;
  contactPhone?: string;
};

export type EInvoiceDetails = {
  seller?: EInvoiceParty;
  buyer?: EInvoiceParty;
  buyerReference?: string; // Leitweg-ID for public recipients
  paymentMeansCode?: "58" | "30" | "10"; // SEPA, credit transfer, cash
  iban?: string;
  bic?: string;
  accountName?: string;
  paymentTerms?: string;
  serviceDate?: string; // ISO date
  taxExemptionReason?: string;
  taxCategory?: "S" | "Z" | "E" | "AE" | "K" | "G" | "O";
  unitCodes?: Record<string, string>; // item id -> UNECE Rec20 code, e.g. C62/HUR
};

/** "advance" = Abschlagsrechnung, "final" = Schlussrechnung that deducts earlier advance invoices. */
export type InvoiceKind = "standard" | "advance" | "final";

/** One advance invoice deducted on a final invoice. Amounts are a snapshot, so later edits cannot shift history. */
export type AdvanceDeduction = {
  id: string;
  invoiceId?: string; // source invoice, if it still exists
  invoiceNumber: string;
  invoiceDate: string; // ISO date
  net: number;
  tax: number;
  /** What the advance invoice itself amounted to when the deduction was taken or last confirmed (the deducted amounts may be changed by hand). */
  sourceNet?: number;
  sourceTax?: number;
};

/** A payment reminder or dunning letter issued for an invoice. */
export type PaymentReminder = {
  id: string;
  level: 1 | 2 | 3; // 1 = Zahlungserinnerung, 2 = 1. Mahnung, 3 = 2. Mahnung
  date: string; // ISO date of the letter
  dueDate: string; // new payment deadline
  fee?: number; // optional dunning fee, shown on the letter only
  text?: string; // optional custom body text
  createdAt: string;
};

export type QuoteStatus = "open" | "accepted" | "declined";

export type Invoice = {
  einvoice?: EInvoiceDetails;
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

  // Optional per-invoice logo override: a stored file (desktop app), or a data URL (older data, browser)
  logoFile?: FileRef;
  logoDataUrl?: string;

  // Credit notes linked to this invoice
  creditNoteIds: string[];

  // Recurring invoice reference
  recurringInvoiceId?: string;

  // ── Optional fields added in 1.3; older invoices simply do not have them ──

  /** Bauvorhaben / Kommission: printed on the document, searchable, reused by the contractor declaration. */
  projectReference?: string;
  /** § 13b UStG: the recipient owes the VAT; lines carry 0 % and the document prints the mandatory note. */
  reverseCharge?: boolean;
  /**
   * Tax rates the positions had before reverse charge was switched on (line id → rate, null = no rate). Kept with
   * the invoice so a wrongly chosen § 13b customer can still be corrected after a reload; removed when it is switched off.
   */
  reverseChargePreviousRates?: Record<string, number | null>;
  /**
   * E-invoice tax category and exemption reason the invoice carried before reverse charge was switched on (for
   * example "E" with the § 19 note). Put back and removed when it is switched off.
   */
  reverseChargePreviousTax?: Pick<EInvoiceDetails, "taxCategory" | "taxExemptionReason">;
  invoiceKind?: InvoiceKind;
  /** Advance invoices deducted on a final invoice (only used when invoiceKind is "final"). */
  advanceDeductions?: AdvanceDeduction[];
  reminders?: PaymentReminder[];

  /** Records in the `quotes` collection are quotes; `dueDate` then means "valid until". */
  documentKind?: "quote";
  quoteStatus?: QuoteStatus;
  /** On a quote: the invoice created from it. On an invoice: the quote it came from. */
  convertedInvoiceId?: string;
  sourceQuoteId?: string;

  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type AppSettings = {
  schemaVersion: 1;

  language: Language;
  currency: string; // ISO 4217, e.g. EUR
  defaultTaxRate?: number;

  defaultSender: PartyDetails;
  defaultEInvoice?: EInvoiceDetails;
  defaultFooterText: string;

  defaultTemplateId: InvoiceTemplateId;
  defaultLayout: Omit<LayoutPreferences, "templateId">;

  // Global logo: a stored file (desktop app), or a data URL (older data, browser)
  defaultLogoFile?: FileRef;
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

  // Appearance preferences
  backgroundChoice?: AppBackgroundChoice;
  /** Text size of the app itself; printed documents are never affected. */
  uiScale?: UiScale;

  /** Days between invoice date and due date for new invoices. */
  defaultPaymentTermDays?: number;
};

export type UiScale = "normal" | "large" | "xlarge";

// ─────────────────────────────────────────────────────────────────────────────
// Contractor declarations (Fachunternehmererklärung), one per construction project
// ─────────────────────────────────────────────────────────────────────────────

export type ContractorDeclaration = {
  id: string;
  date: string; // ISO date printed on the declaration
  senderAddress: string;
  recipientName: string;
  recipientAddress: string;
  kommission: string;
  bodyText: string;
  signatureName: string;
  invoiceId?: string;
  customerId?: string;
  createdAt: string;
  updatedAt: string;
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
  /** Added in 1.3. Older app versions keep unknown collections untouched. */
  quotes: Invoice[];
  contractorDeclarations: ContractorDeclaration[];
};
