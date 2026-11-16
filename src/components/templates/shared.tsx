import Image from "next/image";
import type { Invoice, InvoiceLineItem, LogoPosition, LogoSize, TemplateCustomization } from "@/lib/domain";
import { computeInvoicePayable, computeLineTotal, formatTaxPercent } from "@/lib/calc";
import { formatDocumentDate } from "@/lib/date";
import { REVERSE_CHARGE_NOTE, invoiceKindOf, legalFooterLines } from "@/lib/documents";
import { formatMoney, formatQuantity } from "@/lib/money";

/**
 * The rows of the block under the document title: number, date, date of supply, due date and project. Every
 * template lays them out its own way, but which rows appear is decided once here. Dates print in the reader's
 * format (31.12.2026) instead of the stored ISO form.
 */
export function documentMetaRows(invoice: Invoice, locale: string): { key: string; label: string; value: string }[] {
  const t = invoice.texts;
  const isQuote = invoice.documentKind === "quote";
  const serviceDate = isQuote ? "" : invoice.einvoice?.serviceDate?.trim() ?? "";
  const project = invoice.projectReference?.trim() ?? "";
  return [
    { key: "number", label: t.invoiceNumberLabel, value: invoice.invoiceNumber },
    { key: "date", label: t.invoiceDateLabel, value: formatDocumentDate(invoice.invoiceDate, locale) },
    ...(serviceDate ? [{ key: "service", label: t.serviceDateLabel?.trim() || "Leistungsdatum", value: formatDocumentDate(serviceDate, locale) }] : []),
    { key: "due", label: t.dueDateLabel, value: formatDocumentDate(invoice.dueDate, locale) },
    ...(project ? [{ key: "project", label: t.projectReferenceLabel?.trim() || "Bauvorhaben", value: project }] : []),
  ];
}

export function Logo({ dataUrl, position, size = "medium" }: { dataUrl: string; position: LogoPosition; size?: LogoSize }) {
  const justify: Record<LogoPosition, string> = {
    left: "justify-start",
    center: "justify-center",
    right: "justify-end",
  };

  const sizeClasses: Record<LogoSize, string> = {
    small: "h-8 w-24",
    medium: "h-12 w-40",
    large: "h-16 w-56",
  };

  return (
    <div className={`flex ${justify[position]}`}>
      <div className={`relative ${sizeClasses[size]}`}>
        <Image src={dataUrl} alt="logo" fill className="object-contain" />
      </div>
    </div>
  );
}

// Fixed page footer - appears at bottom of every printed page
// Contains footer text (left/right, or the single default footer text), the tax and bank details, and the page indicator
export function PageIndicator({ invoice }: { invoice: Invoice }) {
  const showFooter = invoice.layout.showFooter;
  const leftText = showFooter ? invoice.footerLeftText?.trim() : "";
  const rightText = showFooter ? invoice.footerRightText?.trim() : "";
  const singleText = showFooter && !leftText && !rightText ? invoice.footerText?.trim() : "";
  const legalLines = showFooter ? legalFooterLines(invoice, `${leftText ?? ""} ${rightText ?? ""} ${singleText ?? ""}`) : [];

  return (
    <div className="invoice-page-number bg-white text-[10px] pt-3 border-t border-zinc-200">
      {(leftText || rightText) && (
        <div className="flex justify-between gap-4 text-zinc-500 mb-2">
          <div className="whitespace-pre-wrap">{leftText}</div>
          <div className="whitespace-pre-wrap text-right">{rightText}</div>
        </div>
      )}
      {singleText && <div className="mb-2 whitespace-pre-wrap text-center text-zinc-500">{singleText}</div>}
      {legalLines.length > 0 && (
        <div className="mb-2 text-center text-zinc-500">
          {legalLines.map((line) => <div key={line}>{line}</div>)}
        </div>
      )}
      <div className="text-center text-zinc-400">
        {invoice.texts.documentTitle} {invoice.invoiceNumber}
      </div>
    </div>
  );
}

// Continuation header - shown on subsequent pages (if needed)
export function ContinuationHeader({ invoice }: { invoice: Invoice }) {
  return (
    <div className="invoice-running-header text-sm text-zinc-600 pb-4 mb-4 border-b border-zinc-200">
      <div className="flex justify-between items-center">
        <div className="font-medium">{invoice.texts.documentTitle} {invoice.invoiceNumber}</div>
        <div>{invoice.recipient.name}</div>
      </div>
    </div>
  );
}

