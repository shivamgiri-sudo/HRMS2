import type { ForecastStatus } from "@/hooks/useRevenueForecast";

export function money(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}

const STATUS: Record<ForecastStatus, { label: string; className: string }> = {
  missing: { label: "Not started", className: "border-slate-300 bg-white text-slate-700" },
  draft: { label: "Draft", className: "border-slate-300 bg-slate-100 text-slate-800" },
  submitted: { label: "Awaiting approval", className: "border-amber-300 bg-amber-50 text-amber-900" },
  rejected: { label: "Returned", className: "border-rose-300 bg-rose-50 text-rose-800" },
  approved: { label: "Open · in P&L", className: "border-blue-300 bg-blue-50 text-blue-900" },
  closed: { label: "Closed · actual in P&L", className: "border-emerald-300 bg-emerald-50 text-emerald-900" },
};

/** Status is always spelled out — colour is never the only signal. */
export function ForecastStatusBadge({ status }: { status: ForecastStatus }) {
  const s = STATUS[status] ?? STATUS.missing;
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.className}`}>{s.label}</span>;
}

export const FORECAST_STATUS_FILTERS: Array<{ value: ForecastStatus | "all" | "overdue"; label: string }> = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "missing", label: "Not started" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Awaiting approval" },
  { value: "rejected", label: "Returned" },
  { value: "approved", label: "Open" },
  { value: "closed", label: "Closed" },
];
