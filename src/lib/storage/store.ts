import type { 
  AppSettings, 
  Attachment,
  CreditNote, 
  Customer, 
  Invoice, 
  Payment, 
  PersistedDataV1, 
  Product, 
  RecurringInvoice, 
  Tag, 
  TemplateVariant 
} from "@/lib/domain";
import { 
  computeInvoiceBalance,
  computeInvoiceTotals,
  convertInvoiceAmountToCurrency,
} from "@/lib/calc";
import { addMonthsClamped, monthKey, todayLocalISO } from "@/lib/date";
import { 
  createDefaultSettings, 
  createInvoiceFromDefaults, 
  duplicateInvoice,
  createDefaultCustomer,
  createDefaultProduct,
  createDefaultTag,
  createDefaultRecurringInvoice,
  createDefaultTemplateVariant,
  createDefaultTemplateCustomization,
  createCreditNoteFromInvoice,
  newId,
} from "@/lib/defaults";
import { STORAGE_KEY } from "@/lib/storage/keys";
import type { StorageAdapter } from "@/lib/storage/types";

type Listener = () => void;

const listeners = new Set<Listener>();

// In-memory cache to ensure `loadData()` returns a stable reference between writes.
// This is important for `useSyncExternalStore`, which uses `Object.is` on snapshots.
let cachedData: PersistedDataV1 | null = null;

const MANUAL_PAID_METHOD = "manual_paid";

export function flushPendingPersist() {
  // Kept for existing callers. Saves are synchronous now, so there is no local
  // write queue to drain.
}

