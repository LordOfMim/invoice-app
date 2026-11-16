"use client";

import { memo, useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardZone, KeyValueList } from "@/components/ui/Layout";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { OverflowMenu } from "@/components/ui/Menu";
import { Select } from "@/components/ui/Select";
import { KindBadge } from "@/components/ui/Status";
import { Textarea } from "@/components/ui/Textarea";
import { computeInvoicePayable, computeLineTotal } from "@/lib/calc";
import { formatDocumentDate } from "@/lib/date";
import { createDefaultLineItem, createLineItemFromProduct, newId } from "@/lib/defaults";
import { lineTaxRateFor } from "@/lib/documents";
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
  /** Products whose name or description matches what is being typed into a fresh position. */
  products: readonly Product[];
  /** True when the invoice is issued without VAT (§ 13b): products are taken over with 0 %. */
  reverseCharge: boolean;
  onUpdate: (id: string, updater: (item: InvoiceLineItem) => InvoiceLineItem) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
};

const MAX_SUGGESTIONS = 4;

/** Products to offer for a position that is still being typed: no product chosen yet and no price entered. */
function suggestProducts(item: InvoiceLineItem, products: readonly Product[]): Product[] {
  if ((item.type ?? "item") !== "item" || item.productId || item.unitPrice !== 0) return [];
  const query = item.description.trim().toLocaleLowerCase("de-DE");
  if (query.length < 2 || query.includes("\n")) return [];
  const starts: Product[] = [];
  const contains: Product[] = [];
  for (const product of products) {
    const name = product.name.toLocaleLowerCase("de-DE");
    const description = product.description.toLocaleLowerCase("de-DE");
    if (name === query || description === query) continue; // already typed out in full; nothing left to complete
    if (name.startsWith(query) || description.startsWith(query)) starts.push(product);
    else if (name.includes(query) || description.includes(query)) contains.push(product);
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

const noSubscribe = () => () => {};
/** The Mac keyboard has ⌘ where others have Strg. */
const isMac = () => window.electronAPI?.platform === "darwin" || /mac/i.test(navigator.userAgent);

const typeLabel: Record<LineItemType, string> = { header: "Überschrift", subheader: "Unter-Überschrift", item: "Position" };

/** Percent shown for a stored rate; rounding is display-only, the stored rate stays untouched until edited. */
const percentOf = (rate: number | undefined) => (rate === undefined ? undefined : roundMoney(rate * 100));

/**
 * One row of the positions plate: mono index lane (Platform step-list recipe), number and description, then the
 * structured amounts. Row actions (type, order, remove) live in a visible „…“ menu, never on hover only.
 */
const LineItemRow = memo(function LineItemRow({ item, index, count, texts, currency, locale, errors, products, reverseCharge, onUpdate, onRemove, onMove }: RowProps) {
  const itemType = item.type ?? "item";
  const isItem = itemType === "item";
  const id = (prop: string) => fieldId(`lineItems.${index}.${prop}`);
  const rowError = errors[`lineItems.${index}`];
  const net = computeLineTotal(item).net;
  const suggestions = suggestProducts(item, products);

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
          {suggestions.length > 0 && (
            <div role="group" aria-label="Passende Produkte und Leistungen" className="flex flex-wrap items-center gap-2 @lg:pl-[calc(7rem+0.75rem)]">
              <span className="font-sans text-base tracking-snug text-ink-muted">Übernehmen:</span>
              {suggestions.map((product) => (
                <Button
                  key={product.id}
                  size="sm"
                  onClick={() => onUpdate(item.id, (prev) => ({
                    ...prev,
                    description: product.description || product.name,
                    unit: product.unit,
                    unitPrice: product.unitPrice,
                    taxRate: reverseCharge ? 0 : product.taxRate,
                    productId: product.id,
                  }))}
                >
                  {product.name} · {formatMoney(product.unitPrice, currency, locale)}
                </Button>
              ))}
            </div>
          )}
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
                <span className="flex h-9.5 items-center justify-end rounded-md bg-surface-subtle px-3 touch:h-11 font-sans text-lg font-semibold tracking-snug text-ink tabular-nums">
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
  previous,
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
  /** The customer's most recent other document; its positions can be taken over. */
  previous?: Invoice;
  currency: string;
  locale: string;
  errors: Record<string, string>;
  save: (next: Invoice | ((prev: Invoice) => Invoice)) => void;
  onUpdate: (id: string, updater: (item: InvoiceLineItem) => InvoiceLineItem) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
}) {
  /** Row whose description takes the focus as soon as it is on the page. */
  const pendingFocus = useRef<number | null>(null);
  const mac = useSyncExternalStore(noSubscribe, isMac, () => false);
  const totals = computeInvoicePayable(invoice);
  const texts = invoice.texts;
  const reverseCharge = invoice.reverseCharge === true;
  const newLineTaxRate = lineTaxRateFor(invoice, defaultTaxRate);
  const hasContent = invoice.lineItems.some((item) => item.description.trim() || item.unitPrice !== 0);
  // The source may be an invoice or, for a quote, another quote: name it by its own title and number.
  const previousName = previous ? `${previous.texts.documentTitle.trim() || (previous.documentKind === "quote" ? "Angebot" : "Rechnung")} ${previous.invoiceNumber.trim() || "ohne Nummer"}` : "";
  const previousPositions = previous ? previous.lineItems.filter((item) => (item.type ?? "item") === "item").length : 0;

  // A new row is ready for typing: its description takes the focus once the row is rendered.
  const rowCount = invoice.lineItems.length;
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const element = document.getElementById(fieldId(`lineItems.${pendingFocus.current}.description`));
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  }, [rowCount]);

  const add = (type: LineItemType, item?: InvoiceLineItem) => {
    pendingFocus.current = invoice.lineItems.length;
    save((prev) => ({ ...prev, lineItems: [...prev.lineItems, item ?? createDefaultLineItem(newLineTaxRate, type)] }));
  };

  /**
   * Keyboard entry without the mouse: Enter in the last field (tax rate) of the last position starts the next
   * position, and ⌘/Strg + Enter does so from any field. A plain Enter in a description keeps breaking the line.
   */
  const onRowsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.altKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    const shortcut = event.metaKey || event.ctrlKey;
    if (!shortcut && target.id !== fieldId(`lineItems.${invoice.lineItems.length - 1}.taxRate`)) return;
    event.preventDefault();
    add("item");
  };

  const takeOverPrevious = () => {
    if (!previous) return;
    save((prev) => {
      const copies = previous.lineItems.map((item): InvoiceLineItem => ({
        ...item,
        id: newId(),
        taxRate: (item.type ?? "item") === "item" && prev.reverseCharge ? 0 : item.taxRate,
      }));
      // Untouched starter rows make room; anything the user typed stays.
      const kept = prev.lineItems.filter((item) => item.description.trim() || item.unitPrice !== 0);
      if (!prev.reverseCharge) return { ...prev, lineItems: [...kept, ...copies] };
      // Without VAT (§ 13b) the copies carry 0 %; their own rates are remembered for the day it is switched off.
      const rates = { ...(prev.reverseChargePreviousRates ?? {}) };
      previous.lineItems.forEach((item, index) => { if ((item.type ?? "item") === "item" && item.taxRate) rates[copies[index].id] = item.taxRate; });
      return { ...prev, lineItems: [...kept, ...copies], reverseChargePreviousRates: rates };
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {errors.lineItems && <p role="alert" className="font-sans text-base tracking-snug text-danger-ink">{errors.lineItems}</p>}
      <Card onKeyDown={onRowsKeyDown}>
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
            products={products}
            reverseCharge={reverseCharge}
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
              { label: texts.totalLabel || "Gesamt", value: formatMoney(totals.total, currency, locale), emphasis: totals.deducted === 0 },
              ...(totals.deducted !== 0 ? [
                { label: "Abschlagsrechnungen", value: formatMoney(-totals.deducted, currency, locale) },
                { label: totals.payable < 0 ? "Guthaben" : "Restbetrag", value: formatMoney(Math.abs(totals.payable), currency, locale), emphasis: true },
              ] : []),
            ]}
          />
        </CardZone>
      </Card>
      {previous && previous.lineItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={takeOverPrevious}>
            Positionen aus {previousName} {hasContent ? "anfügen" : "übernehmen"}
          </Button>
          <span className="font-sans text-base tracking-snug text-ink-muted">
            vom {formatDocumentDate(previous.invoiceDate, locale)} · {previousPositions === 1 ? "1 Position" : `${previousPositions} Positionen`}
          </span>
        </div>
      )}
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
                if (product) add("item", { ...createLineItemFromProduct(product), ...(reverseCharge ? { taxRate: 0 } : {}) });
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
      <p className="max-w-[72ch] font-sans text-base tracking-snug text-ink-muted">
        Mit der Tastatur: Die Eingabetaste im Feld „{texts.itemsTaxRateLabel || "MwSt."} %“ der letzten Position legt die nächste Position an. {mac ? "⌘ + Eingabetaste" : "Strg + Eingabetaste"} tut dasselbe aus jedem Feld der Positionen. In der Beschreibung beginnt die Eingabetaste wie gewohnt eine neue Zeile.
      </p>
    </div>
  );
}
