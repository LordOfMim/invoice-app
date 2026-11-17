"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { UnderlineTabs } from "@/components/platform/underline-tabs";
import { useDocumentMail } from "@/components/mail/useDocumentMail";
import { cn } from "@/components/platform/lib/cn";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Disclosure } from "@/components/ui/Disclosure";
import { Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { Page, PageHeader, StatusNote, initialsOf } from "@/components/ui/Layout";
import { OverflowMenu } from "@/components/ui/Menu";
import { Select } from "@/components/ui/Select";
import { DashedBadge, StatusPill } from "@/components/ui/Status";
import { Textarea } from "@/components/ui/Textarea";
import { InvoicePreview } from "@/components/templates/InvoicePreview";
import { EInvoicePanel } from "@/components/EInvoicePanel";
import { PrintStyles } from "@/components/PrintStyles";
import { usePageCrumb } from "@/components/shell/AppShell";
import { formatDay, invoiceStatus, quoteStatus } from "@/components/invoiceStatus";
import type { Invoice, InvoiceLineItem } from "@/lib/domain";
import type { EInvoiceError } from "@/lib/einvoice";
import { waitForInvoicePrintReady } from "@/lib/printing";
import { buildPdfFilename } from "@/lib/filename";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { computeInvoiceBalance } from "@/lib/calc";
import { todayLocalISO } from "@/lib/date";
import { declarationFromInvoice, lacksSellerDefaults, withSellerDefaults } from "@/lib/documents";
import { loadDeclarationDefaults } from "@/lib/declarationDefaults";
import { logoUrl } from "@/lib/storage/files";
import { usePersistedData } from "@/lib/storage/useStore";
import {
  addDeclaration,
  convertQuoteToInvoice,
  createCreditNote,
  deleteInvoice,
  deleteQuote,
  duplicateInvoiceById,
  duplicateQuoteById,
  togglePaid,
  updateInvoice,
  updateSettings,
  upsertCustomer,
  upsertInvoice,
} from "@/lib/storage/store";
import { PREVIEW_HASH, errorTarget, fieldId, tabHash, type EditorTab } from "./fields";
import { DocumentDetails } from "./DocumentDetails";
import { ExtrasTab } from "./ExtrasTab";
import { LineItemsEditor } from "./LineItems";
import { PAYMENT_AMOUNT_ID, PaymentsTab } from "./PaymentsTab";
import { switchReverseCharge } from "./reverseCharge";

const INVOICE_TABS: EditorTab[] = ["edit", "payments", "einvoice", "extras"];
/** Quotes are neither paid nor sent as E-Rechnung. */
const QUOTE_TABS: EditorTab[] = ["edit", "extras"];

/** Width of the workspace from which inputs and preview stand side by side (1280px Mac windows and wider). */
const SPLIT_MIN_WIDTH = 880;
/** A4 width in CSS pixels. */
const PAPER_WIDTH = (210 * 96) / 25.4;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5];
/** A tax number the sender typed into the footer or the sender block by hand is on the paper as well. */
const TAX_NUMBER_IN_TEXT = /steuer[-\s]?n(?:umme)?r|st\.?[-\s]?nr|ust\.?[-\s]?id|umsatzsteuer[-\s]?id|vat[-\s]?(?:id|no)/i;
const NOTE_LINK = "rounded-sm text-left underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

function initialTab(allowed: readonly EditorTab[]): EditorTab {
  if (typeof window === "undefined") return "edit";
  const hash = window.location.hash.slice(1);
  const found = Object.entries(tabHash).find(([, value]) => value === hash)?.[0] as EditorTab | undefined;
  return found && allowed.includes(found) ? found : "edit";
}

