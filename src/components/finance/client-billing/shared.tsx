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
import type {
  GstType,
  InvoiceStatus,
  CreditNoteStatus,
} from "@/lib/clientBillingApi";

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
export function moneyCompact(
  value: number | string | null | undefined,
): string {
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
      {Boolean(row.apply_gst) &&
        (row.gst_type === "Integrated" ? (
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
        ))}
      <div className="flex items-center justify-between border-t pt-1 font-semibold">
        <dt>Grand total</dt>
        <dd className="tabular-nums">{money(row.grand_total)}</dd>
      </div>
    </dl>
  );
}

export function formatMonthYear(
  financeYear: string,
  monthLabel: string,
): string {
  return [monthLabel, financeYear].filter(Boolean).join(" · ");
}

/**
 * Popup width per the 2026-10-06 UI standard: 60vw (capped at 1200px) on desktop, full screen
 * below the `md` breakpoint, scrolling internally. Applied to `DialogContent` — it overrides the
 * default `max-w-lg` centred box without needing a shared modal component.
 */
export const DIALOG_60VW_CLASS =
  "flex max-h-[90vh] w-full max-w-none flex-col gap-3 overflow-y-auto md:w-[min(60vw,1200px)] " +
  "max-md:left-0 max-md:top-0 max-md:h-[100dvh] max-md:max-h-none max-md:w-screen max-md:translate-x-0 " +
  "max-md:translate-y-0 max-md:rounded-none";

/** Right slide-over drawer width for row drill-downs: 60vw (capped), full width on mobile. */
export const DRAWER_60VW_CLASS =
  "flex w-full flex-col gap-0 overflow-y-auto p-0 sm:w-[min(60vw,1200px)] sm:max-w-none";

/** Section label used inside drill-down drawers (CLAUDE.md Drill-Down Mandate). */
export const SECTION_LABEL_CLASS =
  "text-xs font-bold uppercase tracking-wide text-slate-400";

/** DD/MM/YYYY HH:mm, as the Drill-Down Mandate requires. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** DD/MM/YYYY for DATE columns (which arrive as YYYY-MM-DD strings). */
export function formatDateOnly(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value ? String(value) : "—";
}
