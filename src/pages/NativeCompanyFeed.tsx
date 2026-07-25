import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUp,
  Megaphone,
  PenSquare,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { FeedPostCard } from "@/components/feed/FeedPostCard";
import {
  useCompanyFeed,
  useMyCompanyPosts,
  type CompanyPost,
} from "@/hooks/useCompanyFeed";

const PAGE_LIMIT = 10;
const NEW_POSTS_POLL_MS = 60_000;

function FeedSkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full skeleton shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-36 skeleton" />
          <div className="h-3 w-24 skeleton" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full skeleton" />
        <div className="h-4 w-[88%] skeleton" />
        <div className="aspect-video w-full rounded-xl skeleton mt-3" />
      </div>
    </div>
  );
}

function isCreatorAccessError(message?: string): boolean {
  return /creator access|no active company post creator access|forbidden|http 403/i.test(message ?? "");
}

function getJwtPayload(): { id?: string; sub?: string; role?: string } | null {
  try {
    const token = localStorage.getItem("hrms_access_token");
    if (!token) return null;
    return JSON.parse(atob(token.split(".")[1]));
  } catch { return null; }
}

const MODERATOR_ROLES = new Set(["super_admin", "admin", "hr_admin", "hr_head"]);

function getCurrentUserId(): string | undefined {
  const p = getJwtPayload();
  return typeof p?.id === "string" ? p.id : (typeof p?.sub === "string" ? p.sub : undefined);
}

function getIsModerator(): boolean {
  const p = getJwtPayload();
  return typeof p?.role === "string" && MODERATOR_ROLES.has(p.role);
}

