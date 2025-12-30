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

export function ClassicInvoice({ invoice, currency, locale, logoDataUrl }: { invoice: Invoice; currency: string; locale: string; logoDataUrl?: string }) {
  const t = invoice.texts;
  const logo = invoice.layout.showLogo ? logoDataUrl : undefined;
  const customStyles = getCustomizationStyles(invoice.layout.customization);

  const senderBlock = (
    <div>
      <div className="text-xs font-medium text-zinc-600">{t.senderHeading}</div>
      <div className="mt-2 whitespace-pre-wrap font-medium">{invoice.sender.name}</div>
      <div className="whitespace-pre-wrap text-zinc-700">{invoice.sender.address}</div>
      <div className="whitespace-pre-wrap text-zinc-700">{invoice.sender.contact}</div>
    </div>
  );

  const recipientBlock = (
    <div>
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
      return (
        <div className="space-y-6 text-sm">
          {senderBlock}
          {recipientBlock}
        </div>
      );
    }

    const left = senderPosition === "left" ? senderBlock : recipientBlock;
    const right = senderPosition === "right" ? senderBlock : recipientBlock;
    return (
      <div className="grid w-full max-w-md grid-cols-2 gap-6 text-sm">
        {left}
        {right}
      </div>
    );
  })();

  return (
    <div className="flex min-h-[273mm] print:min-h-0 flex-col" style={customStyles}>
      <div className="space-y-6">
        {logo ? <Logo dataUrl={logo} position={invoice.layout.logoPosition} size={invoice.layout.logoSize} /> : null}

        <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <div className="text-2xl font-semibold tracking-tight">{t.documentTitle}</div>
          <div className="mt-3 grid gap-1 text-sm">
            <div className="flex gap-2 min-w-86">
              <div className="w-40 text-zinc-600">{t.invoiceNumberLabel}</div>
              <div className="font-medium">{invoice.invoiceNumber}</div>
            </div>
            <div className="flex gap-2 min-w-86">
              <div className="w-40 text-zinc-600">{t.invoiceDateLabel}</div>
              <div className="font-medium">{invoice.invoiceDate}</div>
            </div>
            <div className="flex gap-2 min-w-86">
              <div className="w-40 text-zinc-600">{t.dueDateLabel}</div>
              <div className="font-medium">{invoice.dueDate}</div>
            </div>
          </div>
        </div>

        {parties}
      </div>

        {/* Positions */}
        <LineItemsTable invoice={invoice} currency={currency} locale={locale} variant="classic" />

        {/* Totals */}
        <TotalsBlock invoice={invoice} currency={currency} locale={locale} />

        {/* Notes (Hinweise) below totals */}
        <NotesSection invoice={invoice} />
      </div>

      {/* Footer with page indicator */}
      <div className="invoice-footer mt-auto pt-6">
        <PageIndicator invoice={invoice} />
      </div>
    </div>
  );
}
