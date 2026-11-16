import { DOCUMENT_LOCALE } from "@/lib/date";
import type { Invoice } from "@/lib/domain";
import { ClassicInvoice } from "@/components/templates/ClassicInvoice";
import { ModernInvoice } from "@/components/templates/ModernInvoice";
import { MinimalInvoice } from "@/components/templates/MinimalInvoice";

/**
 * The printed document. Dates and amounts always use `DOCUMENT_LOCALE`; the language of the app is deliberately
 * not a parameter, so every place that renders a document prints the same.
 */
export function InvoicePreview({ invoice, currency, logoDataUrl }: { invoice: Invoice; currency: string; logoDataUrl?: string }) {
  const locale = DOCUMENT_LOCALE;
  const templateId = invoice.layout.templateId;

  if (templateId === "modern") {
    return <ModernInvoice invoice={invoice} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />;
  }
  if (templateId === "minimal") {
    return <MinimalInvoice invoice={invoice} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />;
  }

  return <ClassicInvoice invoice={invoice} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />;
}
