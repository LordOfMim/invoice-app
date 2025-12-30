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
  createDefaultSettings, 
  createInvoiceFromDefaults, 
  duplicateInvoice,
  createDefaultCustomer,
  createDefaultProduct,
  createDefaultTag,
  createDefaultRecurringInvoice,
  createDefaultTemplateVariant,
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

function emitChange() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function safeParse(json: string | null): PersistedDataV1 | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const data = parsed as Partial<PersistedDataV1>;
    if (data.schemaVersion !== 1) return null;
    if (!data.settings || !data.invoices) return null;
    // Migrate: add new collections if missing
    return {
      schemaVersion: 1,
      settings: migrateSettings(data.settings),
      invoices: (data.invoices || []).map(migrateInvoice),
      customers: data.customers || [],
      products: data.products || [],
      tags: data.tags || [],
      creditNotes: data.creditNotes || [],
      recurringInvoices: data.recurringInvoices || [],
      templateVariants: data.templateVariants || [],
    };
  } catch {
    return null;
  }
}

function migrateSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    backupEnabled: settings.backupEnabled ?? false,
    dashboardPeriod: settings.dashboardPeriod ?? "month",
    defaultInvoiceId: settings.defaultInvoiceId ?? undefined,
    defaultLayout: {
      ...settings.defaultLayout,
      logoMaxHeight: settings.defaultLayout.logoMaxHeight ?? 80,
      logoFitMode: settings.defaultLayout.logoFitMode ?? "contain",
    },
  };
}

