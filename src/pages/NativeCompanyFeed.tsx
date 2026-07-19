import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Clock3,
  FileText,
  ImageIcon,
  Loader2,
  Megaphone,
  PenSquare,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useCompanyFeed,
  useMyCompanyPosts,
  getStatusMeta,
  type CompanyPost,
} from "@/hooks/useCompanyFeed";
import { apiUrl } from "@/lib/apiBase";
import { useUserRole } from "@/hooks/useUserRole";

const MODERATOR_ROLES = new Set(["hr_head", "admin", "super_admin"]);

const HERO_PANEL_COPY = [
  {
    label: "Channel",
    value: "Approved bulletins",
    detail: "Only published company updates land here.",
  },
  {
    label: "Pace",
    value: "Built for quick scan",
    detail: "Editorial cards, clear status, mobile-first reading.",
  },
  {
    label: "Compliance",
    value: "Moderated before publish",
    detail: "Creator access and review stay backend-controlled.",
  },
] as const;

function formatPostTimestamp(value: string | null): string {
  if (!value) return "Moments ago";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const STATUS_CLASS_MAP: Record<string, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending_approval: "border-amber-200 bg-amber-50 text-amber-700",
  borderline_flagged: "border-orange-200 bg-orange-50 text-orange-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  auto_rejected: "border-rose-200 bg-rose-50 text-rose-700",
  deleted: "border-slate-200 bg-slate-100 text-slate-600",
  draft: "border-slate-200 bg-slate-100 text-slate-600",
};

function statusBadgeClass(status: string): string {
  return STATUS_CLASS_MAP[status] ?? "border-slate-200 bg-slate-100 text-slate-600";
}

function getCompanyFeedImageUrl(fileId: string): string {
  return apiUrl(`/api/files/company-feed/${fileId}`);
}

