import { ArrowRight, ExternalLink, MessageCircle, ThumbsUp } from "lucide-react";
import { Link } from "react-router-dom";
import { useSocialFeed, type SocialPost, type SocialPlatform } from "@/hooks/useSocialFeed";
import { Skeleton } from "@/components/ui/skeleton";

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  facebook: "bg-[#1877F2] text-white",
  instagram: "bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white",
  youtube: "bg-[#FF0000] text-white",
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function PostRow({ post }: { post: SocialPost }) {
  return (
    <a
      href={post.post_url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-3 transition hover:border-slate-200 hover:shadow-sm"
    >
      {post.media_url ? (
        <img
          src={post.media_url}
          alt=""
          className="h-14 w-14 shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
      ) : (
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${PLATFORM_COLORS[post.platform]}`}>
          {PLATFORM_LABELS[post.platform].slice(0, 2).toUpperCase()}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`inline-block rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${PLATFORM_COLORS[post.platform]}`}>
            {PLATFORM_LABELS[post.platform]}
          </span>
          {post.published_at && (
            <span className="text-[10px] text-slate-400">{timeAgo(post.published_at)}</span>
          )}
        </div>
        {post.content_text && (
          <p className="line-clamp-2 text-xs text-slate-700 leading-5">
            {post.content_text}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2.5">
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <ThumbsUp className="h-3 w-3" />
            {post.like_count}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <MessageCircle className="h-3 w-3" />
            {post.comment_count}
          </span>
          <span className="ml-auto flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 opacity-0 group-hover:opacity-100 transition">
            Open <ExternalLink className="h-2.5 w-2.5" />
          </span>
        </div>
      </div>
    </a>
  );
}

export function SocialFeedWidget() {
  const { data, isLoading, isError } = useSocialFeed("all", 1, 5);
  const posts = data?.posts ?? [];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          MAS on Social Media
        </p>
        <Link
          to="/social-feed"
          className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-2">
        {isLoading && (
          <>
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </>
        )}

        {isError && (
          <p className="rounded-xl bg-rose-50 px-3 py-4 text-center text-xs text-rose-600">
            Could not load social feed.
          </p>
        )}

        {!isLoading && !isError && posts.length === 0 && (
          <p className="rounded-xl bg-white px-3 py-6 text-center text-xs text-slate-400">
            No social media posts yet.
          </p>
        )}

        {posts.map((post) => (
          <PostRow key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
