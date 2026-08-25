import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, TrendingDown, Users } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type CostCenterRisk = {
  mandate_id: string;
  process_name: string;
  branch_name: string;
  role_group: string;
  mandated_hc: number;
  active_hc: number;
  in_notice_count: number;
  effective_hc: number;
  gap: number;
  gap_pct: number;
  attrition_rate: number;
  exits_3m: number;
  risk_level: "critical" | "high" | "medium" | "low";
  hiring_recommendation: number;
};

type Summary = {
  total_cost_centers: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total_in_notice: number;
  total_gap: number;
  total_hiring_needed: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_STYLES: Record<string, { badge: string; row: string; bar: string }> = {
  critical: { badge: "bg-red-100 text-red-700 border-red-200",    row: "bg-red-50/50",    bar: "bg-red-500" },
  high:     { badge: "bg-amber-100 text-amber-700 border-amber-200", row: "bg-amber-50/30", bar: "bg-amber-400" },
  medium:   { badge: "bg-blue-100 text-blue-700 border-blue-200",  row: "bg-blue-50/20",  bar: "bg-blue-400" },
  low:      { badge: "bg-emerald-100 text-emerald-700 border-emerald-200", row: "", bar: "bg-emerald-400" },
};

// ─── Main Component ────────────────────────────────────────────────────────────

/**
 * ManpowerRiskWidget — per-cost-centre HC gap + attrition alert panel.
 * Render in HR/CEO/Branch Head dashboards.
 *
 * Props:
 *   compact — show only critical+high rows, no full table (for dashboard cards)
 *   maxRows — cap visible rows (default 10)
 */
export function ManpowerRiskWidget({
  compact = false,
  maxRows = 10,
}: {
  compact?: boolean;
  maxRows?: number;
}) {
  const [data, setData] = useState<CostCenterRisk[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    hrmsApi
      .get<{ success: boolean; data: CostCenterRisk[]; summary: Summary }>(
        "/api/manpower-risk/cost-center"
      )
      .then((res) => {
        setData(res.data ?? []);
        setSummary(res.summary ?? null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const visible = compact
    ? data.filter((d) => d.risk_level === "critical" || d.risk_level === "high")
    : showAll
    ? data
    : data.slice(0, maxRows);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
      </div>
    );
  }

  if (!summary || data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
        <Users className="mx-auto mb-2 h-8 w-8 opacity-30" />
        <p className="text-sm font-semibold">No workforce mandate data configured.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary KPI row */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-red-600">Critical</p>
          <p className="mt-1 text-xl font-black text-red-700">{summary.critical}</p>
          <p className="text-[10px] text-red-400">cost centres</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-amber-600">High Risk</p>
          <p className="mt-1 text-xl font-black text-amber-700">{summary.high}</p>
          <p className="text-[10px] text-amber-400">cost centres</p>
        </div>
        <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-cyan-700">In Notice</p>
          <p className="mt-1 text-xl font-black text-cyan-800">{summary.total_in_notice}</p>
          <p className="text-[10px] text-cyan-400">employees</p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">Hiring Needed</p>
          <p className="mt-1 text-xl font-black text-violet-800">{summary.total_hiring_needed}</p>
          <p className="text-[10px] text-violet-400">recommended seats</p>
        </div>
      </div>

      {/* Alert banner for critical centres */}
      {summary.critical > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-black text-red-800">
              {summary.critical} cost centre{summary.critical > 1 ? "s" : ""} at critical HC gap — immediate hiring required.
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Total open seats: <b>{summary.total_gap}</b> · Recommend raising {summary.total_hiring_needed} positions
            </p>
          </div>
        </div>
      )}

      {/* Cost centre table */}
      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                {["Process / Branch", "Role Group", "Mandate", "Active HC", "In Notice", "Effective HC", "Gap", "Attrition", "Risk", "Action"].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const style = RISK_STYLES[r.risk_level] ?? RISK_STYLES.low;
                return (
                  <tr key={r.mandate_id} className={`border-t transition-colors ${style.row}`}>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-800">{r.process_name}</p>
                      <p className="text-xs text-slate-400">{r.branch_name}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 capitalize">
                      {(r.role_group ?? "All").replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-3 font-bold text-slate-800">{r.mandated_hc}</td>
                    <td className="px-3 py-3 font-bold text-emerald-700">{r.active_hc}</td>
                    <td className="px-3 py-3">
                      <span className={`font-bold ${r.in_notice_count > 0 ? "text-amber-700" : "text-slate-400"}`}>
                        {r.in_notice_count}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`font-black ${r.effective_hc < r.mandated_hc ? "text-red-700" : "text-emerald-700"}`}>
                        {r.effective_hc}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {r.gap > 0 ? (
                        <div>
                          <span className="font-black text-red-700">-{r.gap}</span>
                          <div className="mt-1 h-1.5 w-16 rounded-full bg-slate-200">
                            <div
                              className={`h-1.5 rounded-full ${style.bar}`}
                              style={{ width: `${Math.min(100, r.gap_pct)}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-emerald-600 font-bold">OK</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        {r.attrition_rate > 0 && <TrendingDown className="h-3.5 w-3.5 text-rose-500" />}
                        <span className={`font-bold text-xs ${r.attrition_rate >= 30 ? "text-red-700" : r.attrition_rate >= 15 ? "text-amber-700" : "text-slate-600"}`}>
                          {r.attrition_rate}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold capitalize ${style.badge}`}>
                        {r.risk_level}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {r.hiring_recommendation > 0 && (
                        <span className="text-xs font-bold text-violet-700">
                          Hire +{r.hiring_recommendation}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-sm text-slate-400 font-semibold">
                    {compact ? "No critical or high-risk cost centres." : "No data."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Show all toggle */}
        {!compact && !showAll && data.length > maxRows && (
          <div className="border-t px-4 py-3">
            <button
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
            >
              Show all {data.length} cost centres
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
