"use client";

// Prints ONLY the statement tables — not the sidebar, header, filters or
// buttons. `window.print()` alone emits the whole page; this hides
// everything, then re-shows just #acct-print-area at the top of the sheet.
// Same technique as the Accounting Lab's print (components/accounting
// StatutoryStatements already renders the society name / statement headers
// when given `societyName`, so nothing extra needs to be typed for print).

export function PrintArea({ id = "acct-print-area", children }) {
  return (
    <>
      <div id={id}>{children}</div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  body * { visibility: hidden !important; }
  #${id}, #${id} * { visibility: visible !important; }
  #${id} {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  #${id} table { page-break-inside: avoid; }
  #${id} tr { page-break-inside: avoid; }
  @page { margin: 12mm; }
}
`,
        }}
      />
    </>
  );
}