function migrateInvoice(invoice: Invoice): Invoice {
  return {
    ...invoice,
    payments: invoice.payments || [],
    tagIds: invoice.tagIds || [],
    currency: invoice.currency || "EUR",
    attachments: invoice.attachments || [],
    creditNoteIds: invoice.creditNoteIds || [],
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

  const existing = safeParse(adapter.getItem(STORAGE_KEY));
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

export function deleteInvoice(adapter: StorageAdapter, id: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.filter((inv) => inv.id !== id);
  const settings: AppSettings = {
    ...data.settings,
    defaultInvoiceId: data.settings.defaultInvoiceId === id ? undefined : data.settings.defaultInvoiceId,
  };
  saveData(adapter, { ...data, settings, invoices });
}

export function createInvoice(adapter: StorageAdapter): Invoice {
  const data = loadData(adapter);
  const today = new Date().toISOString().split("T")[0];

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
  const invoices = data.invoices.map((inv) => (inv.id === id ? { ...inv, paid: !inv.paid } : inv));
  saveData(adapter, { ...data, invoices });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure Invoice Helpers (work on Invoice object without adapter)
// ─────────────────────────────────────────────────────────────────────────────

/** Add a payment to an invoice (pure function, returns new Invoice) */
export function addPaymentToInvoice(invoice: Invoice, payment: Payment): Invoice {
  return {
    ...invoice,
    payments: [...invoice.payments, payment],
    updatedAt: new Date().toISOString(),
  };
}

/** Remove a payment from an invoice (pure function, returns new Invoice) */
export function removePaymentFromInvoice(invoice: Invoice, paymentId: string): Invoice {
  return {
    ...invoice,
    payments: invoice.payments.filter((p) => p.id !== paymentId),
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
    const payments = [...inv.payments, payment];
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    // Auto-mark as paid if fully paid (we'll calculate this in the UI)
    return { ...inv, payments, updatedAt: new Date().toISOString() };
  });
  saveData(adapter, { ...data, invoices });
}

export function removePayment(adapter: StorageAdapter, invoiceId: string, paymentId: string): void {
  const data = loadData(adapter);
  const invoices = data.invoices.map((inv) => {
    if (inv.id !== invoiceId) return inv;
    return { 
      ...inv, 
      payments: inv.payments.filter((p) => p.id !== paymentId),
      updatedAt: new Date().toISOString(),
    };
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
  saveData(adapter, { ...data, customers: data.customers.filter((c) => c.id !== id) });
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
  saveData(adapter, { ...data, products: data.products.filter((p) => p.id !== id) });
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

export function generateInvoiceFromRecurring(adapter: StorageAdapter, recurringId: string): Invoice | null {
  const data = loadData(adapter);
  const recurring = data.recurringInvoices.find((ri) => ri.id === recurringId);
  if (!recurring) return null;

  const nowIso = new Date().toISOString();
  const today = new Date().toISOString().split("T")[0];
  
  // Create invoice from recurring template
  const invoice: Invoice = {
    schemaVersion: 1,
    id: newId(),
    invoiceNumber: "",
    invoiceDate: today,
    dueDate: today,
    sender: { ...recurring.sender },
    recipient: { ...recurring.recipient },
    customerId: recurring.customerId,
    lineItems: recurring.lineItems.map((li) => ({ ...li, id: newId() })),
    footerText: recurring.footerText,
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
    lastRunDate: today,
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
  const date = new Date(currentDate);
  switch (frequency) {
    case "monthly":
      date.setMonth(date.getMonth() + 1);
      break;
    case "quarterly":
      date.setMonth(date.getMonth() + 3);
      break;
    case "yearly":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  return date.toISOString().split("T")[0];
}

export function getDueRecurringInvoices(adapter: StorageAdapter): RecurringInvoice[] {
  const data = loadData(adapter);
  const today = new Date().toISOString().split("T")[0];
  return data.recurringInvoices.filter((ri) => ri.active && ri.nextRunDate <= today);
}

export function getUpcomingReminders(adapter: StorageAdapter): RecurringInvoice[] {
  const data = loadData(adapter);
  const today = new Date();
  return data.recurringInvoices.filter((ri) => {
    if (!ri.active) return false;
    const nextRun = new Date(ri.nextRunDate);
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
  saveData(adapter, { 
    ...data, 
    templateVariants: data.templateVariants.filter((tv) => tv.id !== id) 
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
  const today = new Date().toISOString().split("T")[0];
  
  let unpaidTotal = 0;
  let overdueCount = 0;
  let overdueTotal = 0;
  
  const revenueMap = new Map<string, number>();
  
  for (const inv of data.invoices) {
    // Calculate invoice total (simplified - should use calc.ts)
    const total = inv.lineItems.reduce((sum, li) => {
      const net = li.quantity * li.unitPrice;
      const tax = li.taxRate ? net * li.taxRate : 0;
      return sum + net + tax;
    }, 0);
    
    const paidAmount = inv.payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = total - paidAmount;
    
    if (remaining > 0) {
      unpaidTotal += remaining;
      if (inv.dueDate < today) {
        overdueCount++;
        overdueTotal += remaining;
      }
    }
    
    // Revenue by month (based on invoice date)
    const month = inv.invoiceDate.substring(0, 7); // YYYY-MM
    revenueMap.set(month, (revenueMap.get(month) || 0) + total);
  }
  
  // Sort revenue by month
  const revenueByMonth = Array.from(revenueMap.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // Most recent first
    .slice(0, 12)
    .map(([month, revenue]) => ({ month, revenue }))
    .reverse();
  
  return {
    unpaidTotal,
    overdueCount,
    overdueTotal,
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
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return false;
    const data = parsed as Partial<PersistedDataV1>;
    if (data.schemaVersion !== 1) return false;
    if (!data.settings || !data.invoices) return false;
    
    // Ensure all collections exist
    const fullData: PersistedDataV1 = {
      schemaVersion: 1,
      settings: migrateSettings(data.settings),
      invoices: (data.invoices || []).map(migrateInvoice),
      customers: data.customers || [],
      products: data.products || [],
      tags: data.tags || [],
      creditNotes: data.creditNotes || [],
      recurringInvoices: data.recurringInvoices || [],
      templateVariants: data.templateVariants || [],
    };
    
    saveData(adapter, fullData);
    return true;
  } catch {
    return false;
  }
}
