import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sparkles, Trophy, ArrowRight, X, Flame, Zap } from "lucide-react";

interface EngagementSummary {
  total_points: number;
  current_streak?: number;
  badges_earned: any[];
  tier_name?: string;
}

export function EngagementPromoBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<EngagementSummary | null>({
    queryKey: ["dashboard-engagement-me"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: EngagementSummary }>("/api/engagement/me");
      return res.data ?? null;
    },
    staleTime: 5 * 60_000,
  });

  if (dismissed) return null;

  const pts = data?.total_points ?? 0;
  const streak = data?.current_streak ?? 0;
  const badges = data?.badges_earned?.length ?? 0;
  const tier = data?.tier_name ?? "Bronze";

  const activities = [
    { icon: <Zap className="h-3.5 w-3.5 text-amber-500" />, label: "Daily tip", pts: "+2 pts" },
    { icon: <Trophy className="h-3.5 w-3.5 text-indigo-500" />, label: "Trivia", pts: "+10 pts" },
    { icon: <Flame className="h-3.5 w-3.5 text-orange-500" />, label: "Login streak", pts: "+5 pts" },
    { icon: <Sparkles className="h-3.5 w-3.5 text-violet-500" />, label: "Word puzzle", pts: "+50 pts" },
  ];

  return (
    // data-keep-gradient: this banner's gradient is its surface, not decoration.
    // Without it the role-dashboard-reference scope strips the background and the
    // white text below becomes invisible.
    <div
      data-keep-gradient
      className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-700 p-px shadow-lg shadow-indigo-500/20"
    >
      {/* Inner content */}
      <div
        data-keep-gradient
        className="relative rounded-[calc(1rem-1px)] bg-gradient-to-r from-violet-600/95 via-indigo-600/95 to-blue-700/95 px-5 py-4"
      >
        {/* Background glow */}
        <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-8 left-20 h-24 w-24 rounded-full bg-pink-400/20 blur-2xl" />

        {/* Dismiss */}
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-3 top-3 rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: headline + stats */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-300 flex-shrink-0" />
              <p className="text-sm font-bold text-white">Boost your engagement today!</p>
            </div>

            {/* Mini stats */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                <Trophy className="h-3 w-3 text-amber-300" />
                {pts.toLocaleString()} pts
              </span>
              {streak > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  <Flame className="h-3 w-3 text-orange-300" />
                  {streak}-day streak
                </span>
              )}
              {badges > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  🏅 {badges} badge{badges !== 1 ? "s" : ""}
                </span>
              )}
              <span className="rounded-full bg-amber-400/30 border border-amber-300/40 px-2.5 py-0.5 text-[11px] font-bold text-amber-200">
                {tier} tier
              </span>
            </div>

            {/* Activity pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-white/60 font-medium">Earn today:</span>
              {activities.map((a, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80">
                  {a.icon}
                  {a.label} <span className="font-bold text-white/90">{a.pts}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Right: CTA */}
          <Link
            to="/engagement"
            className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-indigo-700 shadow-lg hover:bg-indigo-50 transition-colors flex-shrink-0 self-start sm:self-center"
          >
            Open Engagement
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