export function TotalsBlock({ invoice, currency, locale }: { invoice: Invoice; currency: string; locale: string }) {
  const totals = computeInvoicePayable(invoice);
  const t = invoice.texts;
  const money = (value: number) => formatMoney(value, currency, locale);
  const deductions = invoiceKindOf(invoice) === "final" ? invoice.advanceDeductions ?? [] : [];

  return (
    <div className="invoice-totals-block ml-auto w-full max-w-xs space-y-1 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-zinc-600">{t.subtotalLabel}</div>
        <div className="font-medium">{money(totals.subtotal)}</div>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-zinc-600">{t.taxTotalLabel}</div>
        <div className="font-medium">{money(totals.taxTotal)}</div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2">
        <div className="text-zinc-600">{t.totalLabel}</div>
        <div className={deductions.length ? "font-medium" : "text-base font-semibold"}>{money(totals.total)}</div>
      </div>
      {deductions.length > 0 && (
        <>
          {deductions.map((deduction) => (
            <div key={deduction.id} className="flex items-start justify-between gap-3">
              <div className="text-zinc-600">
                abzgl. Abschlagsrechnung {deduction.invoiceNumber}
                {deduction.invoiceDate ? ` vom ${formatDocumentDate(deduction.invoiceDate, locale)}` : ""}
                {deduction.tax ? <span className="block text-xs">darin USt {money(deduction.tax)}</span> : null}
              </div>
              <div className="whitespace-nowrap font-medium">{money(-(deduction.net + deduction.tax))}</div>
            </div>
          ))}
          <div className="mt-2 flex items-start justify-between gap-3 border-t border-zinc-200 pt-2">
            <div className="text-zinc-600">
              {totals.payable < 0 ? "Guthaben" : "Restbetrag"}
              {totals.payableTax ? <span className="block text-xs">darin USt {money(totals.payableTax)}</span> : null}
            </div>
            <div className="whitespace-nowrap text-base font-semibold">{money(Math.abs(totals.payable))}</div>
          </div>
        </>
      )}
      {invoice.reverseCharge && <div className="pt-2 text-xs text-zinc-600">{REVERSE_CHARGE_NOTE}</div>}
    </div>
  );
}

export function NotesSection({ invoice }: { invoice: Invoice }) {
  const t = invoice.texts;
  const notesText = invoice.notesText?.trim();
  
  if (!notesText) return null;
  
  return (
    <div className="invoice-notes text-sm">
      {t.notesHeading && (
        <div className="text-xs font-medium text-zinc-600 mb-1">{t.notesHeading}</div>
      )}
      <div className="whitespace-pre-wrap text-zinc-700">{notesText}</div>
    </div>
  );
}

export function FooterSection({ invoice }: { invoice: Invoice }) {
  const leftText = invoice.footerLeftText?.trim();
  const rightText = invoice.footerRightText?.trim();
  const legacyText = invoice.footerText?.trim();
  
  // If no footer content, don't render
  if (!leftText && !rightText && !legacyText) return null;
  
  // If only legacy text, render it centered
  if (!leftText && !rightText && legacyText) {
    return (
      <div className="invoice-footer border-t border-zinc-200 pt-3 text-[10px] text-zinc-500 text-center">
        <div className="whitespace-pre-wrap">{legacyText}</div>
      </div>
    );
  }
  
  // Render left/right layout
  return (
    <div className="invoice-footer border-t border-zinc-200 pt-3 flex justify-between gap-8 text-[10px] text-zinc-500">
      <div className="whitespace-pre-wrap flex-1">{leftText}</div>
      <div className="whitespace-pre-wrap flex-1 text-right">{rightText}</div>
    </div>
  );
}

// Get padding class based on tablePadding setting
function getPaddingClass(padding?: "compact" | "normal" | "spacious"): string {
  switch (padding) {
    case "compact": return "py-1";
    case "spacious": return "py-3";
    default: return "py-2";
  }
}

// Get header style class
function getHeaderStyleClass(style?: "simple" | "boxed" | "underlined", accentColor?: string): string {
  switch (style) {
    case "boxed": return "bg-zinc-100 rounded";
    case "underlined": return "border-b-2 border-zinc-300";
    default: return "";
  }
}

type ColumnVisibility = {
  showQuantity: boolean;
  showUnitPrice: boolean;
  showTax: boolean;
};

