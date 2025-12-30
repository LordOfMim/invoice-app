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

export function MinimalInvoice({ invoice, currency, locale, logoDataUrl }: { invoice: Invoice; currency: string; locale: string; logoDataUrl?: string }) {
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
      return <div className="space-y-6">{senderBlock}{recipientBlock}</div>;
    }
    const left = senderPosition === "left" ? senderBlock : recipientBlock;
    const right = senderPosition === "right" ? senderBlock : recipientBlock;
    return <div className="grid grid-cols-2 gap-6">{left}{right}</div>;
  })();

  return (
    <div className="flex min-h-[273mm] print:min-h-0 flex-col" style={customStyles}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-6">
        <div>
          {logo ? <Logo dataUrl={logo} position={invoice.layout.logoPosition} size={invoice.layout.logoSize} /> : null}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tracking-tight">{t.documentTitle}</div>
          <div className="mt-3 space-y-1 text-sm">
            <div>
              <span className="text-zinc-600">{t.invoiceNumberLabel}</span>
              <span className="ml-2 font-medium">{invoice.invoiceNumber}</span>
            </div>
            <div>
              <span className="text-zinc-600">{t.invoiceDateLabel}</span>
              <span className="ml-2 font-medium">{invoice.invoiceDate}</span>
            </div>
            <div>
              <span className="text-zinc-600">{t.dueDateLabel}</span>
              <span className="ml-2 font-medium">{invoice.dueDate}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="text-sm">{parties}</div>

        {/* Positions */}
        <LineItemsTable invoice={invoice} currency={currency} locale={locale} variant="minimal" />

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
