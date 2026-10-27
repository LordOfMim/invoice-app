export function PrintStyles() {
  return (
    <style>{`
@media print {
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  body { background: white !important; }
  /* Every screen layout shares this one document. Release all shell, grid,
     sticky and scroll ancestors, including a hidden narrow preview pane. */
  .app-frame, .app-main-column, .app-main, .app-page-wrapper,
  .invoice-editor, .invoice-workspace, .invoice-preview-pane, .invoice-preview-frame {
    display: block !important;
    position: static !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    contain: none !important;
    margin: 0 !important;
    padding: 0 !important;
    gap: 0 !important;
  }
  .invoice-preview-pane, .invoice-preview-frame {
    overflow: visible !important;
    max-height: none !important;
    border: 0 !important;
    padding: 0 !important;
    background: white !important;
  }
  
  /* Print ONLY the invoice content */
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    right: 0 !important;
  }
  
  .invoice-paper {
    zoom: 1 !important;
    width: auto !important;
    min-height: 0 !important;
    height: auto !important;
    max-width: none !important;
    padding: 10mm !important;
    box-shadow: none !important;
    box-sizing: border-box !important;
  }
  
  /* Invoice flex container - use page height for footer positioning */
  .invoice-paper > div {
    min-height: calc(297mm - 40mm) !important; /* A4 height minus page margins and padding */
    display: flex !important;
    flex-direction: column !important;
  }
  
  /* Page setup */
  @page { 
    size: A4;
    margin: 10mm;
  }
  
  /* Ensure table rows don't break awkwardly */
  tr {
    page-break-inside: avoid;
  }
  
  /* Keep totals block together */
  .invoice-totals-block {
    page-break-inside: avoid;
  }
  
  /* Keep footer together and at bottom */
  .invoice-footer {
    page-break-inside: avoid;
    margin-top: auto !important;
  }
  
  /* Notes section should stay together if possible */
  .invoice-notes {
    page-break-inside: avoid;
  }
  
  /* Page indicator */
  .invoice-page-number {
    display: block !important;
  }
}

/* Screen preview styles */
@media screen {
  .invoice-page-number {
    display: block;
  }
}
`}</style>
  );
}
