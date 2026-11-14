import type { InvoiceBalance } from "@/lib/calc";
import type { Invoice, Language } from "@/lib/domain";
import type { Tone } from "@/components/ui/Status";

export type InvoiceStatusKey = "draft" | "paid" | "partial" | "overdue" | "open";

/**
 * One status word per invoice, shared by the list and the editor. A blank, unnumbered invoice has nothing to pay
 * yet; it reads as a draft instead of the technically "fully paid" zero balance.
 */
export function invoiceStatus(invoice: Invoice, balance: InvoiceBalance, language: Language): { key: InvoiceStatusKey; tone: Tone; label: string } {
  const de = language === "de";
  if (!invoice.invoiceNumber && balance.invoiceTotal === 0) return { key: "draft", tone: "muted", label: de ? "Entwurf" : "Draft" };
  if (balance.isFullyPaid) return { key: "paid", tone: "success", label: de ? "Bezahlt" : "Paid" };
  if (balance.isPartiallyPaid) return { key: "partial", tone: "attention", label: de ? "Teilweise bezahlt" : "Partially paid" };
  if (balance.isOverdue) return { key: "overdue", tone: "error", label: de ? "Überfällig" : "Overdue" };
  return { key: "open", tone: "info", label: de ? "Offen" : "Open" };
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date (YYYY-MM-DD) in the user's locale, e.g. 27.10.2026. */
export function formatDay(iso: string, locale: string) {
  const date = new Date(`${iso}T00:00:00`);
  if (!iso || Number.isNaN(date.getTime())) return iso;
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
    dateFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}
