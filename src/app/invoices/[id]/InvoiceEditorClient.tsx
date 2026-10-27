"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { UnderlineTabs } from "@/components/platform/underline-tabs";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Disclosure } from "@/components/ui/Disclosure";
import { Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { KeyValueList, Page, PageHeader, StatusNote, initialsOf } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { Select } from "@/components/ui/Select";
import { DashedBadge, StatusPill } from "@/components/ui/Status";
import { Textarea } from "@/components/ui/Textarea";
import { InvoicePreview } from "@/components/templates/InvoicePreview";
import { EInvoicePanel } from "@/components/EInvoicePanel";
import { PrintStyles } from "@/components/PrintStyles";
import { usePageCrumb } from "@/components/shell/AppShell";
import { formatDay, invoiceStatus } from "@/components/invoiceStatus";
import type { Invoice, InvoiceLineItem } from "@/lib/domain";
import type { EInvoiceError } from "@/lib/einvoice";
import { waitForInvoicePrintReady } from "@/lib/printing";
import { buildPdfFilename } from "@/lib/filename";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { computeInvoiceBalance, computeInvoiceTotals } from "@/lib/calc";
import { usePersistedData } from "@/lib/storage/useStore";
import {
  createCreditNote,
  deleteInvoice,
  duplicateInvoiceById,
  togglePaid,
  updateInvoice,
  updateSettings,
  upsertInvoice,
} from "@/lib/storage/store";
import { errorTarget, fieldId, tabHash, type EditorTab } from "./fields";
import { ExtrasTab } from "./ExtrasTab";
import { LineItemsEditor } from "./LineItems";
import { PAYMENT_AMOUNT_ID, PaymentsTab } from "./PaymentsTab";

const TAB_ORDER: EditorTab[] = ["edit", "preview", "payments", "einvoice", "extras"];

function initialTab(): EditorTab {
  if (typeof window === "undefined") return "edit";
  const hash = window.location.hash.slice(1);
  return (Object.entries(tabHash).find(([, value]) => value === hash)?.[0] as EditorTab | undefined) ?? "edit";
}

/** Focus a control once its tab and group are rendered. */
function focusLater(id: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const element = document.getElementById(id);
    element?.focus();
    element?.scrollIntoView({ block: "center" });
  }));
}

/**
 * The invoice as one object (Platform `line-shell-frame` + Overwatch entity `PageHeader`): identity with status and
 * the main actions, then UnderlineTabs for the areas of the invoice. „Bearbeiten“ is one 880px form column with a
 * sticky section list and the running total; „Vorschau“ shows the single paper preview at readable size. Every
 * input is saved immediately (no save/discard buttons). The one preview stays in the DOM so the PDF print finds it.
 */