function emitChange() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function parsePersistedData(json: string | null): PersistedDataV1 | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const data = parsed as Record<string, unknown>;
    if (data.schemaVersion !== 1) return null;
    if (!isRecord(data.settings) || !Array.isArray(data.invoices)) return null;
    // Migrate: add new collections if missing
    return {
      schemaVersion: 1,
      settings: migrateSettings(data.settings),
      invoices: data.invoices.map(migrateInvoice),
      customers: asArray(data.customers).map(migrateCustomer),
      products: asArray(data.products).map(migrateProduct),
      tags: asArray(data.tags).map(migrateTag),
      creditNotes: asArray(data.creditNotes).map(migrateCreditNote),
      recurringInvoices: asArray(data.recurringInvoices).map(migrateRecurringInvoice),
      templateVariants: asArray(data.templateVariants).map(migrateTemplateVariant),
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function migratePartyDetails(value: unknown, fallback = { name: "", address: "", contact: "" }) {
  if (!isRecord(value)) return fallback;
  return {
    salutation: typeof value.salutation === "string" ? value.salutation : undefined,
    name: asString(value.name, fallback.name),
    address: asString(value.address, fallback.address),
    contact: asString(value.contact, fallback.contact),
  };
}

function migrateInvoiceTexts(value: unknown, fallback = createDefaultSettings().defaultTexts) {
  return isRecord(value) ? { ...fallback, ...value } : fallback;
}

function migrateLayout(value: unknown, fallback = createInvoiceFromDefaults(createDefaultSettings()).layout) {
  const source = isRecord(value) ? value : {};
  return {
    ...fallback,
    ...source,
    templateId: source.templateId === "modern" || source.templateId === "minimal" ? source.templateId : fallback.templateId,
    showLogo: typeof source.showLogo === "boolean" ? source.showLogo : fallback.showLogo,
    showFooter: typeof source.showFooter === "boolean" ? source.showFooter : fallback.showFooter,
    logoMaxHeight: asNumber(source.logoMaxHeight, fallback.logoMaxHeight ?? 80),
    logoFitMode:
      source.logoFitMode === "cover" || source.logoFitMode === "fill" || source.logoFitMode === "contain"
        ? source.logoFitMode
        : fallback.logoFitMode,
  };
}

function migrateSettings(settings: unknown): AppSettings {
  const defaults = createDefaultSettings();
  if (!isRecord(settings)) return defaults;
  const defaultLayout = isRecord(settings.defaultLayout) ? settings.defaultLayout : {};
  return {
    ...defaults,
    ...settings,
    language: settings.language === "en" ? "en" : "de",
    currency: asString(settings.currency, defaults.currency).toUpperCase(),
    defaultTaxRate:
      typeof settings.defaultTaxRate === "number" && Number.isFinite(settings.defaultTaxRate)
        ? settings.defaultTaxRate
        : defaults.defaultTaxRate,
    defaultSender: migratePartyDetails(settings.defaultSender, defaults.defaultSender),
    defaultFooterText: asString(settings.defaultFooterText, defaults.defaultFooterText),
    defaultTexts: migrateInvoiceTexts(settings.defaultTexts, defaults.defaultTexts),
    backupEnabled: typeof settings.backupEnabled === "boolean" ? settings.backupEnabled : false,
    dashboardPeriod:
      settings.dashboardPeriod === "quarter" || settings.dashboardPeriod === "year" ? settings.dashboardPeriod : "month",
    backgroundChoice:
      settings.backgroundChoice === "off" ||
      settings.backgroundChoice === "threads" ||
      settings.backgroundChoice === "light-rays" ||
      settings.backgroundChoice === "shape-grid" ||
      settings.backgroundChoice === "beams"
        ? settings.backgroundChoice
        : defaults.backgroundChoice,
    defaultInvoiceId: typeof settings.defaultInvoiceId === "string" ? settings.defaultInvoiceId : undefined,
    defaultLayout: {
      ...defaults.defaultLayout,
      ...defaultLayout,
      logoMaxHeight: asNumber(defaultLayout.logoMaxHeight, 80),
      logoFitMode:
        defaultLayout.logoFitMode === "cover" ||
        defaultLayout.logoFitMode === "fill" ||
        defaultLayout.logoFitMode === "contain"
          ? defaultLayout.logoFitMode
          : "contain",
    },
  };
}

function migrateLineItem(value: unknown): Invoice["lineItems"][0] {
  const base = createDefaultInvoiceLineItem();
  if (!isRecord(value)) return base;
  const type = value.type === "header" || value.type === "subheader" ? value.type : "item";
  return {
    ...base,
    ...value,
    id: asString(value.id, newId()),
    type,
    positionNumber: typeof value.positionNumber === "string" ? value.positionNumber : "",
    description: asString(value.description),
    quantity: type === "item" ? asNumber(value.quantity, 1) : 0,
    unit: typeof value.unit === "string" ? value.unit : undefined,
    unitPrice: type === "item" ? asNumber(value.unitPrice, 0) : 0,
    taxRate: type === "item" && typeof value.taxRate === "number" && Number.isFinite(value.taxRate) ? value.taxRate : undefined,
    productId: typeof value.productId === "string" ? value.productId : undefined,
  };
}

function createDefaultInvoiceLineItem(): Invoice["lineItems"][0] {
  return createInvoiceFromDefaults(createDefaultSettings()).lineItems[0];
}

function migratePayment(value: unknown): Payment {
  const now = new Date().toISOString();
  if (!isRecord(value)) {
    return { id: newId(), amount: 0, date: todayLocalISO(), createdAt: now };
  }
  return {
    ...value,
    id: asString(value.id, newId()),
    amount: Math.max(0, asNumber(value.amount, 0)),
    currency: typeof value.currency === "string" ? value.currency : undefined,
    date: asString(value.date, todayLocalISO()),
    method: typeof value.method === "string" ? value.method : undefined,
    reference: typeof value.reference === "string" ? value.reference : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : now,
  };
}

function migrateAttachment(value: unknown): Attachment {
  const now = new Date().toISOString();
  if (!isRecord(value)) {
    return { id: newId(), name: "Attachment", type: "", size: 0, dataUrl: "", createdAt: now };
  }
  return {
    ...value,
    id: asString(value.id, newId()),
    name: asString(value.name, "Attachment"),
    type: asString(value.type),
    size: Math.max(0, asNumber(value.size, 0)),
    dataUrl: asString(value.dataUrl),
    createdAt: asString(value.createdAt, now),
  };
}

function migrateInvoice(invoice: unknown): Invoice {
  const base = createInvoiceFromDefaults(createDefaultSettings());
  if (!isRecord(invoice)) return base;
  const lineItems = asArray(invoice.lineItems).map(migrateLineItem);
  return {
    ...base,
    ...invoice,
    schemaVersion: 1,
    id: asString(invoice.id, newId()),
    invoiceNumber: asString(invoice.invoiceNumber),
    invoiceDate: asString(invoice.invoiceDate, todayLocalISO()),
    dueDate: asString(invoice.dueDate, todayLocalISO()),
    sender: migratePartyDetails(invoice.sender, base.sender),
    recipient: migratePartyDetails(invoice.recipient, base.recipient),
    customerId: typeof invoice.customerId === "string" ? invoice.customerId : undefined,
    lineItems: lineItems.length > 0 ? lineItems : base.lineItems,
    payments: asArray(invoice.payments).map(migratePayment),
    tagIds: asStringArray(invoice.tagIds),
    currency: asString(invoice.currency, "EUR").toUpperCase(),
    attachments: asArray(invoice.attachments).map(migrateAttachment),
    texts: migrateInvoiceTexts(invoice.texts, base.texts),
    layout: migrateLayout(invoice.layout, base.layout),
    creditNoteIds: asStringArray(invoice.creditNoteIds),
    createdAt: asString(invoice.createdAt, new Date().toISOString()),
    updatedAt: asString(invoice.updatedAt, new Date().toISOString()),
  };
}

function migrateCustomer(value: unknown): Customer {
  const base = createDefaultCustomer();
  if (!isRecord(value)) return base;
  return {
    ...base,
    ...value,
    id: asString(value.id, newId()),
    name: asString(value.name),
    address: asString(value.address),
    contact: asString(value.contact),
    salutation: typeof value.salutation === "string" ? value.salutation : undefined,
    email: typeof value.email === "string" ? value.email : undefined,
    phone: typeof value.phone === "string" ? value.phone : undefined,
    taxId: typeof value.taxId === "string" ? value.taxId : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    createdAt: asString(value.createdAt, base.createdAt),
    updatedAt: asString(value.updatedAt, base.updatedAt),
  };
}

function migrateProduct(value: unknown): Product {
  const base = createDefaultProduct();
  if (!isRecord(value)) return base;
  return {
    ...base,
    ...value,
    id: asString(value.id, newId()),
    name: asString(value.name),
    description: asString(value.description),
    unit: typeof value.unit === "string" ? value.unit : undefined,
    unitPrice: asNumber(value.unitPrice, 0),
    taxRate: typeof value.taxRate === "number" && Number.isFinite(value.taxRate) ? value.taxRate : undefined,
    category: typeof value.category === "string" ? value.category : undefined,
    createdAt: asString(value.createdAt, base.createdAt),
    updatedAt: asString(value.updatedAt, base.updatedAt),
  };
}

function migrateTag(value: unknown): Tag {
  const base = createDefaultTag();
  if (!isRecord(value)) return base;
  return {
    ...base,
    ...value,
    id: asString(value.id, newId()),
    name: asString(value.name),
    color: asString(value.color, base.color),
    createdAt: asString(value.createdAt, base.createdAt),
  };
}

function migrateCreditNote(value: unknown): CreditNote {
  const invoice = createInvoiceFromDefaults(createDefaultSettings());
  const base = createCreditNoteFromInvoice(invoice, "gutschrift");
  if (!isRecord(value)) return base;
  const type = value.type === "storno" ? "storno" : "gutschrift";
  return {
    ...base,
    ...value,
    schemaVersion: 1,
    id: asString(value.id, newId()),
    type,
    creditNoteNumber: asString(value.creditNoteNumber),
    creditNoteDate: asString(value.creditNoteDate, todayLocalISO()),
    linkedInvoiceId: asString(value.linkedInvoiceId),
    linkedInvoiceNumber: asString(value.linkedInvoiceNumber),
    reason: asString(value.reason),
    amount: Math.max(0, asNumber(value.amount, 0)),
    sender: migratePartyDetails(value.sender, base.sender),
    recipient: migratePartyDetails(value.recipient, base.recipient),
    footerText: asString(value.footerText, base.footerText),
    texts: isRecord(value.texts) ? { ...base.texts, ...value.texts } : base.texts,
    createdAt: asString(value.createdAt, base.createdAt),
    updatedAt: asString(value.updatedAt, base.updatedAt),
  };
}

function migrateRecurringInvoice(value: unknown): RecurringInvoice {
  const base = createDefaultRecurringInvoice(createDefaultSettings());
  if (!isRecord(value)) return base;
  const lineItems = asArray(value.lineItems).map(migrateLineItem);
  return {
    ...base,
    ...value,
    id: asString(value.id, newId()),
    name: asString(value.name),
    frequency:
      value.frequency === "quarterly" || value.frequency === "yearly" || value.frequency === "monthly"
        ? value.frequency
        : "monthly",
    nextRunDate: asString(value.nextRunDate, base.nextRunDate),
    lastRunDate: typeof value.lastRunDate === "string" ? value.lastRunDate : undefined,
    customerId: typeof value.customerId === "string" ? value.customerId : undefined,
    sender: migratePartyDetails(value.sender, base.sender),
    recipient: migratePartyDetails(value.recipient, base.recipient),
    lineItems: lineItems.length > 0 ? lineItems : base.lineItems,
    footerText: asString(value.footerText, base.footerText),
    texts: migrateInvoiceTexts(value.texts, base.texts),
    layout: migrateLayout(value.layout, base.layout),
    currency: asString(value.currency, base.currency).toUpperCase(),
    active: typeof value.active === "boolean" ? value.active : base.active,
    reminderDays: Math.max(0, asNumber(value.reminderDays, base.reminderDays)),
    autoGenerate: typeof value.autoGenerate === "boolean" ? value.autoGenerate : base.autoGenerate,
    createdAt: asString(value.createdAt, base.createdAt),
    updatedAt: asString(value.updatedAt, base.updatedAt),
  };
}

function migrateTemplateVariant(value: unknown): TemplateVariant {
  const base = createDefaultTemplateVariant();
  const baseCustomization = createDefaultTemplateCustomization();
  if (!isRecord(value)) return base;
  const customization = isRecord(value.customization) ? value.customization : {};
  return {
    ...base,
    ...value,
    id: asString(value.id, newId()),
    name: asString(value.name),
    baseTemplateId:
      value.baseTemplateId === "modern" || value.baseTemplateId === "minimal" || value.baseTemplateId === "classic"
        ? value.baseTemplateId
        : base.baseTemplateId,
    customization: {
      ...baseCustomization,
      ...customization,
      fontSizeScale: asNumber(customization.fontSizeScale, baseCustomization.fontSizeScale),
      lineSpacing: asNumber(customization.lineSpacing, baseCustomization.lineSpacing),
      tablePadding:
        customization.tablePadding === "compact" || customization.tablePadding === "spacious"
          ? customization.tablePadding
          : "normal",
      showTaxColumn:
        typeof customization.showTaxColumn === "boolean" ? customization.showTaxColumn : baseCustomization.showTaxColumn,
      showQuantityColumn:
        typeof customization.showQuantityColumn === "boolean"
          ? customization.showQuantityColumn
          : baseCustomization.showQuantityColumn,
      showUnitPriceColumn:
        typeof customization.showUnitPriceColumn === "boolean"
          ? customization.showUnitPriceColumn
          : baseCustomization.showUnitPriceColumn,
      footerColumns:
        customization.footerColumns === 2 || customization.footerColumns === 3 ? customization.footerColumns : 1,
      headerStyle:
        customization.headerStyle === "boxed" || customization.headerStyle === "underlined"
          ? customization.headerStyle
          : "simple",
      accentColor: typeof customization.accentColor === "string" ? customization.accentColor : undefined,
    },
    createdAt: asString(value.createdAt, base.createdAt),
    updatedAt: asString(value.updatedAt, base.updatedAt),
  };
}

function createEmptyData(): PersistedDataV1 {
  return {
    schemaVersion: 1,
    settings: createDefaultSettings(),
    invoices: [],
    customers: [],
    products: [],
    tags: [],
    creditNotes: [],
    recurringInvoices: [],
    templateVariants: [],
  };
}

export function loadData(adapter: StorageAdapter): PersistedDataV1 {
  if (cachedData) return cachedData;

  const existing = parsePersistedData(adapter.getItem(STORAGE_KEY));
  if (existing) {
    cachedData = existing;
    return existing;
  }

  const initial = createEmptyData();
  adapter.setItem(STORAGE_KEY, JSON.stringify(initial));
  cachedData = initial;
  return initial;
}

export function saveData(adapter: StorageAdapter, data: PersistedDataV1): void {
  adapter.setItem(STORAGE_KEY, JSON.stringify(data));
  cachedData = data;
  emitChange();
}

export function clearDataCache(): void {
  cachedData = null;
}

export function replaceData(adapter: StorageAdapter, data: PersistedDataV1): void {
  cachedData = data;
  adapter.setItem(STORAGE_KEY, JSON.stringify(data));
  emitChange();
}

export function getSettings(adapter: StorageAdapter): AppSettings {
  return loadData(adapter).settings;
}

export function updateSettings(adapter: StorageAdapter, updater: (prev: AppSettings) => AppSettings): AppSettings {
  const data = loadData(adapter);
  const nextSettings = updater(data.settings);
  const next: PersistedDataV1 = {
    ...data,
    settings: nextSettings,
  };
  saveData(adapter, next);
  return nextSettings;
}

export function listInvoices(adapter: StorageAdapter): Invoice[] {
  return loadData(adapter).invoices;
}

export function getInvoice(adapter: StorageAdapter, id: string): Invoice | null {
  return loadData(adapter).invoices.find((inv) => inv.id === id) ?? null;
}

export function upsertInvoice(adapter: StorageAdapter, invoice: Invoice): void {
  const data = loadData(adapter);
  const nowIso = new Date().toISOString();
  const nextInvoice: Invoice = { ...invoice, updatedAt: nowIso };

  const idx = data.invoices.findIndex((inv) => inv.id === invoice.id);
  const invoices = [...data.invoices];
  if (idx >= 0) invoices[idx] = nextInvoice;
  else invoices.unshift(nextInvoice);

  saveData(adapter, { ...data, invoices });
}

export function updateInvoice(
  adapter: StorageAdapter,
  id: string,
  updater: (prev: Invoice) => Invoice
): Invoice | null {
  const data = loadData(adapter);
  const idx = data.invoices.findIndex((inv) => inv.id === id);
  if (idx < 0) return null;

  const nowIso = new Date().toISOString();
  const nextInvoice = { ...updater(data.invoices[idx]), updatedAt: nowIso };
  const invoices = [...data.invoices];
  invoices[idx] = nextInvoice;
  saveData(adapter, { ...data, invoices });
  return nextInvoice;
}

export function deleteInvoice(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.filter((inv) => inv.id !== id);
  const creditNotes = data.creditNotes.filter((cn) => cn.linkedInvoiceId !== id);
  const settings: AppSettings = {
    ...data.settings,
    defaultInvoiceId: data.settings.defaultInvoiceId === id ? undefined : data.settings.defaultInvoiceId,
  };
  saveData(adapter, { ...data, settings, invoices, creditNotes });
}

export function createInvoice(adapter: StorageAdapter): Invoice {
  const data = loadData(adapter);
  const today = todayLocalISO();

  const defaultInvoiceId = data.settings.defaultInvoiceId;
  const defaultInvoice = defaultInvoiceId ? data.invoices.find((inv) => inv.id === defaultInvoiceId) ?? null : null;

  const invoice = defaultInvoice
    ? {
        ...duplicateInvoice(defaultInvoice),
        invoiceDate: today,
        dueDate: today,
      }
    : createInvoiceFromDefaults(data.settings);

  saveData(adapter, { ...data, invoices: [invoice, ...data.invoices] });
  return invoice;
}

export function duplicateInvoiceById(adapter: StorageAdapter, id: string): Invoice | null {
  const data = loadData(adapter);
  const existing = data.invoices.find((inv) => inv.id === id);
  if (!existing) return null;
  const dup = duplicateInvoice(existing);
  saveData(adapter, { ...data, invoices: [dup, ...data.invoices] });
  return dup;
}

export function togglePaid(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  const today = todayLocalISO();
  const invoices = data.invoices.map((inv) => {
    if (inv.id !== id) return inv;
    const linkedCreditNotes = data.creditNotes.filter((cn) => cn.linkedInvoiceId === inv.id);
    const balance = computeInvoiceBalance(inv, linkedCreditNotes, today);

    if (balance.isFullyPaid) {
      return {
        ...inv,
        paid: false,
        payments: (inv.payments ?? []).filter((payment) => payment.method !== MANUAL_PAID_METHOD),
        updatedAt: new Date().toISOString(),
      };
    }

    const remaining = balance.remainingAmount;
    const manualPayment: Payment = {
      id: newId(),
      amount: remaining,
      currency: inv.currency ?? "EUR",
      date: today,
      method: MANUAL_PAID_METHOD,
      reference: "Marked paid",
      createdAt: new Date().toISOString(),
    };

    return {
      ...inv,
      paid: true,
      payments: [...(inv.payments ?? []), manualPayment],
      updatedAt: new Date().toISOString(),
    };
  });
  saveData(adapter, { ...data, invoices });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure Invoice Helpers (work on Invoice object without adapter)
// ─────────────────────────────────────────────────────────────────────────────

/** Add a payment to an invoice (pure function, returns new Invoice) */
export function addPaymentToInvoice(invoice: Invoice, payment: Payment): Invoice {
  const payments = [...(invoice.payments ?? []), payment];
  const total = computeInvoiceTotals(invoice).total;
  const paid = computeInvoiceBalance({ ...invoice, payments, paid: false }).paidAmount >= total;
  return {
    ...invoice,
    paid,
    payments,
    updatedAt: new Date().toISOString(),
  };
}

/** Remove a payment from an invoice (pure function, returns new Invoice) */
export function removePaymentFromInvoice(invoice: Invoice, paymentId: string): Invoice {
  const payments = (invoice.payments ?? []).filter((p) => p.id !== paymentId);
  return {
    ...invoice,
    paid: false,
    payments,
    updatedAt: new Date().toISOString(),
  };
}

/** Add an attachment to an invoice (pure function, returns new Invoice) */
export function addAttachmentToInvoice(invoice: Invoice, attachment: Attachment): Invoice {
  return {
    ...invoice,
    attachments: [...invoice.attachments, attachment],
    updatedAt: new Date().toISOString(),
  };
}

/** Remove an attachment from an invoice (pure function, returns new Invoice) */
export function removeAttachmentFromInvoice(invoice: Invoice, attachmentId: string): Invoice {
  return {
    ...invoice,
    attachments: invoice.attachments.filter((a) => a.id !== attachmentId),
    updatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────────

export function addPayment(adapter: StorageAdapter, invoiceId: string, payment: Payment): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) => {
    if (inv.id !== invoiceId) return inv;
    return addPaymentToInvoice(inv, payment);
  });
  saveData(adapter, { ...data, invoices });
}

export function removePayment(adapter: StorageAdapter, invoiceId: string, paymentId: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) => {
    if (inv.id !== invoiceId) return inv;
    return removePaymentFromInvoice(inv, paymentId);
  });
  saveData(adapter, { ...data, invoices });
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers
// ─────────────────────────────────────────────────────────────────────────────

