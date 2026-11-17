import { isDraftInvoice, type InvoiceBalance } from "@/lib/calc";
import type { Invoice, Language } from "@/lib/domain";
import type { Tone } from "@/components/ui/Status";

export type InvoiceStatusKey = "draft" | "paid" | "partial" | "overdue" | "open";

/**
 * One status word per invoice, shared by the list and the editor. An invoice without a number is a draft, whatever
 * its amount (see isDraftInvoice): it is not open, not overdue and not paid yet.
 */
export function invoiceStatus(invoice: Invoice, balance: InvoiceBalance, language: Language): { key: InvoiceStatusKey; tone: Tone; label: string } {
  const de = language === "de";
  if (isDraftInvoice(invoice)) return { key: "draft", tone: "muted", label: de ? "Entwurf" : "Draft" };
  if (balance.isFullyPaid) return { key: "paid", tone: "success", label: de ? "Bezahlt" : "Paid" };
  if (balance.isPartiallyPaid) return { key: "partial", tone: "attention", label: de ? "Teilweise bezahlt" : "Partially paid" };
  if (balance.isOverdue) return { key: "overdue", tone: "error", label: de ? "Überfällig" : "Overdue" };
  return { key: "open", tone: "info", label: de ? "Offen" : "Open" };
}

/** Status word for a quote: converted, accepted, declined, expired or open. */
export function quoteStatus(quote: Invoice, today: string, language: Language): { key: "converted" | "accepted" | "declined" | "expired" | "open"; tone: Tone; label: string } {
  const de = language === "de";
  if (quote.convertedInvoiceId) return { key: "converted", tone: "success", label: de ? "Rechnung erstellt" : "Invoiced" };
  if (quote.quoteStatus === "accepted") return { key: "accepted", tone: "success", label: de ? "Angenommen" : "Accepted" };
  if (quote.quoteStatus === "declined") return { key: "declined", tone: "muted", label: de ? "Abgelehnt" : "Declined" };
  if (quote.dueDate && quote.dueDate < today) return { key: "expired", tone: "attention", label: de ? "Abgelaufen" : "Expired" };
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
