import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { safeNum } from "./types";
import { Spinner, ErrBanner, PanelShell } from "./shared";

interface Props {
  from: string;
  to: string;
  queryKey: unknown[];
}

interface IbKpis {
  total_audited: number;
  avg_cq_score: number;
  fatal_count: number;
  fatal_pct: number;
}

interface TopAgent {
  agent: string;
  calls: number;
  score: number;
}

interface DailyPoint {
  date: string;
  avg_score: number;
  audit_count: number;
}

interface FatalData {
  total_fatal: number;
  fatal_pct: number;
  top_contributors: { agent?: string; agent_name?: string; count: number }[];
}

export function InboundQualityPanel({ from, to, queryKey }: Props) {
  const qs = `startDate=${from}&endDate=${to}`;

  const kpisQ = useQuery<IbKpis>({
    queryKey: ["ib-kpis", ...queryKey],
    queryFn: () =>
      hrmsApi.get<{ data: { kpis?: Record<string, unknown> } }>(`/api/inbound-quality/kpis?${qs}`).then((r) => {
        const k = ((r as unknown as { data: { kpis?: Record<string, unknown> } }).data.kpis) ?? {};
        return {
          total_audited: safeNum(k.audit_count),
          avg_cq_score: safeNum(k.cq_score),
          fatal_count: safeNum(k.fatal_count),
          fatal_pct: safeNum(k.fatal_pct),
        };
      }),
    staleTime: 5 * 60 * 1000,
  });

  const topQ = useQuery<TopAgent[]>({
    queryKey: ["ib-top", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ data: { user?: string; agent?: string; audit_count?: number; calls?: number; avg_score?: number; score?: number }[] }>(
          `/api/inbound-quality/top-performers?${qs}`,
        )
        .then((r) =>
          ((r as unknown as { data: unknown[] }).data ?? []).map((a: unknown) => {
            const ag = a as Record<string, unknown>;
            return {
              agent: String(ag.user ?? ag.agent ?? ""),
              calls: safeNum(ag.audit_count ?? ag.calls),
              score: safeNum(ag.avg_score ?? ag.score),
            };
          }),
        ),
    staleTime: 5 * 60 * 1000,
  });

  const dailyQ = useQuery<DailyPoint[]>({
    queryKey: ["ib-daily", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ data: { call_date?: string; date?: string; avg_score: number; audit_count: number }[] }>(
          `/api/inbound-quality/daily-scores?${qs}`,
        )
        .then((r) =>
          ((r as unknown as { data: unknown[] }).data ?? []).map((d: unknown) => {
            const row = d as Record<string, unknown>;
            return {
              date: String(row.call_date ?? row.date ?? ""),
              avg_score: safeNum(row.avg_score),
              audit_count: safeNum(row.audit_count),
            };
          }),
        ),
    staleTime: 5 * 60 * 1000,
  });

  const fatalQ = useQuery<FatalData>({
    queryKey: ["ib-fatal", ...queryKey],
    queryFn: () =>
      hrmsApi.get<{ data: unknown }>(`/api/inbound-quality/fatal-analysis?${qs}`).then((r) => {
        const d = (r as unknown as { data: Record<string, unknown> }).data ?? {};
        const k = (d.kpis as Record<string, unknown>) ?? {};
        return {
          total_fatal: safeNum(k.fatal_count),
          fatal_pct: safeNum(k.fatal_pct),
          top_contributors: ((d.top_contributors as unknown[]) ?? []).map((c: unknown) => {
            const row = c as Record<string, unknown>;
            return { agent: String(row.agent_name ?? row.agent ?? ""), count: safeNum(row.fatal_count ?? row.count) };
          }),
        };
      }),
    staleTime: 5 * 60 * 1000,
  });

  const kpis = kpisQ.data;
  const daily = dailyQ.data ?? [];

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Audited",   val: kpis?.total_audited ?? 0,                     color: "bg-blue-50 border-blue-100" },
          { label: "Avg CQ Score",    val: `${(kpis?.avg_cq_score ?? 0).toFixed(1)}%`,   color: "bg-emerald-50 border-emerald-100" },
          { label: "Fatal Calls",     val: kpis?.fatal_count ?? 0,                        color: "bg-red-50 border-red-100" },
          { label: "Fatal %",         val: `${(kpis?.fatal_pct ?? 0).toFixed(1)}%`,       color: "bg-orange-50 border-orange-100" },
        ].map(({ label, val, color }) => (
          <div key={label} className={`rounded-xl border p-3 ${color}`}>
            <p className="text-[11px] font-semibold text-slate-500">{label}</p>
            <p className="mt-0.5 text-xl font-black tabular-nums text-slate-900">{kpisQ.isLoading ? "…" : val}</p>
          </div>
        ))}
      </div>

      {/* Daily trend */}
      <PanelShell title="Daily CQ Score" subtitle="Inbound quality score trend">
        {dailyQ.isLoading ? (
          <Spinner size="sm" />
        ) : dailyQ.isError ? (
          <ErrBanner msg="Failed to load daily scores" />
        ) : daily.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No data</p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={daily} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ibGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1baf7a" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#1baf7a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", fontSize: 12 }} formatter={(v: number) => [`${v}%`, "CQ Score"]} />
              <Area type="monotone" dataKey="avg_score" stroke="#1baf7a" strokeWidth={2.5} fill="url(#ibGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </PanelShell>

      {/* Top performers + fatal contributors */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelShell title="Top Performers" subtitle="Highest CQ scores — inbound">
          {topQ.isLoading ? (
            <Spinner size="sm" />
          ) : (topQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No data</p>
          ) : (
            <div className="space-y-2">
              {(topQ.data ?? []).slice(0, 5).map((a, i) => (
                <div key={a.agent} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="text-sm font-black text-slate-300 tabular-nums">{i + 1}</span>
                  <span className="flex-1 truncate text-sm font-semibold text-slate-800">{a.agent}</span>
                  <span className="text-xs text-slate-400">{a.calls} calls</span>
                  <span className="font-bold text-emerald-700 tabular-nums">{a.score.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </PanelShell>

        <PanelShell title="Fatal Contributors" subtitle="Agents with most fatal-flagged calls">
          {fatalQ.isLoading ? (
            <Spinner size="sm" />
          ) : (fatalQ.data?.top_contributors ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No fatal calls in period</p>
          ) : (
            <div className="space-y-2">
              {(fatalQ.data?.top_contributors ?? []).slice(0, 5).map((c, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                  <span className="text-sm font-black text-red-200 tabular-nums">{i + 1}</span>
                  <span className="flex-1 truncate text-sm font-semibold text-slate-800">{c.agent}</span>
                  <span className="font-bold text-red-600 tabular-nums">{c.count} fatal</span>
                </div>
              ))}
            </div>
          )}
        </PanelShell>
      </div>
    </div>
  );
}
