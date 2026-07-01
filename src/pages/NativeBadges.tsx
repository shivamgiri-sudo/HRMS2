import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BadgeCard } from "@/components/engagement/BadgeCard";
import type { ApiResponse, BadgeDefinition, EngagementSummary } from "@/components/engagement/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hrmsApi } from "@/lib/hrmsApi";

const categories = ["all", "performance", "activity", "tenure", "social"];

export default function NativeBadges() {
  const [badges, setBadges] = useState<BadgeDefinition[]>([]);
  const [summary, setSummary] = useState<EngagementSummary | null>(null);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      hrmsApi.get<ApiResponse<BadgeDefinition[]>>("/api/engagement/badges"),
      hrmsApi.get<ApiResponse<EngagementSummary>>("/api/engagement/me"),
    ])
      .then(([badgesResponse, summaryResponse]) => {
        setBadges(badgesResponse.data);
        setSummary(summaryResponse.data);
      })
      .catch((requestError: Error) => setError(requestError.message));
  }, []);

  const earned = useMemo(() => new Set(summary?.badges_earned.map((badge) => badge.badge_id)), [summary]);
  const visibleBadges = badges.filter((badge) => {
    const matchesCategory = category === "all" || badge.badge_category === category;
    const matchesSearch = badge.badge_name.toLowerCase().includes(search.trim().toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Badge Gallery</h1>
          <p className="mt-1 text-slate-500">See the recognition you have unlocked and the milestones still ahead.</p>
        </div>
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {categories.map((item) => (
              <Button key={item} variant={category === item ? "default" : "outline"} size="sm" onClick={() => setCategory(item)}>
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </Button>
            ))}
          </div>
          <label className="relative block w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search badges..." />
          </label>
        </div>
        <p className="text-sm text-slate-500">{earned.size} earned · {badges.length} available</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleBadges.map((badge) => <BadgeCard key={badge.badge_id} badge={badge} earned={earned.has(badge.badge_id)} />)}
        </div>
      </main>
    </DashboardLayout>
  );
}
