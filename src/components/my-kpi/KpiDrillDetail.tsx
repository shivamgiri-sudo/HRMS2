import { DrawerSection, DrawerKV } from "./DrillDownDrawer";
import type { KpiMetricResult } from "./PeerMetricCard";

function formatValue(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "seconds") {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  if (unit === "percent") return `${Math.round(v * 10) / 10}%`;
  if (unit === "currency") return `₹${v.toLocaleString("en-IN")}`;
  return String(Math.round(v * 10) / 10);
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return d;
  }
}

function estimatePeerScore(peerAvg: number, targetValue: number | null, direction: string): number {
  if (!targetValue || targetValue === 0 || peerAvg === 0) return 0;
  const raw = direction === "lower_is_better"
    ? (targetValue / peerAvg) * 100
    : (peerAvg / targetValue) * 100;
  return Math.min(Math.max(raw, 0), 100);
}

type Props = { metric: KpiMetricResult };

export function KpiDrillDetail({ metric }: Props) {
  const hasData = metric.actual_value !== null;
  const scorePct = metric.score_pct;
  const scoreColor =
    scorePct >= 90 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : scorePct >= 70 ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-rose-700 bg-rose-50 border-rose-200";

  return (
    <>
      {/* Summary strip */}
      <div className={`rounded-xl border p-4 ${scoreColor}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{metric.metric_code}</p>
            <p className="text-lg font-extrabold">{metric.metric_name}</p>
            <p className="text-sm opacity-80 capitalize">{metric.category.replace(/_/g, " ")}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-3xl font-extrabold font-mono">{hasData ? Math.round(scorePct) : "—"}</p>
            <p className="text-[11px] opacity-70 font-semibold">/ 100 score</p>
          </div>
        </div>
      </div>

      {/* Core metrics */}
      <DrawerSection label="Performance">
        <DrawerKV label="Actual Value" value={formatValue(metric.actual_value, metric.unit)} />
        <DrawerKV label="Target" value={formatValue(metric.target_value, metric.unit)} />
        <DrawerKV
          label="Min Threshold"
          value={metric.min_threshold != null ? formatValue(metric.min_threshold, metric.unit) : "None"}
        />
        <DrawerKV label="Direction" value={metric.direction === "lower_is_better" ? "Lower is better" : "Higher is better"} />
        <DrawerKV label="Score" value={`${Math.round(scorePct)}%`} />
        <DrawerKV label="Rating" value={metric.rating ?? "—"} />
        <DrawerKV label="Status" value={metric.score_status ?? "—"} />
        <DrawerKV label="Data Source" value={metric.resolved_from ?? "—"} />
        <DrawerKV label="Family" value={metric.family ?? "—"} />
      </DrawerSection>

      {/* Peer benchmarking */}
      {metric.peer_avg != null && (
        <DrawerSection label="Peer Comparison">
          <DrawerKV label="Your Value" value={formatValue(metric.actual_value, metric.unit)} />
          <DrawerKV label="Peer Average" value={formatValue(metric.peer_avg, metric.unit)} />
          <DrawerKV
            label="Percentile"
            value={metric.percentile != null ? `${Math.round(metric.percentile)}th percentile` : "—"}
          />
          <DrawerKV label="Peer Count" value={metric.peer_count ?? "—"} />
          {/* Visual bar */}
          <div className="mt-3 space-y-2">
            {[
              { label: "You", pct: Math.min(scorePct, 100), color: "bg-blue-500" },
              {
                label: "Peer Avg",
                pct: estimatePeerScore(metric.peer_avg!, metric.target_value, metric.direction ?? "higher_is_better"),
                color: "bg-slate-300",
              },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 w-14">{row.label}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${row.color}`} style={{ width: `${row.pct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-slate-600 w-8 text-right">{Math.round(row.pct)}%</span>
              </div>
            ))}
          </div>
        </DrawerSection>
      )}

      {/* Trend history */}
      {metric.trend_data?.length > 0 && (
        <DrawerSection label="Recent Trend">
          <div className="divide-y divide-slate-50">
            {(metric.trend_data ?? []).slice(-10).reverse().map((point, i) => (
              <div key={i} className="flex justify-between items-center py-2 text-xs">
                <span className="text-slate-500">{fmtDate(point.date)}</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-[10px]">{point.source}</span>
                  <span className="font-mono font-bold text-slate-900">{formatValue(point.value, metric.unit)}</span>
                </div>
              </div>
            ))}
          </div>
        </DrawerSection>
      )}
    </>
  );
}
