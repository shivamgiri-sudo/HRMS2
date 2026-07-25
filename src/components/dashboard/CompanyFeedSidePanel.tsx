import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Megaphone,
  MessageCircle,
  ThumbsUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AuthedImage } from "@/components/ui/AuthedImage";
import { useCompanyFeed, type CompanyPost } from "@/hooks/useCompanyFeed";
import { getCompanyFeedImageUrl, formatRelativeTime } from "@/lib/companyFeedUtils";

function isNewPost(post: CompanyPost): boolean {
  const dateStr = post.approved_at ?? post.created_at;
  if (!dateStr) return false;
  return Date.now() - new Date(dateStr).getTime() < 24 * 60 * 60 * 1000;
}

function formatTimestamp(value: string | null): string {
  return formatRelativeTime(value);
}

function PostImageCarousel({ post }: { post: CompanyPost }) {
  const [idx, setIdx] = useState(0);
  const images = post.media;
  if (images.length === 0) return null;

  const prev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const next = () => setIdx((i) => (i + 1) % images.length);

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-100">
        <AuthedImage
          src={getCompanyFeedImageUrl(images[idx].file_id)}
          alt={`Post image ${idx + 1} of ${images.length}`}
          loading="lazy"
          className="h-full w-full object-cover transition-opacity duration-300"
        />
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-white/70 backdrop-blur-sm shadow-sm transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white z-10"
          >
            <ChevronLeft className="h-4 w-4 text-slate-800" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next image"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-white/70 backdrop-blur-sm shadow-sm transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white z-10"
          >
            <ChevronRight className="h-4 w-4 text-slate-800" />
          </button>

          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 z-10">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to image ${i + 1}`}
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === idx ? "w-4 bg-white" : "w-1.5 bg-white/60"
                }`}
              />
            ))}
          </div>

          <span className="absolute top-2 right-2 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            {idx + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}

function PostCard({ post }: { post: CompanyPost }) {
  const timestamp = formatTimestamp(post.approved_at ?? post.submitted_at ?? post.created_at);
  const authorLabel = post.author_name ?? "Company Update";
  const authorCode = post.author_code ? `@${post.author_code}` : "";
  const isNew = isNewPost(post);

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
      <div
        className="absolute inset-x-0 top-0 h-[1.5px]"
        style={{
          background:
            "linear-gradient(90deg, var(--sidebar-canvas) 0%, var(--brand-500) 55%, rgba(232,35,26,0.82) 100%)",
        }}
      />

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--brand-100)] bg-[color:var(--brand-50)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">
                <Megaphone className="h-3 w-3" />
                MCN
              </div>
              {isNew && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--success-500,#3BAD49)] px-2 py-0.5 text-[10px] font-semibold text-white animate-pulse">
                  New
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-xs font-semibold text-slate-900">{authorLabel}</p>
            {authorCode && <p className="truncate text-[11px] text-slate-400">{authorCode}</p>}
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap">
            <Clock3 className="h-3 w-3" />
            {timestamp}
          </span>
        </div>

        {post.media.length > 0 && <PostImageCarousel post={post} />}

        {post.content_text?.trim() && (
          <p className="text-[13px] leading-6 text-slate-700 line-clamp-3">
            {post.content_text.trim()}
          </p>
        )}

        {/* Engagement counts */}
        {((post.like_count ?? 0) > 0 || (post.comment_count ?? 0) > 0) && (
          <div className="flex items-center gap-3 pt-1">
            {(post.like_count ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <ThumbsUp className="h-3 w-3" />
                {post.like_count}
              </span>
            )}
            {(post.comment_count ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <MessageCircle className="h-3 w-3" />
                {post.comment_count}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-sm)]">
      <div className="mb-3 h-[1.5px] w-full rounded-full skeleton" />
      <div className="space-y-2">
        <div className="h-3 w-24 rounded skeleton" />
        <div className="aspect-video w-full rounded-xl skeleton" />
        <div className="h-3 w-full rounded skeleton" />
        <div className="h-3 w-4/5 rounded skeleton" />
      </div>
    </div>
  );
}

export function CompanyFeedSidePanel() {
  const { data, isLoading, isError } = useCompanyFeed({ limit: 6, page: 1 });
  const posts = data?.posts ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[color:var(--brand-50)] text-[color:var(--brand-600)]">
            <Megaphone className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">
              Company Updates
            </p>
            {!isLoading && !isError && (
              <p className="text-[11px] text-slate-400">{total} announcement{total !== 1 ? "s" : ""} live</p>
            )}
          </div>
        </div>
        {total > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {total}
          </Badge>
        )}
      </div>

      {/* Scrollable feed */}
      <div className="overflow-y-auto max-h-[calc(100vh-220px)] space-y-3 pr-0.5 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
        {isLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center">
            <p className="text-xs font-semibold text-rose-700">Unable to load updates</p>
            <p className="mt-1 text-xs text-rose-500">Check your connection and try again.</p>
          </div>
        )}

        {!isLoading && !isError && posts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center">
            <Megaphone className="mx-auto h-6 w-6 text-slate-300" />
            <p className="mt-2 text-xs font-medium text-slate-500">No announcements yet</p>
            <p className="mt-1 text-[11px] text-slate-400">Company updates will appear here when published.</p>
          </div>
        )}

        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>

      {/* Footer link */}
      {!isLoading && posts.length > 0 && (
        <Link
          to="/engagement/company-feed"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-[color:var(--brand-700)] shadow-[var(--shadow-xs)] transition hover:bg-[color:var(--brand-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand-500)]"
        >
          View all company updates
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
