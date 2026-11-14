import type { CreditNote, Invoice, Language } from "@/lib/domain";
import { computeInvoiceBalance } from "@/lib/calc";
import { todayLocalISO } from "@/lib/date";
import { formatDay, invoiceStatus } from "@/components/invoiceStatus";

export type InvoiceDirectoryRow = {
  invoice: Invoice;
  dateLabel: string;
  dueLabel: string;
  balance: ReturnType<typeof computeInvoiceBalance>;
  status: ReturnType<typeof invoiceStatus>;
  searchText: string;
};

const noCredits: CreditNote[] = [];

/** Cache derived rows by immutable record identity; removed records can be collected. */
export function createInvoiceDirectory() {
  const cache = new WeakMap<Invoice, {
    locale: string;
    language: Language;
    today: string;
    credits: CreditNote[];
    row: InvoiceDirectoryRow;
  }>();
  let previousCredits: readonly CreditNote[] | undefined;
  let creditsByInvoice = new Map<string, CreditNote[]>();

  return {
    rows(invoices: readonly Invoice[], credits: readonly CreditNote[], locale: string, language: Language, today = todayLocalISO()): InvoiceDirectoryRow[] {
      if (credits !== previousCredits) {
        const grouped = new Map<string, CreditNote[]>();
        for (const credit of credits) {
          const group = grouped.get(credit.linkedInvoiceId);
          if (group) group.push(credit);
          else grouped.set(credit.linkedInvoiceId, [credit]);
        }
        // Replacing one credit note must not invalidate rows for other invoices.
        for (const [id, group] of grouped) {
          const previous = creditsByInvoice.get(id);
          if (previous && previous.length === group.length && group.every((item, index) => item === previous[index])) grouped.set(id, previous);
        }
        creditsByInvoice = grouped;
        previousCredits = credits;
      }
      return invoices.map((invoice) => {
        const linked = creditsByInvoice.get(invoice.id) ?? noCredits;
        const cached = cache.get(invoice);
        if (cached && cached.locale === locale && cached.language === language && cached.today === today && cached.credits === linked) return cached.row;
        const dateLabel = formatDay(invoice.invoiceDate, locale);
        const balance = computeInvoiceBalance(invoice, linked, today);
        const row = {
          invoice,
          dateLabel,
          dueLabel: formatDay(invoice.dueDate, locale),
          balance,
          status: invoiceStatus(invoice, balance, language),
          searchText: `${invoice.invoiceNumber} ${invoice.recipient.name} ${invoice.invoiceDate} ${dateLabel}`.toLocaleLowerCase(locale),
        };
        cache.set(invoice, { locale, language, today, credits: linked, row });
        return row;
      });
    },
  };
}
