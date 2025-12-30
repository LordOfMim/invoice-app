import type { Invoice } from "@/lib/domain";
import { ClassicInvoice } from "@/components/templates/ClassicInvoice";
import { ModernInvoice } from "@/components/templates/ModernInvoice";
import { MinimalInvoice } from "@/components/templates/MinimalInvoice";

export function InvoicePreview({ invoice, currency, locale, logoDataUrl }: { invoice: Invoice; currency: string; locale: string; logoDataUrl?: string }) {
  const templateId = invoice.layout.templateId;

  if (templateId === "modern") {
    return <ModernInvoice invoice={invoice} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />;
  }
  if (templateId === "minimal") {
    return <MinimalInvoice invoice={invoice} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />;
  }

  return <ClassicInvoice invoice={invoice} currency={currency} locale={locale} logoDataUrl={logoDataUrl} />;
}