export default function NativeCompanyFeed() {
  const [feedPage, setFeedPage] = useState(1);
  const [search, setSearch] = useState("");
  const [displayedPosts, setDisplayedPosts] = useState<CompanyPost[]>([]);
  const [newPostsAvailable, setNewPostsAvailable] = useState(false);
  const accumulatedRef = useRef<CompanyPost[]>([]);
  const knownTotalRef = useRef<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const currentUserId = getCurrentUserId();
  const isModerator = getIsModerator();

  const feedQuery = useCompanyFeed({ limit: PAGE_LIMIT, page: feedPage });
  const myPostsQuery = useMyCompanyPosts({ limit: 6 });
  const creatorAccessDenied = myPostsQuery.isError && isCreatorAccessError(myPostsQuery.error?.message);

  const currentPagePosts = feedQuery.data?.posts ?? [];
  const feedTotal = feedQuery.data?.total ?? 0;
  const hasMore = displayedPosts.length < feedTotal;

  // Accumulate pages
  useEffect(() => {
    if (!feedQuery.isSuccess || currentPagePosts.length === 0) return;
    if (feedPage === 1) {
      accumulatedRef.current = currentPagePosts;
      knownTotalRef.current = feedTotal;
    } else {
      const ids = new Set(accumulatedRef.current.map((p) => p.id));
      const fresh = currentPagePosts.filter((p) => !ids.has(p.id));
      accumulatedRef.current = [...accumulatedRef.current, ...fresh];
    }
    setDisplayedPosts([...accumulatedRef.current]);
  }, [feedPage, feedQuery.isSuccess, currentPagePosts, feedTotal]);

  // Infinite scroll sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || feedQuery.isFetching) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setFeedPage((p) => p + 1);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, feedQuery.isFetching]);

  // Poll for new posts
  useEffect(() => {
    const interval = setInterval(() => {
      if (knownTotalRef.current === null) return;
      void (async () => {
        try {
          const res = await fetch(
            `/api/engagement/company-posts/feed?page=1&limit=1`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem("hrms_access_token") ?? ""}`,
              },
            },
          );
          if (!res.ok) return;
          const data = (await res.json()) as { total?: number };
          if (typeof data.total === "number" && data.total > (knownTotalRef.current ?? 0)) {
            setNewPostsAvailable(true);
          }
        } catch {
          // silent
        }
      })();
    }, NEW_POSTS_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  function refreshFeed() {
    accumulatedRef.current = [];
    knownTotalRef.current = null;
    setDisplayedPosts([]);
    setFeedPage(1);
    setNewPostsAvailable(false);
    void feedQuery.refetch();
  }

  const myPosts = myPostsQuery.data?.posts ?? [];
  const waitingForReview = myPosts.filter(
    (p) => p.status === "pending_approval" || p.status === "borderline_flagged",
  ).length;

  // Client-side search filter
  const filteredPosts = search.trim()
    ? displayedPosts.filter((p) =>
        [p.content_text ?? "", p.author_name ?? "", p.author_code ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
    : displayedPosts;

  return (
    <DashboardLayout>
      <main className="space-y-0 p-4 sm:p-6 lg:p-8">
        {/* Page header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-100)] bg-[color:var(--brand-50)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
              <Megaphone className="h-3.5 w-3.5" />
              Company Feed
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
              MCN Announcements
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {feedTotal > 0 ? `${feedTotal} live announcement${feedTotal !== 1 ? "s" : ""}` : "Internal company updates"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!creatorAccessDenied && (
              <Button asChild size="sm" className="rounded-xl bg-[color:var(--brand-600)] hover:bg-[color:var(--brand-700)]">
                <Link to="/engagement/company-feed/create">
                  <PenSquare className="mr-1.5 h-3.5 w-3.5" />
                  New Post
                </Link>
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Feed lane */}
          <div className="space-y-4">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search announcements…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-700 shadow-[var(--shadow-sm)] placeholder:text-slate-400 focus:border-[color:var(--brand-400)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-200)]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* New posts banner */}
            {newPostsAvailable && (
              <button
                type="button"
                onClick={refreshFeed}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--brand-600)] px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-[color:var(--brand-700)] active:scale-[0.98]"
              >
                <ArrowUp className="h-4 w-4" />
                New posts available — tap to refresh
              </button>
            )}

            {/* Error */}
            {feedQuery.isError && (
              <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                <p className="flex-1 text-sm text-rose-700">
                  {feedQuery.error?.message ?? "Unable to load the company feed."}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                  onClick={() => void feedQuery.refetch()}
                >
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}

            {/* Loading skeletons */}
            {feedQuery.isLoading && displayedPosts.length === 0 && (
              <div className="space-y-4" aria-busy="true">
                <FeedSkeletonCard />
                <FeedSkeletonCard />
                <FeedSkeletonCard />
              </div>
            )}

            {/* Empty state */}
            {!feedQuery.isLoading && !feedQuery.isError && filteredPosts.length === 0 && (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-12 text-center">
                <Megaphone className="h-8 w-8 text-slate-300" />
                <div>
                  <p className="font-semibold text-slate-700">
                    {search ? "No matching announcements" : "No announcements yet"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {search
                      ? "Try a different search term."
                      : "Company updates will appear here when published."}
                  </p>
                </div>
                {search && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                )}
              </div>
            )}

            {/* Posts */}
            {filteredPosts.length > 0 && (
              <div className="space-y-4">
                {filteredPosts.map((post) => (
                  <FeedPostCard
                    key={post.id}
                    post={post}
                    currentUserId={currentUserId}
                    isModerator={isModerator}
                  />
                ))}

                {/* Infinite scroll sentinel */}
                {!search && hasMore && (
                  <div ref={sentinelRef} className="flex justify-center py-4">
                    {feedQuery.isFetching && (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-[color:var(--brand-500)]" />
                    )}
                  </div>
                )}

                {!search && !hasMore && displayedPosts.length > 0 && (
                  <p className="py-3 text-center text-xs text-slate-400">
                    All {feedTotal} announcement{feedTotal !== 1 ? "s" : ""} loaded
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Stats card */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-sm)]">
              <div
                className="h-1.5 w-full"
                style={{ background: "linear-gradient(90deg, var(--sidebar-canvas) 0%, var(--brand-500) 55%, rgba(232,35,26,0.82) 100%)" }}
              />
              <div className="grid grid-cols-2 divide-x p-4">
                <div className="pr-4 text-center">
                  <p className="text-2xl font-bold tabular-nums text-slate-950">{feedTotal}</p>
                  <p className="text-[11px] text-slate-500">Live posts</p>
                </div>
                <div className="pl-4 text-center">
                  <p className="text-2xl font-bold tabular-nums text-slate-950">{waitingForReview}</p>
                  <p className="text-[11px] text-slate-500">My queue</p>
                </div>
              </div>
            </div>

            {/* My submissions */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-sm)]">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">
                  My submissions
                </p>
              </div>
              <div className="p-4 space-y-2">
                {myPostsQuery.isLoading && (
                  <>
                    <div className="h-16 w-full rounded-xl skeleton" />
                    <div className="h-16 w-full rounded-xl skeleton" />
                  </>
                )}
                {creatorAccessDenied && (
                  <p className="py-3 text-center text-xs text-slate-400">
                    Creator access required to submit posts.
                  </p>
                )}
                {!myPostsQuery.isLoading && !myPostsQuery.isError && myPosts.length === 0 && !creatorAccessDenied && (
                  <p className="py-3 text-center text-xs text-slate-400">No submissions yet.</p>
                )}
                {myPosts.slice(0, 3).map((post) => (
                  <div key={post.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        post.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : post.status === "pending_approval" ? "border-amber-200 bg-amber-50 text-amber-700"
                        : post.status === "borderline_flagged" ? "border-orange-200 bg-orange-50 text-orange-700"
                        : "border-rose-200 bg-rose-50 text-rose-700"
                      }`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {post.status === "approved" ? "Published"
                          : post.status === "pending_approval" ? "Pending"
                          : post.status === "borderline_flagged" ? "Flagged"
                          : post.status === "rejected" ? "Rejected"
                          : "Auto-rejected"}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">
                      {post.content_text?.trim() || "Image-led post"}
                    </p>
                  </div>
                ))}
                {!creatorAccessDenied && (
                  <Button asChild variant="ghost" className="w-full rounded-xl text-xs text-[color:var(--brand-700)]">
                    <Link to="/engagement/company-feed/create">+ Create new post</Link>
                  </Button>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </DashboardLayout>
  );
}
