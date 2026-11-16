import type { ReactNode } from "react";

/**
 * An A4 sheet for letters (payment reminder, contractor declaration). It is the page's single `.print-area`, so the
 * same PDF and e-mail flows that print an invoice print this sheet. On screen the sheet keeps its real width and
 * the frame scrolls sideways in a narrow window; print releases the frame (see PrintStyles).
 */
export function LetterPaper({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className="invoice-preview-frame min-w-0 overflow-x-auto rounded-card-sm shadow-medium bg-surface-muted p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <div id="invoice-preview" className="print-area invoice-paper mx-auto min-h-[297mm] w-[210mm] bg-white p-[12mm]">
        <div className="flex min-h-[273mm] flex-col text-sm leading-relaxed text-zinc-800 print:min-h-0">{children}</div>
      </div>
    </div>
  );
}
