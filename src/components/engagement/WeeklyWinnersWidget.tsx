import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Medal, Sparkles, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  employee_id: string;
  employee_name: string;
  total_points: number;
  current_tier: string;
  rank: number;
  badges_earned: number;
}

const PODIUM = [
  {
    rank: 1,
    icon: <Crown className="h-4 w-4" />,
    bg: "bg-gradient-to-br from-amber-400 to-yellow-500",
    ring: "ring-2 ring-amber-300",
    label: "text-amber-700",
    size: "h-14 w-14",
    order: "order-2",
    height: "pt-0",
  },
  {
    rank: 2,
    icon: <Medal className="h-3.5 w-3.5" />,
    bg: "bg-gradient-to-br from-slate-300 to-slate-400",
    ring: "ring-2 ring-slate-200",
    label: "text-slate-600",
    size: "h-11 w-11",
    order: "order-1",
    height: "pt-3",
  },
  {
    rank: 3,
    icon: <Medal className="h-3.5 w-3.5" />,
    bg: "bg-gradient-to-br from-orange-300 to-amber-400",
    ring: "ring-2 ring-orange-200",
    label: "text-orange-700",
    size: "h-10 w-10",
    order: "order-3",
    height: "pt-5",
  },
];

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

export function WeeklyWinnersWidget({ currentEmployeeId }: { currentEmployeeId?: string }) {
  const { data, isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["engagement-leaderboard", "week"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: LeaderboardEntry[] }>(
        "/api/engagement/leaderboard?period=week&limit=3"
      );
      return res.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const top3 = data?.slice(0, 3) ?? [];
  const myRank = data?.find(e => e.employee_id === currentEmployeeId);

  return (
    <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 via-indigo-50 to-purple-50 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">Weekly Top Achievers</p>
            <p className="text-[11px] text-slate-400">This week's engagement leaders</p>
          </div>
        </div>
        <Link
          to="/engagement/leaderboard"
          className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700 transition-colors"
        >
          Full board <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Podium */}
      {isLoading ? (
        <div className="flex items-end justify-center gap-3 px-4 pb-4 pt-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-11 w-11 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : top3.length === 0 ? (
        <div className="px-4 pb-4 pt-2 text-center text-xs text-slate-400">
          No data yet — be the first to earn points this week!
        </div>
      ) : (
        <div className="flex items-end justify-center gap-2 px-4 pb-3 pt-1">
          {PODIUM.map(({ rank, icon, bg, ring, label, size, order, height }) => {
            const entry = top3.find(e => e.rank === rank);
            if (!entry) return null;
            const isMe = entry.employee_id === currentEmployeeId;
            const firstName = entry.employee_name.split(" ")[0];

            return (
              <div key={rank} className={cn("flex flex-col items-center gap-1.5", order, height)}>
                {/* Avatar */}
                <div className={cn(
                  "relative flex items-center justify-center rounded-full text-white font-black text-xs shadow-md",
                  size, bg, ring,
                  isMe && "outline outline-2 outline-offset-2 outline-violet-500"
                )}>
                  {initials(entry.employee_name)}
                  {/* Rank badge */}
                  <div className={cn(
                    "absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm text-[10px] font-black",
                    label
                  )}>
                    {icon}
                  </div>
                </div>
                {/* Name */}
                <p className={cn(
                  "text-[11px] font-bold text-center max-w-[60px] truncate",
                  isMe ? "text-violet-700" : "text-slate-700"
                )}>
                  {isMe ? "You" : firstName}
                </p>
                {/* Points */}
                <p className="text-[10px] text-slate-400 font-medium">
                  {entry.total_points.toLocaleString()} pts
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* My rank strip */}
      {myRank && myRank.rank > 3 && (
        <div className="mx-4 mb-3 rounded-xl bg-white/70 border border-violet-100 px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-slate-500">Your rank</span>
          <span className="text-sm font-black text-violet-700">#{myRank.rank}</span>
          <span className="text-xs text-slate-400">{myRank.total_points} pts</span>
        </div>
      )}

      {/* CTA */}
      <Link
        to="/engagement"
        data-keep-gradient
        className="mx-4 mb-4 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-xs font-bold text-white shadow-md shadow-violet-500/20 hover:from-violet-700 hover:to-indigo-700 transition-all"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Earn points today
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