export function listCustomers(adapter: StorageAdapter): Customer[] {
  return loadData(adapter).customers;
}

export function getCustomer(adapter: StorageAdapter, id: string): Customer | null {
  return loadData(adapter).customers.find((c) => c.id === id) ?? null;
}

export function createCustomer(adapter: StorageAdapter): Customer {
  const data = loadData(adapter);
  const customer = createDefaultCustomer();
  saveData(adapter, { ...data, customers: [customer, ...data.customers] });
  return customer;
}

export function upsertCustomer(adapter: StorageAdapter, customer: Customer): void {
  const data = loadData(adapter);
  const nowIso = new Date().toISOString();
  const nextCustomer: Customer = { ...customer, updatedAt: nowIso };
  const idx = data.customers.findIndex((c) => c.id === customer.id);
  const customers = [...data.customers];
  if (idx >= 0) customers[idx] = nextCustomer;
  else customers.unshift(nextCustomer);
  saveData(adapter, { ...data, customers });
}

export function deleteCustomer(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) =>
    inv.customerId === id ? { ...inv, customerId: undefined, updatedAt: new Date().toISOString() } : inv
  );
  const recurringInvoices = data.recurringInvoices.map((ri) =>
    ri.customerId === id ? { ...ri, customerId: undefined, updatedAt: new Date().toISOString() } : ri
  );
  saveData(adapter, {
    ...data,
    customers: data.customers.filter((c) => c.id !== id),
    invoices,
    recurringInvoices,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────

export function listProducts(adapter: StorageAdapter): Product[] {
  return loadData(adapter).products;
}

export function getProduct(adapter: StorageAdapter, id: string): Product | null {
  return loadData(adapter).products.find((p) => p.id === id) ?? null;
}

export function createProduct(adapter: StorageAdapter, defaultTaxRate?: number): Product {
  const data = loadData(adapter);
  const product = createDefaultProduct(defaultTaxRate);
  saveData(adapter, { ...data, products: [product, ...data.products] });
  return product;
}

export function upsertProduct(adapter: StorageAdapter, product: Product): void {
  const data = loadData(adapter);
  const nowIso = new Date().toISOString();
  const nextProduct: Product = { ...product, updatedAt: nowIso };
  const idx = data.products.findIndex((p) => p.id === product.id);
  const products = [...data.products];
  if (idx >= 0) products[idx] = nextProduct;
  else products.unshift(nextProduct);
  saveData(adapter, { ...data, products });
}

export function deleteProduct(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) => ({
    ...inv,
    lineItems: inv.lineItems.map((li) => (li.productId === id ? { ...li, productId: undefined } : li)),
  }));
  const recurringInvoices = data.recurringInvoices.map((ri) => ({
    ...ri,
    lineItems: ri.lineItems.map((li) => (li.productId === id ? { ...li, productId: undefined } : li)),
  }));
  saveData(adapter, {
    ...data,
    products: data.products.filter((p) => p.id !== id),
    invoices,
    recurringInvoices,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────────────────────

export function listTags(adapter: StorageAdapter): Tag[] {
  return loadData(adapter).tags;
}

export function getTag(adapter: StorageAdapter, id: string): Tag | null {
  return loadData(adapter).tags.find((t) => t.id === id) ?? null;
}

export function createTag(adapter: StorageAdapter): Tag {
  const data = loadData(adapter);
  const tag = createDefaultTag();
  saveData(adapter, { ...data, tags: [tag, ...data.tags] });
  return tag;
}

export function upsertTag(adapter: StorageAdapter, tag: Tag): void {
  const data = loadData(adapter);
  const idx = data.tags.findIndex((t) => t.id === tag.id);
  const tags = [...data.tags];
  if (idx >= 0) tags[idx] = tag;
  else tags.unshift(tag);
  saveData(adapter, { ...data, tags });
}

export function deleteTag(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  // Also remove tag from all invoices
  const invoices = data.invoices.map((inv) => ({
    ...inv,
    tagIds: inv.tagIds.filter((tid) => tid !== id),
  }));
  saveData(adapter, { ...data, tags: data.tags.filter((t) => t.id !== id), invoices });
}

export function addTagToInvoice(adapter: StorageAdapter, invoiceId: string, tagId: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) => {
    if (inv.id !== invoiceId) return inv;
    if (inv.tagIds.includes(tagId)) return inv;
    return { ...inv, tagIds: [...inv.tagIds, tagId] };
  });
  saveData(adapter, { ...data, invoices });
}

export function removeTagFromInvoice(adapter: StorageAdapter, invoiceId: string, tagId: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) => {
    if (inv.id !== invoiceId) return inv;
    return { ...inv, tagIds: inv.tagIds.filter((t) => t !== tagId) };
  });
  saveData(adapter, { ...data, invoices });
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit Notes
// ─────────────────────────────────────────────────────────────────────────────

