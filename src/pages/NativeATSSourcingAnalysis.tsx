import { useEffect, useState } from "react";
import {
  AlertTriangle, BarChart3, Clock, Loader, RefreshCcw, TrendingUp, Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type BySource = Record<string, number>;
type ByStage = Record<string, number>;

type AtsStats = {
  total_candidates: number;
  by_stage: ByStage;
  by_source: BySource;
  conversion_rate: number;
  time_to_hire_avg: number;
};

type SourcingChannel = {
  id: string;
  name: string;
};

// Pipeline stages in order
const PIPELINE_STAGES = [
  "Applied",
  "Screening",
  "Interview",
  "Offer",
  "Joined",
  "Converted",
] as const;

type PipelineStage = (typeof PIPELINE_STAGES)[number];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon,
  tone,
  suffix = "",
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  tone: string;
  suffix?: string;
}) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            {value}
            {suffix}
          </p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function NativeATSSourcingAnalysis() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<AtsStats | null>(null);
  const [channels, setChannels] = useState<SourcingChannel[]>([]);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [statsRes, channelsRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: AtsStats }>("/api/ats/stats"),
        hrmsApi.get<{ success: boolean; data: SourcingChannel[] }>(
          "/api/ats/sourcing-channels"
        ),
      ]);
      setStats(statsRes.data ?? null);
      setChannels(channelsRes.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unable to load ATS data";
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────────

  // Build pipeline funnel data from by_stage
  // "Converted" maps to the 'converted' stage key in ats_candidate
  const pipelineFunnel = PIPELINE_STAGES.map((stage) => {
    const key = stage.toLowerCase();
    let count = stats?.by_stage?.[key] ?? stats?.by_stage?.[stage] ?? 0;
    if (stage === "Converted") {
      // Also check alternate key spellings
      count = stats?.by_stage?.["converted"] ?? stats?.by_stage?.["Converted"] ?? 0;
    }
    return { stage, count };
  });

  const maxPipelineCount = Math.max(...pipelineFunnel.map((s) => s.count), 1);

  // Build sorted source list (by count desc)
  const sourceEntries: Array<{ source: string; count: number }> = Object.entries(
    stats?.by_source ?? {}
  )
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const maxSourceCount = Math.max(...sourceEntries.map((s) => s.count), 1);

  // Resolve channel name for a source key
  const resolveChannelName = (key: string): string => {
    const match = channels.find(
      (c) => c.id === key || c.name.toLowerCase() === key.toLowerCase()
    );
    return match?.name ?? key.replace(/_/g, " ");
  };

  // Stage funnel colours
  const STAGE_COLOURS: Record<PipelineStage, string> = {
    Applied: "bg-blue-500",
    Screening: "bg-violet-500",
    Interview: "bg-amber-500",
    Offer: "bg-orange-500",
    Joined: "bg-emerald-500",
    Converted: "bg-teal-600",
  };

  // Stage text colours for labels
  const STAGE_TEXT_COLOURS: Record<PipelineStage, string> = {
    Applied: "text-blue-700",
    Screening: "text-violet-700",
    Interview: "text-amber-700",
    Offer: "text-orange-700",
    Joined: "text-emerald-700",
    Converted: "text-teal-700",
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
              ATS
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">
              Sourcing Analysis
            </h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Candidate pipeline funnel, sourcing channel performance, and
              conversion metrics.
            </p>
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Message banner */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {/* ── Summary Stat Cards ──────────────────────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                title="Total Candidates"
                value={stats?.total_candidates ?? 0}
                icon={<Users className="h-5 w-5" />}
                tone="bg-blue-50 text-blue-700"
              />
              <StatCard
                title="Conversion Rate"
                value={
                  stats?.conversion_rate != null
                    ? stats.conversion_rate.toFixed(1)
                    : "0.0"
                }
                suffix="%"
                icon={<TrendingUp className="h-5 w-5" />}
                tone="bg-emerald-50 text-emerald-700"
              />
              <StatCard
                title="Avg Time to Hire"
                value={
                  stats?.time_to_hire_avg != null
                    ? Math.round(stats.time_to_hire_avg)
                    : 0
                }
                suffix=" days"
                icon={<Clock className="h-5 w-5" />}
                tone="bg-amber-50 text-amber-700"
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* ── Pipeline Stage Funnel ─────────────────────────────────────── */}
              <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                <div className="border-b p-5">
                  <h2 className="font-black text-slate-950">Pipeline Funnel</h2>
                  <p className="text-sm text-slate-500">
                    Candidates by recruitment stage
                  </p>
                </div>
                <div className="space-y-3 p-5">
                  {pipelineFunnel.map(({ stage, count }) => {
                    const pct =
                      maxPipelineCount > 0
                        ? Math.max((count / maxPipelineCount) * 100, 2)
                        : 2;
                    const barClass = STAGE_COLOURS[stage];
                    const textClass = STAGE_TEXT_COLOURS[stage];
                    return (
                      <div key={stage} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className={`font-semibold ${textClass}`}>
                            {stage}
                          </span>
                          <span className="font-black text-slate-950">
                            {count.toLocaleString()}
                          </span>
                        </div>
                        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Sourcing Channel Breakdown ────────────────────────────────── */}
              <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                <div className="border-b p-5">
                  <h2 className="font-black text-slate-950">
                    Sourcing Channel Breakdown
                  </h2>
                  <p className="text-sm text-slate-500">
                    Candidates by acquisition channel
                  </p>
                </div>
                {sourceEntries.length === 0 ? (
                  <div className="py-12 text-center text-slate-400">
                    <BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-30" />
                    <p className="font-semibold">No sourcing data available.</p>
                  </div>
                ) : (
                  <div className="space-y-3 p-5">
                    {sourceEntries.map(({ source, count }) => {
                      const pct =
                        maxSourceCount > 0
                          ? Math.max((count / maxSourceCount) * 100, 2)
                          : 2;
                      const sharePct =
                        (stats?.total_candidates ?? 0) > 0
                          ? ((count / stats!.total_candidates) * 100).toFixed(1)
                          : "0.0";
                      return (
                        <div key={source} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-semibold text-slate-700 capitalize">
                              {resolveChannelName(source)}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-slate-400">
                                {sharePct}%
                              </span>
                              <span className="font-black text-slate-950">
                                {count.toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-blue-500 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Top Sources Table ─────────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">Top Sources</h2>
                <p className="text-sm text-slate-500">Ranked by candidate volume</p>
              </div>
              {sourceEntries.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="font-semibold">No source data available.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Rank", "Source", "Candidates", "Share"].map((h) => (
                          <th key={h} className="p-4 font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sourceEntries.map(({ source, count }, idx) => {
                        const sharePct =
                          (stats?.total_candidates ?? 0) > 0
                            ? (
                                (count / stats!.total_candidates) *
                                100
                              ).toFixed(1)
                            : "0.0";
                        return (
                          <tr
                            key={source}
                            className="border-t hover:bg-slate-50/80 transition-colors"
                          >
                            <td className="p-4">
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-700">
                                {idx + 1}
                              </span>
                            </td>
                            <td className="p-4 font-semibold text-slate-950 capitalize">
                              {resolveChannelName(source)}
                            </td>
                            <td className="p-4 font-black text-slate-950">
                              {count.toLocaleString()}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className="h-full rounded-full bg-blue-500"
                                    style={{
                                      width: `${
                                        maxSourceCount > 0
                                          ? Math.max(
                                              (count / maxSourceCount) * 100,
                                              2
                                            )
                                          : 2
                                      }%`,
                                    }}
                                  />
                                </div>
                                <span className="text-xs font-semibold text-slate-500">
                                  {sharePct}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