function FeedPostCard({ post, featured = false }: { post: CompanyPost; featured?: boolean }) {
  const statusMeta = getStatusMeta(post.status);
  const timestamp = formatPostTimestamp(post.approved_at ?? post.submitted_at ?? post.created_at);
  const attachmentCount = post.media.length;
  const authorLabel = post.author_name ?? "Company Update";
  const authorCode = post.author_code ? `@${post.author_code}` : "";

  return (
    <article
      className={`group relative overflow-hidden rounded-[1.75rem] border bg-white transition-all duration-300 ${
        featured
          ? "border-[color:var(--brand-200)] shadow-[var(--shadow-lg)]"
          : "border-slate-200 shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
      }`}
    >
      <div
        className="absolute inset-x-0 top-0 h-1.5"
        style={{
          background:
            "linear-gradient(90deg, var(--sidebar-canvas) 0%, var(--brand-500) 55%, rgba(232,35,26,0.82) 100%)",
        }}
      />
      <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-[radial-gradient(circle,_rgba(27,106,181,0.12)_0%,_rgba(27,106,181,0)_72%)]" />

      <div className="relative space-y-5 p-5 sm:p-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-100)] bg-[color:var(--brand-50)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
              <Megaphone className="h-3.5 w-3.5" />
              MCN Broadcast
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{authorLabel}</p>
              <p className="mt-0.5 text-xs text-slate-400">{authorCode}</p>
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <Clock3 className="h-3.5 w-3.5" />
                Published {timestamp}
              </p>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(post.status)}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {statusMeta.label}
          </span>
        </header>

        <div className="space-y-4">
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
            {post.content_text?.trim() || "Update published without written copy."}
          </p>

          {attachmentCount > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-[1.2rem] border border-slate-200 bg-slate-50/90 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[color:var(--brand-600)] shadow-[var(--shadow-xs)]">
                  <ImageIcon className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {attachmentCount} image{attachmentCount === 1 ? "" : "s"} published with this post
                  </p>
                  <p className="text-xs text-slate-500">
                    Images render inline on the company feed for quick employee scanning.
                  </p>
                </div>
              </div>

              <div className={`grid gap-3 ${attachmentCount === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                {post.media.slice(0, 4).map((media) => (
                  <div
                    key={media.file_id}
                    className="overflow-hidden rounded-[1.3rem] border border-slate-200 bg-slate-100"
                  >
                    <img
                      src={getCompanyFeedImageUrl(media.file_id)}
                      alt={`Post image ${media.sort_order} by ${authorLabel}`}
                      loading="lazy"
                      className="h-full min-h-[220px] w-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function FeedSkeletonCard() {
  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[var(--shadow-sm)] sm:p-6">
      <div className="mb-4 h-1.5 w-full rounded-full skeleton" />
      <div className="space-y-3">
        <div className="h-4 w-32 skeleton" />
        <div className="h-7 w-56 skeleton" />
        <div className="h-4 w-full skeleton" />
        <div className="h-4 w-[92%] skeleton" />
        <div className="h-4 w-[70%] skeleton" />
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="hrms-empty-state rounded-[1.75rem] border border-dashed border-slate-300 bg-white/80 shadow-[var(--shadow-xs)]">
      <div className="hrms-empty-icon">{icon}</div>
      <div className="space-y-2">
        <h2 className="hrms-empty-title">{title}</h2>
        <p className="hrms-empty-desc">{description}</p>
      </div>
      {action}
    </div>
  );
}

function ErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <Card className="rounded-[1.75rem] border-rose-200 bg-rose-50/80 shadow-[var(--shadow-sm)]">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-rose-600 shadow-[var(--shadow-xs)]">
            <AlertCircle className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-rose-900">{title}</p>
            <p className="mt-1 text-sm text-rose-700">{description}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="border-rose-200 bg-white text-rose-800 hover:bg-rose-100"
          onClick={onRetry}
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

const PAGE_LIMIT = 12;

export default function NativeCompanyFeed() {
  const [feedPage, setFeedPage] = useState(1);
  const accumulatedRef = useRef<CompanyPost[]>([]);
  const [displayedPosts, setDisplayedPosts] = useState<CompanyPost[]>([]);

  const feedQuery = useCompanyFeed({ limit: PAGE_LIMIT, page: feedPage });
  const myPostsQuery = useMyCompanyPosts({ limit: 6 });
  const roleQuery = useUserRole();

  const currentPagePosts = feedQuery.data?.posts ?? [];
  const feedTotal = feedQuery.data?.total ?? 0;
  const hasMore = displayedPosts.length < feedTotal;

  useEffect(() => {
    if (!feedQuery.isSuccess || currentPagePosts.length === 0) return;
    if (feedPage === 1) {
      accumulatedRef.current = currentPagePosts;
    } else {
      const ids = new Set(accumulatedRef.current.map((p) => p.id));
      const fresh = currentPagePosts.filter((p) => !ids.has(p.id));
      accumulatedRef.current = [...accumulatedRef.current, ...fresh];
    }
    setDisplayedPosts([...accumulatedRef.current]);
  }, [feedPage, feedQuery.isSuccess, currentPagePosts]);

  const feedPosts = displayedPosts;

  const myPosts = myPostsQuery.data?.posts ?? [];
  const roleKeys = roleQuery.data?.roleKeys ?? [];
  const isLikelyModerator = roleKeys.some((role) => MODERATOR_ROLES.has(role));
  const waitingForReview = myPosts.filter(
    (post) => post.status === "pending_approval" || post.status === "borderline_flagged",
  ).length;
  const returnedPosts = myPosts.filter(
    (post) => post.status === "rejected" || post.status === "auto_rejected",
  ).length;

  return (
    <DashboardLayout>
      <main className="space-y-8 p-4 sm:p-6 lg:p-8">
        <section
          className="relative overflow-hidden rounded-[2rem] border border-white/40 px-5 py-6 text-white shadow-[var(--shadow-brand-lg)] sm:px-7 sm:py-8 lg:px-9"
          style={{
            background:
              "linear-gradient(140deg, var(--sidebar-canvas) 0%, var(--brand-700) 35%, var(--brand-500) 72%, rgba(232,35,26,0.86) 120%)",
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18)_0%,_rgba(255,255,255,0)_34%),radial-gradient(circle_at_bottom_right,_rgba(255,255,255,0.14)_0%,_rgba(255,255,255,0)_30%)]" />
          <div className="absolute -right-16 top-10 h-52 w-52 rounded-full border border-white/10 bg-white/10 blur-3xl" />
          <div className="absolute -bottom-20 left-10 h-56 w-56 rounded-full bg-[rgba(255,255,255,0.12)] blur-3xl" />

          <div className="relative space-y-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/90 backdrop-blur">
                  <Sparkles className="h-3.5 w-3.5" />
                  Broadcast Deck
                </div>
                <div className="space-y-3">
                  <h1 className="font-['Fira_Sans'] text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl lg:text-[3.35rem]">
                    Company Feed keeps the whole floor on the same page.
                  </h1>
                  <p className="max-w-2xl text-sm leading-7 text-blue-50/92 sm:text-[15px]">
                    Scan approved announcements, track your own submissions, and stay ready for the
                    next creator and moderation surfaces without leaving the employee workspace.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:w-[23rem] lg:grid-cols-1">
                <Button
                  asChild
                  className="h-auto justify-between rounded-[1.15rem] bg-white px-4 py-3 text-left text-[color:var(--brand-700)] hover:bg-blue-50"
                >
                  <a href="#company-feed-lane">
                    <span>
                      <span className="block text-sm font-semibold">Read today&apos;s bulletins</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        Jump straight to the published update lane.
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </a>
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="h-auto justify-between rounded-[1.15rem] border-white/30 bg-white/10 px-4 py-3 text-left text-white hover:bg-white/15"
                >
                  <Link to="/engagement">
                    <span>
                      <span className="block text-sm font-semibold">Open engagement hub</span>
                      <span className="mt-1 block text-xs text-blue-100/80">
                        Leaderboard, kudos, badges, and surveys stay one click away.
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              {HERO_PANEL_COPY.map((panel) => (
                <div
                  key={panel.label}
                  className="rounded-[1.4rem] border border-white/15 bg-white/10 p-4 backdrop-blur-sm"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-100/80">
                    {panel.label}
                  </p>
                  <p className="mt-2 font-['Fira_Sans'] text-xl font-semibold tracking-[-0.03em]">
                    {panel.value}
                  </p>
                  <p className="mt-2 text-sm text-blue-50/85">{panel.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_24rem]">
          <section id="company-feed-lane" className="space-y-5">
            <div className="flex flex-col gap-4 rounded-[1.75rem] border border-slate-200 bg-white/85 p-5 shadow-[var(--shadow-sm)] sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--brand-700)]">
                  Approved feed
                </p>
                <h2 className="mt-2 font-['Fira_Sans'] text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                  Internal updates, ready for a fast scroll
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Only published company posts appear here. Moderation, creator access, and removal
                  rights continue to stay server-controlled.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:min-w-[14rem]">
                <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Live cards
                  </p>
                  <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">
                    {feedQuery.isLoading && feedPosts.length === 0 ? "..." : feedTotal}
                  </p>
                </div>
                <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    My queue
                  </p>
                  <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">
                    {myPostsQuery.isLoading ? "..." : waitingForReview}
                  </p>
                </div>
              </div>
            </div>

            {feedQuery.isError && (
              <ErrorState
                title="The company feed could not be loaded"
                description="Published announcements are temporarily unavailable. Retry to refresh the lane."
                onRetry={() => {
                  void feedQuery.refetch();
                }}
              />
            )}

            {feedQuery.isLoading && (
              <div className="space-y-4" aria-busy="true" aria-label="Loading company feed">
                <FeedSkeletonCard />
                <FeedSkeletonCard />
                <FeedSkeletonCard />
              </div>
            )}

            {!feedQuery.isLoading && !feedQuery.isError && feedPosts.length === 0 && (
              <EmptyState
                icon={<Megaphone className="h-6 w-6" />}
                title="No approved updates are on the board yet"
                description="The feed will populate here as soon as moderated company announcements are published."
                action={
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link to="/engagement">Browse the engagement hub</Link>
                  </Button>
                }
              />
            )}

            {feedPosts.length > 0 && (
              <div className="space-y-4">
                {feedPosts.map((post, index) => (
                  <FeedPostCard key={post.id} post={post} featured={index === 0} />
                ))}

                {hasMore && (
                  <div className="flex justify-center pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      disabled={feedQuery.isFetching}
                      onClick={() => setFeedPage((p) => p + 1)}
                    >
                      {feedQuery.isFetching ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading…
                        </>
                      ) : (
                        "Load more updates"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <Card className="overflow-hidden rounded-[1.75rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
              <div
                className="h-24"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(6,43,82,0.98) 0%, rgba(27,106,181,0.94) 62%, rgba(232,35,26,0.66) 100%)",
                }}
              />
              <CardContent className="relative space-y-5 p-5">
                <div className="-mt-12 flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-white/80 bg-white text-[color:var(--brand-600)] shadow-[var(--shadow-lg)]">
                  <FileText className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
                    My submissions
                  </p>
                  <h3
                    id="my-submissions"
                    className="mt-2 font-['Fira_Sans'] text-xl font-semibold tracking-[-0.03em] text-slate-950"
                  >
                    Your publishing lane
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Submission history gives employees a clear read on what is waiting, published,
                    or returned for policy reasons.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Awaiting
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">
                      {myPostsQuery.isLoading ? "..." : waitingForReview}
                    </p>
                  </div>
                  <div className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Returned
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">
                      {myPostsQuery.isLoading ? "..." : returnedPosts}
                    </p>
                  </div>
                </div>

                {myPostsQuery.isError && (
                  <ErrorState
                    title="Your submission history is unavailable"
                    description="Retry to reload your creator-side status cards."
                    onRetry={() => {
                      void myPostsQuery.refetch();
                    }}
                  />
                )}

                {myPostsQuery.isLoading && (
                  <div className="space-y-3" aria-busy="true" aria-label="Loading your submissions">
                    <div className="h-20 w-full rounded-[1.2rem] skeleton" />
                    <div className="h-20 w-full rounded-[1.2rem] skeleton" />
                    <div className="h-20 w-full rounded-[1.2rem] skeleton" />
                  </div>
                )}

                {!myPostsQuery.isLoading && !myPostsQuery.isError && myPosts.length === 0 && (
                  <EmptyState
                    icon={<PenSquare className="h-6 w-6" />}
                    title="No submissions yet"
                    description="Creator access is assigned separately by Super Admin. Once you submit, your moderation trail will appear here."
                  />
                )}

                {!myPostsQuery.isLoading && !myPostsQuery.isError && myPosts.length > 0 && (
                  <div className="space-y-3">
                    {myPosts.slice(0, 4).map((post) => {
                      const statusMeta = getStatusMeta(post.status);
                      return (
                        <div
                          key={post.id}
                          className="rounded-[1.2rem] border border-slate-200 bg-slate-50/90 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-2">
                              <span
                                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass(post.status)}`}
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                {statusMeta.label}
                              </span>
                              <p className="line-clamp-2 text-sm leading-6 text-slate-700">
                                {post.content_text?.trim() || "Post submitted without written copy."}
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                              {formatPostTimestamp(post.submitted_at ?? post.created_at)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="pt-1">
                      <Button asChild variant="ghost" className="w-full rounded-xl text-xs text-slate-500">
                        <Link to="/engagement/company-feed/create">View all my posts →</Link>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[1rem] bg-[color:var(--brand-50)] text-[color:var(--brand-600)]">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
                      Workflow shortcuts
                    </p>
                    <h3 className="mt-1 font-['Fira_Sans'] text-lg font-semibold tracking-[-0.03em] text-slate-950">
                      What opens from here
                    </h3>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50/90 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Creator studio</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          Submit posts for review. Creator access is granted by Super Admin — the
                          backend will gate submission if access has not been assigned.
                        </p>
                      </div>
                      <Button
                        asChild
                        variant="outline"
                        className="shrink-0 rounded-xl"
                      >
                        <Link to="/engagement/company-feed/create">Open</Link>
                      </Button>
                    </div>
                  </div>

                  {isLikelyModerator && (
                    <div id="moderation-brief" className="rounded-[1.2rem] border border-slate-200 bg-slate-50/90 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Approval queue</p>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            Review pending and flagged submissions. Moderation rights are enforced
                            server-side for your role.
                          </p>
                        </div>
                        <Button
                          asChild
                          variant="outline"
                          className="shrink-0 rounded-xl"
                        >
                          <Link to="/engagement/company-feed/approvals">Review</Link>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
              <CardContent className="space-y-4 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
                  Publishing rules
                </p>
                <div className="space-y-3 text-sm leading-6 text-slate-600">
                  <p>
                    Approved posts appear for all employees. Clear violations are blocked before
                    publishing, and borderline content is routed for moderator review.
                  </p>
                  <p>
                    Deletion and moderation rights stay with backend-enforced approver roles. This
                    page only surfaces safe, employee-facing signals.
                  </p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </DashboardLayout>
  );
}
