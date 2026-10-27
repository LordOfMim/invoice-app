"use client";

import Link from "next/link";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { InvoicePreview } from "@/components/templates/InvoicePreview";
import { EInvoicePanel } from "@/components/EInvoicePanel";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { PrintStyles } from "@/components/PrintStyles";
import type { Invoice, InvoiceLineItem, InvoiceTexts, InvoiceTemplateId, LayoutPreferences, LogoPosition, Payment, Attachment, LineItemType } from "@/lib/domain";
import { createDefaultLineItem, createLineItemFromProduct } from "@/lib/defaults";
import { buildPdfFilename } from "@/lib/filename";
import { t } from "@/lib/i18n";
import { todayLocalISO } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { computeInvoiceBalance } from "@/lib/calc";
import { usePersistedData } from "@/lib/storage/useStore";
import { 
  deleteInvoice, 
  duplicateInvoiceById, 
  togglePaid, 
  upsertInvoice,
  updateInvoice,
  updateSettings,
  addPaymentToInvoice,
  removePaymentFromInvoice,
  removeAttachmentFromInvoice,
  createCreditNote,
} from "@/lib/storage/store";

// Common currencies with metadata
const CURRENCIES = [
  { code: "EUR", symbol: "€", en: "Euro", de: "Euro" },
  { code: "USD", symbol: "$", en: "US Dollar", de: "US-Dollar" },
  { code: "GBP", symbol: "£", en: "British Pound", de: "Britisches Pfund" },
  { code: "CHF", symbol: "CHF", en: "Swiss Franc", de: "Schweizer Franken" },
  { code: "JPY", symbol: "¥", en: "Japanese Yen", de: "Japanischer Yen" },
  { code: "CAD", symbol: "C$", en: "Canadian Dollar", de: "Kanadischer Dollar" },
  { code: "AUD", symbol: "A$", en: "Australian Dollar", de: "Australischer Dollar" },
  { code: "CNY", symbol: "¥", en: "Chinese Yuan", de: "Chinesischer Yuan" },
  { code: "INR", symbol: "₹", en: "Indian Rupee", de: "Indische Rupie" },
  { code: "BRL", symbol: "R$", en: "Brazilian Real", de: "Brasilianischer Real" },
];

function setInvoiceField<K extends keyof Invoice>(invoice: Invoice, key: K, value: Invoice[K]): Invoice {
  return {
    ...invoice,
    [key]: value,
  };
}

function setTexts(invoice: Invoice, next: InvoiceTexts): Invoice {
  return { ...invoice, texts: next };
}

function setLayout(invoice: Invoice, next: LayoutPreferences): Invoice {
  return { ...invoice, layout: next };
}

const card = "rounded-xl border border-zinc-200 bg-white p-5";
const chip = "rounded-full border px-2.5 py-0.5 text-sm font-medium";
const menuItem = "w-full justify-start hover:bg-zinc-100!";

// Native disclosure used as a small menu: Escape returns focus to the trigger,
// and choosing an action or moving focus elsewhere closes it.
function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = (focusTrigger: boolean) => {
    const details = menu.current;
    if (!details?.open) return;
    details.open = false;
    if (focusTrigger) details.querySelector("summary")?.focus();
  };
  return (
    <details
      ref={menu}
      className="disclosure relative"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(false);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) close(false);
      }}
    >
      <summary id="invoice-actions-trigger" className="rounded-lg border border-zinc-300 bg-white px-4 text-base font-medium hover:bg-zinc-50">{label}</summary>
      <div className="absolute right-0 z-20 mt-2 flex w-72 flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-2">{children}</div>
    </details>
  );
}

