import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
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

/**
 * Dismissing a celebration only declutters THIS widget, per-user — the post stays fully
 * visible with its likes/comments on the actual Company Feed. So this is a client-side,
 * per-user preference rather than a server-side "seen" flag: today's celebrations are a
 * fresh set of post ids every day, so an old dismissed id simply never matches a future
 * post again and nothing needs expiry/cleanup logic.
 */
function dismissedStorageKey(userId: string | undefined): string {
  return `dismissed-celebrations:${userId ?? "anonymous"}`;
}

function loadDismissedIds(userId: string | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(dismissedStorageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedIds(userId: string | undefined, ids: Set<string>): void {
  try {
    localStorage.setItem(dismissedStorageKey(userId), JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage unavailable (private mode, quota) — dismissal just won't survive a reload.
  }
}

export function TodayCelebrationsWidget() {
  const currentUserId = getCurrentUserId();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadDismissedIds(currentUserId));

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

  // Dismissing declutters this dashboard widget only — the post itself is untouched
  // (still visible, with its likes/comments, on the Company Feed page) — so this is a
  // pure client-side filter, not a mutation on the post or a fetch of a smaller list.
  const visiblePosts = posts.filter((p) => !dismissedIds.has(p.id));
  if (visiblePosts.length === 0) return null;

  const dismiss = (postId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(postId);
      saveDismissedIds(currentUserId, next);
      return next;
    });
  };

  const birthdays = visiblePosts.filter((p) => p.post_type === "birthday");
  const anniversaries = visiblePosts.filter((p) => p.post_type === "anniversary");

  const renderDismissible = (post: CompanyPost) => (
    <div key={post.id} className="relative">
      <button
        type="button"
        onClick={() => dismiss(post.id)}
        aria-label="Dismiss this celebration"
        title="Dismiss"
        className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/15 text-white transition-colors hover:bg-black/25"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <CelebrationPostCard post={post} currentUserId={currentUserId} />
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>🎉</span>
          <h3 className="text-sm font-bold text-slate-700">
            Today&rsquo;s Celebrations
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-bold text-pink-700">
              {visiblePosts.length}
            </span>
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
      {birthdays.map(renderDismissible)}

      {/* Anniversary cards */}
      {anniversaries.map(renderDismissible)}
    </div>
  );
}
