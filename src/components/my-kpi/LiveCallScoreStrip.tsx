import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp, AlertTriangle, CheckCircle, Activity } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface CqScoreData {
  cq_score_current: number | null;
  cq_score_7day_avg: number | null;
  cq_score_30day_avg: number | null;
  target: number | null;
  gap_pct: number | null;
  trend_7day: number | null;
  rank: { position: number; total_agents: number } | null;
  peer_avg: number | null;
  status: string | null;
}

type Props = {
  refetchInterval?: number;
  showLiveBadge?: boolean;
};

export function LiveCallScoreStrip({ refetchInterval = 30_000, showLiveBadge = false }: Props) {
  const { data, isLoading, error } = useQuery<CqScoreData>({
    queryKey: ["live-cq-score", "7d"],
    queryFn: () => hrmsApi.get("/api/agent/cq-score?daysBack=7").then((r) => r.data?.data ?? r.data),
    refetchInterval,
    staleTime: 25_000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 animate-pulse">
        <div className="h-4 w-48 bg-slate-100 rounded mb-2" />
        <div className="h-8 w-32 bg-slate-100 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
        <Activity size={16} className="text-slate-400 flex-shrink-0" />
        <p className="text-xs text-slate-500">Call quality data unavailable — contact your quality team.</p>
      </div>
    );
  }

  const score = data?.cq_score_current ?? data?.cq_score_7day_avg ?? null;
  const hasNoData = score === null || score === 0;

  if (!data || hasNoData) {
    return (
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-3">
        <Activity size={16} className="text-blue-400 flex-shrink-0" />
        <p className="text-xs text-blue-600">
          {showLiveBadge && <span className="inline-flex items-center gap-1 mr-2"><span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />LIVE </span>}
          No scored calls yet for this period. Quality scores appear once your team completes call audits.
        </p>
      </div>
    );
  }

  const target = data.target ?? 80;
  const gap = data.gap_pct ?? 0;
  const trend = (data as { trend_7day?: { change_pct?: number } | null }).trend_7day?.change_pct ?? 0;
  const isOnTarget = score >= target;
  const isCritical = score < target * 0.85;

  return (
    <div className={`rounded-xl border shadow-sm p-4 ${
      isCritical ? "bg-rose-50 border-rose-200" : isOnTarget ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
    }`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Left: score + label */}
        <div className="flex items-center gap-3">
          {showLiveBadge && (
            <div className="flex items-center gap-1.5 bg-white/70 border border-current/20 px-2 py-0.5 rounded-full">
              <span className={`h-2 w-2 rounded-full animate-pulse ${isCritical ? "bg-rose-500" : isOnTarget ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-600">LIVE</span>
            </div>
          )}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Call Quality Score</p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className={`text-3xl font-extrabold font-mono ${isCritical ? "text-rose-700" : isOnTarget ? "text-emerald-700" : "text-amber-700"}`}>
                {score > 0 ? `${Math.round(score * 10) / 10}%` : "—"}
              </span>
              <span className="text-sm text-slate-400">/ {target}% target</span>
            </div>
          </div>
        </div>

        {/* Middle: trend + rank */}
        <div className="flex items-center gap-4">
          {trend !== 0 && (
            <div className="flex items-center gap-1.5">
              {trend > 0 ? (
                <TrendingUp size={16} className="text-emerald-600" />
              ) : (
                <TrendingDown size={16} className="text-rose-600" />
              )}
              <span className={`text-sm font-bold ${trend > 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {trend > 0 ? "+" : ""}{Math.round(trend * 10) / 10}% vs last week
              </span>
            </div>
          )}
          {data.rank && (
            <div className="flex items-center gap-1.5">
              <Activity size={14} className="text-slate-400" />
              <span className="text-xs text-slate-600">
                Rank <span className="font-bold text-slate-900">#{data.rank.position}</span> of {data.rank.total_agents}
              </span>
            </div>
          )}
        </div>

        {/* Right: status badge */}
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs ${
          isCritical
            ? "bg-rose-100 text-rose-700 border border-rose-200"
            : isOnTarget
            ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
            : "bg-amber-100 text-amber-700 border border-amber-200"
        }`}>
          {isCritical ? (
            <AlertTriangle size={13} />
          ) : isOnTarget ? (
            <CheckCircle size={13} />
          ) : (
            <AlertTriangle size={13} />
          )}
          {isCritical ? "Needs Attention" : isOnTarget ? "On Track" : `${Math.abs(Math.round(gap))}% below target`}
        </div>
      </div>

      {/* Peer avg row */}
      {data.peer_avg != null && (
        <div className="mt-3 pt-3 border-t border-white/50 flex items-center gap-2 text-xs text-slate-600">
          <span className="font-medium">Peer avg:</span>
          <span className="font-bold text-slate-900">{Math.round(data.peer_avg * 10) / 10}%</span>
          {score > data.peer_avg ? (
            <span className="text-emerald-600 font-medium">You're {Math.round((score - data.peer_avg) * 10) / 10}% above peers</span>
          ) : (
            <span className="text-rose-600 font-medium">You're {Math.round((data.peer_avg - score) * 10) / 10}% below peers</span>
          )}
        </div>
      )}
    </div>
  );
}