function initialNarrowView(): "form" | "preview" {
  return typeof window !== "undefined" && window.location.hash.slice(1) === PREVIEW_HASH ? "preview" : "form";
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
 * The invoice workspace (docs/design-reference.md, „Rechnungsarbeitsplatz“): identity with status and the main
 * actions on top, then inputs and the live paper preview side by side. The input column carries the areas of the
 * invoice as UnderlineTabs (Bearbeiten · Zahlungen · E-Rechnung · Gestaltung und mehr); the preview column sticks
 * below the top bar, scrolls by itself and has fit/zoom controls. When the workspace is narrower than
 * SPLIT_MIN_WIDTH, an Eingaben/Vorschau switch shows one of the two columns over the same document. Every input is
 * saved immediately (no save/discard buttons). There is exactly one preview in the DOM; the PDF print uses it.
 *
 * Quotes (`kind="quote"`) are the same document in their own collection: the same editor without payments,
 * E-Rechnung and corrections, plus the step that turns the quote into an invoice.
 */
export function InvoiceEditorClient({ id, kind = "invoice" }: { id: string; kind?: "invoice" | "quote" }) {
  const isQuote = kind === "quote";
  const collection = isQuote ? "quotes" : "invoices";
  const basePath = isQuote ? "/quotes" : "/invoices";
  const TAB_ORDER = isQuote ? QUOTE_TABS : INVOICE_TABS;
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const de = language === "de";
  const locale = de ? "de-DE" : "en-US";
  const defaultCurrency = data?.settings.currency ?? "EUR";

  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfInFlight = useRef(false);
  const documentMail = useDocumentMail(({ warning, to }) => {
    setPdfError(false);
    setPdfMessage(warning || `Die E-Mail an ${to} wurde gesendet.`);
  });
  const [pdfMessage, setPdfMessage] = useState("");
  const [pdfError, setPdfError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewImmediate, setPreviewImmediate] = useState(false);
  const [tab, setTab] = useState<EditorTab>(() => initialTab(isQuote ? QUOTE_TABS : INVOICE_TABS));
  const [einvoiceErrors, setEinvoiceErrors] = useState<EInvoiceError[]>([]);
  const [senderOpen, setSenderOpen] = useState<boolean | null>(null);
  const previewFrame = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const narrowSwitch = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [split, setSplit] = useState(true);
  const [narrowView, setNarrowView] = useState<"form" | "preview">(initialNarrowView);

  const documents = data?.[collection];
  const invoice = useMemo(() => documents?.find((inv) => inv.id === id) ?? null, [documents, id]);
  const deferredInvoice = useDeferredValue(invoice);
  usePageCrumb(invoice ? invoice.invoiceNumber || (de ? "Ohne Nummer" : "No number") : null);

  // Measure the committed pane before painting, including when a hidden pane
  // becomes visible. clientWidth excludes its scrollbar; remove padding too.
  useLayoutEffect(() => {
    const frame = previewFrame.current;
    if (!frame) return;
    const style = getComputedStyle(frame);
    const width = frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (width > 2) setFitScale(Math.min(1, (width - 2) / PAPER_WIDTH));
  }, [invoice?.id, split, narrowView]);

  // One observer on the real preview container: the fit scale follows its width (never per keystroke).
  useEffect(() => {
    const frame = previewFrame.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 2) setFitScale(Math.min(1, (entry.contentRect.width - 2) / PAPER_WIDTH));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [invoice?.id]);

  // Resolve the initial layout before painting, then observe later resizes.
  // Only classes change; no inputs or preview remount.
  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const updateLayout = (width: number) => {
      const nextSplit = width >= SPLIT_MIN_WIDTH;
      // A resize must never hide the field the user is editing or move its focus.
      if (!nextSplit) {
        if (element.querySelector("#invoice-inputs")?.contains(document.activeElement)) setNarrowView("form");
        else if (element.querySelector("#invoice-live-preview")?.contains(document.activeElement)) setNarrowView("preview");
      } else if (narrowSwitch.current?.contains(document.activeElement)) {
        // The narrow-only switch disappears on expansion. Keep keyboard focus
        // in the pane named by that control, without scrolling or touching drafts.
        const preview = document.activeElement?.getAttribute("aria-controls") === "invoice-live-preview";
        requestAnimationFrame(() => {
          const target = preview
            ? previewFrame.current
            : element.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
          target?.focus({ preventScroll: true });
        });
      }
      setSplit(nextSplit);
    };
    updateLayout(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => updateLayout(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [invoice?.id]);

  const settings = data?.settings;
  const customers = data?.customers ?? [];
  const products = data?.products ?? [];
  const tags = data?.tags ?? [];
  const templateVariants = data?.templateVariants ?? [];
  const creditNotes = useMemo(() => (isQuote ? [] : (data?.creditNotes ?? []).filter((cn) => cn.linkedInvoiceId === id)), [data?.creditNotes, id, isQuote]);
  const allInvoices = data?.invoices;
  const allQuotes = data?.quotes;
  // The customer's most recent other document offers its positions for reuse.
  const previousDocument = useMemo(() => {
    if (!invoice) return undefined;
    const name = invoice.recipient.name.trim().toLocaleLowerCase("de-DE");
    if (!invoice.customerId && !name) return undefined;
    const sameCustomer = (other: Invoice) => other.id !== invoice.id && other.lineItems.some((item) => item.type === "item" && item.description.trim())
      && (invoice.customerId ? other.customerId === invoice.customerId : other.recipient.name.trim().toLocaleLowerCase("de-DE") === name);
    const pool = [...(allInvoices ?? []), ...(isQuote ? allQuotes ?? [] : [])].filter(sameCustomer);
    return pool.sort((a, b) => `${b.invoiceDate}|${b.createdAt}`.localeCompare(`${a.invoiceDate}|${a.createdAt}`))[0];
    // Only identity and customer decide; typing into this document must not re-sort the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allInvoices, allQuotes, isQuote, invoice?.id, invoice?.customerId, invoice?.recipient.name]);
  const balance = useMemo(() => (invoice ? computeInvoiceBalance(invoice, creditNotes) : null), [creditNotes, invoice]);

  const save = useCallback((next: Invoice | ((prev: Invoice) => Invoice)) => {
    if (!adapter) return;
    if (typeof next === "function") updateInvoice(adapter, id, next, collection);
    else upsertInvoice(adapter, next, collection);
  }, [adapter, id, collection]);

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
    setNarrowView("form");
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
        <PageHeader title={isQuote ? "Angebot nicht gefunden" : t(language, "invoice.notFound")} description={isQuote ? "Das Angebot wurde gelöscht oder der Link ist veraltet." : de ? "Die Rechnung wurde gelöscht oder der Link ist veraltet." : "The invoice was deleted or the link is outdated."} />
        <div><Link href={basePath} className="font-sans text-lg font-medium tracking-snug text-link underline-offset-3 hover:underline">{isQuote ? "Zu allen Angeboten" : de ? "Zu allen Rechnungen" : "All invoices"}</Link></div>
      </Page>
    );
  }

  const currency = invoice.currency || defaultCurrency;
  // The logo as a data URL for the preview, the PDF and the e-invoice, whether it is a stored file or older data.
  const logoDataUrl = logoUrl(invoice, settings);
  const logoMissing = invoice.layout.showLogo && !logoDataUrl && !!(invoice.logoFile ?? settings?.defaultLogoFile);
  const isDefaultInvoice = !isQuote && (settings?.defaultInvoiceId ?? null) === invoice.id;
  const status = isQuote ? quoteStatus(invoice, todayLocalISO(), language) : invoiceStatus(invoice, balance, language);
  const convertedInvoice = isQuote && invoice.convertedInvoiceId ? allInvoices?.find((inv) => inv.id === invoice.convertedInvoiceId) : undefined;
  const sourceQuote = !isQuote && invoice.sourceQuoteId ? allQuotes?.find((quote) => quote.id === invoice.sourceQuoteId) : undefined;
  const pdfPattern = isQuote ? "Angebot-{invoiceNumber}.pdf" : settings?.pdfFilenamePattern ?? "Rechnung-{invoiceNumber}.pdf";
  const previewScale = zoom === "fit" ? fitScale : zoom;
  const zoomIn = () => setZoom(ZOOM_STEPS.find((step) => step > previewScale + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  const zoomOut = () => setZoom([...ZOOM_STEPS].reverse().find((step) => step < previewScale - 0.001) ?? ZOOM_STEPS[0]);
  const showNarrow = (view: "form" | "preview") => {
    setNarrowView(view);
    window.history.replaceState(null, "", `#${view === "preview" ? PREVIEW_HASH : tabHash[tab]}`);
  };
  const title = `${invoice.texts.documentTitle || (isQuote ? "Angebot" : de ? "Rechnung" : "Invoice")} ${invoice.invoiceNumber || (de ? "ohne Nummer" : "without number")}`;
  const editTabLabel = de ? "Bearbeiten" : "Edit";

  /** A reminder needs an issued invoice that is past its due date with something left to pay (as in the invoice list). */
  const canRemind = !isQuote && !!invoice.invoiceNumber.trim() && balance.isOverdue && balance.remainingAmount > 0;
  /** Declarations written for this invoice, newest first. */
  const declarations = isQuote ? [] : (data?.contractorDeclarations ?? [])
    .filter((declaration) => declaration.invoiceId === invoice.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const newestDeclaration = declarations[0];

  // Reverse charge (§ 13b): never switched off silently. When the chosen customer is not marked for it, a note offers the way back.
  const selectedCustomer = invoice.customerId ? customers.find((customer) => customer.id === invoice.customerId) : undefined;
  const reverseChargeMismatch = invoice.reverseCharge === true && !!selectedCustomer && !selectedCustomer.reverseCharge;
  const setReverseCharge = (enabled: boolean) => save((prev) => switchReverseCharge(prev, enabled, settings?.defaultTaxRate, products));

  // Mandatory details of an invoice (§ 14 UStG). They live where the E-Rechnung check reads them (`prepareEInvoice`):
  // tax number and VAT ID in `einvoice.seller`, the service date in `einvoice.serviceDate`. A hint only; nothing is blocked.
  const hasStarted = !!invoice.recipient.name.trim() || invoice.lineItems.some((item) => (item.type ?? "item") === "item" && item.unitPrice !== 0);
  const taxNumberInSettings = !!settings?.defaultEInvoice?.seller?.taxId?.trim() || !!settings?.defaultEInvoice?.seller?.vatId?.trim();
  const hasTaxNumber = !!invoice.einvoice?.seller?.taxId?.trim() || !!invoice.einvoice?.seller?.vatId?.trim()
    || TAX_NUMBER_IN_TEXT.test([invoice.footerText, invoice.footerLeftText, invoice.footerRightText, invoice.sender.address, invoice.sender.contact].join(" "));
  const openSender = (field: "name" | "address") => { setSenderOpen(true); selectTab("edit", fieldId(`sender.${field}`)); };
  const missingDetails = isQuote || !hasStarted ? [] : [
    !invoice.invoiceNumber.trim() && { key: "number", label: "Rechnungsnummer", onJump: () => selectTab("edit", fieldId("invoiceNumber")) },
    !invoice.einvoice?.serviceDate && { key: "serviceDate", label: "Leistungsdatum oder Leistungszeitraum", onJump: () => selectTab("edit", fieldId("einvoice.serviceDate.edit")) },
    (!invoice.recipient.name.trim() || !invoice.recipient.address.trim()) && { key: "recipient", label: "Name und Anschrift des Empfängers", onJump: () => selectTab("edit", fieldId(invoice.recipient.name.trim() ? "recipient.address" : "recipient.name")) },
    (!invoice.sender.name.trim() || !invoice.sender.address.trim()) && { key: "sender", label: "Name und Anschrift des Absenders", onJump: () => openSender(invoice.sender.name.trim() ? "address" : "name") },
    !hasTaxNumber && { key: "tax", label: "Steuernummer oder USt-IdNr. des Absenders (§ 14 UStG)", onJump: undefined },
  ].filter((entry): entry is { key: string; label: string; onJump: (() => void) | undefined } => !!entry);
  const taxNumberMissing = missingDetails.some((entry) => entry.key === "tax");

  const editErrors = einvoiceErrors.filter((error) => error.field && errorTarget(error.field).tab === "edit");

  const onPrint = async () => {
    if (pdfInFlight.current) return;
    pdfInFlight.current = true;
    setPdfBusy(true);
    setPdfMessage("");
    setPdfError(false);
    setPreviewImmediate(true);
    const filename = buildPdfFilename(pdfPattern, invoice);
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
    const taxId = customer.taxId?.replace(/\s+/g, "").toUpperCase() ?? "";
    const customerVatId = /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(taxId) ? taxId : undefined;
    const next: Invoice = {
      ...invoice,
      customerId,
      // Structured recipient details must not follow a different customer.
      // The customer's VAT ID comes along: the E-Rechnung needs it for reverse charge.
      einvoice: invoice.einvoice || customerVatId
        ? { ...(invoice.einvoice ?? {}), buyer: customerVatId ? { vatId: customerVatId } : undefined, buyerReference: undefined }
        : undefined,
      recipient: { salutation: customer.salutation, name: customer.name, address: customer.address, contact: customer.contact },
    };
    // A customer marked for § 13b switches the document to reverse charge; it is never switched off silently.
    // Choosing a customer without the mark afterwards keeps it on and shows the note above the workspace instead.
    save(customer.reverseCharge && !invoice.reverseCharge ? switchReverseCharge(next, true, settings?.defaultTaxRate, products) : next);
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
    const filename = buildPdfFilename(pdfPattern, invoice);

    setPdfBusy(true);
    setPdfMessage("");
    setPdfError(false);
    setPreviewImmediate(true);
    try {
      await waitForInvoicePrintReady();
      // This is explicitly the ordinary PDF; validated E-invoice attachments
      // are prepared separately from the E-Rechnung area.
      if (documentMail.available) {
        await documentMail.composeWithPrint({ to, subject: subjectText, text: bodyText }, filename);
        return;
      }
      if (!window.electronAPI?.emailInvoiceWithPdf) {
        throw new Error("Ein E-Mailentwurf mit normaler PDF ist in der installierten Desktop-App verfügbar.");
      }
      const result = await window.electronAPI.emailInvoiceWithPdf({ to, subject: subjectText, body: bodyText, filename });
      if (!result?.ok) throw new Error(result?.error || "Der E-Mailentwurf mit normaler PDF konnte nicht vorbereitet werden.");
      setPdfMessage("E-Mailentwurf mit normaler PDF vorbereitet. Bitte im E-Mailprogramm prüfen und selbst senden.");
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
    { value: "payments" as const, label: de ? "Zahlungen" : "Payments", count: (invoice.payments ?? []).length || undefined },
    { value: "einvoice" as const, label: de ? "E-Rechnung" : "E-invoice", count: einvoiceErrors.length ? (de ? `${einvoiceErrors.length} offen` : `${einvoiceErrors.length} open`) : undefined },
    { value: "extras" as const, label: de ? "Gestaltung und mehr" : "Layout and more" },
  ].filter((item) => TAB_ORDER.includes(item.value));

  const handleConvert = () => {
    const created = convertQuoteToInvoice(adapter, invoice.id);
    if (created) window.location.assign(`/invoices/${created.id}`);
  };

  const handleCreateDeclaration = () => {
    const declaration = addDeclaration(adapter, declarationFromInvoice(invoice, loadDeclarationDefaults(adapter)));
    window.location.assign(`/fachunternehmer/${declaration.id}`);
  };

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
    ["rechnungsdaten", isQuote ? "Angebotsdaten" : de ? "Rechnungsdaten" : "Invoice details"],
    ["empfaenger", invoice.texts.recipientHeading || (de ? "Empfänger" : "Recipient")],
    ["positionen", de ? "Positionen" : "Line items"],
    ["hinweise", invoice.texts.notesHeading || (de ? "Hinweistext" : "Notes")],
    ["absender", invoice.texts.senderHeading || (de ? "Absender" : "Sender")],
  ] as const;

  const description = [
    invoice.recipient.name || (de ? "Noch kein Empfänger" : "No recipient yet"),
    formatMoney(balance.effectiveTotal, currency, locale),
    invoice.projectReference?.trim() || null,
    invoice.dueDate ? `${isQuote ? "gültig bis" : de ? "fällig am" : "due"} ${formatDay(invoice.dueDate, locale)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Page className="invoice-editor gap-0">
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
        meta={[de ? "Änderungen werden automatisch lokal gespeichert." : "Changes are saved locally automatically."]}
        actions={(
          <>
            <Button variant="primary" loading={pdfBusy} onClick={onPrint}>{pdfBusy ? (de ? "PDF wird erstellt …" : "Creating PDF …") : (de ? "PDF speichern" : "Save PDF")}</Button>
            {isQuote
              ? <Button onClick={handleConvert}>{convertedInvoice ? "Rechnung öffnen" : "In Rechnung umwandeln"}</Button>
              : <Button onClick={() => selectTab("einvoice")}>{de ? "E-Rechnung" : "E-invoice"}</Button>}
            <OverflowMenu
              label={de ? "Weitere Aktionen" : "More actions"}
              trigger={de ? "Weitere Aktionen" : "More actions"}
              items={isQuote ? [
                { label: documentMail.available ? "PDF per E-Mail senden" : "PDF per E-Mail vorbereiten", onSelect: () => { void handleEmailInvoice(); } },
                {
                  label: t(language, "actions.duplicate"),
                  onSelect: () => {
                    const dup = duplicateQuoteById(adapter, invoice.id);
                    if (dup) window.location.assign(`/quotes/${dup.id}`);
                  },
                },
                !convertedInvoice && { kind: "separator" },
                !convertedInvoice && { kind: "label", label: "Antwort des Kunden" },
                !convertedInvoice && invoice.quoteStatus !== "accepted" && { label: "Als angenommen markieren", onSelect: () => save({ ...invoice, quoteStatus: "accepted" }) },
                !convertedInvoice && invoice.quoteStatus !== "declined" && { label: "Als abgelehnt markieren", onSelect: () => save({ ...invoice, quoteStatus: "declined" }) },
                !convertedInvoice && (invoice.quoteStatus === "accepted" || invoice.quoteStatus === "declined") && { label: "Wieder als offen markieren", onSelect: () => save({ ...invoice, quoteStatus: "open" }) },
                { kind: "separator" },
                { label: "Angebot löschen …", tone: "danger", onSelect: () => setConfirmDelete(true) },
              ] : [
                { label: documentMail.available ? (de ? "Normale PDF per E-Mail senden" : "Send ordinary PDF by email") : de ? "Normale PDF per E-Mail vorbereiten" : "Prepare email with ordinary PDF", onSelect: () => { void handleEmailInvoice(); } },
                !balance.isFullyPaid && { label: t(language, "actions.addPayment"), onSelect: () => selectTab("payments", PAYMENT_AMOUNT_ID) },
                canRemind && { kind: "link", label: "Zahlungserinnerung schreiben", href: `/invoices/${invoice.id}/reminder` },
                {
                  label: t(language, "actions.duplicate"),
                  onSelect: () => {
                    const dup = duplicateInvoiceById(adapter, invoice.id);
                    if (dup) window.location.assign(`/invoices/${dup.id}`);
                  },
                },
                !isDefaultInvoice && { label: t(language, "actions.setDefaultInvoice"), onSelect: () => updateSettings(adapter, (prev) => ({ ...prev, defaultInvoiceId: invoice.id })) },
                newestDeclaration
                  ? { kind: "link", label: "Fachunternehmererklärung öffnen", href: `/fachunternehmer/${newestDeclaration.id}` }
                  : { label: "Fachunternehmererklärung erstellen", onSelect: handleCreateDeclaration },
                !!newestDeclaration && { label: "Weitere Erklärung erstellen", onSelect: handleCreateDeclaration },
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

      <div className="no-print mt-4 flex flex-col gap-3 empty:hidden">
        {pdfMessage && <StatusNote tone={pdfError ? "error" : "ok"} role={pdfError ? "alert" : "status"}>{pdfMessage}</StatusNote>}
        {logoMissing && (
          <StatusNote tone="attention" title={de ? "Die Logo-Datei ist nicht mehr vorhanden." : "The logo file is no longer available."}>
            {de ? "Das Dokument wird ohne Logo gedruckt. Bitte das Logo neu wählen oder eine Sicherung mit Anhängen wiederherstellen." : "The document prints without a logo. Choose the logo again or restore a backup with attachments."}
          </StatusNote>
        )}
        {convertedInvoice && (
          <StatusNote tone="ok" title="Aus diesem Angebot ist eine Rechnung entstanden.">
            <Link href={`/invoices/${convertedInvoice.id}`} className="underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              Rechnung {convertedInvoice.invoiceNumber || "ohne Nummer"} öffnen
            </Link>
          </StatusNote>
        )}
        {sourceQuote && (
          <StatusNote tone="info">
            Erstellt aus{" "}
            <Link href={`/quotes/${sourceQuote.id}`} className="underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              Angebot {sourceQuote.invoiceNumber || "ohne Nummer"}
            </Link>
            .
          </StatusNote>
        )}
        {declarations.length > 0 && (
          <StatusNote tone="info" title={declarations.length === 1 ? "Fachunternehmererklärung zu dieser Rechnung" : `Fachunternehmererklärungen zu dieser Rechnung (${declarations.length})`}>
            <ul className="flex flex-col gap-0.5">
              {declarations.map((declaration) => (
                <li key={declaration.id}>
                  <Link href={`/fachunternehmer/${declaration.id}`} className="underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    {declaration.kommission || "Ohne Bauvorhaben"} · {formatDay(declaration.date, locale)}
                  </Link>
                </li>
              ))}
            </ul>
          </StatusNote>
        )}
        {reverseChargeMismatch && selectedCustomer && (
          <StatusNote
            tone="attention"
            title={`${isQuote ? "Dieses Angebot wird ohne Umsatzsteuer erstellt" : "Diese Rechnung wird ohne Umsatzsteuer gestellt"} (§ 13b UStG), der gewählte Kunde ist dafür nicht vorgemerkt.`}
            action={<>
              <Button size="sm" onClick={() => setReverseCharge(false)}>Umsatzsteuer wieder berechnen</Button>
              <Button size="sm" variant="ghost" onClick={() => upsertCustomer(adapter, { ...selectedCustomer, reverseCharge: true })}>Kunde für § 13b vormerken</Button>
            </>}
          >
            „Umsatzsteuer wieder berechnen“ setzt die Positionen auf ihre vorherigen Steuersätze zurück und entfernt den Hinweis auf § 13b. Trifft § 13b bei {selectedCustomer.name || "diesem Kunden"} zu, merken Sie den Kunden dafür vor.
          </StatusNote>
        )}
        {missingDetails.length > 0 && (
          <StatusNote
            tone="attention"
            title="Für eine vollständige Rechnung fehlt noch:"
            action={taxNumberMissing && taxNumberInSettings ? <Button size="sm" onClick={() => save((prev) => withSellerDefaults(prev, settings))}>Steuernummer aus den Einstellungen übernehmen</Button> : undefined}
          >
            <ul className="mt-1 flex flex-col gap-1">
              {missingDetails.map((entry) => (
                <li key={entry.key}>
                  {entry.onJump
                    ? <button type="button" onClick={entry.onJump} className={NOTE_LINK}>{entry.label}</button>
                    : <>
                      {entry.label}
                      {!taxNumberInSettings && <>: einmal in den <Link href="/settings" className={NOTE_LINK}>Einstellungen unter „Steuer und Bankverbindung“</Link> eintragen oder nur für diese Rechnung im Bereich <button type="button" onClick={() => selectTab("einvoice")} className={NOTE_LINK}>E-Rechnung</button> unter „Ihre Angaben als Rechnungssteller“.</>}
                    </>}
                </li>
              ))}
            </ul>
            <p className="mt-2">Ein Klick auf eine Angabe führt zum passenden Feld. Speichern und PDF sind weiterhin möglich.{missingDetails.some((entry) => entry.key === "serviceDate") ? " Steht der Leistungszeitraum bereits im Text der Rechnung, ist das Leistungsdatum nicht zusätzlich nötig." : ""}</p>
          </StatusNote>
        )}
        {!isQuote && invoice.layout.showFooter && lacksSellerDefaults(invoice, settings) && !(taxNumberMissing && taxNumberInSettings) && (
          <StatusNote
            tone="info"
            title="Steuernummer oder Bankverbindung aus den Einstellungen fehlen auf dieser Rechnung."
            action={<Button size="sm" onClick={() => save((prev) => withSellerDefaults(prev, settings))}>Aus den Einstellungen übernehmen</Button>}
          >
            Sie werden in der Fußzeile gedruckt und für die E-Rechnung verwendet.
          </StatusNote>
        )}
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

      <div className="no-print mt-5 mb-4 flex flex-wrap items-center justify-between gap-3">
        {!split && (
          <div ref={narrowSwitch} role="group" aria-label={de ? "Ansicht des Rechnungsarbeitsplatzes" : "Invoice workspace view"} className="inline-flex gap-0.5 rounded-md bg-surface-muted p-0.5">
            {(["form", "preview"] as const).map((view) => (
              <button key={view} type="button" aria-pressed={narrowView === view} aria-controls={view === "form" ? "invoice-inputs" : "invoice-live-preview"} onClick={() => showNarrow(view)} className={cn("min-h-9 rounded-sm px-4 font-sans text-lg font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50", narrowView === view ? "bg-surface shadow-low" : "text-ink-body hover:text-ink")}>
                {view === "form" ? (de ? "Eingaben" : "Inputs") : (de ? "Vorschau" : "Preview")}
              </button>
            ))}
          </div>
        )}
        {/* The split workspace already shows the preview, so the hint only accompanies the toggle. */}
        {!split && <span className="font-sans text-base tracking-snug text-ink-body">{de ? "Änderungen erscheinen direkt in der Vorschau." : "Changes appear directly in the preview."}</span>}
      </div>

      <div ref={workspace} className={cn("invoice-workspace grid min-w-0 items-start gap-6", split && "grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]")}>
        <div id="invoice-inputs" className={cn("invoice-input-pane no-print min-w-0", !split && narrowView !== "form" && "screen-hidden")}>
          <UnderlineTabs
            role="tablist"
            aria-label={isQuote ? "Bereiche des Angebots" : de ? "Bereiche der Rechnung" : "Invoice areas"}
            size="lg"
            className="gap-x-4"
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
                className="min-h-10 rounded-sm pt-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 touch:pt-3"
              >
                {content}
              </button>
            )}
          />

          <div className="pt-6">
            <div role="tabpanel" id="panel-edit" aria-labelledby="tab-edit" hidden={tab !== "edit"}>
              <nav aria-label={isQuote ? "Abschnitte dieses Angebots" : de ? "Abschnitte dieser Rechnung" : "Sections of this invoice"} className="mb-6 flex flex-wrap gap-x-4 gap-y-2 border-b border-line pb-4">
                {sections.map(([anchor, label]) => (
                  <a key={anchor} href={`#${anchor}`} onClick={() => { if (anchor === "absender") setSenderOpen(true); }} className="inline-flex min-h-10 items-center rounded-sm font-sans text-lg font-medium tracking-snug text-ink-body underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
                    {label}
                  </a>
                ))}
              </nav>
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

                <DocumentDetails
                  invoice={invoice}
                  kind={kind}
                  documents={documents ?? []}
                  invoices={allInvoices ?? []}
                  creditNotes={data?.creditNotes ?? []}
                  settings={settings}
                  currency={currency}
                  locale={locale}
                  de={de}
                  errors={errorMap}
                  save={save}
                  onReverseCharge={setReverseCharge}
                  clearErrors={clearErrors}
                />

                <FormSection id="empfaenger" title={invoice.texts.recipientHeading || (de ? "Empfänger" : "Recipient")} description={isQuote ? "An wen das Angebot geht. Aus der Kundenliste übernehmen oder direkt eintragen." : de ? "An wen die Rechnung geht. Aus der Kundenliste übernehmen oder direkt eintragen." : "Who receives the invoice. Fill from the customer list or type directly."}>
                  {customers.length > 0 && (
                    <Field
                      label={de ? "Aus Kundenliste übernehmen" : "Fill from customer list"}
                      hint={de ? "Ersetzt Anrede, Name, Adresse und Kontakt durch die gespeicherten Kundendaten." : "Replaces salutation, name, address and contact with the saved customer details."}
                      className="@md:col-span-2"
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
                  <Field label="Adresse" id={fieldId("recipient.address")}>
                    <Textarea rows={3} value={invoice.recipient.address} onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, address: e.target.value } })} />
                  </Field>
                  <Field label="Kontakt">
                    <Textarea rows={3} value={invoice.recipient.contact} onChange={(e) => save({ ...invoice, recipient: { ...invoice.recipient, contact: e.target.value } })} />
                  </Field>
                </FormSection>

                <FormSection id="positionen" title={de ? "Positionen" : "Line items"} description={de ? `Mengen und Preise mit Komma eingeben, z. B. 12,50. Überschriften gliedern längere ${isQuote ? "Angebote" : "Rechnungen"}.` : "Enter quantities and prices with a comma or dot. Headings structure longer invoices."} columns={1}>
                  <LineItemsEditor
                    invoice={invoice}
                    products={products}
                    defaultTaxRate={settings?.defaultTaxRate}
                    previous={previousDocument}
                    currency={currency}
                    locale={locale}
                    errors={errorMap}
                    save={save}
                    onUpdate={updateLineItem}
                    onRemove={removeLineItem}
                    onMove={moveLineItem}
                  />
                </FormSection>

                <FormSection id="hinweise" title={invoice.texts.notesHeading || (de ? "Hinweistext" : "Notes")} description={isQuote ? "Steht auf dem Angebot unter der Summe, z. B. Ausführungszeitraum oder Zahlungsbedingungen." : de ? "Steht auf der Rechnung unter der Summe, z. B. Zahlungsbedingungen." : "Printed below the totals, e.g. payment terms."} columns={1}>
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
                  className="@container"
                  summary={de ? `Ihre eigenen Angaben. Neue ${isQuote ? "Angebote" : "Rechnungen"} übernehmen sie aus den Einstellungen.` : "Your own details. New invoices take them from the settings."}
                >
                  <div className="grid gap-4 @md:grid-cols-2">
                    <Field label="Name" id={fieldId("sender.name")} error={errorMap.seller} className="@md:col-span-2">
                      <Input value={invoice.sender.name} onChange={(e) => { setSenderOpen(true); save({ ...invoice, sender: { ...invoice.sender, name: e.target.value } }); clearErrors((field) => field === "seller"); }} />
                    </Field>
                    <Field label="Adresse" id={fieldId("sender.address")}>
                      <Textarea rows={3} value={invoice.sender.address} onChange={(e) => save({ ...invoice, sender: { ...invoice.sender, address: e.target.value } })} />
                    </Field>
                    <Field label="Kontakt">
                      <Textarea rows={3} value={invoice.sender.contact} onChange={(e) => save({ ...invoice, sender: { ...invoice.sender, contact: e.target.value } })} />
                    </Field>
                  </div>
                </Disclosure>
              </FormPage>
            </div>

            {!isQuote && <>
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
                canRemind={canRemind}
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
                onSaveDefaults={(defaultEInvoice) => updateSettings(adapter, (previous) => ({
                  ...previous,
                  // Reverse charge belongs to this invoice (or its customer), never to every new invoice.
                  defaultEInvoice: invoice.reverseCharge ? { ...defaultEInvoice, taxCategory: undefined, taxExemptionReason: undefined } : defaultEInvoice,
                }))}
                errors={einvoiceErrors}
                onErrors={(next) => setEinvoiceErrors((previous) => (previous.length === 0 && next.length === 0 ? previous : next))}
                onJump={jumpTo}
                fieldId={fieldId}
                editTabLabel={editTabLabel}
              />
            </div>
            </>}

            <div role="tabpanel" id="panel-extras" aria-labelledby="tab-extras" hidden={tab !== "extras"} className="no-print">
              <ExtrasTab
                invoice={invoice}
                templateVariants={templateVariants}
                tags={tags}
                kind={kind}
                language={language}
                locale={locale}
                errors={errorMap}
                save={(next) => { save(next); clearErrors((field) => field === "currency"); }}
              />
            </div>
          </div>
        </div>

        <section id="invoice-live-preview" aria-labelledby="invoice-preview-title" className={cn("invoice-preview-pane min-w-0 overflow-hidden rounded-card-sm shadow-medium bg-surface-muted", split && "sticky top-16 max-lg:top-26", !split && narrowView !== "preview" && "screen-hidden")}>
          <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-rail px-3 py-2">
            <h2 id="invoice-preview-title" className="font-sans text-base font-semibold tracking-snug text-ink">{de ? "Live-Vorschau" : "Live preview"}</h2>
            <div role="group" aria-label={de ? "Vergrößerung der Vorschau" : "Preview zoom"} className="flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label={de ? "Vorschau verkleinern" : "Zoom out"} disabled={previewScale <= ZOOM_STEPS[0]} onClick={zoomOut} className="w-8 px-0">−</Button>
              <span className="w-11 text-center font-sans text-base text-ink-body tabular-nums" aria-label={de ? "Aktuelle Vergrößerung" : "Current zoom"}>{Math.round(previewScale * 100)}%</span>
              <Button size="sm" variant="ghost" aria-label={de ? "Vorschau vergrößern" : "Zoom in"} disabled={previewScale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={zoomIn} className="w-8 px-0">+</Button>
              <Button size="sm" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>{de ? "Einpassen" : "Fit width"}</Button>
            </div>
          </div>
          <div ref={previewFrame} tabIndex={0} role="region" aria-label={isQuote ? "Angebotsvorschau, scrollbar" : de ? "Rechnungsvorschau, scrollbar" : "Invoice preview, scrollable"} className="invoice-preview-frame max-h-[calc(100dvh-12rem)] min-w-0 overflow-auto overscroll-contain p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset lg:max-h-[calc(100dvh-9rem)]">
            <div id="invoice-preview" style={{ zoom: previewScale }} className="print-area invoice-paper mx-auto w-[210mm] min-h-[297mm] bg-white p-[12mm]">
              <InvoicePreview invoice={previewImmediate ? invoice : (deferredInvoice ?? invoice)} currency={currency} logoDataUrl={logoDataUrl} />
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (isQuote) deleteQuote(adapter, invoice.id);
          else deleteInvoice(adapter, invoice.id);
          window.location.assign(basePath);
        }}
        title={isQuote ? "Angebot löschen?" : t(language, "invoice.deleteTitle")}
        description={isQuote ? "Das Angebot wird endgültig entfernt. Eine daraus erstellte Rechnung bleibt erhalten." : t(language, "invoice.deleteDescription")}
        confirmLabel={t(language, "actions.delete")}
        cancelLabel={t(language, "common.cancel")}
        warningLabel={t(language, "common.cannotUndo")}
        variant="danger"
      />
      {documentMail.dialog}
    </Page>
  );
}
