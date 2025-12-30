export function PrintStyles() {
  return (
    <style>{`
@media print {
  .no-print { display: none !important; }
  .print-only { display: block !important; }
  body { background: white !important; }
  
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
    width: auto !important;
    min-height: auto !important;
    max-width: none !important;
    padding: 10mm 12mm !important;
    padding-bottom: 5mm !important;
    box-shadow: none !important;
    box-sizing: border-box !important;
  }
  
  /* Page setup - no margins for browser headers/footers */
  @page { 
    size: A4;
    margin: 8mm 10mm 10mm 10mm;
  }
  
  /* Ensure table rows don't break awkwardly */
  tr {
    page-break-inside: avoid;
  }
  
  /* Keep totals block together */
  .invoice-totals-block {
    page-break-inside: avoid;
  }
  
  /* Keep footer together */
  .invoice-footer {
    page-break-inside: avoid;
  }
  
  /* Notes section should stay together if possible */
  .invoice-notes {
    page-break-inside: avoid;
  }
  
  /* Page indicator fixed at bottom of every page */
  .invoice-page-number {
    display: block !important;
    position: fixed;
    bottom: 0;
    left: 10mm;
    right: 10mm;
    padding-bottom: 2mm;
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
