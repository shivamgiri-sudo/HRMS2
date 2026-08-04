import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Medal, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { TierBadge } from "@/components/engagement/TierBadge";

type Period = "day" | "week" | "month" | "year";

interface LeaderboardEntry {
  employee_id: string;
  employee_name: string;
  total_points: number;
  current_tier: string;
  rank: number;
  badges_earned: number;
}

const PERIOD_LABELS: Record<Period, string> = {
  day:   "Yesterday",
  week:  "This Week",
  month: "This Month",
  year:  "This Year",
};

const RANK_CONFIG = [
  { icon: <Trophy className="h-4 w-4 text-amber-500" />, bg: "bg-amber-50", text: "text-amber-700" },
  { icon: <Medal  className="h-4 w-4 text-slate-400" />, bg: "bg-slate-100", text: "text-slate-600" },
  { icon: <Medal  className="h-4 w-4 text-orange-400"/>, bg: "bg-orange-50", text: "text-orange-600" },
];

export function PointsLeaderboard({ currentEmployeeId }: { currentEmployeeId?: string }) {
  const [period, setPeriod] = useState<Period>("month");

  const { data, isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["engagement-leaderboard", period],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: LeaderboardEntry[] }>(
        `/api/engagement/leaderboard?period=${period}&limit=5`
      );
      return res.data ?? [];
    },
    staleTime: 60_000,
  });

  return (
    <Card className="rounded-[2rem] border-0 shadow-xl shadow-slate-200/40 bg-white overflow-hidden">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-black flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            Top Points Gainers
          </CardTitle>
        </div>
        {/* Period tabs */}
        <div className="flex gap-1 mt-2 bg-slate-100 p-1 rounded-xl">
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "flex-1 text-xs font-semibold rounded-lg py-1.5 px-2 transition-all",
                period === p
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5 space-y-2">
        {isLoading ? (
          Array(5).fill(0).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <Skeleton className="h-8 w-8 rounded-xl" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center gap-2">
            <Star className="h-8 w-8 text-slate-200" />
            <p className="text-sm text-slate-400 font-medium">No activity yet</p>
            <p className="text-xs text-slate-300">
              {period === "day" ? "No points earned yesterday" : `Be the first to earn points ${PERIOD_LABELS[period].toLowerCase()}!`}
            </p>
          </div>
        ) : (
          data.map((entry, idx) => {
            const isMe = entry.employee_id === currentEmployeeId;
            const rankCfg = RANK_CONFIG[idx] ?? null;

            return (
              <div
                key={entry.employee_id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl p-3 transition-colors",
                  isMe ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"
                )}
              >
                {/* Rank badge */}
                <div className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black",
                  rankCfg ? cn(rankCfg.bg, rankCfg.text) : "bg-slate-100 text-slate-500"
                )}>
                  {idx < 3 ? rankCfg!.icon : <span>{idx + 1}</span>}
                </div>

                {/* Name + tier */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-bold truncate",
                    isMe ? "text-indigo-700" : "text-slate-900"
                  )}>
                    {entry.employee_name}{isMe ? " (You)" : ""}
                  </p>
                  <TierBadge tier={entry.current_tier} />
                </div>

                {/* Points */}
                <div className="text-right shrink-0">
                  <p className={cn(
                    "text-sm font-black tabular-nums",
                    idx === 0 ? "text-amber-600" : isMe ? "text-indigo-600" : "text-slate-700"
                  )}>
                    {Number(entry.total_points).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-400">pts</p>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export default PointsLeaderboard;
