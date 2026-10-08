import { AlertTriangle, CheckCircle2, CircleDashed, MinusCircle, XCircle } from "lucide-react";
import type { ForecastStatus } from "./types";

/** Status is always icon + words; colour only reinforces it. */
export const STATUS: Record<ForecastStatus, { label: string; cls: string; bar: string; Icon: typeof CheckCircle2; help: string }> = {
  on_track: { label: "On track", cls: "bg-emerald-50 text-emerald-900 ring-emerald-300", bar: "bg-emerald-600", Icon: CheckCircle2, help: "Projected month-end meets the target" },
  at_risk: { label: "At risk", cls: "bg-amber-50 text-amber-950 ring-amber-300", bar: "bg-amber-500", Icon: AlertTriangle, help: "Projected to miss the target, but it is still within reach" },
  off_track: { label: "Off track", cls: "bg-red-50 text-red-900 ring-red-300", bar: "bg-red-600", Icon: XCircle, help: "Projected to miss the target by more than recent performance can recover" },
  nodata: { label: "Not enough data", cls: "bg-slate-100 text-slate-800 ring-slate-300", bar: "bg-slate-400", Icon: MinusCircle, help: "Too little history to project" },
  no_target: { label: "No target set", cls: "bg-blue-50 text-blue-900 ring-blue-200", bar: "bg-blue-600", Icon: CircleDashed, help: "No target is configured for this KPI, so there is nothing to pace against" },
};
export const statusOf = (s?: string) => STATUS[(s as ForecastStatus) in STATUS ? (s as ForecastStatus) : "nodata"];

export function StatusChip({ status }: { status?: string }) {
  const m = statusOf(status);
  return <span title={m.help} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${m.cls}`}><m.Icon className="h-3.5 w-3.5" aria-hidden="true" />{m.label}</span>;
}
