import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  FunnelChart, Funnel, LabelList,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import type { SalesSummary, Competitor, SalesFunnel, RejectionReason } from "./types";
import { safeNum } from "./types";
import { Spinner, ErrBanner, PanelShell } from "./shared";

interface Props {
  from: string;
  to: string;
  clientId: string;
  queryKey: unknown[];
}

const FUNNEL_COLORS = ["#94a3b8", "#5b93dd", "#2a78d6", "#1f8fa8", "#1baf7a"];

export function SalesFunnelPanel({ from, to, clientId, queryKey }: Props) {
  const qs = `from=${from}&to=${to}${clientId ? `&client_id=${clientId}` : ""}`;

  const salesQ = useQuery<{ summary: SalesSummary; top_competitors: Competitor[] }>({
    queryKey: ["qd-sales", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ summary: SalesSummary; top_competitors: Competitor[] }>(
          `/api/quality-dashboard/sales-intelligence?${qs}`,
        )
        .then((r) => r),
    staleTime: 5 * 60 * 1000,
  });

  const funnelQ = useQuery<{ sales_funnel: SalesFunnel; top_rejection_reasons: RejectionReason[] }>({
    queryKey: ["qd-funnel", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ sales_funnel: SalesFunnel; rejection_funnel: unknown; top_rejection_reasons: RejectionReason[] }>(
          `/api/quality-dashboard/sales-funnel?${qs}`,
        )
        .then((r) => ({ sales_funnel: r.sales_funnel, top_rejection_reasons: r.top_rejection_reasons })),
    staleTime: 5 * 60 * 1000,
  });

  const s = salesQ.data?.summary;
  const competitors = salesQ.data?.top_competitors ?? [];
  const funnel = funnelQ.data?.sales_funnel;
  const rejections = funnelQ.data?.top_rejection_reasons ?? [];

  const funnelData = funnel
    ? [
        { name: "Total Calls",       value: safeNum(funnel.total_calls),        fill: FUNNEL_COLORS[0] },
        { name: "Opening Done",      value: safeNum(funnel.opening_done),       fill: FUNNEL_COLORS[1] },
        { name: "Offer Made",        value: safeNum(funnel.offer_made),         fill: FUNNEL_COLORS[2] },
        { name: "Objection Handled", value: safeNum(funnel.objection_handled),  fill: FUNNEL_COLORS[3] },
        { name: "Sale Done",         value: safeNum(funnel.sale_done),          fill: FUNNEL_COLORS[4] },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Sales KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Calls",          val: s?.total_calls ?? 0,          color: "border-slate-100 bg-slate-50" },
          { label: "Sales Done",           val: s?.sales_done ?? 0,           color: "border-emerald-100 bg-emerald-50" },
          { label: "Competitor Mentions",  val: s?.competitor_mentions ?? 0,  color: "border-orange-100 bg-orange-50" },
          { label: "Objection Calls",      val: s?.objection_calls ?? 0,      color: "border-yellow-100 bg-yellow-50" },
        ].map(({ label, val, color }) => (
          <div key={label} className={`rounded-xl border p-3 ${color}`}>
            <p className="text-[11px] font-semibold text-slate-500">{label}</p>
            <p className="mt-0.5 text-xl font-black tabular-nums text-slate-900">
              {salesQ.isLoading ? "…" : safeNum(val).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sales Funnel */}
        <PanelShell title="Sales Conversion Funnel" subtitle="Call-to-sale drop-off at each stage">
          {funnelQ.isLoading ? (
            <Spinner size="sm" />
          ) : funnelQ.isError ? (
            <ErrBanner msg="Failed to load funnel" />
          ) : funnelData.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No funnel data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <FunnelChart>
                <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Funnel dataKey="value" data={funnelData} isAnimationActive>
                  <LabelList position="right" fill="#64748b" stroke="none" dataKey="name" style={{ fontSize: 11 }} />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          )}
        </PanelShell>

        {/* Competitor mentions */}
        <PanelShell title="Competitor Mentions" subtitle="Most cited competitors in call audits">
          {salesQ.isLoading ? (
            <Spinner size="sm" />
          ) : salesQ.isError ? (
            <ErrBanner msg="Failed to load competitor data" />
          ) : competitors.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No competitor data</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={competitors.slice(0, 8)}
                layout="vertical"
                margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
                barSize={12}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="CompetitorName"
                  type="category"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  width={90}
                />
                <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="mentions" fill="#2a78d6" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </PanelShell>
      </div>

      {/* Rejection reasons */}
      {rejections.length > 0 && (
        <PanelShell title="Top Rejection Reasons" subtitle="Why offers are declined">
          <div className="space-y-2">
            {rejections.slice(0, 8).map((r, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-center text-[11px] font-black text-slate-300">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="mb-0.5 flex justify-between text-xs">
                    <span className="truncate font-medium text-slate-700">{r.reason}</span>
                    <span className="shrink-0 ml-2 font-bold text-slate-600">{r.count}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-1.5 rounded-full bg-orange-400 transition-all duration-700"
                      style={{
                        width: `${Math.min((r.count / (rejections[0]?.count || 1)) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PanelShell>
      )}
    </div>
  );
}