export function listCreditNotes(adapter: StorageAdapter): CreditNote[] {
  return loadData(adapter).creditNotes;
}

export function getCreditNote(adapter: StorageAdapter, id: string): CreditNote | null {
  return loadData(adapter).creditNotes.find((cn) => cn.id === id) ?? null;
}

export function createCreditNote(
  adapter: StorageAdapter, 
  invoiceId: string, 
  type: "storno" | "gutschrift"
): CreditNote | null {
  const data = loadData(adapter);
  const invoice = data.invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) return null;
  
  const creditNote = createCreditNoteFromInvoice(invoice, type);
  
  // Link credit note to invoice
  const invoices = data.invoices.map((inv) => 
    inv.id === invoiceId 
      ? { ...inv, creditNoteIds: [...inv.creditNoteIds, creditNote.id] }
      : inv
  );
  
  saveData(adapter, { 
    ...data, 
    creditNotes: [creditNote, ...data.creditNotes],
    invoices,
  });
  return creditNote;
}

export function upsertCreditNote(adapter: StorageAdapter, creditNote: CreditNote): void {
  const data = loadData(adapter);
  const nowIso = new Date().toISOString();
  const next: CreditNote = { ...creditNote, updatedAt: nowIso };
  const idx = data.creditNotes.findIndex((cn) => cn.id === creditNote.id);
  const creditNotes = [...data.creditNotes];
  if (idx >= 0) creditNotes[idx] = next;
  else creditNotes.unshift(next);
  saveData(adapter, { ...data, creditNotes });
}

