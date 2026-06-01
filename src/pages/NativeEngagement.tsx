import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Award, ClipboardList, Heart, Trophy } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KudosCard } from "@/components/engagement/KudosCard";
import { PointsDisplay } from "@/components/engagement/PointsDisplay";
import { TierBadge } from "@/components/engagement/TierBadge";
import type { ApiResponse, EngagementSummary, LeaderboardEntry } from "@/components/engagement/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";

export default function NativeEngagement() {
  const [summary, setSummary] = useState<EngagementSummary | null>(null);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      hrmsApi.get<ApiResponse<EngagementSummary>>("/api/engagement/me"),
      hrmsApi.get<ApiResponse<LeaderboardEntry[]>>("/api/engagement/leaderboard?period=month&limit=5"),
    ])
      .then(([summaryResponse, leaderboardResponse]) => {
        setSummary(summaryResponse.data);
        setLeaders(leaderboardResponse.data);
      })
      .catch((requestError: Error) => setError(requestError.message));
  }, []);

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">My Engagement</h1>
            <p className="mt-1 text-slate-500">Recognition, participation, and your current tier in one place.</p>
          </div>
          <Button asChild><Link to="/engagement/kudos">Give Kudos</Link></Button>
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={<Trophy />} label="Points" value={<PointsDisplay points={summary?.total_points ?? 0} />} />
          <Metric icon={<Award />} label="Badges earned" value={summary?.badges_earned.length ?? 0} />
          <Metric icon={<Heart />} label="Kudos received" value={summary?.kudos_received.length ?? 0} />
          <Metric icon={<ClipboardList />} label="Surveys completed" value={summary?.surveys_completed ?? 0} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Tier progress</CardTitle>
                <TierBadge tier={summary?.current_tier} />
              </div>
            </CardHeader>
            <CardContent>
              <Progress value={summary?.progress_percentage ?? 0} className="h-3" />
              <p className="mt-3 text-sm text-slate-500">
                {summary?.points_to_next_tier == null
                  ? "You are at the highest available tier."
                  : `${summary.points_to_next_tier} points to your next tier.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild variant="outline"><Link to="/engagement/badges">Explore badges</Link></Button>
                <Button asChild variant="outline"><Link to="/engagement/surveys">Open surveys</Link></Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Monthly leaders</CardTitle>
              <Link to="/engagement/leaderboard" className="text-sm font-medium text-sky-700">View all</Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {leaders.length === 0 && <p className="text-sm text-slate-500">Leaderboard points will appear here.</p>}
              {leaders.map((leader) => (
                <div key={leader.employee_id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">#{leader.rank} {leader.employee_name}</p>
                    <TierBadge tier={leader.current_tier} />
                  </div>
                  <PointsDisplay points={leader.total_points} compact />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent appreciation</CardTitle>
            <Link to="/engagement/kudos" className="text-sm font-medium text-sky-700">Open kudos wall</Link>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {(summary?.kudos_received ?? []).length === 0 && <p className="text-sm text-slate-500">Your received kudos will show up here.</p>}
            {summary?.kudos_received.map((kudos) => <KudosCard key={kudos.kudos_id} kudos={kudos} />)}
          </CardContent>
        </Card>
      </main>
    </DashboardLayout>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-700 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
        <div><p className="text-sm text-slate-500">{label}</p><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div></div>
      </CardContent>
    </Card>
  );
}
