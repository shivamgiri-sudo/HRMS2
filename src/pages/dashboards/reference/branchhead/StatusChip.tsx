import { AlertOctagon, AlertTriangle, CheckCircle2, CircleSlash } from "lucide-react";

export type HealthStatus = "healthy" | "watch" | "critical" | "no_data";

const MAP = {
  healthy: { label: "Healthy", Icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-900 border-emerald-300" },
  watch: { label: "Watch", Icon: AlertTriangle, cls: "bg-amber-50 text-amber-900 border-amber-300" },
  critical: { label: "Critical", Icon: AlertOctagon, cls: "bg-rose-50 text-rose-900 border-rose-300" },
  no_data: { label: "No data", Icon: CircleSlash, cls: "bg-slate-100 text-slate-800 border-slate-300" },
} as const;

/** Status is always icon + text, never colour alone. */
export function StatusChip({ status }: { status: HealthStatus }) {
  const { label, Icon, cls } = MAP[status] ?? MAP.no_data;
  return (
    <span className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