export function deleteCreditNote(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  const creditNote = data.creditNotes.find((cn) => cn.id === id);
  
  // Remove link from invoice
  let invoices = data.invoices;
  if (creditNote) {
    invoices = data.invoices.map((inv) => 
      inv.id === creditNote.linkedInvoiceId
        ? { ...inv, creditNoteIds: inv.creditNoteIds.filter((cnId) => cnId !== id) }
        : inv
    );
  }
  
  saveData(adapter, { 
    ...data, 
    creditNotes: data.creditNotes.filter((cn) => cn.id !== id),
    invoices,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Recurring Invoices
// ─────────────────────────────────────────────────────────────────────────────

export function listRecurringInvoices(adapter: StorageAdapter): RecurringInvoice[] {
  return loadData(adapter).recurringInvoices;
}

export function getRecurringInvoice(adapter: StorageAdapter, id: string): RecurringInvoice | null {
  return loadData(adapter).recurringInvoices.find((ri) => ri.id === id) ?? null;
}

export function createRecurringInvoice(adapter: StorageAdapter): RecurringInvoice {
  const data = loadData(adapter);
  const recurring = createDefaultRecurringInvoice(data.settings);
  saveData(adapter, { ...data, recurringInvoices: [recurring, ...data.recurringInvoices] });
  return recurring;
}

export function upsertRecurringInvoice(adapter: StorageAdapter, recurring: RecurringInvoice): void {
  const data = loadData(adapter);
  const nowIso = new Date().toISOString();
  const next: RecurringInvoice = { ...recurring, updatedAt: nowIso };
  const idx = data.recurringInvoices.findIndex((ri) => ri.id === recurring.id);
  const recurringInvoices = [...data.recurringInvoices];
  if (idx >= 0) recurringInvoices[idx] = next;
  else recurringInvoices.unshift(next);
  saveData(adapter, { ...data, recurringInvoices });
}

export function deleteRecurringInvoice(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  saveData(adapter, { 
    ...data, 
    recurringInvoices: data.recurringInvoices.filter((ri) => ri.id !== id) 
  });
}

export function generateInvoiceFromRecurring(
  adapter: StorageAdapter,
  recurringId: string,
  expectedNextRunDate?: string
): Invoice | null {
  const data = loadData(adapter);
  const recurring = data.recurringInvoices.find((ri) => ri.id === recurringId);
  if (!recurring) return null;

  const nowIso = new Date().toISOString();
  const scheduledDate = recurring.nextRunDate || todayLocalISO();

  if (expectedNextRunDate && scheduledDate !== expectedNextRunDate) {
    return data.invoices.find(
      (inv) => inv.recurringInvoiceId === recurringId && inv.invoiceDate === expectedNextRunDate
    ) ?? null;
  }

  const existingForRun = data.invoices.find(
    (inv) => inv.recurringInvoiceId === recurringId && inv.invoiceDate === scheduledDate
  );
  if (existingForRun) return existingForRun;
  
  // Create invoice from recurring template
  const invoice: Invoice = {
    schemaVersion: 1,
    id: newId(),
    invoiceNumber: "",
    invoiceDate: scheduledDate,
    dueDate: scheduledDate,
    sender: { ...recurring.sender },
    recipient: { ...recurring.recipient },
    customerId: recurring.customerId,
    lineItems: recurring.lineItems.map((li) => ({ ...li, id: newId() })),
    footerText: recurring.footerText,
    notesText: "",
    paid: false,
    payments: [],
    tagIds: [],
    currency: recurring.currency,
    attachments: [],
    creditNoteIds: [],
    texts: { ...recurring.texts },
    layout: { ...recurring.layout },
    recurringInvoiceId: recurringId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // Calculate next run date
  const nextRunDate = calculateNextRunDate(recurring.nextRunDate, recurring.frequency);
  
  // Update recurring invoice
  const updatedRecurring: RecurringInvoice = {
    ...recurring,
    lastRunDate: scheduledDate,
    nextRunDate,
    updatedAt: nowIso,
  };

  const recurringInvoices = data.recurringInvoices.map((ri) => 
    ri.id === recurringId ? updatedRecurring : ri
  );

  saveData(adapter, { 
    ...data, 
    invoices: [invoice, ...data.invoices],
    recurringInvoices,
  });

  return invoice;
}

function calculateNextRunDate(currentDate: string, frequency: RecurringInvoice["frequency"]): string {
  switch (frequency) {
    case "monthly":
      return addMonthsClamped(currentDate, 1);
    case "quarterly":
      return addMonthsClamped(currentDate, 3);
    case "yearly":
      return addMonthsClamped(currentDate, 12);
    default:
      return addMonthsClamped(currentDate, 1);
  }
}

export function getDueRecurringInvoices(adapter: StorageAdapter): RecurringInvoice[] {
  const data = loadData(adapter);
  const today = todayLocalISO();
  return data.recurringInvoices.filter((ri) => ri.active && ri.nextRunDate <= today);
}

export function getUpcomingReminders(adapter: StorageAdapter): RecurringInvoice[] {
  const data = loadData(adapter);
  const today = new Date();
  return data.recurringInvoices.filter((ri) => {
    if (!ri.active) return false;
    const nextRun = new Date(`${ri.nextRunDate}T00:00:00`);
    const reminderDate = new Date(nextRun);
    reminderDate.setDate(reminderDate.getDate() - ri.reminderDays);
    return reminderDate <= today && nextRun > today;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Variants
// ─────────────────────────────────────────────────────────────────────────────

export function listTemplateVariants(adapter: StorageAdapter): TemplateVariant[] {
  return loadData(adapter).templateVariants;
}

export function getTemplateVariant(adapter: StorageAdapter, id: string): TemplateVariant | null {
  return loadData(adapter).templateVariants.find((tv) => tv.id === id) ?? null;
}

export function createTemplateVariant(adapter: StorageAdapter, baseTemplateId?: string): TemplateVariant {
  const data = loadData(adapter);
  const variant = createDefaultTemplateVariant(baseTemplateId || data.settings.defaultTemplateId);
  saveData(adapter, { ...data, templateVariants: [variant, ...data.templateVariants] });
  return variant;
}

export function upsertTemplateVariant(adapter: StorageAdapter, variant: TemplateVariant): void {
  const data = loadData(adapter);
  const nowIso = new Date().toISOString();
  const next: TemplateVariant = { ...variant, updatedAt: nowIso };
  const idx = data.templateVariants.findIndex((tv) => tv.id === variant.id);
  const templateVariants = [...data.templateVariants];
  if (idx >= 0) templateVariants[idx] = next;
  else templateVariants.unshift(next);
  saveData(adapter, { ...data, templateVariants });
}

export function deleteTemplateVariant(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) =>
    inv.layout.templateVariantId === id
      ? { ...inv, layout: { ...inv.layout, templateVariantId: undefined }, updatedAt: new Date().toISOString() }
      : inv
  );
  const recurringInvoices = data.recurringInvoices.map((ri) =>
    ri.layout.templateVariantId === id
      ? { ...ri, layout: { ...ri.layout, templateVariantId: undefined }, updatedAt: new Date().toISOString() }
      : ri
  );
  saveData(adapter, { 
    ...data, 
    templateVariants: data.templateVariants.filter((tv) => tv.id !== id),
    invoices,
    recurringInvoices,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachments
// ─────────────────────────────────────────────────────────────────────────────

export function addAttachment(adapter: StorageAdapter, invoiceId: string, attachment: Invoice["attachments"][0]): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) => {
    if (inv.id !== invoiceId) return inv;
    return { 
      ...inv, 
      attachments: [...inv.attachments, attachment],
      updatedAt: new Date().toISOString(),
    };
  });
  saveData(adapter, { ...data, invoices });
}

export function removeAttachment(adapter: StorageAdapter, invoiceId: string, attachmentId: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) => {
    if (inv.id !== invoiceId) return inv;
    return { 
      ...inv, 
      attachments: inv.attachments.filter((a) => a.id !== attachmentId),
      updatedAt: new Date().toISOString(),
    };
  });
  saveData(adapter, { ...data, invoices });
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

export function searchInvoices(adapter: StorageAdapter, query: string): Invoice[] {
  if (!query.trim()) return loadData(adapter).invoices;
  
  const data = loadData(adapter);
  const lowerQuery = query.toLowerCase();
  
  return data.invoices.filter((inv) => {
    // Search in invoice number
    if (inv.invoiceNumber.toLowerCase().includes(lowerQuery)) return true;
    
    // Search in recipient
    if (inv.recipient.name.toLowerCase().includes(lowerQuery)) return true;
    if (inv.recipient.address.toLowerCase().includes(lowerQuery)) return true;
    if (inv.recipient.contact.toLowerCase().includes(lowerQuery)) return true;
    
    // Search in sender
    if (inv.sender.name.toLowerCase().includes(lowerQuery)) return true;
    
    // Search in line items
    for (const li of inv.lineItems) {
      if (li.description.toLowerCase().includes(lowerQuery)) return true;
    }
    
    // Search in footer/notes
    if (inv.footerText.toLowerCase().includes(lowerQuery)) return true;
    
    // Search in tags
    const tags = data.tags.filter((t) => inv.tagIds.includes(t.id));
    for (const tag of tags) {
      if (tag.name.toLowerCase().includes(lowerQuery)) return true;
    }
    
    return false;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Stats
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardStats = {
  unpaidTotal: number;
  overdueCount: number;
  overdueTotal: number;
  paidThisPeriod: number;
  revenueByMonth: { month: string; revenue: number }[];
  invoiceCount: number;
  customerCount: number;
};

export function getDashboardStats(adapter: StorageAdapter): DashboardStats {
  const data = loadData(adapter);
  const today = todayLocalISO();
  const baseCurrency = data.settings.currency || "EUR";
  
  let unpaidTotal = 0;
  let overdueCount = 0;
  let overdueTotal = 0;
  
  const revenueMap = new Map<string, number>();
  const creditNotesByInvoiceId = new Map<string, CreditNote[]>();

  for (const creditNote of data.creditNotes) {
    const linked = creditNotesByInvoiceId.get(creditNote.linkedInvoiceId);
    if (linked) linked.push(creditNote);
    else creditNotesByInvoiceId.set(creditNote.linkedInvoiceId, [creditNote]);
  }
  
  for (const inv of data.invoices) {
    const linkedCreditNotes = creditNotesByInvoiceId.get(inv.id) ?? [];
    const balance = computeInvoiceBalance(inv, linkedCreditNotes, today);
    const remaining = convertInvoiceAmountToCurrency(balance.remainingAmount, inv, baseCurrency);
    
    if (remaining > 0) {
      unpaidTotal += remaining;
      if (balance.isOverdue) {
        overdueCount++;
        overdueTotal += remaining;
      }
    }
    
    for (const payment of inv.payments ?? []) {
      const month = monthKey(payment.date);
      if (!month) continue;
      const paymentAmount = convertInvoiceAmountToCurrency(payment.amount, inv, baseCurrency);
      revenueMap.set(month, (revenueMap.get(month) || 0) + paymentAmount);
    }
  }

  for (const creditNote of data.creditNotes) {
    const invoice = data.invoices.find((inv) => inv.id === creditNote.linkedInvoiceId);
    const month = monthKey(creditNote.creditNoteDate);
    if (!invoice || !month) continue;
    const creditAmount = convertInvoiceAmountToCurrency(Math.max(0, creditNote.amount), invoice, baseCurrency);
    revenueMap.set(month, (revenueMap.get(month) || 0) - creditAmount);
  }
  
  // Sort revenue by month
  const revenueByMonth = Array.from(revenueMap.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // Most recent first
    .slice(0, 12)
    .map(([month, revenue]) => ({ month, revenue }))
    .reverse();
  
  return {
    unpaidTotal: Math.round((unpaidTotal + Number.EPSILON) * 100) / 100,
    overdueCount,
    overdueTotal: Math.round((overdueTotal + Number.EPSILON) * 100) / 100,
    paidThisPeriod: 0, // Would need period filter
    revenueByMonth,
    invoiceCount: data.invoices.length,
    customerCount: data.customers.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup / Restore
// ─────────────────────────────────────────────────────────────────────────────

export function exportData(adapter: StorageAdapter): string {
  const data = loadData(adapter);
  return JSON.stringify(data, null, 2);
}

export function importData(adapter: StorageAdapter, json: string): boolean {
  try {
    const fullData = parsePersistedData(json);
    if (!fullData) return false;
    saveData(adapter, fullData);
    return true;
  } catch {
    return false;
  }
}
