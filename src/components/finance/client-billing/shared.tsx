/**
 * Shared display helpers for the Client Billing workspace tabs and sheets.
 *
 * Money formatting mirrors `VendorPaymentDispatchPage.tsx`'s own `money()` helper (Intl
 * en-IN currency, 2dp) — every value passed in comes straight from the API response
 * (`InvoiceRow`/`CreditNoteRow` money fields), never computed here.
 *
 * `GstBreakdown` mirrors `client-billing-pdf.service.ts`'s `drawTaxSummary` exactly:
 * taxable value, then IGST alone (Integrated) or CGST+SGST (Intrastate) when
 * `apply_gst` is set, then grand total — same source fields, same branching, rendered
 * as HTML instead of a PDF stream (design doc §5).
 */
import { StatusBadge } from "@/components/ui/status-badge";
import type { GstType, InvoiceStatus, CreditNoteStatus } from "@/lib/clientBillingApi";

export function money(value: number | string | null | undefined): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

/**
 * Compact Indian-notation money for the KPI tiles only — lakh/crore, two decimals.
 *
 * The tiles used the exact same `money()` as the table cells, so the all-time approved
 * figure rendered as "₹3,94,19,35,105.07" inside a ~180px card. A summary number exists to
 * be read at a glance and nobody parses eleven digits and a paise value at a glance; it also
 * pushed the tile text to the edge of its box at 1280px and below. "₹394.19 Cr" carries the
 * same meaning in a fifth of the space.
 *
 * Deliberately NOT used anywhere a figure is transacted on, reconciled or exported — every
 * table cell, detail dialog, GST breakdown, PDF and CSV keeps the full-precision `money()`.
 * Rounding is display-only and never re-enters a calculation.
 */
export function moneyCompact(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  // Two decimals, then strip trailing zeros and a bare trailing dot: 394.19 stays, 2.50
  // becomes 2.5, 5.00 becomes 5. Stripping only an exact ".00" left "₹2.50 L" sitting next
  // to "₹5 L" in the same tile row.
  const fmt = (v: number) => v.toFixed(2).replace(/\.?0+$/, "");
  if (abs >= 1e7) return `${sign}₹${fmt(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${fmt(abs / 1e5)} L`;
  return money(n);
}

/** `client_invoice.invoice_status` badge — reuses the codebase's shared status-badge
 *  palette (green/approved, amber/pending, red/rejected) rather than a page-local one. */
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === "approved") return <StatusBadge status="approved" />;
  if (status === "rejected") return <StatusBadge status="rejected" />;
  return <StatusBadge status="pending" label="Proforma" />;
}

/** `client_credit_note.credit_status` badge — same shared palette. */
export function CreditStatusBadge({ status }: { status: CreditNoteStatus }) {
  if (status === "approved") return <StatusBadge status="approved" />;
  return <StatusBadge status="draft" label="Draft" />;
}

interface GstBreakdownSource {
  total_amount: number | string;
  apply_gst: 0 | 1;
  gst_type: GstType;
  igst_amount: number | string;
  cgst_amount: number | string;
  sgst_amount: number | string;
  grand_total: number | string;
}

/** One line per row, right-aligned amounts — the HTML mirror of `drawTaxSummary`. */
export function GstBreakdown({ row }: { row: GstBreakdownSource }) {
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex items-center justify-between">
        <dt className="text-muted-foreground">Taxable value</dt>
        <dd className="tabular-nums">{money(row.total_amount)}</dd>
      </div>
      {Boolean(row.apply_gst) && (
        row.gst_type === "Integrated" ? (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">IGST</dt>
            <dd className="tabular-nums">{money(row.igst_amount)}</dd>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">CGST</dt>
              <dd className="tabular-nums">{money(row.cgst_amount)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">SGST</dt>
              <dd className="tabular-nums">{money(row.sgst_amount)}</dd>
            </div>
          </>
        )
      )}
      <div className="flex items-center justify-between border-t pt-1 font-semibold">
        <dt>Grand total</dt>
        <dd className="tabular-nums">{money(row.grand_total)}</dd>
      </div>
    </dl>
  );
}

export function formatMonthYear(financeYear: string, monthLabel: string): string {
  return [monthLabel, financeYear].filter(Boolean).join(" · ");
}
