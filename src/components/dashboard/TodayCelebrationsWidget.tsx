import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronDown, X } from "lucide-react";
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
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["today-celebrations"],
    queryFn: () => hrmsApi.get<FeedResult>("/api/engagement/company-posts/today-celebrations"),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const posts = data?.posts ?? [];

  if (isLoading) {
    return <div className="h-11 animate-pulse rounded-2xl border border-slate-200 bg-white" aria-hidden />;
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

  const nameOf = (p: CompanyPost) => (p.celebrated_employee_name ?? p.author_name ?? "").toString().trim();

  // Compact by default: the full-width cards (one per celebrant) pushed the whole dashboard below the fold.
  // The strip shows who is celebrating at a glance; the cards are one click away.
  return (
    <div className="rounded-2xl border border-pink-100 bg-gradient-to-r from-pink-50 via-white to-amber-50 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="flex items-center gap-2 text-[13px] font-bold text-slate-700">
          <span aria-hidden>🎉</span>
          Today&rsquo;s celebrations
          <span className="inline-flex items-center justify-center rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-bold text-pink-700">{visiblePosts.length}</span>
        </h3>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {[...birthdays, ...anniversaries].slice(0, 5).map((p) => (
            <li key={p.id} className="rounded-full border border-pink-100 bg-white px-2.5 py-0.5 text-[12px] font-medium text-slate-700">
              <span aria-hidden>{p.post_type === "birthday" ? "🎂" : "🎉"}</span> {nameOf(p) || "Team member"}
            </li>
          ))}
          {visiblePosts.length > 5 ? <li className="px-1 py-0.5 text-[12px] font-medium text-slate-500">+{visiblePosts.length - 5} more</li> : null}
        </ul>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-600 hover:text-slate-900">
            {expanded ? "Hide cards" : "Show cards"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
          <Link to="/engagement/company-feed" className="text-[12px] font-semibold text-blue-600 transition-colors hover:text-blue-800">View all →</Link>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3">
          {birthdays.map(renderDismissible)}
          {anniversaries.map(renderDismissible)}
        </div>
      ) : null}
    </div>
  );
}
