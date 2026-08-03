import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { CelebrationPostCard } from "@/components/feed/CelebrationPostCard";
import type { CompanyPost } from "@/hooks/useCompanyFeed";

function getCurrentUserId(): string | undefined {
  try {
    const token = localStorage.getItem("hrms_access_token");
    if (!token) return undefined;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload?.id === "string" ? payload.id : undefined;
  } catch {
    return undefined;
  }
}

interface FeedResult {
  posts: CompanyPost[];
  total: number;
}

export function TodayCelebrationsWidget() {
  const currentUserId = getCurrentUserId();

  const { data, isLoading } = useQuery({
    queryKey: ["today-celebrations"],
    queryFn: () => hrmsApi.get<FeedResult>("/api/engagement/company-posts/today-celebrations"),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const posts = data?.posts ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 animate-pulse">
            <div className="h-16 rounded-xl bg-slate-200 mb-3" />
            <div className="h-4 w-3/4 rounded bg-slate-200 mb-2" />
            <div className="h-3 w-1/2 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) return null;

  const birthdays = posts.filter((p) => p.post_type === "birthday");
  const anniversaries = posts.filter((p) => p.post_type === "anniversary");

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🎉</span>
          <h3 className="text-sm font-bold text-slate-700">
            Today&rsquo;s Celebrations
            {posts.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-bold text-pink-700">
                {posts.length}
              </span>
            )}
          </h3>
        </div>
        <Link
          to="/engagement/company-feed"
          className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
        >
          View all →
        </Link>
      </div>

      {/* Birthday cards */}
      {birthdays.map((post) => (
        <CelebrationPostCard key={post.id} post={post} currentUserId={currentUserId} />
      ))}

      {/* Anniversary cards */}
      {anniversaries.map((post) => (
        <CelebrationPostCard key={post.id} post={post} currentUserId={currentUserId} />
      ))}
    </div>
  );
}
