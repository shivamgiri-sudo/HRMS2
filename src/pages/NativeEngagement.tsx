import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Award,
  ClipboardList,
  Crown,
  Heart,
  Medal,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KudosCard } from "@/components/engagement/KudosCard";
import { PointsDisplay } from "@/components/engagement/PointsDisplay";
import { TierBadge } from "@/components/engagement/TierBadge";
import type {
  ApiResponse,
  EngagementSummary,
  LeaderboardEntry,
} from "@/components/engagement/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";

export default function NativeEngagement() {
  const [summary, setSummary] = useState<EngagementSummary | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      hrmsApi.get<ApiResponse<EngagementSummary>>("/api/engagement/me"),
      hrmsApi.get<ApiResponse<LeaderboardEntry[]>>(
        "/api/engagement/leaderboard?period=month&limit=5"
      ),
    ])
      .then(([summaryResponse, leaderboardResponse]) => {
        setSummary(summaryResponse.data);
        setLeaders(leaderboardResponse.data);
      })
      .catch((requestError: Error) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout>
      <main className="space-y-8 p-6 lg:p-8">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-700 p-8 text-white shadow-2xl shadow-indigo-200/40">
          <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-pink-400/20 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5" /> My Engagement Hub
              </div>
              <h1 className="text-4xl font-black tracking-tight">
                My Engagement
              </h1>
              <p className="mt-2 max-w-lg text-indigo-100">
                Recognition, participation, and your current tier in one beautiful
                place.
              </p>
            </div>
            <Button
              asChild
              className="rounded-2xl bg-white text-indigo-700 shadow-lg hover:bg-indigo-50 hover:text-indigo-800 font-bold"
            >
              <Link to="/engagement/kudos">Give Kudos</Link>
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 border border-red-100">
            <Zap className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* Metrics */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<Trophy />}
            label="Total Points"
            value={<PointsDisplay points={summary?.total_points ?? 0} />}
            color="from-amber-400 to-orange-500"
            delay={0}
          />
          <MetricCard
            icon={<Medal />}
            label="Badges Earned"
            value={summary?.badges_earned.length ?? 0}
            color="from-blue-400 to-indigo-500"
            delay={1}
          />
          <MetricCard
            icon={<Heart />}
            label="Kudos Received"
            value={summary?.kudos_received.length ?? 0}
            color="from-rose-400 to-pink-500"
            delay={2}
          />
          <MetricCard
            icon={<ClipboardList />}
            label="Surveys Completed"
            value={summary?.surveys_completed ?? 0}
            color="from-emerald-400 to-teal-500"
            delay={3}
          />
        </div>

        {/* Tier + Leaderboard */}
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          {/* Tier Progress */}
          <Card className="relative overflow-hidden rounded-[2rem] border-0 bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-2xl shadow-slate-900/20">
            <div className="absolute right-0 top-0 h-40 w-40 bg-gradient-to-br from-violet-500/20 to-transparent rounded-bl-full" />
            <CardHeader className="relative">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl font-black flex items-center gap-2">
                    <Crown className="h-5 w-5 text-amber-400" /> Tier Progress
                  </CardTitle>
                  <p className="mt-1 text-sm text-slate-300">
                    You're making great progress!
                  </p>
                </div>
                <TierBadge tier={summary?.current_tier} />
              </div>
            </CardHeader>
            <CardContent className="relative space-y-6">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-300">
                    {summary?.progress_percentage ?? 0}% to next tier
                  </span>
                  <span className="text-xs font-bold text-slate-400">LEVEL UP</span>
                </div>
                <div className="h-4 rounded-full bg-slate-700/50 p-1">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 transition-all duration-1000 ease-out"
                    style={{ width: `${summary?.progress_percentage ?? 0}%` }}
                  />
                </div>
              </div>
              <p className="text-sm text-slate-300">
                {summary?.points_to_next_tier == null ? (
                  "
                ) : (
                  <>
                    <span className="font-bold text-white">
                      {summary.points_to_next_tier.toLocaleString()} points
                    </span>{" "}
                    to your next tier milestone.
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  asChild
                  variant="outline"
                  className="rounded-2xl border-slate-600 bg-slate-800/50 text-slate-200 hover:bg-slate-700 hover:text-white"
                >
                  <Link to="/engagement/badges">Explore Badges</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="rounded-2xl border-slate-600 bg-slate-800/50 text-slate-200 hover:bg-slate-700 hover:text-white"
                >
                  <Link to="/engagement/surveys">Open Surveys</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Leaderboard */}
          <Card className="rounded-[2rem] border-0 shadow-xl shadow-slate-200/40 bg-white">
            <CardHeader className="flex-row items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <CardTitle className="text-lg font-black">Monthly Leaders</CardTitle>
                <p className="text-xs text-slate-400 font-medium">Top performers this month</p>
              </div>
              <Link
                to="/engagement/leaderboard"
                className="text-sm font-bold text-indigo-600 hover:text-indigo-700"
              >
                View all →
              </Link>
            </CardHeader>
            <CardContent className="space-y-2 pt-4">
              {leaders.length === 0 && (
                <p className="text-sm text-slate-400 py-4">Leaderboard points will appear here.</p>
              )}
              {leaders.map((leader, idx) => (
                <div
                  key={leader.employee_id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 hover:bg-indigo-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-black ${
                        idx === 0
                          ? "bg-amber-100 text-amber-700"
                          : idx === 1
                          ? "bg-slate-200 text-slate-700"
                          : idx === 2
                          ? "bg-orange-100 text-orange-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">
                        {leader.employee_name}
                      </p>
                      <TierBadge tier={leader.current_tier} />
                    </div>
                  </div>
                  <PointsDisplay points={leader.total_points} compact />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Recent Kudos */}
        <Card className="rounded-[2rem] border-0 shadow-xl shadow-slate-200/40 bg-white overflow-hidden">
          <CardHeader className="flex-row items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <CardTitle className="text-lg font-black flex items-center gap-2">
                <Heart className="h-5 w-5 text-rose-500" /> Recent Appreciation
              </CardTitle>
              <p className="text-xs text-slate-400 font-medium">Kudos you've received</p>
            </div>
            <Link
              to="/engagement/kudos"
              className="text-sm font-bold text-indigo-600 hover:text-indigo-700"
            >
              Open kudos wall →
            </Link>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid gap-3 md:grid-cols-2">
              {(summary?.kudos_received ?? []).length === 0 && (
                <p className="text-sm text-slate-400 col-span-full py-4">
                  Your received kudos will show up here.
                </p>
              )}
              {summary?.kudos_received.map((kudos) => (
                <KudosCard key={kudos.kudos_id} kudos={kudos} />
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </DashboardLayout>
  );
}

function MetricCard({
  icon,
  label,
  value,
  color,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  color: string;
  delay: number;
}) {
  return (
    <Card className="group relative overflow-hidden rounded-[2rem] border-0 bg-white shadow-lg shadow-slate-200/30 hover:shadow-xl hover:shadow-slate-300/40 transition-all duration-300 hover:-translate-y-1">
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-lg shadow-current/30 [&>svg]:h-6 [&>svg]:w-6 transition-transform duration-300 group-hover:scale-110`}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
