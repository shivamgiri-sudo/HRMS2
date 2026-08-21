import { AlertTriangle, CheckCircle2, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePnlFreshness } from "@/hooks/usePnlFreshness";

/**
 * Mounted in the header of every P&L view (CEO Overview, P&L Statement, Process Matrix, LOB
 * Profitability, Budget Consolidation, Period Close, Cost-Centre Utilization). Same
 * mode/blockers signal the "Live P&L" tab's full PnlReconciliationPanel already computes — this
 * is the compact version so the other six views don't each need their own copy of that panel.
 *
 * FINAL (green) — the period is closed and every figure is locked/actual.
 * LIVE_MTD (amber) — the current month, still accruing; hover for exactly which sources are
 *   provisional (this is the normal, expected state for the current month, not an error).
 * BLOCKED (red) — a real data gap is preventing a trustworthy number; hover for which one.
 */
export function PnlFreshnessBadge({ period, branchId, branchIds }: { period: string; branchId?: string; branchIds?: string[] }) {
  const { data, isLoading } = usePnlFreshness(period, { branchId, branchIds });

  if (isLoading || !data) {
    return (
      <Badge variant="outline" className="animate-pulse border-slate-200 text-slate-400">
        Checking freshness…
      </Badge>
    );
  }

  const tone =
    data.mode === "FINAL"
      ? { className: "bg-emerald-600 hover:bg-emerald-600", icon: CheckCircle2, label: "Final" }
      : data.mode === "BLOCKED"
        ? { className: "bg-rose-600 hover:bg-rose-600", icon: Ban, label: "Blocked" }
        : { className: "bg-amber-600 hover:bg-amber-600", icon: AlertTriangle, label: "Live MTD" };
  const Icon = tone.icon;

  const hasNotes = data.blockers.length > 0 || data.exceptions.length > 0;
  const badge = (
    <Badge className={`gap-1 ${tone.className}`}>
      <Icon className="h-3 w-3" />
      {tone.label}
    </Badge>
  );

  if (!hasNotes) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="space-y-1.5 text-xs">
          {data.blockers.map((b) => (
            <p key={b}>{b}</p>
          ))}
          {data.exceptions.map((e) => (
            <p key={e.code} className="text-amber-600">
              {e.label} — {e.count} row{e.count === 1 ? "" : "s"}
              {e.amount ? `, Rs ${(e.amount / 100000).toFixed(2)} L` : ""}
            </p>
          ))}
          <p className="pt-1 text-slate-400">As of {new Date(data.generatedAt).toLocaleString()}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
