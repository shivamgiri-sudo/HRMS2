import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { safeNum } from "./types";
import { Spinner, ErrBanner, PanelShell } from "./shared";

interface Props {
  from: string;
  to: string;
  clientId: string;
  queryKey: unknown[];
}

interface VocQuote {
  call_date: string;
  agent_name: string;
  client: string;
  branch: string;
  positive_quote: string | null;
  negative_quote: string | null;
}

interface VocSummaryRow {
  branch: string;
  positive_count: number;
  negative_count: number;
  total_calls: number;
}

interface ClapIntel {
  summary: {
    positive_voc_count: number;
    negative_voc_count: number;
    avg_cq_score: number;
    total_audits: number;
  };
  insights: string[];
}

export function ClapVocPanel({ from, to, clientId, queryKey }: Props) {
  const qs = `startDate=${from}&endDate=${to}${clientId ? `&clientId=${clientId}` : ""}`;

  const quotesQ = useQuery<VocQuote[]>({
    queryKey: ["clap-voc", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ data: VocQuote[] }>(`/api/inbound-quality/clap-voc-quotes?${qs}`)
        .then((r) => (r as unknown as { data: VocQuote[] }).data ?? []),
    staleTime: 5 * 60 * 1000,
  });

  const summaryQ = useQuery<VocSummaryRow[]>({
    queryKey: ["clap-summary", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ data: VocSummaryRow[] }>(`/api/inbound-quality/clap-product-voc-summary?${qs}`)
        .then((r) => (r as unknown as { data: VocSummaryRow[] }).data ?? []),
    staleTime: 5 * 60 * 1000,
  });

  const intelQ = useQuery<ClapIntel | null>({
    queryKey: ["clap-intel", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ data: ClapIntel }>(`/api/inbound-quality/clap-intelligence?${qs}`)
        .then((r) => (r as unknown as { data: ClapIntel }).data ?? null),
    staleTime: 5 * 60 * 1000,
  });

  const intel = intelQ.data;
  const summaryRows = summaryQ.data ?? [];
  const quotes = quotesQ.data ?? [];

  const chartData = summaryRows.map((r) => ({
    branch: r.branch.length > 12 ? `${r.branch.slice(0, 12)}…` : r.branch,
    Positive: r.positive_count,
    Negative: r.negative_count,
  }));

  return (
    <div className="space-y-4">
      {/* Intel KPI strip */}
      {intel && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Positive VOC",  val: intel.summary.positive_voc_count, color: "bg-emerald-50 border-emerald-100 text-emerald-700" },
            { label: "Negative VOC",  val: intel.summary.negative_voc_count, color: "bg-red-50 border-red-100 text-red-700" },
            { label: "Avg CQ Score",  val: `${intel.summary.avg_cq_score.toFixed(1)}%`, color: "bg-blue-50 border-blue-100 text-blue-700" },
            { label: "Total Audits",  val: intel.summary.total_audits, color: "bg-slate-50 border-slate-100 text-slate-700" },
          ].map(({ label, val, color }) => (
            <div key={label} className={`rounded-xl border p-3 ${color.split(" ").slice(0, 2).join(" ")}`}>
              <p className="text-[11px] font-semibold text-slate-500">{label}</p>
              <p className={`mt-0.5 text-xl font-black tabular-nums ${color.split(" ")[2]}`}>{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* VOC by branch chart */}
      <PanelShell title="VOC by Branch" subtitle="Positive vs negative voice-of-customer mentions per branch">
        {summaryQ.isLoading ? (
          <Spinner size="sm" />
        ) : summaryQ.isError ? (
          <ErrBanner msg="Failed to load VOC summary" />
        ) : chartData.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No VOC data for this period</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="branch" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", fontSize: 12 }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Positive" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Negative" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </PanelShell>

      {/* AI Insights strip */}
      {intel?.insights && intel.insights.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-blue-600">Intelligence Summary</p>
          <ul className="space-y-1.5">
            {intel.insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-blue-800">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quote cards */}
      <PanelShell title="VOC Quotes" subtitle="Recent positive and negative customer voice excerpts">
        {quotesQ.isLoading ? (
          <Spinner size="sm" />
        ) : quotes.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No quotes in this period</p>
        ) : (
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {quotes.slice(0, 20).map((q, i) => (
              <div key={i} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 truncate">{q.agent_name}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{q.call_date}</span>
                </div>
                {q.positive_quote && (
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    <span className="font-semibold">+ </span>{q.positive_quote}
                  </p>
                )}
                {q.negative_quote && (
                  <p className="text-xs text-red-700 leading-relaxed mt-1">
                    <span className="font-semibold">− </span>{q.negative_quote}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </PanelShell>
    </div>
  );
}
