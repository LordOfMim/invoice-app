import { isValidPersistedData } from "../../../electron/storage-validation.cjs";
import type { 
  AppSettings, 
  Attachment,
  ContractorDeclaration,
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
  computeInvoicePayable,
  convertInvoiceAmountToCurrency,
} from "@/lib/calc";
import { isDateOnly, addMonthsAnchored, dateToLocalISO, daysBetweenDateOnly, monthKey, parseDateOnly, todayLocalISO } from "@/lib/date";
import { createDeclaration, createQuoteFromDefaults, invoiceFromQuote, switchReverseCharge, withSellerDefaults, type DeclarationDefaults } from "@/lib/documents";
import { roundMoney } from "@/lib/money";
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
  dueDateFor,
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
  // Compatibility hook: adapters accept edits synchronously and own their durable flush barrier.
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
    if (!isValidPersistedData(parsed)) return null;
    const data = parsed as Record<string, unknown>;
    // Preserve unknown additive fields for compatibility with newer exports.
    return {
      ...data,
      schemaVersion: 1,
      settings: migrateSettings(data.settings),
      invoices: asArray(data.invoices).map(migrateInvoice),
      customers: asArray(data.customers).map(migrateCustomer),
      products: asArray(data.products).map(migrateProduct),
      tags: asArray(data.tags).map(migrateTag),
      creditNotes: asArray(data.creditNotes).map(migrateCreditNote),
      recurringInvoices: asArray(data.recurringInvoices).map(migrateRecurringInvoice),
      templateVariants: asArray(data.templateVariants).map(migrateTemplateVariant),
      quotes: asArray(data.quotes).map(migrateInvoice),
      contractorDeclarations: asArray(data.contractorDeclarations).map(migrateDeclaration),
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

function asString(value: unknown, fallback: string | (() => string) = ""): string {
  return typeof value === "string" ? value : typeof fallback === "function" ? fallback() : fallback;
}

function nowIso() { return new Date().toISOString(); }

const migrationSettings = { ...createDefaultSettings(), defaultTaxRate: undefined };
const migrationInvoice = createInvoiceFromDefaults(migrationSettings);
const migrationCustomer = createDefaultCustomer();
const migrationProduct = createDefaultProduct();
const migrationTag = createDefaultTag();
const migrationCreditNote = createCreditNoteFromInvoice(migrationInvoice, "gutschrift");
const migrationRecurring = createDefaultRecurringInvoice(migrationSettings);
const migrationTemplate = createDefaultTemplateVariant();
const migrationCustomization = createDefaultTemplateCustomization();

function migratePartyDetails(value: unknown, fallback = { name: "", address: "", contact: "" }) {
  if (!isRecord(value)) return { ...fallback };
  return {
    ...value,
    salutation: typeof value.salutation === "string" ? value.salutation : undefined,
    name: asString(value.name, fallback.name),
    address: asString(value.address, fallback.address),
    contact: asString(value.contact, fallback.contact),
  };
}

function migrateInvoiceTexts(value: unknown, fallback = migrationSettings.defaultTexts) {
  return isRecord(value) ? { ...fallback, ...value } : { ...fallback };
}

function migrateLayout(value: unknown, fallback = migrationInvoice.layout) {
  const source = isRecord(value) ? value : {};
  return {
    ...fallback,
    ...source,
    templateId:
      source.templateId === "classic" || source.templateId === "modern" || source.templateId === "minimal"
        ? source.templateId
        : fallback.templateId,
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
  const defaults = migrationSettings;
  if (!isRecord(settings)) return { ...defaults };
  const defaultLayout = isRecord(settings.defaultLayout) ? settings.defaultLayout : {};
  return {
    ...defaults,
    ...settings,
    language: settings.language === "en" ? "en" : "de",
    currency: asString(settings.currency, defaults.currency).toUpperCase(),
    defaultTaxRate:
      typeof settings.defaultTaxRate === "number" && Number.isFinite(settings.defaultTaxRate)
        ? settings.defaultTaxRate
        : undefined,
    defaultSender: migratePartyDetails(settings.defaultSender, defaults.defaultSender),
    defaultFooterText: asString(settings.defaultFooterText, defaults.defaultFooterText),
    defaultTexts: migrateInvoiceTexts(settings.defaultTexts, defaults.defaultTexts),
    backupEnabled: typeof settings.backupEnabled === "boolean" ? settings.backupEnabled : false,
    dashboardPeriod:
      settings.dashboardPeriod === "quarter" || settings.dashboardPeriod === "year" ? settings.dashboardPeriod : "month",
    backgroundChoice:
      settings.backgroundChoice === "auto" ||
      settings.backgroundChoice === "off" ||
      settings.backgroundChoice === "threads" ||
      settings.backgroundChoice === "light-rays" ||
      settings.backgroundChoice === "shape-grid" ||
      settings.backgroundChoice === "beams"
        ? settings.backgroundChoice
        : defaults.backgroundChoice,
    defaultInvoiceId: typeof settings.defaultInvoiceId === "string" ? settings.defaultInvoiceId : undefined,
    defaultTemplateId:
      settings.defaultTemplateId === "classic" ||
      settings.defaultTemplateId === "modern" ||
      settings.defaultTemplateId === "minimal"
        ? settings.defaultTemplateId
        : defaults.defaultTemplateId,
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
  const base = migrationInvoice.lineItems[0];
  if (!isRecord(value)) return base;
  const type = value.type === "header" || value.type === "subheader" ? value.type : "item";
  return {
    ...base,
    ...value,
    id: asString(value.id, newId),
    type,
    positionNumber: typeof value.positionNumber === "string" ? value.positionNumber : "",
    description: asString(value.description),
    quantity: asNumber(value.quantity, type === "item" ? 1 : 0),
    unit: typeof value.unit === "string" ? value.unit : undefined,
    unitPrice: asNumber(value.unitPrice, 0),
    taxRate: typeof value.taxRate === "number" ? value.taxRate : undefined,
    productId: typeof value.productId === "string" ? value.productId : undefined,
  };
}

function migratePayment(value: unknown): Payment {
  if (!isRecord(value)) return { id: newId(), amount: 0, date: todayLocalISO(), createdAt: nowIso() };
  return {
    ...value,
    id: asString(value.id, newId),
    amount: asNumber(value.amount, 0),
    currency: typeof value.currency === "string" ? value.currency : undefined,
    date: asString(value.date, todayLocalISO),
    method: typeof value.method === "string" ? value.method : undefined,
    reference: typeof value.reference === "string" ? value.reference : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    createdAt: asString(value.createdAt, nowIso),
  };
}

function migrateAttachment(value: unknown): Attachment {
  if (!isRecord(value)) return { id: newId(), name: "Attachment", type: "", size: 0, createdAt: nowIso() };
  // The content is a stored file (`file`) or, in older data, a data URL. An empty data URL carries nothing and is
  // dropped; a real one keeps its place, so data that needs no change is not rewritten.
  const dataUrl = typeof value.dataUrl === "string" && value.dataUrl ? value.dataUrl : undefined;
  const attachment: Attachment = {
    ...value,
    id: asString(value.id, newId),
    name: asString(value.name, "Attachment"),
    type: asString(value.type),
    size: asNumber(value.size, 0),
    dataUrl,
    createdAt: asString(value.createdAt, nowIso),
  };
  if (dataUrl === undefined) delete attachment.dataUrl;
  return attachment;
}

function migrateInvoice(invoice: unknown): Invoice {
  const base = migrationInvoice;
  if (!isRecord(invoice)) return base;
  const lineItems = asArray(invoice.lineItems).map(migrateLineItem);
  return {
    ...base,
    ...invoice,
    schemaVersion: 1,
    id: asString(invoice.id, newId),
    invoiceNumber: asString(invoice.invoiceNumber),
    invoiceDate: asString(invoice.invoiceDate, todayLocalISO),
    dueDate: asString(invoice.dueDate, todayLocalISO),
    sender: migratePartyDetails(invoice.sender, base.sender),
    recipient: migratePartyDetails(invoice.recipient, base.recipient),
    customerId: typeof invoice.customerId === "string" ? invoice.customerId : undefined,
    lineItems: invoice.lineItems === undefined ? [{ ...base.lineItems[0], id: newId() }] : lineItems,
    payments: asArray(invoice.payments).map(migratePayment),
    tagIds: asStringArray(invoice.tagIds),
    currency: asString(invoice.currency, "EUR").toUpperCase(),
    attachments: asArray(invoice.attachments).map(migrateAttachment),
    texts: migrateInvoiceTexts(invoice.texts, base.texts),
    layout: migrateLayout(invoice.layout, base.layout),
    creditNoteIds: asStringArray(invoice.creditNoteIds),
    createdAt: asString(invoice.createdAt, nowIso),
    updatedAt: asString(invoice.updatedAt, nowIso),
  };
}

function migrateCustomer(value: unknown): Customer {
  const base = migrationCustomer;
  if (!isRecord(value)) return base;
  return {
    ...base,
    ...value,
    id: asString(value.id, newId),
    name: asString(value.name),
    address: asString(value.address),
    contact: asString(value.contact),
    salutation: typeof value.salutation === "string" ? value.salutation : undefined,
    email: typeof value.email === "string" ? value.email : undefined,
    phone: typeof value.phone === "string" ? value.phone : undefined,
    taxId: typeof value.taxId === "string" ? value.taxId : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    createdAt: asString(value.createdAt, nowIso),
    updatedAt: asString(value.updatedAt, nowIso),
  };
}

function migrateProduct(value: unknown): Product {
  const base = migrationProduct;
  if (!isRecord(value)) return base;
  return {
    ...base,
    ...value,
    id: asString(value.id, newId),
    name: asString(value.name),
    description: asString(value.description),
    unit: typeof value.unit === "string" ? value.unit : undefined,
    unitPrice: asNumber(value.unitPrice, 0),
    taxRate: typeof value.taxRate === "number" && Number.isFinite(value.taxRate) ? value.taxRate : undefined,
    category: typeof value.category === "string" ? value.category : undefined,
    createdAt: asString(value.createdAt, nowIso),
    updatedAt: asString(value.updatedAt, nowIso),
  };
}

function migrateTag(value: unknown): Tag {
  const base = migrationTag;
  if (!isRecord(value)) return base;
  return {
    ...base,
    ...value,
    id: asString(value.id, newId),
    name: asString(value.name),
    color: asString(value.color, base.color),
    createdAt: asString(value.createdAt, nowIso),
  };
}

function migrateCreditNote(value: unknown): CreditNote {
  const base = migrationCreditNote;
  if (!isRecord(value)) return base;
  const type = value.type === "storno" ? "storno" : "gutschrift";
  return {
    ...base,
    ...value,
    schemaVersion: 1,
    id: asString(value.id, newId),
    type,
    creditNoteNumber: asString(value.creditNoteNumber),
    creditNoteDate: asString(value.creditNoteDate, todayLocalISO),
    linkedInvoiceId: asString(value.linkedInvoiceId),
    linkedInvoiceNumber: asString(value.linkedInvoiceNumber),
    reason: asString(value.reason),
    amount: asNumber(value.amount, 0),
    sender: migratePartyDetails(value.sender, base.sender),
    recipient: migratePartyDetails(value.recipient, base.recipient),
    footerText: asString(value.footerText, base.footerText),
    texts: isRecord(value.texts) ? { ...base.texts, ...value.texts } : { ...base.texts },
    createdAt: asString(value.createdAt, nowIso),
    updatedAt: asString(value.updatedAt, nowIso),
  };
}

function migrateRecurringInvoice(value: unknown): RecurringInvoice {
  const base = migrationRecurring;
  if (!isRecord(value)) return base;
  const lineItems = asArray(value.lineItems).map(migrateLineItem);
  return {
    ...base,
    ...value,
    id: asString(value.id, newId),
    name: asString(value.name),
    frequency:
      value.frequency === "quarterly" || value.frequency === "yearly" || value.frequency === "monthly"
        ? value.frequency
        : "monthly",
    nextRunDate: asString(value.nextRunDate, () => { const now = new Date(); return dateToLocalISO(new Date(now.getFullYear(), now.getMonth() + 1, 1)); }),
    lastRunDate: typeof value.lastRunDate === "string" ? value.lastRunDate : undefined,
    customerId: typeof value.customerId === "string" ? value.customerId : undefined,
    sender: migratePartyDetails(value.sender, base.sender),
    recipient: migratePartyDetails(value.recipient, base.recipient),
    lineItems: value.lineItems === undefined ? [{ ...base.lineItems[0], id: newId() }] : lineItems,
    footerText: asString(value.footerText, base.footerText),
    texts: migrateInvoiceTexts(value.texts, base.texts),
    layout: migrateLayout(value.layout, base.layout),
    currency: asString(value.currency, base.currency).toUpperCase(),
    active: typeof value.active === "boolean" ? value.active : base.active,
    reminderDays: asNumber(value.reminderDays, base.reminderDays),
    autoGenerate: typeof value.autoGenerate === "boolean" ? value.autoGenerate : base.autoGenerate,
    createdAt: asString(value.createdAt, nowIso),
    updatedAt: asString(value.updatedAt, nowIso),
  };
}

function migrateTemplateVariant(value: unknown): TemplateVariant {
  const base = migrationTemplate;
  const baseCustomization = migrationCustomization;
  if (!isRecord(value)) return base;
  const customization = isRecord(value.customization) ? value.customization : {};
  return {
    ...base,
    ...value,
    id: asString(value.id, newId),
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
    createdAt: asString(value.createdAt, nowIso),
    updatedAt: asString(value.updatedAt, nowIso),
  };
}

function migrateDeclaration(value: unknown): ContractorDeclaration {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    id: asString(source.id, newId),
    date: asString(source.date, todayLocalISO),
    senderAddress: asString(source.senderAddress),
    recipientName: asString(source.recipientName),
    recipientAddress: asString(source.recipientAddress),
    kommission: asString(source.kommission),
    bodyText: asString(source.bodyText),
    signatureName: asString(source.signatureName),
    invoiceId: typeof source.invoiceId === "string" ? source.invoiceId : undefined,
    customerId: typeof source.customerId === "string" ? source.customerId : undefined,
    createdAt: asString(source.createdAt, nowIso),
    updatedAt: asString(source.updatedAt, nowIso),
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
    quotes: [],
    contractorDeclarations: [],
  };
}

export function loadData(adapter: StorageAdapter): PersistedDataV1 {
  if (cachedData) return cachedData;

  const raw = adapter.getItem(STORAGE_KEY);
  const existing = parsePersistedData(raw);
  if (raw !== null && !existing) throw new Error("Gespeicherte Daten sind ungültig. Originaldaten bleiben unverändert.");
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
  if (data === cachedData) return;
  // Queue acceptance must succeed before publishing an edit. Legacy adapters
  // retain their synchronous full-snapshot write and failure behavior.
  if (adapter.persistData) adapter.persistData(data, cachedData);
  else adapter.setItem(STORAGE_KEY, JSON.stringify(data));
  cachedData = data;
  emitChange();
}

/** Seed an already validated authoritative startup snapshot without a write. */
export function primeDataCache(data: PersistedDataV1): void {
  cachedData = data;
}

export function clearDataCache(): void {
  cachedData = null;
}

/** Current accepted renderer state, including edits still awaiting disk acknowledgement. */
export function getCurrentData(): PersistedDataV1 | null { return cachedData; }

export function replaceData(adapter: StorageAdapter, data: PersistedDataV1): void {
  adapter.setItem(STORAGE_KEY, JSON.stringify(data));
  cachedData = data;
  emitChange();
}

export function getSettings(adapter: StorageAdapter): AppSettings {
  return loadData(adapter).settings;
}

function sameValue(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (Array.isArray(previous) && Array.isArray(next)) {
    return previous.length === next.length && previous.every((value, index) => sameValue(value, next[index]));
  }
  if (!isRecord(previous) || !isRecord(next)) return false;
  const keys = Object.keys(previous);
  return keys.length === Object.keys(next).length && keys.every((key) => Object.hasOwn(next, key) && sameValue(previous[key], next[key]));
}

export function updateSettings(adapter: StorageAdapter, updater: (prev: AppSettings) => AppSettings): AppSettings {
  const data = loadData(adapter);
  const nextSettings = updater(data.settings);
  if (sameValue(data.settings, nextSettings)) return data.settings;
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

/** Invoices and quotes share one record shape and one editor; they live in separate collections. */
export type DocumentCollection = "invoices" | "quotes";

export function upsertInvoice(adapter: StorageAdapter, invoice: Invoice, collection: DocumentCollection = "invoices"): void {
  const data = loadData(adapter);
  const list = data[collection] ?? [];
  const idx = list.findIndex((inv) => inv.id === invoice.id);
  if (idx >= 0 && sameValue(list[idx], invoice)) return;
  const nextInvoice: Invoice = { ...invoice, updatedAt: nowIso() };
  const next = [...list];
  if (idx >= 0) next[idx] = nextInvoice;
  else next.unshift(nextInvoice);
  saveData(adapter, { ...data, [collection]: next });
}

export function updateInvoice(
  adapter: StorageAdapter,
  id: string,
  updater: (prev: Invoice) => Invoice,
  collection: DocumentCollection = "invoices"
): Invoice | null {
  const data = loadData(adapter);
  const list = data[collection] ?? [];
  const idx = list.findIndex((inv) => inv.id === id);
  if (idx < 0) return null;

  const updated = updater(list[idx]);
  if (sameValue(list[idx], updated)) return list[idx];
  const nextInvoice = { ...updated, updatedAt: nowIso() };
  const next = [...list];
  next[idx] = nextInvoice;
  saveData(adapter, { ...data, [collection]: next });
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
  // A quote whose invoice is gone can be converted again; declarations keep their content without the link.
  // A final invoice that deducted this invoice as an advance keeps its deduction (amounts on issued documents are
  // never changed silently); `checkAdvanceDeductions` reports the missing source in the editor and on the dashboard.
  const quotes = (data.quotes ?? []).map((quote) => (quote.convertedInvoiceId === id ? { ...quote, convertedInvoiceId: undefined, updatedAt: nowIso() } : quote));
  const contractorDeclarations = (data.contractorDeclarations ?? []).map((declaration) =>
    declaration.invoiceId === id ? { ...declaration, invoiceId: undefined, updatedAt: nowIso() } : declaration);
  saveData(adapter, { ...data, settings, invoices, creditNotes, quotes, contractorDeclarations });
}

export function createInvoice(adapter: StorageAdapter): Invoice {
  const data = loadData(adapter);
  const today = todayLocalISO();

  const defaultInvoiceId = data.settings.defaultInvoiceId;
  const defaultInvoice = defaultInvoiceId ? data.invoices.find((inv) => inv.id === defaultInvoiceId) ?? null : null;

  const invoice = defaultInvoice
    ? withSellerDefaults({
        ...duplicateInvoice(defaultInvoice),
        invoiceDate: today,
        dueDate: dueDateFor(today, data.settings),
      }, data.settings)
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
  const total = computeInvoicePayable(invoice).payable;
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
  const idx = data.customers.findIndex((c) => c.id === customer.id);
  if (idx >= 0 && sameValue(data.customers[idx], customer)) return;
  const nextCustomer: Customer = { ...customer, updatedAt: nowIso() };
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
  const quotes = (data.quotes ?? []).map((quote) =>
    quote.customerId === id ? { ...quote, customerId: undefined, updatedAt: new Date().toISOString() } : quote
  );
  const contractorDeclarations = (data.contractorDeclarations ?? []).map((declaration) =>
    declaration.customerId === id ? { ...declaration, customerId: undefined, updatedAt: new Date().toISOString() } : declaration
  );
  saveData(adapter, {
    ...data,
    customers: data.customers.filter((c) => c.id !== id),
    invoices,
    recurringInvoices,
    quotes,
    contractorDeclarations,
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
  const idx = data.products.findIndex((p) => p.id === product.id);
  if (idx >= 0 && sameValue(data.products[idx], product)) return;
  const nextProduct: Product = { ...product, updatedAt: nowIso() };
  const products = [...data.products];
  if (idx >= 0) products[idx] = nextProduct;
  else products.unshift(nextProduct);
  saveData(adapter, { ...data, products });
}

export function deleteProduct(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  // Only documents that really use the product are replaced; all others keep their identity (and cached rows).
  const unlink = <T extends { lineItems: Invoice["lineItems"] }>(document: T): T =>
    document.lineItems.some((li) => li.productId === id)
      ? { ...document, lineItems: document.lineItems.map((li) => (li.productId === id ? { ...li, productId: undefined } : li)) }
      : document;
  saveData(adapter, {
    ...data,
    products: data.products.filter((p) => p.id !== id),
    invoices: data.invoices.map(unlink),
    recurringInvoices: data.recurringInvoices.map(unlink),
    quotes: (data.quotes ?? []).map(unlink),
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
  if (idx >= 0 && sameValue(data.tags[idx], tag)) return;
  const tags = [...data.tags];
  if (idx >= 0) tags[idx] = tag;
  else tags.unshift(tag);
  saveData(adapter, { ...data, tags });
}

export function deleteTag(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  // Also remove tag from all invoices
  const untag = (inv: Invoice): Invoice => (inv.tagIds.includes(id) ? { ...inv, tagIds: inv.tagIds.filter((tid) => tid !== id) } : inv);
  saveData(adapter, { ...data, tags: data.tags.filter((t) => t.id !== id), invoices: data.invoices.map(untag), quotes: (data.quotes ?? []).map(untag) });
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
  const idx = data.creditNotes.findIndex((cn) => cn.id === creditNote.id);
  if (idx >= 0 && sameValue(data.creditNotes[idx], creditNote)) return;
  const next: CreditNote = { ...creditNote, updatedAt: nowIso() };
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
  const idx = data.recurringInvoices.findIndex((ri) => ri.id === recurring.id);
  if (idx >= 0 && sameValue(data.recurringInvoices[idx], recurring)) return;
  const next: RecurringInvoice = { ...recurring, updatedAt: nowIso() };
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

  const scheduledDate = recurring.nextRunDate || todayLocalISO();
  // A date that does not exist (imported or damaged data) must not become an invoice date.
  if (!isDateOnly(scheduledDate)) return null;

  if (expectedNextRunDate && scheduledDate !== expectedNextRunDate) {
    return data.invoices.find(
      (inv) => inv.recurringInvoiceId === recurringId && inv.invoiceDate === expectedNextRunDate
    ) ?? null;
  }

  // The day the schedule was set up for stays the anchor, so a run on the 31st returns to the 31st after February.
  const anchorDay = recurring.anchorDay ?? parseDateOnly(scheduledDate)?.getDate();
  const nextRunDate = calculateNextRunDate(scheduledDate, recurring.frequency, anchorDay);
  return writeRecurringRun(adapter, data, recurring, scheduledDate, nextRunDate, anchorDay).invoice;
}

/**
 * Store one run of a schedule: the invoice dated `runDate` (unless the schedule already has one for that day) and
 * the schedule moved on to `nextRunDate`. One write for both.
 */
function writeRecurringRun(
  adapter: StorageAdapter,
  data: PersistedDataV1,
  recurring: RecurringInvoice,
  runDate: string,
  nextRunDate: string,
  anchorDay: number | undefined
): { invoice: Invoice; created: boolean } {
  const nowIso = new Date().toISOString();
  const recurringId = recurring.id;
  const existingForRun = data.invoices.find(
    (inv) => inv.recurringInvoiceId === recurringId && inv.invoiceDate === runDate
  );
  const advanced: RecurringInvoice = {
    ...recurring,
    lastRunDate: runDate,
    nextRunDate,
    anchorDay,
    updatedAt: nowIso,
  };
  const recurringInvoices = data.recurringInvoices.map((ri) => (ri.id === recurringId ? advanced : ri));
  if (existingForRun) {
    // This run already has its invoice (created by hand, or the schedule was moved back onto that day): do not
    // create a second one, but let the schedule continue instead of waiting on this day forever.
    saveData(adapter, { ...data, recurringInvoices });
    return { invoice: existingForRun, created: false };
  }

  // Create invoice from recurring template
  const draft: Invoice = {
    schemaVersion: 1,
    id: newId(),
    invoiceNumber: "",
    invoiceDate: runDate,
    dueDate: dueDateFor(runDate, data.settings),
    // Tax numbers and bank details for the printed footer and the E-Rechnung, as on every new invoice.
    einvoice: data.settings.defaultEInvoice ? structuredClone(data.settings.defaultEInvoice) : undefined,
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
  // A customer marked for § 13b gets the invoice without VAT, exactly as when the customer is chosen in the editor
  // (the tax rates of the schedule are remembered, so the switch can still be taken back on the draft).
  const customer = recurring.customerId ? data.customers.find((entry) => entry.id === recurring.customerId) : undefined;
  let invoice = draft;
  if (customer?.reverseCharge) {
    // The E-Rechnung needs the customer's VAT ID for reverse charge; it comes along as in the editor.
    const taxId = customer.taxId?.replace(/\s+/g, "").toUpperCase() ?? "";
    const withBuyer = /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(taxId) ? { ...draft, einvoice: { ...(draft.einvoice ?? {}), buyer: { vatId: taxId } } } : draft;
    invoice = switchReverseCharge(withBuyer, true, data.settings.defaultTaxRate, data.products);
  }

  saveData(adapter, { 
    ...data, 
    invoices: [invoice, ...data.invoices],
    recurringInvoices,
  });

  return { invoice, created: true };
}

const monthsPerRun = (frequency: RecurringInvoice["frequency"]) => (frequency === "quarterly" ? 3 : frequency === "yearly" ? 12 : 1);

function calculateNextRunDate(currentDate: string, frequency: RecurringInvoice["frequency"], anchorDay?: number): string {
  return addMonthsAnchored(currentDate, monthsPerRun(frequency), anchorDay);
}

/** Years before this are typing mistakes or damaged data, not a schedule to catch up on. */
const EARLIEST_PLAUSIBLE_RUN_YEAR = 2000;

/** What the automatic run did for one schedule. */
export type RecurringRunResult = {
  /** The schedule as it was before the run. */
  recurring: RecurringInvoice;
  /** The invoice that was newly created: one, or none when the run already had its invoice. */
  invoices: Invoice[];
  /** The date this run stands for (the invoice date). */
  runDate: string;
  /** How many earlier due dates were passed over without an invoice. */
  skippedRuns: number;
  /** With skipped runs: the date the schedule had been waiting on. */
  dueSince?: string;
  /** Set when an invoice of this schedule already carried `runDate`, so none was created. */
  existingInvoice?: Invoice;
};

/**
 * The most recent due date of a schedule and the first one after today, by calendar arithmetic (no stepping
 * through the periods, so a schedule that is decades behind costs the same as one that is a day behind).
 */
function latestDueRun(recurring: RecurringInvoice, today: string): { runDate: string; nextRunDate: string; skippedRuns: number; anchorDay: number | undefined } | null {
  const first = recurring.nextRunDate;
  // Only real, plausible calendar dates are compared; anything else waits for the user.
  if (!isDateOnly(first) || !isDateOnly(today) || first > today) return null;
  const start = parseDateOnly(first);
  const end = parseDateOnly(today);
  if (!start || !end || start.getFullYear() < EARLIEST_PLAUSIBLE_RUN_YEAR) return null;
  const anchorDay = recurring.anchorDay ?? start.getDate();
  const months = monthsPerRun(recurring.frequency);
  const runAt = (index: number) => (index === 0 ? first : addMonthsAnchored(first, index * months, anchorDay));
  const monthsApart = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  let skippedRuns = Math.floor(monthsApart / months);
  // In the month of today the day may still lie ahead; then the run before it is the latest one that is due.
  if (skippedRuns > 0 && runAt(skippedRuns) > today) skippedRuns -= 1;
  const runDate = runAt(skippedRuns);
  const nextRunDate = runAt(skippedRuns + 1);
  if (!isDateOnly(runDate) || !isDateOnly(nextRunDate) || runDate > today || nextRunDate <= today) return null;
  return { runDate, nextRunDate, skippedRuns, anchorDay };
}

/**
 * Create the invoice that is due for every schedule with "automatically create" switched on: at most one per
 * schedule and call. A schedule that is more than one period behind (the app was closed, or the switch was set
 * before automatic creation existed) gets only its most recent due date; the earlier ones are skipped and the
 * schedule continues after today, so old periods never arrive as a pile of back-dated drafts. Invoices come
 * without a number so the user assigns it. Returns one entry per schedule that was moved on, including runs that
 * created nothing because their invoice already existed.
 */
export function runDueRecurringInvoices(adapter: StorageAdapter, today: string = todayLocalISO()): RecurringRunResult[] {
  const results: RecurringRunResult[] = [];
  const candidates = loadData(adapter).recurringInvoices.filter((ri) => ri.active && ri.autoGenerate);
  for (const candidate of candidates) {
    const data = loadData(adapter);
    const recurring = data.recurringInvoices.find((ri) => ri.id === candidate.id);
    if (!recurring) continue;
    const due = latestDueRun(recurring, today);
    if (!due) continue;
    const { invoice, created } = writeRecurringRun(adapter, data, recurring, due.runDate, due.nextRunDate, due.anchorDay);
    results.push({
      recurring,
      invoices: created ? [invoice] : [],
      runDate: due.runDate,
      skippedRuns: due.skippedRuns,
      dueSince: due.skippedRuns > 0 ? recurring.nextRunDate : undefined,
      existingInvoice: created ? undefined : invoice,
    });
  }
  return results;
}

export function getDueRecurringInvoices(adapter: StorageAdapter): RecurringInvoice[] {
  const data = loadData(adapter);
  const today = todayLocalISO();
  return data.recurringInvoices.filter((ri) => ri.active && isDateOnly(ri.nextRunDate) && ri.nextRunDate <= today);
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
  const idx = data.templateVariants.findIndex((tv) => tv.id === variant.id);
  if (idx >= 0 && sameValue(data.templateVariants[idx], variant)) return;
  const next: TemplateVariant = { ...variant, updatedAt: nowIso() };
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
  const quotes = (data.quotes ?? []).map((quote) =>
    quote.layout.templateVariantId === id
      ? { ...quote, layout: { ...quote.layout, templateVariantId: undefined }, updatedAt: new Date().toISOString() }
      : quote
  );
  saveData(adapter, { 
    ...data, 
    templateVariants: data.templateVariants.filter((tv) => tv.id !== id),
    invoices,
    recurringInvoices,
    quotes,
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
    if ((inv.projectReference ?? "").toLowerCase().includes(lowerQuery)) return true;
    
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
  issuedThisMonthCount: number;
  issuedThisMonthTotal: number;
  dueSoonCount: number;
  dueSoonTotal: number;
  collectionRate: number;
  averageDaysToPay: number | null;
  statusCounts: {
    paid: number;
    partial: number;
    overdue: number;
    unpaid: number;
  };
  agingBuckets: {
    bucket: "current" | "1-30" | "31-60" | "61+";
    count: number;
    total: number;
  }[];
  topCustomers: {
    key: string;
    name: string;
    invoiceCount: number;
    totalBilled: number;
    outstanding: number;
  }[];
  revenueByMonth: { month: string; revenue: number }[];
  invoiceCount: number;
  customerCount: number;
};

export function getDashboardStats(adapter: StorageAdapter): DashboardStats {
  const data = loadData(adapter);
  const today = todayLocalISO();
  const baseCurrency = data.settings.currency || "EUR";
  const currentMonth = monthKey(today);
  const dueSoonDate = new Date(`${today}T00:00:00`);
  dueSoonDate.setDate(dueSoonDate.getDate() + 7);
  const dueSoonLimit = dateToLocalISO(dueSoonDate);
  
  let unpaidTotal = 0;
  let overdueCount = 0;
  let overdueTotal = 0;
  let paidThisPeriod = 0;
  let issuedThisMonthCount = 0;
  let issuedThisMonthTotal = 0;
  let dueSoonCount = 0;
  let dueSoonTotal = 0;
  let totalBilled = 0;
  let totalPaid = 0;
  let totalDaysToPay = 0;
  let paidInvoiceSampleSize = 0;
  
  const revenueMap = new Map<string, number>();
  const creditNotesByInvoiceId = new Map<string, CreditNote[]>();
  const invoicesById = new Map<string, Invoice>();
  const statusCounts: DashboardStats["statusCounts"] = {
    paid: 0,
    partial: 0,
    overdue: 0,
    unpaid: 0,
  };
  const agingTotals = new Map<DashboardStats["agingBuckets"][number]["bucket"], { count: number; total: number }>([
    ["current", { count: 0, total: 0 }],
    ["1-30", { count: 0, total: 0 }],
    ["31-60", { count: 0, total: 0 }],
    ["61+", { count: 0, total: 0 }],
  ]);
  const customers = new Map<string, DashboardStats["topCustomers"][number]>();

  for (const creditNote of data.creditNotes) {
    const linked = creditNotesByInvoiceId.get(creditNote.linkedInvoiceId);
    if (linked) linked.push(creditNote);
    else creditNotesByInvoiceId.set(creditNote.linkedInvoiceId, [creditNote]);
  }
  
  for (const inv of data.invoices) {
    invoicesById.set(inv.id, inv);
    const linkedCreditNotes = creditNotesByInvoiceId.get(inv.id) ?? [];
    const balance = computeInvoiceBalance(inv, linkedCreditNotes, today);
    const remaining = convertInvoiceAmountToCurrency(balance.remainingAmount, inv, baseCurrency);
    const effectiveTotal = convertInvoiceAmountToCurrency(balance.effectiveTotal, inv, baseCurrency);
    const paidAmount = convertInvoiceAmountToCurrency(balance.paidAmount, inv, baseCurrency);
    const invoiceMonth = monthKey(inv.invoiceDate);

    totalBilled += effectiveTotal;
    totalPaid += Math.min(paidAmount, effectiveTotal);
    // A blank, unnumbered draft has a zero balance but is not a paid invoice (see invoiceStatus).
    if (inv.invoiceNumber || balance.invoiceTotal !== 0) statusCounts[balance.status]++;

    if (invoiceMonth === currentMonth) {
      issuedThisMonthCount++;
      issuedThisMonthTotal += effectiveTotal;
    }

    if (!balance.isFullyPaid && inv.dueDate >= today && inv.dueDate <= dueSoonLimit) {
      dueSoonCount++;
      dueSoonTotal += remaining;
    }
    
    if (remaining > 0) {
      unpaidTotal += remaining;
      if (balance.isOverdue) {
        overdueCount++;
        overdueTotal += remaining;
      }

      const daysOverdue = Math.max(0, daysBetweenDateOnly(inv.dueDate, today));
      const agingBucket: DashboardStats["agingBuckets"][number]["bucket"] =
        daysOverdue === 0 ? "current" : daysOverdue <= 30 ? "1-30" : daysOverdue <= 60 ? "31-60" : "61+";
      const aging = agingTotals.get(agingBucket);
      if (aging) {
        aging.count++;
        aging.total += remaining;
      }
    }

    if (balance.isFullyPaid && (inv.payments ?? []).length > 0) {
      const lastPaymentDate = (inv.payments ?? [])
        .map((payment) => payment.date)
        .filter(Boolean)
        .sort()
        .at(-1);

      if (lastPaymentDate) {
        totalDaysToPay += Math.max(0, daysBetweenDateOnly(inv.invoiceDate, lastPaymentDate));
        paidInvoiceSampleSize++;
      }
    }

    const customerKey = inv.customerId || inv.recipient.name.trim().toLowerCase() || inv.recipient.name || inv.id;
    const customerName = inv.recipient.name.trim();
    const existingCustomer = customers.get(customerKey);
    if (existingCustomer) {
      existingCustomer.invoiceCount++;
      existingCustomer.totalBilled += effectiveTotal;
      existingCustomer.outstanding += remaining;
    } else {
      customers.set(customerKey, {
        key: customerKey,
        name: customerName,
        invoiceCount: 1,
        totalBilled: effectiveTotal,
        outstanding: remaining,
      });
    }
    
    for (const payment of inv.payments ?? []) {
      const month = monthKey(payment.date);
      if (!month) continue;
      const paymentAmount = convertInvoiceAmountToCurrency(payment.amount, inv, baseCurrency);
      if (month === currentMonth) paidThisPeriod += paymentAmount;
      revenueMap.set(month, (revenueMap.get(month) || 0) + paymentAmount);
    }
  }

  for (const creditNote of data.creditNotes) {
    const invoice = invoicesById.get(creditNote.linkedInvoiceId);
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
    unpaidTotal: roundMoney(unpaidTotal),
    overdueCount,
    overdueTotal: roundMoney(overdueTotal),
    paidThisPeriod: roundMoney(paidThisPeriod),
    issuedThisMonthCount,
    issuedThisMonthTotal: roundMoney(issuedThisMonthTotal),
    dueSoonCount,
    dueSoonTotal: roundMoney(dueSoonTotal),
    collectionRate: totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0,
    averageDaysToPay: paidInvoiceSampleSize > 0 ? Math.round(totalDaysToPay / paidInvoiceSampleSize) : null,
    statusCounts,
    agingBuckets: Array.from(agingTotals.entries()).map(([bucket, value]) => ({
      bucket,
      count: value.count,
      total: roundMoney(value.total),
    })),
    topCustomers: Array.from(customers.values())
      .sort((a, b) => b.totalBilled - a.totalBilled)
      .slice(0, 5)
      .map((customer) => ({
        ...customer,
        totalBilled: roundMoney(customer.totalBilled),
        outstanding: roundMoney(customer.outstanding),
      })),
    revenueByMonth,
    invoiceCount: data.invoices.length,
    customerCount: data.customers.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quotes
// ─────────────────────────────────────────────────────────────────────────────

export function createQuote(adapter: StorageAdapter): Invoice {
  const data = loadData(adapter);
  const quote = createQuoteFromDefaults(data.settings);
  saveData(adapter, { ...data, quotes: [quote, ...(data.quotes ?? [])] });
  return quote;
}

export function duplicateQuoteById(adapter: StorageAdapter, id: string): Invoice | null {
  const data = loadData(adapter);
  const existing = (data.quotes ?? []).find((quote) => quote.id === id);
  if (!existing) return null;
  const copy: Invoice = { ...duplicateInvoice(existing), documentKind: "quote", quoteStatus: "open" };
  saveData(adapter, { ...data, quotes: [copy, ...(data.quotes ?? [])] });
  return copy;
}

export function deleteQuote(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  // The invoice created from the quote stays; only its back reference goes.
  const invoices = data.invoices.map((inv) => (inv.sourceQuoteId === id ? { ...inv, sourceQuoteId: undefined, updatedAt: nowIso() } : inv));
  saveData(adapter, { ...data, invoices, quotes: (data.quotes ?? []).filter((quote) => quote.id !== id) });
}

/**
 * Turn a quote into an invoice in one step. A quote that already has an existing invoice returns that invoice
 * instead of creating a second one.
 */
export function convertQuoteToInvoice(adapter: StorageAdapter, quoteId: string): Invoice | null {
  const data = loadData(adapter);
  const quote = (data.quotes ?? []).find((candidate) => candidate.id === quoteId);
  if (!quote) return null;
  const existing = quote.convertedInvoiceId ? data.invoices.find((inv) => inv.id === quote.convertedInvoiceId) : undefined;
  if (existing) return existing;
  const invoice = invoiceFromQuote(quote, data.settings);
  const quotes = (data.quotes ?? []).map((candidate) =>
    candidate.id === quoteId ? { ...candidate, quoteStatus: "accepted" as const, convertedInvoiceId: invoice.id, updatedAt: nowIso() } : candidate);
  saveData(adapter, { ...data, invoices: [invoice, ...data.invoices], quotes });
  return invoice;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contractor declarations
// ─────────────────────────────────────────────────────────────────────────────

export function addDeclaration(adapter: StorageAdapter, declaration: ContractorDeclaration): ContractorDeclaration {
  const data = loadData(adapter);
  saveData(adapter, { ...data, contractorDeclarations: [declaration, ...(data.contractorDeclarations ?? [])] });
  return declaration;
}

export function createDeclarationFromDefaults(adapter: StorageAdapter, defaults: DeclarationDefaults): ContractorDeclaration {
  return addDeclaration(adapter, createDeclaration(defaults));
}

export function updateDeclaration(
  adapter: StorageAdapter,
  id: string,
  updater: (prev: ContractorDeclaration) => ContractorDeclaration
): ContractorDeclaration | null {
  const data = loadData(adapter);
  const list = data.contractorDeclarations ?? [];
  const idx = list.findIndex((declaration) => declaration.id === id);
  if (idx < 0) return null;
  const updated = updater(list[idx]);
  if (sameValue(list[idx], updated)) return list[idx];
  const next = [...list];
  next[idx] = { ...updated, updatedAt: nowIso() };
  saveData(adapter, { ...data, contractorDeclarations: next });
  return next[idx];
}

export function deleteDeclaration(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  saveData(adapter, { ...data, contractorDeclarations: (data.contractorDeclarations ?? []).filter((declaration) => declaration.id !== id) });
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
    const previous = adapter.getItem(STORAGE_KEY);
    if (previous !== null) {
      adapter.setItem(`${STORAGE_KEY}:recovery:${new Date().toISOString()}:before-import`, previous);
    }
    replaceData(adapter, fullData);
    return true;
  } catch {
    return false;
  }
}
