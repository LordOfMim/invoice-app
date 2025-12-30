import type { Invoice, TemplateCustomization } from "@/lib/domain";
import { LineItemsTable, Logo, TotalsBlock, NotesSection, PageIndicator } from "@/components/templates/shared";

// Get customization style object as CSS variables
function getCustomizationStyles(customization?: TemplateCustomization): React.CSSProperties {
  const fontSize = customization?.fontSizeScale ?? 1;
  const lineHeight = customization?.lineSpacing ?? 1.5;
  
  return {
    '--font-scale': fontSize,
    '--line-height': lineHeight,
    fontSize: `calc(14px * ${fontSize})`,
    lineHeight: lineHeight,
  } as React.CSSProperties;
}

export function ModernInvoice({ invoice, currency, locale, logoDataUrl }: { invoice: Invoice; currency: string; locale: string; logoDataUrl?: string }) {
  const t = invoice.texts;
  const logo = invoice.layout.showLogo ? logoDataUrl : undefined;
  const customStyles = getCustomizationStyles(invoice.layout.customization);

  const senderBlock = (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="text-xs font-medium text-zinc-600">{t.senderHeading}</div>
      <div className="mt-2 whitespace-pre-wrap font-medium">{invoice.sender.name}</div>
      <div className="whitespace-pre-wrap text-zinc-700">{invoice.sender.address}</div>
      <div className="whitespace-pre-wrap text-zinc-700">{invoice.sender.contact}</div>
    </div>
  );

  const recipientBlock = (
    <div className="rounded-xl bg-white p-4 ring-1 ring-zinc-200">
      <div className="text-xs font-medium text-zinc-600">{t.recipientHeading}</div>
      {invoice.recipient.salutation && (
        <div className="mt-2 whitespace-pre-wrap text-zinc-700">{invoice.recipient.salutation}</div>
      )}
      <div className={invoice.recipient.salutation ? "whitespace-pre-wrap font-medium" : "mt-2 whitespace-pre-wrap font-medium"}>{invoice.recipient.name}</div>
      <div className="whitespace-pre-wrap text-zinc-700">{invoice.recipient.address}</div>
      <div className="whitespace-pre-wrap text-zinc-700">{invoice.recipient.contact}</div>
    </div>
  );

  const parties = (() => {
    const { senderPosition, recipientPosition } = invoice.layout;
    if (senderPosition === recipientPosition) {
      return <div className="space-y-4">{senderBlock}{recipientBlock}</div>;
    }
    const left = senderPosition === "left" ? senderBlock : recipientBlock;
    const right = senderPosition === "right" ? senderBlock : recipientBlock;
    return <div className="grid grid-cols-2 gap-6">{left}{right}</div>;
  })();

  return (
    <div className="flex min-h-[274mm] print:min-h-[calc(297mm-24mm)] flex-col" style={customStyles}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            {logo ? <Logo dataUrl={logo} position={invoice.layout.logoPosition} size={invoice.layout.logoSize} /> : null}
            <div className="text-3xl font-semibold tracking-tight">{t.documentTitle}</div>
          </div>

          <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm ring-1 ring-zinc-200">
            <div className="grid gap-1">
              <div className="flex gap-3">
                <div className="w-40 text-zinc-600">{t.invoiceNumberLabel}</div>
                <div className="font-medium">{invoice.invoiceNumber}</div>
              </div>
              <div className="flex gap-3">
                <div className="w-40 text-zinc-600">{t.invoiceDateLabel}</div>
                <div className="font-medium">{invoice.invoiceDate}</div>
              </div>
              <div className="flex gap-3">
                <div className="w-40 text-zinc-600">{t.dueDateLabel}</div>
                <div className="font-medium">{invoice.dueDate}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-sm">{parties}</div>

        {/* Positions */}
        <LineItemsTable invoice={invoice} currency={currency} locale={locale} variant="modern" />

        {/* Totals */}
        <TotalsBlock invoice={invoice} currency={currency} locale={locale} />

        {/* Notes (Hinweise) below totals */}
        <NotesSection invoice={invoice} />
      </div>

      {/* Footer with page indicator */}
      <div className="mt-auto pt-6">
        <PageIndicator invoice={invoice} />
      </div>
    </div>
  );
}
