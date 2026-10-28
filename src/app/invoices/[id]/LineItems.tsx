"use client";

import { memo, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardZone, KeyValueList } from "@/components/ui/Layout";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { OverflowMenu } from "@/components/ui/Menu";
import { Select } from "@/components/ui/Select";
import { KindBadge } from "@/components/ui/Status";
import { Textarea } from "@/components/ui/Textarea";
import { computeInvoiceTotals, computeLineTotal } from "@/lib/calc";
import { createDefaultLineItem, createLineItemFromProduct } from "@/lib/defaults";
import type { Invoice, InvoiceLineItem, InvoiceTexts, LineItemType, Product } from "@/lib/domain";
import { formatMoney, roundMoney } from "@/lib/money";
import { fieldId } from "./fields";

type RowProps = {
  item: InvoiceLineItem;
  index: number;
  count: number;
  texts: InvoiceTexts;
  currency: string;
  locale: string;
  errors: Record<string, string>;
  onUpdate: (id: string, updater: (item: InvoiceLineItem) => InvoiceLineItem) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
};

const typeLabel: Record<LineItemType, string> = { header: "Überschrift", subheader: "Unter-Überschrift", item: "Position" };

/** Percent shown for a stored rate; rounding is display-only, the stored rate stays untouched until edited. */
const percentOf = (rate: number | undefined) => (rate === undefined ? undefined : roundMoney(rate * 100));

/**
 * One row of the positions plate: mono index lane (Platform step-list recipe), number and description, then the
 * structured amounts. Row actions (type, order, remove) live in a visible „…“ menu, never on hover only.
 */
