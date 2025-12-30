"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { InvoicePreview } from "@/components/templates/InvoicePreview";
import { PrintStyles } from "@/components/PrintStyles";
import type { Invoice, InvoiceTexts, InvoiceTemplateId, LayoutPreferences, LogoPosition, Payment, Attachment, LineItemType } from "@/lib/domain";
import { createDefaultLineItem, createDefaultPayment, createLineItemFromProduct, newId } from "@/lib/defaults";
import { buildPdfFilename } from "@/lib/filename";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { computeInvoiceTotals } from "@/lib/calc";
import { usePersistedData } from "@/lib/storage/useStore";
import { 
  deleteInvoice, 
  duplicateInvoiceById, 
  togglePaid, 
  upsertInvoice,
  updateSettings,
  addPaymentToInvoice,
  removePaymentFromInvoice,
  addAttachmentToInvoice,
  removeAttachmentFromInvoice,
  listCustomers,
  listProducts,
  listTags,
} from "@/lib/storage/store";

// Common currencies with metadata
const CURRENCIES = [
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
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

function parseNumber(input: string): number {
  const normalized = input.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function InvoiceEditorClient({ id }: { id: string }) {
  const { adapter, data } = usePersistedData();
  const language = data?.settings.language ?? "de";
  const locale = language === "de" ? "de-DE" : "en-US";
  const defaultCurrency = data?.settings.currency ?? "EUR";

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [newPaymentDate, setNewPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [newPaymentMethod, setNewPaymentMethod] = useState("");
  const [newPaymentReference, setNewPaymentReference] = useState("");

  const invoice = useMemo(() => {
    return data?.invoices.find((inv) => inv.id === id) ?? null;
  }, [data?.invoices, id]);

  const settings = data?.settings;
  
  // Get related data
  const customers = adapter ? listCustomers(adapter) : [];
  const products = adapter ? listProducts(adapter) : [];
  const tags = adapter ? listTags(adapter) : [];
  const templateVariants = data?.templateVariants ?? [];

  const creditNotes = useMemo(() => {
    return (data?.creditNotes ?? []).filter((cn) => cn.linkedInvoiceId === id);
  }, [data?.creditNotes, id]);

  // Calculate payment status
  const invoiceTotals = useMemo(() => {
    if (!invoice) return { subtotal: 0, taxTotal: 0, total: 0 };
    return computeInvoiceTotals(invoice);
  }, [invoice]);

  const paidAmount = useMemo(() => {
    if (!invoice) return 0;
    return invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  }, [invoice]);

  const remainingAmount = invoiceTotals.total - paidAmount;
  const isFullyPaid = remainingAmount <= 0;
  const isPartiallyPaid = paidAmount > 0 && remainingAmount > 0;

  const currency = invoice?.currency || defaultCurrency;

  const logoDataUrl = invoice?.logoDataUrl || settings?.defaultLogoDataUrl;

  const isDefaultInvoice = (settings?.defaultInvoiceId ?? null) === invoice?.id;

  if (!adapter) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-xl bg-white p-6 text-sm text-zinc-500 ring-1 ring-zinc-200">Loading…</div>
      </main>
    );
  }

  if (!invoice) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="space-y-3">
          <div className="text-sm text-zinc-500">Invoice not found.</div>
          <Link href="/invoices" className="text-sm text-blue-600 hover:underline">
            Back
          </Link>
        </div>
      </main>
    );
  }

  const save = (next: Invoice) => {
    upsertInvoice(adapter, next);
  };

  const onPrint = () => {
    const pattern = settings?.pdfFilenamePattern ?? "Invoice-{invoiceNumber}.pdf";
    const filename = buildPdfFilename(pattern, invoice);
    const original = document.title;
    document.title = filename.replace(/\.pdf$/i, "");
    window.print();
    document.title = original;
  };

  const handleSelectCustomer = (customerId: string) => {
    if (!adapter || !invoice) return;
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    save({
      ...invoice,
      customerId,
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
    // TODO: implement credit note creation
    alert(`Credit note creation (${type}) will be implemented soon.`);
  };

  const handleEmailInvoice = () => {
    if (!invoice) return;
    const subject = encodeURIComponent(`${invoice.texts.documentTitle} ${invoice.invoiceNumber}`);
    const body = encodeURIComponent(
      `${language === "de" ? "Sehr geehrte Damen und Herren" : "Dear Sir or Madam"},\n\n` +
      `${language === "de" ? "anbei erhalten Sie" : "Please find attached"} ${invoice.texts.documentTitle} ${invoice.invoiceNumber}.\n\n` +
      `${language === "de" ? "Mit freundlichen Grüßen" : "Best regards"},\n${invoice.sender.name}`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PrintStyles />

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/invoices" className="text-sm text-zinc-600 hover:text-zinc-900">
            ← {t(language, "nav.invoices")}
          </Link>
          <div className="text-sm font-medium">{invoice.invoiceNumber || "(ohne Nummer)"}</div>
          {isDefaultInvoice ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
              {t(language, "invoice.default")}
            </span>
          ) : null}
          {isFullyPaid ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
              {t(language, "invoice.paid")}
            </span>
          ) : isPartiallyPaid ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
              {t(language, "invoice.partiallyPaid")}
            </span>
          ) : invoice.dueDate < new Date().toISOString().split("T")[0] ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
              {t(language, "invoice.overdue")}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              if (!adapter) return;
              updateSettings(adapter, (prev) => ({ ...prev, defaultInvoiceId: invoice.id }));
            }}
          >
            {t(language, "actions.setDefaultInvoice")}
          </Button>
          <Button onClick={() => setShowPaymentForm(!showPaymentForm)}>
            {t(language, "actions.addPayment")}
          </Button>
          <Button
            onClick={() => {
              const dup = duplicateInvoiceById(adapter, invoice.id);
              if (dup) window.location.assign(`/invoices/${dup.id}`);
            }}
          >
            {t(language, "actions.duplicate")}
          </Button>
          <Button onClick={onPrint}>Print / PDF</Button>
          <Button onClick={handleEmailInvoice}>
            {t(language, "actions.email")}
          </Button>
          
          {/* Credit Note Dropdown */}
          <div className="relative group">
            <Button variant="secondary">
              {t(language, "actions.createCreditNote")} ▾
            </Button>
            <div className="absolute right-0 top-full mt-1 hidden w-40 rounded-lg bg-white py-1 shadow-lg ring-1 ring-zinc-200 group-hover:block z-10">
              <button
                onClick={() => handleCreateCreditNote("storno")}
                className="block w-full px-4 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-50"
              >
                {t(language, "creditNotes.storno")}
              </button>
              <button
                onClick={() => handleCreateCreditNote("gutschrift")}
                className="block w-full px-4 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-50"
              >
                {t(language, "creditNotes.gutschrift")}
              </button>
            </div>
          </div>
          
          <Button
            variant="danger"
            onClick={() => {
              const ok = window.confirm("Wirklich löschen?");
              if (!ok) return;
              deleteInvoice(adapter, invoice.id);
              window.location.assign("/invoices");
            }}
          >
            {t(language, "actions.delete")}
          </Button>
        </div>
      </div>

      {/* Payment Form */}
      {showPaymentForm && (
        <div className="no-print mb-6 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-emerald-800">{t(language, "actions.addPayment")}</h3>
            <button onClick={() => setShowPaymentForm(false)} className="text-emerald-600 hover:text-emerald-800">×</button>
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
            <Field label="Method">
              <Input
                value={newPaymentMethod}
                onChange={(e) => setNewPaymentMethod(e.target.value)}
                placeholder="e.g., Bank Transfer"
              />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" onClick={() => {
                const amount = parseNumber(newPaymentAmount);
                if (amount <= 0) return;
                const payment: Payment = {
                  id: crypto.randomUUID(),
                  amount,
                  currency: invoice.currency ?? "EUR",
                  date: newPaymentDate || new Date().toISOString().split("T")[0],
                  method: (newPaymentMethod || "bank_transfer") as Payment["method"],
                };
                save(addPaymentToInvoice(invoice, payment));
                setShowPaymentForm(false);
                setNewPaymentAmount("");
                setNewPaymentMethod("");
              }}>
                Add
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Credit Notes Warning */}
      {creditNotes.length > 0 && (
        <div className="no-print mb-6 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <h3 className="text-sm font-semibold text-amber-800">
            Linked Credit Notes ({creditNotes.length})
          </h3>
          <div className="mt-2 space-y-1">
            {creditNotes.map((cn) => (
              <Link
                key={cn.id}
                href={`/credit-notes/${cn.id}`}
                className="block text-sm text-amber-700 hover:underline"
              >
                {cn.creditNoteNumber || cn.id} - {cn.type} - {formatMoney(cn.amount, currency, locale)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <section className="no-print space-y-6">
          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">{t(language, "invoice.editorTitle")}</div>

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

          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="text-sm font-semibold">{invoice.texts.senderHeading}</div>
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
          </div>

          <div className="rounded-xl bg-white p-5 ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{invoice.texts.recipientHeading}</div>
              {customers.length > 0 && (
                <Select
                  value={invoice.customerId || ""}
                  onChange={(e) => handleSelectCustomer(e.target.value)}
                  className="max-w-48 text-sm"
                >
                  <option value="">{t(language, "actions.selectCustomer")}...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              )}
            </div>
            <div className="mt-4 grid gap-4">
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
              {invoice.lineItems.map((li, idx) => {
                const itemType = li.type ?? "item";
                const isHeader = itemType === "header";
                const isSubheader = itemType === "subheader";
                const isItem = itemType === "item";
                
                return (
                <div key={li.id} className={`rounded-xl p-4 ring-1 ${isHeader ? "bg-zinc-100 ring-zinc-300" : isSubheader ? "bg-zinc-50/50 ring-zinc-200" : "bg-zinc-50 ring-zinc-200"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="text-xs font-medium text-zinc-600">#{idx + 1}</div>
                      <Select
                        value={itemType}
                        onChange={(e) => {
                          const newType = e.target.value as LineItemType;
                          const next = {
                            ...invoice,
                            lineItems: invoice.lineItems.map((x) => (x.id === li.id ? { 
                              ...x, 
                              type: newType,
                              // Reset quantity/price for headers/subheaders
                              quantity: newType === "item" ? (x.quantity || 1) : 0,
                              unitPrice: newType === "item" ? x.unitPrice : 0,
                              taxRate: newType === "item" ? x.taxRate : undefined,
                            } : x)),
                          };
                          save(next);
                        }}
                        className="w-auto text-xs"
                      >
                        <option value="header">Überschrift</option>
                        <option value="subheader">Unter-Überschrift</option>
                        <option value="item">Position</option>
                      </Select>
                    </div>
                    <Button
                      variant="danger"
                      onClick={() => {
                        const next = {
                          ...invoice,
                          lineItems: invoice.lineItems.filter((x) => x.id !== li.id),
                        };
                        save(next);
                      }}
                    >
                      Entfernen
                    </Button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="grid gap-3 grid-cols-[80px_1fr]">
                      <Field label="Pos.-Nr.">
                        <Input
                          value={li.positionNumber || ""}
                          placeholder={isHeader ? "01" : isSubheader ? "01.001" : ""}
                          onChange={(e) => {
                            const next = {
                              ...invoice,
                              lineItems: invoice.lineItems.map((x) => (x.id === li.id ? { ...x, positionNumber: e.target.value } : x)),
                            };
                            save(next);
                          }}
                        />
                      </Field>
                      <Field label={isHeader ? "Überschrift" : isSubheader ? "Unter-Überschrift" : invoice.texts.itemsDescriptionLabel}>
                        <Textarea
                          rows={Math.max(isItem ? 3 : 1, Math.ceil((li.description?.length || 0) / 80))}
                          value={li.description}
                          placeholder={isHeader ? "z.B. Rückbau Klima" : isSubheader ? "z.B. Raum Düsseldorf" : "Beschreibung der Position"}
                          className="min-h-[60px] resize-y"
                          onChange={(e) => {
                            const next = {
                              ...invoice,
                              lineItems: invoice.lineItems.map((x) => (x.id === li.id ? { ...x, description: e.target.value } : x)),
                            };
                            save(next);
                          }}
                        />
                      </Field>
                    </div>
                    {isItem && (
                    <div className="grid gap-3 grid-cols-4">
                      <Field label={invoice.texts.itemsQuantityLabel}>
                        <Input
                          inputMode="decimal"
                          defaultValue={String(li.quantity)}
                          key={`qty-${li.id}`}
                          onBlur={(e) => {
                            const next = {
                              ...invoice,
                              lineItems: invoice.lineItems.map((x) => (x.id === li.id ? { ...x, quantity: parseNumber(e.target.value) } : x)),
                            };
                            save(next);
                          }}
                        />
                      </Field>
                      <Field label="Einheit">
                        <Input
                          value={li.unit || ""}
                          placeholder="z.B. Stunde"
                          onChange={(e) => {
                            const next = {
                              ...invoice,
                              lineItems: invoice.lineItems.map((x) => (x.id === li.id ? { ...x, unit: e.target.value } : x)),
                            };
                            save(next);
                          }}
                        />
                      </Field>
                      <Field label={invoice.texts.itemsUnitPriceLabel}>
                        <Input
                          inputMode="decimal"
                          defaultValue={String(li.unitPrice)}
                          key={`price-${li.id}`}
                          onBlur={(e) => {
                            const next = {
                              ...invoice,
                              lineItems: invoice.lineItems.map((x) => (x.id === li.id ? { ...x, unitPrice: parseNumber(e.target.value) } : x)),
                            };
                            save(next);
                          }}
                        />
                      </Field>
                      <Field label={`${invoice.texts.itemsTaxRateLabel} (%)`}>
                        <Input
                          inputMode="decimal"
                          placeholder="19"
                          value={li.taxRate === undefined ? "" : String(Math.round(li.taxRate * 10000) / 100)}
                          onChange={(e) => {
                            const value = e.target.value.trim();
                            const nextRate = value === "" ? undefined : parseNumber(value) / 100;
                            const next = {
                              ...invoice,
                              lineItems: invoice.lineItems.map((x) => (x.id === li.id ? { ...x, taxRate: nextRate } : x)),
                            };
                            save(next);
                          }}
                        />
                      </Field>
                    </div>
                    )}
                  </div>
                </div>
                );
              })}

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
                rows={3} 
                value={invoice.notesText || ""} 
                placeholder="z.B. Zahlungsbedingungen, Hinweise, etc."
                onChange={(e) => save({ ...invoice, notesText: e.target.value })} 
              />
            </div>
          </div>

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

              <Field label="Logo Position">
                <Select
                  value={invoice.layout.logoPosition}
                  onChange={(e) => {
                    const pos = e.target.value as LogoPosition;
                    save(setLayout(invoice, { ...invoice.layout, logoPosition: pos }));
                  }}
                >
                  <option value="left">Top-Left</option>
                  <option value="center">Top-Center</option>
                  <option value="right">Top-Right</option>
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
                  <span className="text-sm">{invoice.layout.showLogo ? "Ja" : "Nein"}</span>
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
                    <option value="small">Klein</option>
                    <option value="medium">Mittel</option>
                    <option value="large">Groß</option>
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
                  <span className="text-sm">{invoice.layout.showFooter ? "Ja" : "Nein"}</span>
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
                  <option value="left">Links</option>
                  <option value="right">Rechts</option>
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
                  <option value="left">Links</option>
                  <option value="right">Rechts</option>
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
                      save({ ...invoice, logoDataUrl: result });
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
                      {cur.code} ({cur.symbol}) - {cur.name}
                    </option>
                  ))}
                </Select>
              </Field>

              {invoice.currency && invoice.currency !== "EUR" && (
                <>
                  <Field label={t(language, "invoices.exchangeRate")}>
                    <Input
                      type="number"
                      step="0.0001"
                      value={invoice.exchangeRate ?? 1}
                      onChange={(e) => {
                        save({ ...invoice, exchangeRate: parseFloat(e.target.value) || 1 });
                      }}
                    />
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
                <span className="font-medium">{formatMoney(invoiceTotals.total, invoice.currency ?? "EUR", locale)}</span>
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
                        date: newPaymentDate || new Date().toISOString().split("T")[0],
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

                  Array.from(files).forEach((file) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = reader.result;
                      if (typeof dataUrl !== "string") return;

                      const attachment: Attachment = {
                        id: crypto.randomUUID(),
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        dataUrl,
                        createdAt: new Date().toISOString(),
                      };
                      const updated = addAttachmentToInvoice(invoice, attachment);
                      save(updated);
                    };
                    reader.readAsDataURL(file);
                  });

                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 lg:sticky lg:top-6 lg:self-start">
          <div className="no-print text-sm font-semibold">{t(language, "invoice.previewTitle")}</div>

          <div className="no-print rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200 overflow-auto lg:max-h-[calc(100vh-10rem)] w-max">
            <div>
              <div className="invoice-paper mx-auto w-[210mm] min-h-[297mm] bg-white p-[12mm] ring-1 ring-zinc-200">
                <InvoicePreview invoice={invoice} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />
              </div>
            </div>
          </div>

          <div className="print-only hidden">
            <div id="invoice-preview" className="print-area invoice-paper bg-white">
              <InvoicePreview invoice={invoice} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