function parseNumber(input: string): number {
  const normalized = input.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

type LineItemRowProps = {
  item: InvoiceLineItem;
  index: number;
  texts: InvoiceTexts;
  onUpdate: (id: string, updater: (item: InvoiceLineItem) => InvoiceLineItem) => void;
  onRemove: (id: string) => void;
};

const LineItemRow = memo(function LineItemRow({
  item,
  index,
  texts,
  onUpdate,
  onRemove,
}: LineItemRowProps) {
  const itemType = item.type ?? "item";
  const isHeader = itemType === "header";
  const isSubheader = itemType === "subheader";
  const isItem = itemType === "item";

  return (
    <div
      className={`@container rounded-lg border p-4 ${
        isHeader ? "border-zinc-300 bg-zinc-100" : isSubheader ? "border-zinc-200 bg-zinc-50" : "border-zinc-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium text-zinc-700">{index + 1}.</div>
          <Select
            aria-label={`Art der Zeile ${index + 1}`}
            value={itemType}
            onChange={(e) => {
              const newType = e.target.value as LineItemType;
              onUpdate(item.id, (prev) => ({
                ...prev,
                type: newType,
                quantity: newType === "item" ? (prev.quantity || 1) : 0,
                unitPrice: newType === "item" ? prev.unitPrice : 0,
                taxRate: newType === "item" ? prev.taxRate : undefined,
              }));
            }}
            className="w-auto"
          >
            <option value="header">Überschrift</option>
            <option value="subheader">Unter-Überschrift</option>
            <option value="item">Position</option>
          </Select>
        </div>
        <Button size="sm" variant="danger" aria-label={`Zeile ${index + 1} entfernen`} onClick={() => onRemove(item.id)}>
          Entfernen
        </Button>
      </div>

      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-[88px_1fr] gap-3">
          <Field label="Pos.-Nr.">
            <Input
              value={item.positionNumber || ""}
              placeholder={isHeader ? "01" : isSubheader ? "01.001" : ""}
              onChange={(e) => onUpdate(item.id, (prev) => ({ ...prev, positionNumber: e.target.value }))}
            />
          </Field>
          <Field label={isHeader ? "Überschrift" : isSubheader ? "Unter-Überschrift" : texts.itemsDescriptionLabel}>
            <Textarea
              rows={Math.min(8, Math.max(isItem ? 3 : 1, Math.ceil((item.description?.length || 0) / 80)))}
              value={item.description}
              placeholder={isHeader ? "z.B. Rückbau Klima" : isSubheader ? "z.B. Raum Düsseldorf" : "Beschreibung der Position"}
              className="min-h-[60px] resize-y"
              onChange={(e) => onUpdate(item.id, (prev) => ({ ...prev, description: e.target.value }))}
            />
          </Field>
        </div>

        {isItem && (
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
            <Field label={texts.itemsQuantityLabel}>
              <DecimalInput value={item.quantity}
                onValueChange={(quantity) => onUpdate(item.id, (prev) => ({ ...prev, quantity: quantity ?? 0 }))} />
            </Field>
            <Field label="Einheit">
              <Input
                value={item.unit || ""}
                placeholder="z.B. Stunde"
                onChange={(e) => onUpdate(item.id, (prev) => ({ ...prev, unit: e.target.value }))}
              />
            </Field>
            <Field label={texts.itemsUnitPriceLabel}>
              <DecimalInput value={item.unitPrice}
                onValueChange={(unitPrice) => onUpdate(item.id, (prev) => ({ ...prev, unitPrice: unitPrice ?? 0 }))} />
            </Field>
            <Field label={`${texts.itemsTaxRateLabel} (%)`}>
              <DecimalInput allowEmpty value={item.taxRate === undefined ? undefined : item.taxRate * 100}
                onValueChange={(percent) => onUpdate(item.id, (prev) => ({ ...prev, taxRate: percent === undefined ? undefined : percent / 100 }))} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
});

export function InvoiceEditorClient({ id }: { id: string }) {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const defaultCurrency = data?.settings.currency ?? "EUR";

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMessage, setPdfMessage] = useState("");
  const [pdfError, setPdfError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewImmediate, setPreviewImmediate] = useState(false);
  const previewFrame = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [newPaymentDate, setNewPaymentDate] = useState(todayLocalISO());
  const [newPaymentMethod, setNewPaymentMethod] = useState("bank_transfer");
  const [newPaymentReference, setNewPaymentReference] = useState("");

  const invoice = useMemo(() => {
    return data?.invoices.find((inv) => inv.id === id) ?? null;
  }, [data?.invoices, id]);

  const deferredInvoice = useDeferredValue(invoice);
  useEffect(() => {
    const frame = previewFrame.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewScale(Math.min(1, Math.max(0.3, (entry.contentRect.width - 24) / (210 * 96 / 25.4))));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [invoice?.id]);
  const settings = data?.settings;
  
  // Get related data
  const customers = data?.customers ?? [];
  const products = data?.products ?? [];
  const tags = data?.tags ?? [];
  const templateVariants = data?.templateVariants ?? [];

  const creditNotes = useMemo(() => {
    return (data?.creditNotes ?? []).filter((cn) => cn.linkedInvoiceId === id);
  }, [data?.creditNotes, id]);

  const balance = useMemo(() => {
    if (!invoice) return null;
    return computeInvoiceBalance(invoice, creditNotes);
  }, [creditNotes, invoice]);

  const invoiceTotal = balance?.invoiceTotal ?? 0;
  const paidAmount = balance?.paidAmount ?? 0;
  const remainingAmount = balance?.remainingAmount ?? 0;
  const isFullyPaid = balance?.isFullyPaid ?? false;
  const isPartiallyPaid = balance?.isPartiallyPaid ?? false;

  const currency = invoice?.currency || defaultCurrency;

  const logoDataUrl = invoice?.logoDataUrl || settings?.defaultLogoDataUrl;

  const isDefaultInvoice = (settings?.defaultInvoiceId ?? null) === invoice?.id;

  const save = useCallback(
    (next: Invoice | ((prev: Invoice) => Invoice)) => {
      if (!adapter) return;

      if (typeof next === "function") {
        updateInvoice(adapter, id, next);
      } else {
        upsertInvoice(adapter, next);
      }
    },
    [adapter, id]
  );

  const updateLineItem = useCallback(
    (lineItemId: string, updater: (item: InvoiceLineItem) => InvoiceLineItem) => {
      save((prev) => ({
        ...prev,
        lineItems: prev.lineItems.map((item) => (item.id === lineItemId ? updater(item) : item)),
      }));
    },
    [save]
  );

  const removeLineItem = useCallback(
    (lineItemId: string) => {
      save((prev) => ({
        ...prev,
        lineItems: prev.lineItems.filter((item) => item.id !== lineItemId),
      }));
    },
    [save]
  );

  if (!adapter) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-base text-zinc-600">{t(language, "common.loading")}</div>
      </main>
    );
  }

  if (!invoice) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="space-y-3">
          <p className="text-base text-zinc-700">{t(language, "invoice.notFound")}</p>
          <Link href="/invoices" className="inline-flex min-h-11 items-center text-base text-blue-700 hover:underline">
            ← {t(language, "nav.invoices")}
          </Link>
        </div>
      </main>
    );
  }

  const onPrint = async () => {
    setPdfBusy(true);
    setPdfMessage("");
    setPdfError(false);
    setPreviewImmediate(true);
    const filename = buildPdfFilename(settings?.pdfFilenamePattern ?? "Rechnung-{invoiceNumber}.pdf", invoice);
    const api = window.electronAPI as typeof window.electronAPI & {
      saveDocument?: (payload: { filename: string; bytes: Uint8Array }) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
    };
    try {
      // Let the latest invoice reach the single preview before printing it.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await document.fonts.ready;
      if (api?.printToPDF) {
        const bytes = await api.printToPDF({ printBackground: true, preferCSSPageSize: true });
        if (!bytes) throw new Error("Die PDF konnte nicht erstellt werden.");
        if (api.saveDocument) {
          const result = await api.saveDocument({ filename, bytes: new Uint8Array(bytes) });
          if (!result.ok && !result.canceled) throw new Error(result.error || "Speichern fehlgeschlagen.");
          if (result.ok) setPdfMessage("PDF gespeichert.");
        } else {
          const copy = new Uint8Array(bytes);
          const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/pdf" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = filename;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } else {
        const original = document.title;
        document.title = filename.replace(/\.pdf$/i, "");
        try { window.print(); } finally { document.title = original; }
      }
    } catch (error) {
      setPdfError(true);
      setPdfMessage(error instanceof Error ? error.message : "PDF-Erstellung fehlgeschlagen.");
    } finally {
      setPdfBusy(false);
      setPreviewImmediate(false);
    }
  };

  const handleSelectCustomer = (customerId: string) => {
    if (!adapter || !invoice) return;
    if (!customerId) { save({ ...invoice, customerId: undefined }); return; }
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    save({
      ...invoice,
      customerId,
      // Structured recipient details must not follow a different customer.
      einvoice: invoice.einvoice ? { ...invoice.einvoice, buyer: undefined, buyerReference: undefined } : undefined,
      recipient: {
        salutation: customer.salutation,
        name: customer.name,
        address: customer.address,
        contact: customer.contact,
      },
    });
  };

  const handleAddProduct = (productId: string) => {
    if (!adapter || !invoice) return;
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const lineItem = createLineItemFromProduct(product);
    save({
      ...invoice,
      lineItems: [...invoice.lineItems, lineItem],
    });
  };

  const handleCreateCreditNote = (type: "storno" | "gutschrift") => {
    if (!adapter || !invoice) return;
    const creditNote = createCreditNote(adapter, invoice.id, type);
    if (creditNote) {
      window.location.assign(`/credit-notes/${creditNote.id}`);
    }
  };

  const handleEmailInvoice = async () => {
    if (!invoice) return;

    const customerEmail = invoice.customerId
      ? customers.find((c) => c.id === invoice.customerId)?.email
      : undefined;

    const to = customerEmail ?? "";
    const subjectText = `${invoice.texts.documentTitle} ${invoice.invoiceNumber}`.trim();
    const bodyText =
      `${language === "de" ? "Sehr geehrte Damen und Herren" : "Dear Sir or Madam"},\n\n` +
      `${language === "de" ? "anbei erhalten Sie" : "Please find attached"} ${invoice.texts.documentTitle} ${invoice.invoiceNumber}.\n\n` +
      `${language === "de" ? "Mit freundlichen Grüßen" : "Best regards"},\n${invoice.sender.name}`;

    const pattern = settings?.pdfFilenamePattern ?? "Invoice-{invoiceNumber}.pdf";
    const filename = buildPdfFilename(pattern, invoice);

    setPreviewImmediate(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await document.fonts.ready;

    // Electron: generate PDF + open email compose with attachment
    if (window.electronAPI?.emailInvoiceWithPdf) {
      const result = await window.electronAPI.emailInvoiceWithPdf({
        to,
        subject: subjectText,
        body: bodyText,
        filename,
      });
      if (result?.ok) return;
      console.error('Email compose failed:', result?.error);
      // fall through to mailto
    }

    // Web fallback: mailto (cannot attach files)
    const subject = encodeURIComponent(subjectText);
    const body = encodeURIComponent(bodyText);
    const mailto = to
      ? `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`
      : `mailto:?subject=${subject}&body=${body}`;
    window.location.href = mailto;
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PrintStyles />

      <div className="no-print mb-6 space-y-3">
        <Link href="/invoices" className="inline-flex min-h-11 items-center text-base text-zinc-600 hover:text-zinc-900">
          ← {language === "de" ? "Alle Rechnungen" : "All invoices"}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {invoice.texts.documentTitle || (language === "de" ? "Rechnung" : "Invoice")} {invoice.invoiceNumber || (language === "de" ? "ohne Nummer" : "without number")}
            </h1>
            {!invoice.invoiceNumber && invoiceTotal === 0 ? (
              <span className={`${chip} border-zinc-300 bg-zinc-50 text-zinc-700`}>{language === "de" ? "Entwurf" : "Draft"}</span>
            ) : isFullyPaid ? (
              <span className={`${chip} border-emerald-200 bg-emerald-50 text-emerald-800`}>
                {t(language, "invoice.paid")}
              </span>
            ) : isPartiallyPaid ? (
              <span className={`${chip} border-amber-200 bg-amber-50 text-amber-900`}>
                {t(language, "invoice.partiallyPaid")}
              </span>
            ) : balance?.isOverdue ? (
              <span className={`${chip} border-red-200 bg-red-50 text-red-800`}>
                {t(language, "invoice.overdue")}
              </span>
            ) : null}
            {isDefaultInvoice ? (
              <span className={`${chip} border-zinc-200 bg-white text-zinc-700`}>
                {t(language, "invoice.default")}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={pdfBusy} onClick={onPrint}>{pdfBusy ? "PDF wird erstellt …" : "PDF speichern"}</Button>
            <ActionMenu label={language === "de" ? "Weitere Aktionen" : "More actions"}>
              <Button variant="ghost" className={menuItem} onClick={handleEmailInvoice}>
                {t(language, "actions.email")}
              </Button>
              <Button variant="ghost" className={menuItem} onClick={() => setShowPaymentForm(!showPaymentForm)}>
                {t(language, "actions.addPayment")}
              </Button>
              <Button
                variant="ghost"
                className={menuItem}
                onClick={() => {
                  const dup = duplicateInvoiceById(adapter, invoice.id);
                  if (dup) window.location.assign(`/invoices/${dup.id}`);
                }}
              >
                {t(language, "actions.duplicate")}
              </Button>
              <Button
                variant="ghost"
                className={menuItem}
                onClick={() => {
                  if (!adapter) return;
                  updateSettings(adapter, (prev) => ({ ...prev, defaultInvoiceId: invoice.id }));
                }}
              >
                {t(language, "actions.setDefaultInvoice")}
              </Button>
              <div role="group" aria-labelledby="credit-note-actions" className="mt-1 border-t border-zinc-200 pt-2">
                <p id="credit-note-actions" className="px-4 pb-1 text-sm font-medium text-zinc-600">
                  {language === "de" ? "Korrektur erstellen" : "Create correction"}
                </p>
                <Button variant="ghost" className={menuItem} onClick={() => handleCreateCreditNote("storno")}>{t(language, "creditNotes.storno")}</Button>
                <Button variant="ghost" className={menuItem} onClick={() => handleCreateCreditNote("gutschrift")}>{t(language, "creditNotes.gutschrift")}</Button>
              </div>
              <div className="mt-1 border-t border-zinc-200 pt-2">
                <Button variant="ghost" className={`${menuItem} text-red-700!`} onClick={() => setConfirmDelete(true)}>
                  {language === "de" ? "Rechnung löschen …" : "Delete invoice …"}
                </Button>
              </div>
            </ActionMenu>
          </div>
        </div>
      </div>

      {pdfMessage && (
        <p
          role={pdfError ? "alert" : "status"}
          className={`no-print mb-5 rounded-lg border p-3 text-base ${pdfError ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}
        >
          {pdfMessage}
        </p>
      )}

      {/* Payment Form */}
      {showPaymentForm && (
        <section aria-labelledby="quick-payment-title" className={`no-print mb-6 ${card}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="quick-payment-title" className="text-lg font-semibold">{t(language, "actions.addPayment")}</h2>
            <Button size="sm" variant="ghost" className="hover:bg-zinc-100!" onClick={() => setShowPaymentForm(false)}>
              {language === "de" ? "Schließen" : "Close"}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t(language, "common.amount")}>
              <Input
                inputMode="decimal"
                value={newPaymentAmount}
                onChange={(e) => setNewPaymentAmount(e.target.value)}
                placeholder={formatMoney(remainingAmount, currency, locale)}
              />
            </Field>
            <Field label={t(language, "common.date")}>
              <Input
                type="date"
                value={newPaymentDate}
                onChange={(e) => setNewPaymentDate(e.target.value)}
              />
            </Field>
            <Field label={t(language, "invoices.paymentMethod")}>
              <Select value={newPaymentMethod} onChange={(event) => setNewPaymentMethod(event.target.value)}>
                <option value="bank_transfer">Überweisung</option><option value="cash">Barzahlung</option><option value="card">Karte</option><option value="paypal">PayPal</option><option value="other">Sonstiges</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button variant="primary" onClick={() => {
                const amount = parseNumber(newPaymentAmount);
                if (amount <= 0) return;
                const payment: Payment = {
                  id: crypto.randomUUID(),
                  amount,
                  currency: invoice.currency ?? "EUR",
                  date: newPaymentDate || todayLocalISO(),
                  method: (newPaymentMethod || "bank_transfer") as Payment["method"],
                };
                save(addPaymentToInvoice(invoice, payment));
                setShowPaymentForm(false);
                setNewPaymentAmount("");
                setNewPaymentMethod("bank_transfer");
              }}>
                {t(language, "actions.add")}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Credit Notes Warning */}
      {creditNotes.length > 0 && (
        <div className="no-print mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-base font-semibold text-amber-900">
            {t(language, "invoice.linkedCreditNotes")} ({creditNotes.length})
          </h2>
          <div className="mt-2 space-y-1">
            {creditNotes.map((cn) => (
              <Link
                key={cn.id}
                href={`/credit-notes/${cn.id}`}
                className="block py-1 text-base text-amber-900 underline-offset-4 hover:underline"
              >
                {cn.creditNoteNumber || cn.id} · {t(language, `creditNotes.${cn.type}`)} · {formatMoney(cn.amount, currency, locale)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="no-print space-y-6">
          <div className={card}>
            <h2 className="text-lg font-semibold">{t(language, "invoice.editorTitle")}</h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={invoice.texts.invoiceNumberLabel}>
                <Input value={invoice.invoiceNumber} onChange={(e) => save(setInvoiceField(invoice, "invoiceNumber", e.target.value))} />
              </Field>
              <Field label={invoice.texts.invoiceDateLabel}>
                <Input type="date" value={invoice.invoiceDate} onChange={(e) => save(setInvoiceField(invoice, "invoiceDate", e.target.value))} />
              </Field>
              <Field label={invoice.texts.dueDateLabel}>
                <Input type="date" value={invoice.dueDate} onChange={(e) => save(setInvoiceField(invoice, "dueDate", e.target.value))} />
              </Field>
            </div>
          </div>

          <details className={`disclosure ${card}`}>
            <summary className="flex-wrap">
              <h2 className="text-lg font-semibold">{invoice.texts.senderHeading}</h2>
              <span className={invoice.sender.name ? "text-base text-zinc-600" : "text-base font-medium text-amber-800"}>
                {invoice.sender.name || (language === "de" ? "Bitte ergänzen" : "Please complete")}
              </span>
            </summary>
            <div className="mt-4 grid gap-4">
              <Field label="Name">
                <Input value={invoice.sender.name} onChange={(e) => save({ ...invoice, sender: { ...invoice.sender, name: e.target.value } })} />
              </Field>
              <Field label="Adresse">
                <Textarea rows={3} value={invoice.sender.address} onChange={(e) => save({ ...invoice, sender: { ...invoice.sender, address: e.target.value } })} />
              </Field>
              <Field label="Kontakt">
                <Textarea rows={2} value={invoice.sender.contact} onChange={(e) => save({ ...invoice, sender: { ...invoice.sender, contact: e.target.value } })} />
              </Field>
            </div>
          </details>

          <div className={card}>
            <h2 className="text-lg font-semibold">{invoice.texts.recipientHeading}</h2>
            <div className="mt-4 grid gap-4">
              {customers.length > 0 && (
                <Field
                  label={language === "de" ? "Aus Kundenliste übernehmen" : "Fill from customer list"}
                  hint={language === "de" ? "Ersetzt Anrede, Name, Adresse und Kontakt durch die gespeicherten Kundendaten." : "Replaces salutation, name, address and contact with the saved customer details."}
                >
                  <Select value={invoice.customerId || ""} onChange={(e) => handleSelectCustomer(e.target.value)}>
                    <option value="">{t(language, "actions.selectCustomer")} …</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Anrede">
                <Input 
                  value={invoice.recipient.salutation || ""} 
                  placeholder="z.B. Sehr geehrte Damen und Herren"
                  onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, salutation: e.target.value } })} 
                />
              </Field>
              <Field label="Name">
                <Input value={invoice.recipient.name} onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, name: e.target.value } })} />
              </Field>
              <Field label="Adresse">
                <Textarea rows={3} value={invoice.recipient.address} onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, address: e.target.value } })} />
              </Field>
              <Field label="Kontakt">
                <Textarea rows={2} value={invoice.recipient.contact} onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, contact: e.target.value } })} />
              </Field>
            </div>
          </div>

          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Positionen</div>
              <div className="flex items-center gap-2">
                {products.length > 0 && (
                  <Select
                    aria-label="Produkt oder Leistung hinzufügen"
                    value=""
                    onChange={(e) => handleAddProduct(e.target.value)}
                    className="w-auto text-sm"
                  >
                    <option value="">{t(language, "actions.selectProduct")}...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} - {formatMoney(p.unitPrice, currency, locale)}</option>
                    ))}
                  </Select>
                )}
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {invoice.lineItems.map((lineItem, idx) => (
                <LineItemRow
                  key={lineItem.id}
                  item={lineItem}
                  index={idx}
                  texts={invoice.texts}
                  onUpdate={updateLineItem}
                  onRemove={removeLineItem}
                />
              ))}

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    save({
                      ...invoice,
                      lineItems: [...invoice.lineItems, createDefaultLineItem(settings?.defaultTaxRate, "header")],
                    });
                  }}
                >
                  + Überschrift
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    save({
                      ...invoice,
                      lineItems: [...invoice.lineItems, createDefaultLineItem(settings?.defaultTaxRate, "subheader")],
                    });
                  }}
                >
                  + Unter-Überschrift
                </Button>
                <Button
                  onClick={() => {
                    save({
                      ...invoice,
                      lineItems: [...invoice.lineItems, createDefaultLineItem(settings?.defaultTaxRate, "item")],
                    });
                  }}
                >
                  + Position
                </Button>
              </div>
            </div>
          </div>

          {/* Notes Section (Hinweise) - shown under totals on invoice */}
          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">{invoice.texts.notesHeading || "Hinweise"}</div>
            <p className="mt-1 text-xs text-zinc-500">Wird unter der Zusammenfassung angezeigt.</p>
            <div className="mt-4">
              <Textarea 
                aria-label={invoice.texts.notesHeading || "Hinweise"}
                rows={3} 
                value={invoice.notesText || ""} 
                placeholder="z.B. Zahlungsbedingungen, Hinweise, etc."
                onChange={(e) => save({ ...invoice, notesText: e.target.value })} 
              />
            </div>
          </div>

          <EInvoicePanel invoice={{ ...invoice, logoDataUrl }} onChange={(einvoice) => save((previous) => ({ ...previous, einvoice }))}
            onSaveDefaults={(defaultEInvoice) => updateSettings(adapter, (previous) => ({ ...previous, defaultEInvoice }))} />

          <details className="rounded-xl border border-zinc-200 bg-white p-5">
            <summary className="cursor-pointer text-base font-semibold">Layout, Fußzeile und weitere Einstellungen</summary>
            <div className="mt-5 space-y-6">
          {/* Footer Section - small with left/right */}
          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">Fußzeile</div>
            <p className="mt-1 text-xs text-zinc-500">Kleine Fußzeile am Seitenende mit links/rechts Aufteilung.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Links">
                <Textarea 
                  rows={4} 
                  value={invoice.footerLeftText || ""} 
                  placeholder="z.B. Bankverbindung, IBAN, BIC"
                  className="min-h-[100px]"
                  onChange={(e) => save({ ...invoice, footerLeftText: e.target.value })} 
                />
              </Field>
              <Field label="Rechts">
                <Textarea 
                  rows={4} 
                  value={invoice.footerRightText || ""} 
                  placeholder="z.B. Steuernummer, USt-IdNr., Handelsregister"
                  className="min-h-[100px]"
                  onChange={(e) => save({ ...invoice, footerRightText: e.target.value })} 
                />
              </Field>
            </div>
          </div>

          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">Layout</div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t(language, "settings.defaultTemplate")}>
                <Select
                  value={invoice.layout.templateId}
                  onChange={(e) => {
                    const templateId = e.target.value as InvoiceTemplateId;
                    save(setLayout(invoice, { ...invoice.layout, templateId, templateVariantId: undefined }));
                  }}
                >
                  <option value="classic">Classic</option>
                  <option value="modern">Modern</option>
                  <option value="minimal">Minimal</option>
                </Select>
              </Field>

              {templateVariants.length > 0 && (
                <Field label="Vorlage (Variante)">
                  <Select
                    value={invoice.layout.templateVariantId || ""}
                    onChange={(e) => {
                      const variantId = e.target.value || undefined;
                      const variant = templateVariants.find(v => v.id === variantId);
                      if (variant) {
                        save(setLayout(invoice, { 
                          ...invoice.layout, 
                          templateId: variant.baseTemplateId,
                          templateVariantId: variantId,
                          customization: variant.customization 
                        }));
                      } else {
                        save(setLayout(invoice, { ...invoice.layout, templateVariantId: undefined, customization: undefined }));
                      }
                    }}
                  >
                    <option value="">Keine Variante</option>
                    {templateVariants.map((v) => (
                      <option key={v.id} value={v.id}>{v.name} ({v.baseTemplateId})</option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field label={t(language, "settings.logoPosition")}>
                <Select
                  value={invoice.layout.logoPosition}
                  onChange={(e) => {
                    const pos = e.target.value as LogoPosition;
                    save(setLayout(invoice, { ...invoice.layout, logoPosition: pos }));
                  }}
                >
                  <option value="left">{t(language, "settings.topLeft")}</option>
                  <option value="center">{t(language, "settings.topCenter")}</option>
                  <option value="right">{t(language, "settings.topRight")}</option>
                </Select>
              </Field>

              <Field label="Logo anzeigen">
                <label className="flex items-center gap-3 h-10 px-3 rounded-lg border border-zinc-200 bg-white cursor-pointer hover:bg-zinc-50">
                  <input 
                    type="checkbox" 
                    checked={invoice.layout.showLogo} 
                    onChange={(e) => save(setLayout(invoice, { ...invoice.layout, showLogo: e.target.checked }))} 
                    className="w-4 h-4 accent-zinc-800"
                  />
                  <span className="text-sm">{invoice.layout.showLogo ? t(language, "common.yes") : t(language, "common.no")}</span>
                </label>
              </Field>

              {invoice.layout.showLogo && (
                <Field label="Logo Größe">
                  <Select
                    value={invoice.layout.logoSize ?? "medium"}
                    onChange={(e) => {
                      const logoSize = e.target.value as "small" | "medium" | "large";
                      save(setLayout(invoice, { ...invoice.layout, logoSize }));
                    }}
                  >
                    <option value="small">{t(language, "settings.small")}</option>
                    <option value="medium">{t(language, "settings.medium")}</option>
                    <option value="large">{t(language, "settings.large")}</option>
                  </Select>
                </Field>
              )}

              <Field label="Footer anzeigen">
                <label className="flex items-center gap-3 h-10 px-3 rounded-lg border border-zinc-200 bg-white cursor-pointer hover:bg-zinc-50">
                  <input 
                    type="checkbox" 
                    checked={invoice.layout.showFooter} 
                    onChange={(e) => save(setLayout(invoice, { ...invoice.layout, showFooter: e.target.checked }))} 
                    className="w-4 h-4 accent-zinc-800"
                  />
                  <span className="text-sm">{invoice.layout.showFooter ? t(language, "common.yes") : t(language, "common.no")}</span>
                </label>
              </Field>

              <Field label="Absender Position">
                <Select
                  value={invoice.layout.senderPosition}
                  onChange={(e) => {
                    const senderPosition = e.target.value as LayoutPreferences["senderPosition"];
                    save(setLayout(invoice, { ...invoice.layout, senderPosition }));
                  }}
                >
                  <option value="left">{t(language, "settings.left")}</option>
                  <option value="right">{t(language, "settings.right")}</option>
                </Select>
              </Field>

              <Field label="Empfänger Position">
                <Select
                  value={invoice.layout.recipientPosition}
                  onChange={(e) => {
                    const recipientPosition = e.target.value as LayoutPreferences["recipientPosition"];
                    save(setLayout(invoice, { ...invoice.layout, recipientPosition }));
                  }}
                >
                  <option value="left">{t(language, "settings.left")}</option>
                  <option value="right">{t(language, "settings.right")}</option>
                </Select>
              </Field>

              <Field label="Logo überschreiben (optional)">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = reader.result;
                      if (typeof result !== "string") return;
                      save((prev) => ({ ...prev, logoDataUrl: result }));
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </Field>

              {invoice.logoDataUrl ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    save({ ...invoice, logoDataUrl: undefined });
                  }}
                >
                  Logo-Override entfernen
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">Texte (auf der Rechnung)</div>
            <p className="mt-1 text-sm text-zinc-500">Alle sichtbaren Labels/Überschriften in der Vorschau kommen von diesen Feldern.</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["documentTitle", "Dokumenttitel"],
                  ["senderHeading", "Absender Überschrift"],
                  ["recipientHeading", "Empfänger Überschrift"],
                  ["invoiceNumberLabel", "Label: Rechnungsnummer"],
                  ["invoiceDateLabel", "Label: Rechnungsdatum"],
                  ["dueDateLabel", "Label: Fällig am"],
                  ["itemsDescriptionLabel", "Label: Beschreibung"],
                  ["itemsQuantityLabel", "Label: Menge"],
                  ["itemsUnitPriceLabel", "Label: Einzelpreis"],
                  ["itemsTaxRateLabel", "Label: MwSt."],
                  ["itemsLineTotalLabel", "Label: Summe"],
                  ["subtotalLabel", "Label: Zwischensumme"],
                  ["taxTotalLabel", "Label: Steuer"],
                  ["totalLabel", "Label: Gesamt"],
                  ["notesHeading", "Hinweise Überschrift"],
                  ["footerHeading", "Footer Überschrift (Legacy)"],
                ] as Array<[keyof InvoiceTexts, string]>
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    value={invoice.texts[key] ?? ""}
                    onChange={(e) => {
                      save(setTexts(invoice, { ...invoice.texts, [key]: e.target.value }));
                    }}
                  />
                </Field>
              ))}
            </div>
          </div>

          {/* Tags Section */}
          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">{t(language, "tags.title")}</div>
            <p className="mt-1 text-sm text-zinc-500">{t(language, "tags.assignToInvoice")}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {(invoice.tagIds ?? []).map((tagId) => {
                const tag = tags.find((t) => t.id === tagId);
                if (!tag) return null;
                return (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm"
                    style={{ backgroundColor: tag.color + "20", color: tag.color }}
                  >
                    {tag.name}
                    <button
                      type="button"
                      className="ml-1 text-current hover:opacity-70"
                      onClick={() => {
                        save({ ...invoice, tagIds: (invoice.tagIds ?? []).filter((id) => id !== tagId) });
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>

            <div className="mt-3">
              <Select
                value=""
                onChange={(e) => {
                  const tagId = e.target.value;
                  if (tagId && !(invoice.tagIds ?? []).includes(tagId)) {
                    save({ ...invoice, tagIds: [...(invoice.tagIds ?? []), tagId] });
                  }
                }}
              >
                <option value="">{t(language, "tags.addTag")}</option>
                {tags
                  .filter((tag) => !(invoice.tagIds ?? []).includes(tag.id))
                  .map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
              </Select>
            </div>
          </div>

          {/* Multi-Currency Section */}
          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">{t(language, "invoices.currency")}</div>
            <p className="mt-1 text-sm text-zinc-500">{t(language, "invoices.multiCurrencyNote")}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t(language, "invoices.currency")}>
                <Select
                  value={invoice.currency ?? "EUR"}
                  onChange={(e) => {
                    save({ ...invoice, currency: e.target.value });
                  }}
                >
                  {CURRENCIES.map((cur) => (
                    <option key={cur.code} value={cur.code}>
                      {cur.code} ({cur.symbol}) - {language === "de" ? cur.de : cur.en}
                    </option>
                  ))}
                </Select>
              </Field>

              {invoice.currency && invoice.currency !== "EUR" && (
                <>
                  <Field label={t(language, "invoices.exchangeRate")}>
                    <DecimalInput value={invoice.exchangeRate ?? 1}
                      onValueChange={(exchangeRate) => save({ ...invoice, exchangeRate: exchangeRate ?? 1 })} />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field label={t(language, "invoices.exchangeRateNote")}>
                      <Input
                        value={invoice.exchangeRateNote ?? ""}
                        placeholder={`z.B. 1 ${invoice.currency} = ${invoice.exchangeRate ?? 1} EUR`}
                        onChange={(e) => {
                          save({ ...invoice, exchangeRateNote: e.target.value });
                        }}
                      />
                    </Field>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Payments Section */}
          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{t(language, "invoices.payments")}</div>
              <div className="flex items-center gap-2 text-sm">
                {isFullyPaid ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">{t(language, "invoices.fullyPaid")}</span>
                ) : isPartiallyPaid ? (
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700">{t(language, "invoices.partiallyPaid")}</span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{t(language, "invoices.unpaid")}</span>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span>{t(language, "invoices.invoiceTotal")}:</span>
                <span className="font-medium">{formatMoney(invoiceTotal, invoice.currency ?? "EUR", locale)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>{t(language, "invoices.paidAmount")}:</span>
                <span className="font-medium text-green-600">{formatMoney(paidAmount, invoice.currency ?? "EUR", locale)}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-2">
                <span>{t(language, "invoices.remainingBalance")}:</span>
                <span className={`font-semibold ${remainingAmount > 0 ? "text-red-600" : "text-green-600"}`}>
                  {formatMoney(remainingAmount, invoice.currency ?? "EUR", locale)}
                </span>
              </div>
            </div>

            {(invoice.payments ?? []).length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-medium text-zinc-500 uppercase">{t(language, "invoices.paymentHistory")}</div>
                {(invoice.payments ?? []).map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 text-sm">
                    <div>
                      <div className="font-medium">{formatMoney(payment.amount, payment.currency ?? invoice.currency ?? "EUR", locale)}</div>
                      <div className="text-xs text-zinc-500">
                        {new Date(payment.date).toLocaleDateString(locale)} - {payment.method}
                        {payment.reference && ` (${payment.reference})`}
                      </div>
                      {payment.notes && <div className="text-xs text-zinc-400">{payment.notes}</div>}
                    </div>
                    <button
                      type="button"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => {
                        const updated = removePaymentFromInvoice(invoice, payment.id);
                        save(updated);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!isFullyPaid && (
              <div className="mt-4 border-t pt-4">
                <div className="text-xs font-medium text-zinc-500 uppercase mb-3">{t(language, "invoices.addPayment")}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t(language, "invoices.paymentAmount")}>
                    <Input
                      type="number"
                      step="0.01"
                      value={newPaymentAmount}
                      onChange={(e) => setNewPaymentAmount(e.target.value)}
                      placeholder={remainingAmount.toFixed(2)}
                    />
                  </Field>
                  <Field label={t(language, "invoices.paymentDate")}>
                    <Input
                      type="date"
                      value={newPaymentDate}
                      onChange={(e) => setNewPaymentDate(e.target.value)}
                    />
                  </Field>
                  <Field label={t(language, "invoices.paymentMethod")}>
                    <Select value={newPaymentMethod} onChange={(e) => setNewPaymentMethod(e.target.value)}>
                      <option value="bank_transfer">{t(language, "invoices.bankTransfer")}</option>
                      <option value="cash">{t(language, "invoices.cash")}</option>
                      <option value="card">{t(language, "invoices.card")}</option>
                      <option value="paypal">PayPal</option>
                      <option value="other">{t(language, "common.other")}</option>
                    </Select>
                  </Field>
                  <Field label={t(language, "invoices.paymentReference")}>
                    <Input
                      value={newPaymentReference}
                      onChange={(e) => setNewPaymentReference(e.target.value)}
                      placeholder="z.B. Überweisungs-ID"
                    />
                  </Field>
                </div>
                <div className="mt-3">
                  <Button
                    onClick={() => {
                      const amount = parseFloat(newPaymentAmount);
                      if (!amount || amount <= 0) return;
                      const payment: Payment = {
                        id: crypto.randomUUID(),
                        amount,
                        currency: invoice.currency ?? "EUR",
                        date: newPaymentDate || todayLocalISO(),
                        method: newPaymentMethod as Payment["method"],
                        reference: newPaymentReference || undefined,
                      };
                      const updated = addPaymentToInvoice(invoice, payment);
                      save(updated);
                      setNewPaymentAmount("");
                      setNewPaymentReference("");
                    }}
                  >
                    {t(language, "invoices.recordPayment")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Attachments Section */}
          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">{t(language, "invoices.attachments")}</div>
            <p className="mt-1 text-sm text-zinc-500">{t(language, "invoices.attachmentsNote")}</p>

            {(invoice.attachments ?? []).length > 0 && (
              <div className="mt-4 space-y-2">
                {(invoice.attachments ?? []).map((attachment) => (
                  <div key={attachment.id} className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📎</span>
                      <div>
                        <div className="font-medium">{attachment.name}</div>
                        <div className="text-xs text-zinc-500">
                          {(attachment.size / 1024).toFixed(1)} KB • {new Date(attachment.createdAt).toLocaleDateString(locale)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {attachment.dataUrl && (
                        <a
                          href={attachment.dataUrl}
                          download={attachment.name}
                          className="text-blue-500 hover:text-blue-700 text-sm"
                        >
                          ⬇
                        </a>
                      )}
                      <button
                        type="button"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => {
                          const updated = removeAttachmentFromInvoice(invoice, attachment.id);
                          save(updated);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4">
              <Input
                type="file"
                multiple
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files) return;

                  const attachments: Attachment[] = [];
                  let remainingFiles = files.length;

                  Array.from(files).forEach((file) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = reader.result;
                      remainingFiles -= 1;
                      if (typeof dataUrl !== "string") {
                        if (remainingFiles === 0 && attachments.length > 0) {
                          save((prev) => ({
                            ...prev,
                            attachments: [...(prev.attachments ?? []), ...attachments],
                          }));
                        }
                        return;
                      }

                      const attachment: Attachment = {
                        id: crypto.randomUUID(),
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        dataUrl,
                        createdAt: new Date().toISOString(),
                      };
                      attachments.push(attachment);
                      if (remainingFiles === 0 && attachments.length > 0) {
                        save((prev) => ({
                          ...prev,
                          attachments: [...(prev.attachments ?? []), ...attachments],
                        }));
                      }
                    };
                    reader.onerror = () => {
                      remainingFiles -= 1;
                      if (remainingFiles === 0 && attachments.length > 0) {
                        save((prev) => ({
                          ...prev,
                          attachments: [...(prev.attachments ?? []), ...attachments],
                        }));
                      }
                    };
                    reader.readAsDataURL(file);
                  });

                  e.target.value = "";
                }}
              />
            </div>
          </div>
            </div>
          </details>
        </section>

        <section className="min-w-0 space-y-3 xl:sticky xl:top-6 xl:self-start">
          <div className="no-print text-sm font-semibold">{t(language, "invoice.previewTitle")}</div>

          <div ref={previewFrame} className="invoice-preview-frame overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 xl:max-h-[calc(100vh-7rem)]">
            <div id="invoice-preview" style={{ zoom: previewScale }} className="print-area invoice-paper mx-auto w-[210mm] min-h-[297mm] bg-white p-[12mm]">
              <InvoicePreview invoice={previewImmediate ? invoice : (deferredInvoice ?? invoice)} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        returnFocusSelector="#invoice-actions-trigger"
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteInvoice(adapter, invoice.id);
          window.location.assign("/invoices");
        }}
        title={t(language, "invoice.deleteTitle")}
        description={t(language, "invoice.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
    </main>
  );
}
