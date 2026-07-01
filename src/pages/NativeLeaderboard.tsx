import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PointsDisplay } from "@/components/engagement/PointsDisplay";
import { TierBadge } from "@/components/engagement/TierBadge";
import type { ApiResponse, LeaderboardEntry } from "@/components/engagement/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";

const periods = ["month", "quarter", "all-time"] as const;

export default function NativeLeaderboard() {
  const [period, setPeriod] = useState<(typeof periods)[number]>("month");
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    hrmsApi.get<ApiResponse<LeaderboardEntry[]>>(`/api/engagement/leaderboard?period=${period}&limit=50`)
      .then((response) => setLeaders(response.data))
      .catch((requestError: Error) => setError(requestError.message));
  }, [period]);

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Leaderboard</h1>
            <p className="mt-1 text-slate-500">Celebrate colleagues building momentum through everyday contributions.</p>
          </div>
          <div className="flex gap-2">
            {periods.map((item) => <Button key={item} variant={period === item ? "default" : "outline"} size="sm" onClick={() => setPeriod(item)}>{item}</Button>)}
          </div>
        </div>
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="p-4">Rank</th><th className="p-4">Employee</th><th className="p-4">Tier</th><th className="p-4">Badges</th><th className="p-4 text-right">Points</th></tr>
                </thead>
                <tbody>
                  {leaders.map((leader) => (
                    <tr key={leader.employee_id} className="border-b last:border-0">
                      <td className="p-4 font-semibold text-slate-700"><span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" />#{leader.rank}</span></td>
                      <td className="p-4 font-medium text-slate-900">{leader.employee_name}</td>
                      <td className="p-4"><TierBadge tier={leader.current_tier} /></td>
                      <td className="p-4 text-slate-600">{leader.badges_earned}</td>
                      <td className="p-4 text-right"><PointsDisplay points={leader.total_points} compact /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leaders.length === 0 && <p className="p-6 text-sm text-slate-500">No leaderboard activity yet.</p>}
          </CardContent>
        </Card>
      </main>
    </DashboardLayout>
  );
}
