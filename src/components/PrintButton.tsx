"use client";

/** Scorecard export = browser print-to-PDF (print CSS), NOT a PDF pipeline. */
export function PrintButton() {
  return (
    <button className="btn no-print" onClick={() => window.print()}>
      🖨 Print / Save as PDF
    </button>
  );
}