const LineItemRow = memo(function LineItemRow({ item, index, count, texts, currency, locale, errors, onUpdate, onRemove, onMove }: RowProps) {
  const itemType = item.type ?? "item";
  const isItem = itemType === "item";
  const id = (prop: string) => fieldId(`lineItems.${index}.${prop}`);
  const rowError = errors[`lineItems.${index}`];
  const net = computeLineTotal(item).net;

  return (
    <CardZone className={`@container ${itemType === "header" ? "bg-surface-subtle" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="hidden w-7 shrink-0 pt-9 @lg:block font-mono text-sm font-medium tracking-loose text-ink-muted tabular-nums" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
        <div className="grid min-w-0 flex-1 gap-3">
          {!isItem && <div><KindBadge>{typeLabel[itemType]}</KindBadge></div>}
          <div className="grid gap-3 @lg:grid-cols-[7rem_minmax(0,1fr)]">
            <Field label="Pos.-Nr." id={id("positionNumber")}>
              <Input
                value={item.positionNumber || ""}
                placeholder={itemType === "header" ? "01" : itemType === "subheader" ? "01.001" : ""}
                onChange={(e) => onUpdate(item.id, (prev) => ({ ...prev, positionNumber: e.target.value }))}
              />
            </Field>
            <Field label={isItem ? texts.itemsDescriptionLabel || "Beschreibung" : typeLabel[itemType]} id={id("description")} error={errors[`lineItems.${index}.description`] ?? rowError}>
              <Textarea
                rows={Math.min(8, Math.max(isItem ? 2 : 1, Math.ceil((item.description?.length || 0) / 70)))}
                value={item.description}
                placeholder={itemType === "header" ? "z. B. Rückbau Klima" : itemType === "subheader" ? "z. B. Raum Düsseldorf" : "Was wurde geliefert oder geleistet?"}
                onChange={(e) => onUpdate(item.id, (prev) => ({ ...prev, description: e.target.value }))}
              />
            </Field>
          </div>
          {isItem && (
            <div className="grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
              <Field label={texts.itemsQuantityLabel || "Menge"} id={id("quantity")} error={errors[`lineItems.${index}.quantity`]}>
                <DecimalInput value={item.quantity} onValueChange={(quantity) => onUpdate(item.id, (prev) => ({ ...prev, quantity: quantity ?? 0 }))} />
              </Field>
              <Field label="Einheit" id={id("unit")}>
                <Input value={item.unit || ""} placeholder="z. B. Stunde" onChange={(e) => onUpdate(item.id, (prev) => ({ ...prev, unit: e.target.value }))} />
              </Field>
              <Field label={texts.itemsUnitPriceLabel || "Einzelpreis"} id={id("unitPrice")} error={errors[`lineItems.${index}.unitPrice`]}>
                <DecimalInput value={item.unitPrice} onValueChange={(unitPrice) => onUpdate(item.id, (prev) => ({ ...prev, unitPrice: unitPrice ?? 0 }))} />
              </Field>
              <Field label={`${texts.itemsTaxRateLabel || "MwSt."} %`} id={id("taxRate")} error={errors[`lineItems.${index}.taxRate`]}>
                <DecimalInput allowEmpty value={percentOf(item.taxRate)} onValueChange={(percent) => onUpdate(item.id, (prev) => ({ ...prev, taxRate: percent === undefined ? undefined : percent / 100 }))} />
              </Field>
              <div className="flex min-w-0 flex-col gap-1.5 @xs:col-span-2 @2xl:col-span-1">
                <span className="font-sans text-base font-medium tracking-snug text-ink-secondary">Netto</span>
                <span className="flex h-10 items-center justify-end rounded-md bg-surface-subtle px-3 font-sans text-lg font-semibold tracking-snug text-ink tabular-nums">
                  {formatMoney(net, currency, locale)}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 pt-7">
          <OverflowMenu
            label={`Zeile ${index + 1} bearbeiten`}
            items={[
              { kind: "label", label: "Art der Zeile" },
              ...(["item", "header", "subheader"] as const).map((type) => ({
                label: `Als ${typeLabel[type]}${type === itemType ? " (aktuell)" : ""}`,
                onSelect: () => {
                  if (type === itemType) return;
                  onUpdate(item.id, (prev) => ({
                    ...prev,
                    type,
                    quantity: type === "item" ? (prev.quantity || 1) : 0,
                    unitPrice: type === "item" ? prev.unitPrice : 0,
                    taxRate: type === "item" ? prev.taxRate : undefined,
                  }));
                },
              })),
              { kind: "separator" },
              index > 0 && { label: "Nach oben verschieben", onSelect: () => onMove(item.id, -1) },
              index < count - 1 && { label: "Nach unten verschieben", onSelect: () => onMove(item.id, 1) },
              { kind: "separator" },
              { label: "Zeile entfernen", tone: "danger", onSelect: () => onRemove(item.id) },
            ]}
          />
        </div>
      </div>
    </CardZone>
  );
});

export function LineItemsEditor({
  invoice,
  products,
  defaultTaxRate,
  currency,
  locale,
  errors,
  save,
  onUpdate,
  onRemove,
  onMove,
}: {
  invoice: Invoice;
  products: Product[];
  defaultTaxRate?: number;
  currency: string;
  locale: string;
  errors: Record<string, string>;
  save: (next: Invoice | ((prev: Invoice) => Invoice)) => void;
  onUpdate: (id: string, updater: (item: InvoiceLineItem) => InvoiceLineItem) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
}) {
  const [focusRequest, setFocusRequest] = useState<{ index: number; at: number } | null>(null);
  const totals = computeInvoiceTotals(invoice);
  const texts = invoice.texts;

  // A new row is ready for typing: its description takes the focus.
  useEffect(() => {
    if (!focusRequest) return;
    document.getElementById(fieldId(`lineItems.${focusRequest.index}.description`))?.focus();
  }, [focusRequest]);

  const add = (type: LineItemType, item?: InvoiceLineItem) => {
    setFocusRequest({ index: invoice.lineItems.length, at: Date.now() });
    save((prev) => ({ ...prev, lineItems: [...prev.lineItems, item ?? createDefaultLineItem(defaultTaxRate, type)] }));
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {errors.lineItems && <p role="alert" className="font-sans text-base tracking-snug text-danger">{errors.lineItems}</p>}
      <Card>
        {invoice.lineItems.length === 0 && (
          <CardZone>
            <p className="font-sans text-lg tracking-snug text-ink-muted">Noch keine Positionen. Fügen Sie unten die erste Position hinzu.</p>
          </CardZone>
        )}
        {invoice.lineItems.map((lineItem, index) => (
          <LineItemRow
            key={lineItem.id}
            item={lineItem}
            index={index}
            count={invoice.lineItems.length}
            texts={texts}
            currency={currency}
            locale={locale}
            errors={errors}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onMove={onMove}
          />
        ))}
        <CardZone className="flex justify-end bg-surface-rail">
          <KeyValueList
            className="w-full max-w-sm"
            items={[
              { label: texts.subtotalLabel || "Zwischensumme", value: formatMoney(totals.subtotal, currency, locale) },
              { label: texts.taxTotalLabel || "Steuer", value: formatMoney(totals.taxTotal, currency, locale) },
              { label: texts.totalLabel || "Gesamt", value: formatMoney(totals.total, currency, locale), emphasis: true },
            ]}
          />
        </CardZone>
      </Card>
      <div className="flex flex-wrap items-end gap-2">
        <Button onClick={() => add("item")}>Position hinzufügen</Button>
        <Button variant="ghost" onClick={() => add("header")}>Überschrift</Button>
        <Button variant="ghost" onClick={() => add("subheader")}>Unter-Überschrift</Button>
        {products.length > 0 && (
          <Field label="Aus Produkten übernehmen" hideLabel className="w-full sm:ml-auto sm:w-72">
            <Select
              value=""
              onChange={(e) => {
                const product = products.find((p) => p.id === e.target.value);
                if (product) add("item", createLineItemFromProduct(product));
              }}
            >
              <option value="">Aus Produkten übernehmen …</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.unitPrice, currency, locale)}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </div>
  );
}