export function InvoiceEditorClient({ id }: { id: string }) {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
  const defaultCurrency = data?.settings.currency ?? "EUR";

  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfInFlight = useRef(false);
  const [pdfMessage, setPdfMessage] = useState("");
  const [pdfError, setPdfError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewImmediate, setPreviewImmediate] = useState(false);
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const [einvoiceErrors, setEinvoiceErrors] = useState<EInvoiceError[]>([]);
  const [senderOpen, setSenderOpen] = useState<boolean | null>(null);
  const previewFrame = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);

  const invoice = useMemo(() => data?.invoices.find((inv) => inv.id === id) ?? null, [data?.invoices, id]);
  const deferredInvoice = useDeferredValue(invoice);
  usePageCrumb(invoice ? invoice.invoiceNumber || (de ? "Ohne Nummer" : "No number") : null);

  useEffect(() => {
    const frame = previewFrame.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewScale(Math.min(1, Math.max(0.3, (entry.contentRect.width - 2) / (210 * 96 / 25.4))));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [invoice?.id]);

  const settings = data?.settings;
  const customers = data?.customers ?? [];
  const products = data?.products ?? [];
  const tags = data?.tags ?? [];
  const templateVariants = data?.templateVariants ?? [];
  const creditNotes = useMemo(() => (data?.creditNotes ?? []).filter((cn) => cn.linkedInvoiceId === id), [data?.creditNotes, id]);
  const balance = useMemo(() => (invoice ? computeInvoiceBalance(invoice, creditNotes) : null), [creditNotes, invoice]);

  const save = useCallback((next: Invoice | ((prev: Invoice) => Invoice)) => {
    if (!adapter) return;
    if (typeof next === "function") updateInvoice(adapter, id, next);
    else upsertInvoice(adapter, next);
  }, [adapter, id]);

  const clearErrors = useCallback((match: (field: string) => boolean) => {
    setEinvoiceErrors((previous) => (previous.some((error) => match(error.field)) ? previous.filter((error) => !match(error.field)) : previous));
  }, []);

  const updateLineItem = useCallback((lineItemId: string, updater: (item: InvoiceLineItem) => InvoiceLineItem) => {
    save((prev) => ({ ...prev, lineItems: prev.lineItems.map((item) => (item.id === lineItemId ? updater(item) : item)) }));
    clearErrors((field) => field.startsWith("lineItems"));
  }, [save, clearErrors]);

  const removeLineItem = useCallback((lineItemId: string) => {
    save((prev) => ({ ...prev, lineItems: prev.lineItems.filter((item) => item.id !== lineItemId) }));
    clearErrors((field) => field.startsWith("lineItems"));
  }, [save, clearErrors]);

  const moveLineItem = useCallback((lineItemId: string, offset: -1 | 1) => {
    save((prev) => {
      const index = prev.lineItems.findIndex((item) => item.id === lineItemId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= prev.lineItems.length) return prev;
      const lineItems = [...prev.lineItems];
      [lineItems[index], lineItems[target]] = [lineItems[target], lineItems[index]];
      return { ...prev, lineItems };
    });
    clearErrors((field) => field.startsWith("lineItems"));
  }, [save, clearErrors]);

  const selectTab = useCallback((next: EditorTab, focus?: string) => {
    setTab(next);
    window.history.replaceState(null, "", `#${tabHash[next]}`);
    if (focus) focusLater(focus);
  }, []);

  const jumpTo = useCallback((field: string) => {
    const target = errorTarget(field);
    if (target.sender) setSenderOpen(true);
    selectTab(target.tab, target.id);
  }, [selectTab]);

  const errorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const error of einvoiceErrors) if (error.field && !(error.field in map)) map[error.field] = error.message;
    return map;
  }, [einvoiceErrors]);

  if (!adapter) {
    return <p className="font-sans text-lg tracking-snug text-ink-muted">{t(language, "common.loading")}</p>;
  }

  if (!invoice || !balance) {
    return (
      <Page>
        <PageHeader title={t(language, "invoice.notFound")} description={de ? "Die Rechnung wurde gelöscht oder der Link ist veraltet." : "The invoice was deleted or the link is outdated."} />
        <div><Link href="/invoices" className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">{de ? "Zu allen Rechnungen" : "All invoices"}</Link></div>
      </Page>
    );
  }

  const currency = invoice.currency || defaultCurrency;
  const logoDataUrl = invoice.logoDataUrl || settings?.defaultLogoDataUrl;
  const isDefaultInvoice = (settings?.defaultInvoiceId ?? null) === invoice.id;
  const status = invoiceStatus(invoice, balance, language);
  const totals = computeInvoiceTotals(invoice);
  const title = `${invoice.texts.documentTitle || (de ? "Rechnung" : "Invoice")} ${invoice.invoiceNumber || (de ? "ohne Nummer" : "without number")}`;
  const editTabLabel = de ? "Bearbeiten" : "Edit";

  const editErrors = einvoiceErrors.filter((error) => error.field && errorTarget(error.field).tab === "edit");

  const onPrint = async () => {
    if (pdfInFlight.current) return;
    pdfInFlight.current = true;
    setPdfBusy(true);
    setPdfMessage("");
    setPdfError(false);
    setPreviewImmediate(true);
    const filename = buildPdfFilename(settings?.pdfFilenamePattern ?? "Rechnung-{invoiceNumber}.pdf", invoice);
    const api = window.electronAPI as typeof window.electronAPI & {
      saveDocument?: (payload: { filename: string; bytes: Uint8Array }) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
    };
    try {
      await waitForInvoicePrintReady();
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
      pdfInFlight.current = false;
      setPdfBusy(false);
      setPreviewImmediate(false);
    }
  };

  const handleSelectCustomer = (customerId: string) => {
    if (!customerId) { save({ ...invoice, customerId: undefined }); return; }
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    save({
      ...invoice,
      customerId,
      // Structured recipient details must not follow a different customer.
      einvoice: invoice.einvoice ? { ...invoice.einvoice, buyer: undefined, buyerReference: undefined } : undefined,
      recipient: { salutation: customer.salutation, name: customer.name, address: customer.address, contact: customer.contact },
    });
    clearErrors((field) => field === "buyer");
  };

  const handleCreateCreditNote = (type: "storno" | "gutschrift") => {
    const creditNote = createCreditNote(adapter, invoice.id, type);
    if (creditNote) window.location.assign(`/credit-notes/${creditNote.id}`);
  };

  const handleEmailInvoice = async () => {
    if (pdfInFlight.current) return;
    pdfInFlight.current = true;
    const customerEmail = invoice.customerId ? customers.find((c) => c.id === invoice.customerId)?.email : undefined;
    const to = customerEmail ?? "";
    const subjectText = `${invoice.texts.documentTitle} ${invoice.invoiceNumber}`.trim();
    const bodyText =
      `${de ? "Sehr geehrte Damen und Herren" : "Dear Sir or Madam"},\n\n` +
      `${de ? "anbei erhalten Sie" : "Please find attached"} ${invoice.texts.documentTitle} ${invoice.invoiceNumber}.\n\n` +
      `${de ? "Mit freundlichen Grüßen" : "Best regards"},\n${invoice.sender.name}`;
    const pattern = settings?.pdfFilenamePattern ?? "Invoice-{invoiceNumber}.pdf";
    const filename = buildPdfFilename(pattern, invoice);

    setPdfBusy(true);
    setPdfMessage("");
    setPdfError(false);
    setPreviewImmediate(true);
    try {
      await waitForInvoicePrintReady();
      // Desktop compose includes the checked, fully rendered PDF.
      if (window.electronAPI?.emailInvoiceWithPdf) {
        const result = await window.electronAPI.emailInvoiceWithPdf({ to, subject: subjectText, body: bodyText, filename });
        if (result?.ok) return;
        setPdfError(true);
        setPdfMessage(`${result?.error || "Die E-Mail mit PDF konnte nicht vorbereitet werden."} Der E-Mailentwurf wird ohne Anhang geöffnet. Bitte die PDF separat anhängen.`);
      }
      // Browser mailto cannot attach files.
      const subject = encodeURIComponent(subjectText);
      const body = encodeURIComponent(bodyText);
      window.location.href = to
        ? `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`
        : `mailto:?subject=${subject}&body=${body}`;
    } catch (error) {
      setPdfError(true);
      setPdfMessage(error instanceof Error ? error.message : "Die E-Mail mit PDF konnte nicht vorbereitet werden.");
    } finally {
      pdfInFlight.current = false;
      setPdfBusy(false);
      setPreviewImmediate(false);
    }
  };

  const tabs = [
    { value: "edit" as const, label: editTabLabel },
    { value: "preview" as const, label: de ? "Vorschau" : "Preview" },
    { value: "payments" as const, label: de ? "Zahlungen" : "Payments", count: (invoice.payments ?? []).length || undefined },
    { value: "einvoice" as const, label: de ? "E-Rechnung" : "E-invoice", count: einvoiceErrors.length ? (de ? `${einvoiceErrors.length} offen` : `${einvoiceErrors.length} open`) : undefined },
    { value: "extras" as const, label: de ? "Gestaltung und mehr" : "Layout and more" },
  ];

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TAB_ORDER.indexOf(tab);
    const next = event.key === "ArrowRight" ? TAB_ORDER[(index + 1) % TAB_ORDER.length]
      : event.key === "ArrowLeft" ? TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length]
        : event.key === "Home" ? TAB_ORDER[0]
          : event.key === "End" ? TAB_ORDER[TAB_ORDER.length - 1]
            : null;
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  };

  const sections = [
    ["rechnungsdaten", de ? "Rechnungsdaten" : "Invoice details"],
    ["empfaenger", invoice.texts.recipientHeading || (de ? "Empfänger" : "Recipient")],
    ["positionen", de ? "Positionen" : "Line items"],
    ["hinweise", invoice.texts.notesHeading || (de ? "Hinweistext" : "Notes")],
    ["absender", invoice.texts.senderHeading || (de ? "Absender" : "Sender")],
  ] as const;

  const description = [
    invoice.recipient.name || (de ? "Noch kein Empfänger" : "No recipient yet"),
    formatMoney(balance.effectiveTotal, currency, locale),
    invoice.dueDate ? `${de ? "fällig am" : "due"} ${formatDay(invoice.dueDate, locale)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Page className="gap-0">
      <PrintStyles />

      <PageHeader
        variant="entity"
        className="no-print"
        title={title}
        initials={initialsOf(invoice.recipient.name) || "R"}
        status={(
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            {isDefaultInvoice && <DashedBadge title={de ? "Vorlage für neue Rechnungen" : "Default for new invoices"}>{de ? "Standard" : "Default"}</DashedBadge>}
          </span>
        )}
        description={description}
        meta={[de ? "Jede Änderung wird sofort gespeichert." : "Every change is saved immediately."]}
        actions={(
          <>
            <Button variant="primary" loading={pdfBusy} onClick={onPrint}>{pdfBusy ? (de ? "PDF wird erstellt …" : "Creating PDF …") : (de ? "PDF speichern" : "Save PDF")}</Button>
            <Button onClick={() => selectTab("einvoice")}>{de ? "E-Rechnung" : "E-invoice"}</Button>
            <OverflowMenu
              label={de ? "Weitere Aktionen" : "More actions"}
              trigger={de ? "Weitere Aktionen" : "More actions"}
              items={[
                { label: t(language, "actions.email"), onSelect: () => { void handleEmailInvoice(); } },
                !balance.isFullyPaid && { label: t(language, "actions.addPayment"), onSelect: () => selectTab("payments", PAYMENT_AMOUNT_ID) },
                {
                  label: t(language, "actions.duplicate"),
                  onSelect: () => {
                    const dup = duplicateInvoiceById(adapter, invoice.id);
                    if (dup) window.location.assign(`/invoices/${dup.id}`);
                  },
                },
                !isDefaultInvoice && { label: t(language, "actions.setDefaultInvoice"), onSelect: () => updateSettings(adapter, (prev) => ({ ...prev, defaultInvoiceId: invoice.id })) },
                { kind: "separator" },
                { kind: "label", label: de ? "Korrektur erstellen" : "Create correction" },
                { label: t(language, "creditNotes.storno"), onSelect: () => handleCreateCreditNote("storno") },
                { label: t(language, "creditNotes.gutschrift"), onSelect: () => handleCreateCreditNote("gutschrift") },
                { kind: "separator" },
                { label: de ? "Rechnung löschen …" : "Delete invoice …", tone: "danger", onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </>
        )}
      />

      <div className="no-print mt-6 flex flex-col gap-3 empty:hidden">
        {pdfMessage && <StatusNote tone={pdfError ? "error" : "ok"} role={pdfError ? "alert" : "status"}>{pdfMessage}</StatusNote>}
        {creditNotes.length > 0 && (
          <StatusNote tone="attention" title={`${t(language, "invoice.linkedCreditNotes")} (${creditNotes.length})`}>
            <ul className="flex flex-col gap-0.5">
              {creditNotes.map((cn) => (
                <li key={cn.id}>
                  <Link href={`/credit-notes/${cn.id}`} className="underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    {cn.creditNoteNumber || (de ? "Ohne Nummer" : "No number")} · {t(language, `creditNotes.${cn.type}`)} · {formatMoney(cn.amount, currency, locale)}
                  </Link>
                </li>
              ))}
            </ul>
          </StatusNote>
        )}
      </div>

      <UnderlineTabs
        role="tablist"
        aria-label={de ? "Bereiche der Rechnung" : "Invoice areas"}
        size="lg"
        className="no-print mt-8"
        items={tabs}
        value={tab}
        renderItem={(item, content) => (
          <button
            type="button"
            role="tab"
            id={`tab-${item.value}`}
            aria-selected={item.value === tab}
            aria-controls={`panel-${item.value}`}
            tabIndex={item.value === tab ? 0 : -1}
            onClick={() => selectTab(item.value)}
            onKeyDown={onTabKey}
            className="rounded-sm pt-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 touch:pt-3"
          >
            {content}
          </button>
        )}
      />

      <div className="pt-8 lg:pt-10">
        {tab === "edit" && (
          <div role="tabpanel" id="panel-edit" aria-labelledby="tab-edit" className="no-print flex flex-col gap-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-12">
            <aside className="flex flex-col gap-6 max-lg:hidden lg:sticky lg:top-20">
              <nav aria-label={de ? "Abschnitte dieser Rechnung" : "Sections of this invoice"} className="flex flex-col gap-0.5">
                {sections.map(([anchor, label]) => (
                  <a
                    key={anchor}
                    href={`#${anchor}`}
                    onClick={() => { if (anchor === "absender") setSenderOpen(true); }}
                    className="inline-flex min-h-9 items-center rounded-md px-2.5 font-sans text-lg font-medium tracking-snug text-ink-muted outline-none transition-colors duration-100 hover:bg-surface-muted hover:text-ink-secondary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                  >
                    {label}
                  </a>
                ))}
              </nav>
              <div className="border-t border-line pt-4">
                <KeyValueList
                  items={[
                    { label: de ? "Netto" : "Net", value: formatMoney(totals.subtotal, currency, locale) },
                    { label: de ? "Steuer" : "Tax", value: formatMoney(totals.taxTotal, currency, locale) },
                    { label: invoice.texts.totalLabel || (de ? "Gesamt" : "Total"), value: formatMoney(totals.total, currency, locale), emphasis: true },
                  ]}
                />
              </div>
            </aside>

            <FormPage>
              {editErrors.length > 0 && (
                <StatusNote tone="attention" title={de ? "Für die E-Rechnung fehlen hier noch Angaben." : "The e-invoice still needs details here."}>
                  <ul className="mt-1 flex flex-col gap-1">
                    {editErrors.map((error, index) => (
                      <li key={index}>
                        <button type="button" onClick={() => jumpTo(error.field)} className="rounded-sm text-left underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{error.message}</button>
                      </li>
                    ))}
                  </ul>
                </StatusNote>
              )}

              <FormSection id="rechnungsdaten" title={de ? "Rechnungsdaten" : "Invoice details"} description={de ? "Nummer, Rechnungsdatum und Zahlungsziel." : "Number, invoice date and due date."} columns={3}>
                <Field label={invoice.texts.invoiceNumberLabel || "Rechnungsnummer"} id={fieldId("invoiceNumber")} error={errorMap.invoiceNumber}>
                  <Input value={invoice.invoiceNumber} onChange={(e) => { save({ ...invoice, invoiceNumber: e.target.value }); clearErrors((field) => field === "invoiceNumber"); }} />
                </Field>
                <Field label={invoice.texts.invoiceDateLabel || "Rechnungsdatum"} id={fieldId("invoiceDate")} error={errorMap.invoiceDate}>
                  <Input type="date" value={invoice.invoiceDate} onChange={(e) => { save({ ...invoice, invoiceDate: e.target.value }); clearErrors((field) => field === "invoiceDate"); }} />
                </Field>
                <Field label={invoice.texts.dueDateLabel || "Fällig am"} id={fieldId("dueDate")} error={errorMap.dueDate}>
                  <Input type="date" value={invoice.dueDate} onChange={(e) => { save({ ...invoice, dueDate: e.target.value }); clearErrors((field) => field === "dueDate"); }} />
                </Field>
              </FormSection>

              <FormSection id="empfaenger" title={invoice.texts.recipientHeading || (de ? "Empfänger" : "Recipient")} description={de ? "An wen die Rechnung geht. Aus der Kundenliste übernehmen oder direkt eintragen." : "Who receives the invoice. Fill from the customer list or type directly."}>
                {customers.length > 0 && (
                  <Field
                    label={de ? "Aus Kundenliste übernehmen" : "Fill from customer list"}
                    hint={de ? "Ersetzt Anrede, Name, Adresse und Kontakt durch die gespeicherten Kundendaten." : "Replaces salutation, name, address and contact with the saved customer details."}
                    className="sm:col-span-2"
                  >
                    <Select value={invoice.customerId || ""} onChange={(e) => handleSelectCustomer(e.target.value)}>
                      <option value="">{t(language, "actions.selectCustomer")} …</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Anrede">
                  <Input value={invoice.recipient.salutation || ""} placeholder="z. B. Sehr geehrte Damen und Herren" onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, salutation: e.target.value } })} />
                </Field>
                <Field label="Name" id={fieldId("recipient.name")} error={errorMap.buyer}>
                  <Input value={invoice.recipient.name} onChange={(e) => { save({ ...invoice, recipient: { ...invoice.recipient, name: e.target.value } }); clearErrors((field) => field === "buyer"); }} />
                </Field>
                <Field label="Adresse">
                  <Textarea rows={3} value={invoice.recipient.address} onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, address: e.target.value } })} />
                </Field>
                <Field label="Kontakt">
                  <Textarea rows={3} value={invoice.recipient.contact} onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, contact: e.target.value } })} />
                </Field>
              </FormSection>

              <FormSection id="positionen" title={de ? "Positionen" : "Line items"} description={de ? "Mengen und Preise mit Komma eingeben, z. B. 12,50. Überschriften gliedern längere Rechnungen." : "Enter quantities and prices with a comma or dot. Headings structure longer invoices."} columns={1}>
                <LineItemsEditor
                  invoice={invoice}
                  products={products}
                  defaultTaxRate={settings?.defaultTaxRate}
                  currency={currency}
                  locale={locale}
                  errors={errorMap}
                  save={save}
                  onUpdate={updateLineItem}
                  onRemove={removeLineItem}
                  onMove={moveLineItem}
                />
              </FormSection>

              <FormSection id="hinweise" title={invoice.texts.notesHeading || (de ? "Hinweistext" : "Notes")} description={de ? "Steht auf der Rechnung unter der Summe, z. B. Zahlungsbedingungen." : "Printed below the totals, e.g. payment terms."} columns={1}>
                <Textarea aria-label={invoice.texts.notesHeading || "Hinweise"} rows={3} value={invoice.notesText || ""} placeholder={de ? "z. B. Zahlbar innerhalb von 14 Tagen ohne Abzug." : "e.g. Payable within 14 days."} onChange={(e) => save({ ...invoice, notesText: e.target.value })} />
              </FormSection>

              <Disclosure
                id="absender"
                as="h2"
                title={invoice.texts.senderHeading || (de ? "Absender" : "Sender")}
                open={senderOpen ?? !invoice.sender.name}
                onOpenChange={setSenderOpen}
                status={invoice.sender.name
                  ? <span className="font-sans text-base font-normal tracking-snug text-ink-muted">{invoice.sender.name}</span>
                  : <StatusPill tone="attention">{de ? "Bitte ergänzen" : "Please complete"}</StatusPill>}
                summary={de ? "Ihre eigenen Angaben. Neue Rechnungen übernehmen sie aus den Einstellungen." : "Your own details. New invoices take them from the settings."}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" id={fieldId("sender.name")} error={errorMap.seller} className="sm:col-span-2">
                    <Input value={invoice.sender.name} onChange={(e) => { setSenderOpen(true); save({ ...invoice, sender: { ...invoice.sender, name: e.target.value } }); clearErrors((field) => field === "seller"); }} />
                  </Field>
                  <Field label="Adresse">
                    <Textarea rows={3} value={invoice.sender.address} onChange={(e) => save({ ...invoice, sender: { ...invoice.sender, address: e.target.value } })} />
                  </Field>
                  <Field label="Kontakt">
                    <Textarea rows={3} value={invoice.sender.contact} onChange={(e) => save({ ...invoice, sender: { ...invoice.sender, contact: e.target.value } })} />
                  </Field>
                </div>
              </Disclosure>
            </FormPage>
          </div>
        )}

        <div role="tabpanel" id="panel-preview" aria-labelledby="tab-preview" className={tab === "preview" ? "flex flex-col gap-4" : "screen-hidden"}>
          <p className="no-print max-w-[72ch] font-sans text-lg/6 tracking-snug text-ink-muted">
            {de ? "So wird die Rechnung als PDF gespeichert. Änderungen nehmen Sie im Tab „Bearbeiten“ vor." : "This is how the invoice is saved as PDF. Make changes in the Edit tab."}
          </p>
          <div ref={previewFrame} className="invoice-preview-frame overflow-auto rounded-card-sm border border-line bg-surface-muted p-4 sm:p-8">
            <div id="invoice-preview" style={{ zoom: previewScale }} className="print-area invoice-paper mx-auto w-[210mm] min-h-[297mm] bg-white p-[12mm]">
              <InvoicePreview invoice={previewImmediate ? invoice : (deferredInvoice ?? invoice)} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />
            </div>
          </div>
        </div>

        <div role="tabpanel" id="panel-payments" aria-labelledby="tab-payments" hidden={tab !== "payments"} className="no-print">
          <PaymentsTab
            key={invoice.id}
            invoice={invoice}
            balance={balance}
            status={status}
            creditNotes={creditNotes}
            currency={currency}
            locale={locale}
            language={language}
            save={save}
            onTogglePaid={() => togglePaid(adapter, invoice.id)}
            onCreateCreditNote={handleCreateCreditNote}
          />
        </div>

        <div role="tabpanel" id="panel-einvoice" aria-labelledby="tab-einvoice" hidden={tab !== "einvoice"} className="no-print">
          <EInvoicePanel
            key={invoice.id}
            invoice={{ ...invoice, logoDataUrl }}
            onChange={(einvoice) => save((previous) => ({ ...previous, einvoice }))}
            onSaveDefaults={(defaultEInvoice) => updateSettings(adapter, (previous) => ({ ...previous, defaultEInvoice }))}
            errors={einvoiceErrors}
            onErrors={(next) => setEinvoiceErrors((previous) => (previous.length === 0 && next.length === 0 ? previous : next))}
            onJump={jumpTo}
            fieldId={fieldId}
            editTabLabel={editTabLabel}
          />
        </div>

        {tab === "extras" && (
          <div role="tabpanel" id="panel-extras" aria-labelledby="tab-extras" className="no-print">
            <ExtrasTab
              invoice={invoice}
              templateVariants={templateVariants}
              tags={tags}
              language={language}
              locale={locale}
              errors={errorMap}
              save={(next) => { save(next); clearErrors((field) => field === "currency"); }}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
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
    </Page>
  );
}