function renderLineItemRow(
  item: InvoiceLineItem, 
  currency: string, 
  locale: string, 
  columns: ColumnVisibility,
  paddingClass: string
) {
  const totals = computeLineTotal(item);
  const itemType = item.type ?? "item";
  
  // Calculate colspan for headers
  let colSpan = 2; // description + total always shown
  if (columns.showQuantity) colSpan++;
  if (columns.showUnitPrice) colSpan++;
  if (columns.showTax) colSpan++;
  
  if (itemType === "header") {
    return (
      <tr key={item.id} className="bg-zinc-50/50">
        <td colSpan={colSpan} className={`${paddingClass} pr-2`}>
          <div className="font-semibold text-zinc-900">
            {item.positionNumber && <span className="text-zinc-500 mr-2">{item.positionNumber}</span>}
            {item.description}
          </div>
        </td>
      </tr>
    );
  }
  
  if (itemType === "subheader") {
    return (
      <tr key={item.id}>
        <td colSpan={colSpan} className={`${paddingClass} pr-2 pl-4`}>
          <div className="font-medium text-zinc-700 text-[13px]">
            {item.positionNumber && <span className="text-zinc-400 mr-2">{item.positionNumber}</span>}
            {item.description}
          </div>
        </td>
      </tr>
    );
  }
  
  // Regular item
  return (
    <tr key={item.id} className="border-t border-zinc-200/70 align-top">
      <td className={`${paddingClass} pr-2 pl-4`}>
        <div className="whitespace-pre-wrap wrap-break-word">
          {item.positionNumber && <span className="text-zinc-400 mr-2 text-xs">{item.positionNumber}</span>}
          {item.description}
        </div>
      </td>
      {columns.showQuantity && (
        <td className={`${paddingClass} pr-2 text-right tabular-nums`}>
          {formatQuantity(item.quantity, locale)}{item.unit ? ` ${item.unit}` : ""}
        </td>
      )}
      {columns.showUnitPrice && (
        <td className={`${paddingClass} pr-2 text-right tabular-nums`}>{formatMoney(item.unitPrice, currency, locale)}</td>
      )}
      {columns.showTax && (
        <td className={`${paddingClass} pr-2 text-right tabular-nums`}>{item.taxRate ? `${formatTaxPercent(item.taxRate).replace(".", locale.startsWith("de") ? "," : ".")}%` : ""}</td>
      )}
      <td className={`${paddingClass} text-right tabular-nums`}>{formatMoney(totals.net + totals.tax, currency, locale)}</td>
    </tr>
  );
}

export function LineItemsTable({ invoice, currency, locale, variant }: { invoice: Invoice; currency: string; locale: string; variant: "classic" | "modern" | "minimal" }) {
  const t = invoice.texts;
  const customization = invoice.layout.customization;
  
  // Determine column visibility - use customization if available, otherwise smart defaults
  const hasAnyTax = invoice.lineItems.some(item => item.type === "item" && item.taxRate && item.taxRate > 0);
  
  const columns: ColumnVisibility = {
    showQuantity: customization?.showQuantityColumn ?? true,
    showUnitPrice: customization?.showUnitPriceColumn ?? true,
    showTax: customization?.showTaxColumn ?? hasAnyTax, // If customization says show, show. Otherwise auto-detect.
  };
  
  // If customization explicitly sets showTaxColumn to false, hide it even if items have tax
  if (customization && customization.showTaxColumn === false) {
    columns.showTax = false;
  }
  
  const paddingClass = getPaddingClass(customization?.tablePadding);
  const headerStyleClass = getHeaderStyleClass(customization?.headerStyle, customization?.accentColor);
  
  // Base header class
  let headerClass = variant === "modern" ? "bg-zinc-50" : "";
  if (headerStyleClass) {
    headerClass = headerStyleClass;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className={`text-left text-zinc-600 ${headerClass}`}>
          <th className={`${paddingClass} pr-2 font-medium`}>{t.itemsDescriptionLabel}</th>
          {columns.showQuantity && (
            <th className={`w-20 ${paddingClass} pr-2 text-right font-medium`}>{t.itemsQuantityLabel}</th>
          )}
          {columns.showUnitPrice && (
            <th className={`w-32 ${paddingClass} pr-2 text-right font-medium`}>{t.itemsUnitPriceLabel}</th>
          )}
          {columns.showTax && (
            <th className={`w-24 ${paddingClass} pr-2 text-right font-medium`}>{t.itemsTaxRateLabel}</th>
          )}
          <th className={`w-32 ${paddingClass} text-right font-medium`}>{t.itemsLineTotalLabel}</th>
        </tr>
      </thead>
      <tbody>
        {invoice.lineItems.map((item) => renderLineItemRow(item, currency, locale, columns, paddingClass))}
      </tbody>
    </table>
  );
}
