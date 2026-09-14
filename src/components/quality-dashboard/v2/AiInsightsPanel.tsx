import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Lightbulb, TrendingUp, Info } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import type { Insight, RoiData } from "./types";
import { safeNum } from "./types";
import { Spinner, ErrBanner, PanelShell } from "./shared";

interface Props {
  from: string;
  to: string;
  queryKey: unknown[];
}

const INSIGHT_STYLES: Record<
  Insight["type"],
  { border: string; bg: string; badge: string; icon: React.ReactNode }
> = {
  success:     { border: "border-emerald-200", bg: "bg-emerald-50",  badge: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" /> },
  warning:     { border: "border-yellow-200",  bg: "bg-yellow-50",   badge: "bg-yellow-100 text-yellow-700",   icon: <AlertTriangle className="h-4 w-4 text-yellow-500" /> },
  critical:    { border: "border-red-200",     bg: "bg-red-50",      badge: "bg-red-100 text-red-700",         icon: <AlertTriangle className="h-4 w-4 text-red-500" /> },
  opportunity: { border: "border-blue-200",    bg: "bg-blue-50",     badge: "bg-blue-100 text-blue-700",       icon: <Lightbulb className="h-4 w-4 text-blue-500" /> },
};

function InsightCard({ insight }: { insight: Insight }) {
  const s = INSIGHT_STYLES[insight.type];
  return (
    <div className={`rounded-xl border p-4 ${s.border} ${s.bg}`}>
      <div className="flex gap-3">
        <div className="mt-0.5 shrink-0">{s.icon}</div>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-900">{insight.title}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${s.badge}`}>{insight.type}</span>
          </div>
          <p className="text-sm text-slate-600">{insight.message}</p>
          {insight.action && (
            <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-slate-500">
              <Info className="h-3 w-3" /> {insight.action}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function AiInsightsPanel({ from, to, queryKey }: Props) {
  const insightsQ = useQuery<Insight[]>({
    queryKey: ["qd-insights", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ insights: Insight[] }>(`/api/quality-dashboard/insights?from=${from}&to=${to}`)
        .then((r) => r.insights),
    staleTime: 5 * 60 * 1000,
  });

  const roiQ = useQuery<RoiData>({
    queryKey: ["qd-roi", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ roi: RoiData }>(`/api/quality-dashboard/roi?from=${from}&to=${to}`)
        .then((r) => r.roi),
    staleTime: 5 * 60 * 1000,
  });

  const insights = insightsQ.data ?? [];
  const roi = roiQ.data;

  return (
    <div className="space-y-5">
      {/* Insights */}
      <PanelShell title="AI Quality Insights" subtitle="Detected patterns, anomalies and improvement opportunities">
        {insightsQ.isLoading ? (
          <Spinner size="sm" />
        ) : insightsQ.isError ? (
          <ErrBanner msg="Failed to load insights" />
        ) : insights.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No insights generated for this period</p>
        ) : (
          <div className="space-y-3">
            {insights.map((ins, i) => (
              <InsightCard key={i} insight={ins} />
            ))}
          </div>
        )}
      </PanelShell>

      {/* ROI Calculator */}
      {(roiQ.isLoading || roiQ.isError || roi) && (
        <PanelShell
          title="ROI Improvement Projections"
          subtitle="Illustrative scenario, not a measured prediction — see assumptions below"
          action={
            roi && (
              <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                <TrendingUp className="h-3.5 w-3.5" />
                Current quality: {roi.current_metrics.quality}%
              </div>
            )
          }
        >
          {roiQ.isLoading ? (
            <Spinner size="sm" />
          ) : roiQ.isError ? (
            <ErrBanner msg="Failed to load ROI projections" />
          ) : !roi?.projections?.length ? (
            <p className="py-6 text-center text-sm text-slate-400">No ROI projections available</p>
          ) : (
            <>
              {roi.assumptions_note && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
                  {roi.assumptions_note}
                </p>
              )}
              {/* Current baseline */}
              {roi.current_metrics && (
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Current Quality",    val: `${roi.current_metrics.quality}%` },
                    { label: "Conversion Rate",    val: roi.current_metrics.conversion },
                    { label: "Total Calls",        val: safeNum(roi.current_metrics.total_calls).toLocaleString() },
                    { label: "Total Sales",        val: safeNum(roi.current_metrics.total_sales).toLocaleString() },
                  ].map(({ label, val }) => (
                    <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-400">{label}</p>
                      <p className="mt-0.5 text-base font-black tabular-nums text-slate-900">{val}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Projection scenarios */}
              <div className="space-y-3">
                {roi.projections.map((p, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-white p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-800">{p.label}</span>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-700">
                        {p.roi_multiple}× ROI
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      {[
                        { label: "Quality",         val: `${p.current_quality}% → ${p.projected_quality}%` },
                        { label: "Conversion",      val: `${p.current_conversion} → ${p.projected_conversion}` },
                        { label: "Add. Sales",      val: `+${p.additional_sales}` },
                        { label: "Add. Revenue",    val: `₹${safeNum(p.additional_revenue).toLocaleString()}` },
                      ].map(({ label, val }) => (
                        <div key={label}>
                          <p className="text-slate-400">{label}</p>
                          <p className="font-bold text-slate-900">{val}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </PanelShell>
      )}
    </div>
  );
}
