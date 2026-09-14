import { ExternalLink, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { useSocialFeed, type SocialPost, type SocialPlatform } from "@/hooks/useSocialFeed";

const MCN_NAVY  = "#073f78";
const MCN_BLUE  = "#1B6AB5";
const MCN_GREEN = "#3BAD49";
const MCN_RED   = "#E8231A";

const PLATFORM_DOT: Record<SocialPlatform, string> = {
  facebook:  "#1877F2",
  instagram: "#E1306C",
  youtube:   "#FF0000",
};
const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: "Facebook", instagram: "Instagram", youtube: "YouTube",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("v") ?? u.pathname.split("/").pop() ?? null;
  } catch { return null; }
}

function PostRow({ post, onPlayVideo }: { post: SocialPost; onPlayVideo?: (id: string, title: string) => void }) {
  const videoId = post.platform === "youtube" ? extractYouTubeId(post.post_url) : null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-white p-3 transition hover:border-slate-200 hover:shadow-sm">
      {/* Thumbnail */}
      {post.media_url ? (
        <img src={post.media_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover bg-slate-100" loading="lazy" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white text-[10px] font-bold" style={{ background: PLATFORM_DOT[post.platform] }}>
          {PLATFORM_LABEL[post.platform].slice(0, 2).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* Platform dot + name + time */}
        <div className="flex items-center gap-1.5 mb-1">
          <div className="h-2 w-2 rounded-full shrink-0" style={{ background: PLATFORM_DOT[post.platform] }} />
          <span className="text-[10px] font-semibold text-slate-500">{PLATFORM_LABEL[post.platform]}</span>
          {post.published_at && <span className="ml-auto text-[10px] text-slate-400 shrink-0">{timeAgo(post.published_at)}</span>}
        </div>
        {/* Text */}
        {post.content_text && (
          <p className="line-clamp-2 text-xs leading-5 text-slate-700">{post.content_text}</p>
        )}
      </div>

      {/* Action button */}
      <div className="shrink-0">
        {videoId && onPlayVideo ? (
          <button
            onClick={() => onPlayVideo(videoId, post.content_text ?? "")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm transition hover:opacity-80 cursor-pointer"
            style={{ background: MCN_RED }}
            aria-label="Play video"
          >
            <Play className="h-3.5 w-3.5 fill-white ml-0.5" />
          </button>
        ) : (
          <a
            href={post.post_url} target="_blank" rel="noopener noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 cursor-pointer"
            aria-label="Open post"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

interface SocialFeedWidgetProps {
  onPlayVideo?: (id: string, title: string) => void;
}

export function SocialFeedWidget({ onPlayVideo }: SocialFeedWidgetProps = {}) {
  const { data, isLoading, isError } = useSocialFeed("all", 1, 5);
  const posts = data?.posts ?? [];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* MCN navy header */}
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ background: MCN_NAVY }}>
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white p-0.5">
          <img
            src="/mcn-icon.png" alt="MCN"
            className="h-full w-full object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).parentElement!.style.display = "none"; }}
          />
        </div>
        <p className="flex-1 text-sm font-black text-white">MAS Connect</p>
        <Link
          to="/social-feed"
          className="shrink-0 text-[11px] font-semibold text-blue-200 hover:text-white transition"
        >
          View all →
        </Link>
      </div>

      {/* MCN identity stripe */}
      <div className="flex" style={{ height: 3 }}>
        <div className="flex-1" style={{ background: MCN_BLUE }} />
        <div className="flex-1" style={{ background: MCN_GREEN }} />
        <div className="flex-1" style={{ background: MCN_RED }} />
      </div>

      {/* Posts */}
      <div className="space-y-2 p-3">
        {isLoading && (
          <>{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}</>
        )}

        {isError && (
          <p className="rounded-xl bg-rose-50 px-3 py-4 text-center text-xs text-rose-600">Could not load social feed.</p>
        )}

        {!isLoading && !isError && posts.length === 0 && (
          <div className="rounded-xl bg-slate-50 px-3 py-8 text-center">
            <p className="text-xs text-slate-400">No posts synced yet.</p>
          </div>
        )}

        {posts.map((post) => (
          <PostRow key={post.id} post={post} onPlayVideo={onPlayVideo} />
        ))}
      </div>

      {/* Footer CTA */}
      {posts.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <Link
            to="/social-feed"
            className="text-xs font-semibold transition hover:underline"
            style={{ color: MCN_BLUE }}
          >
            View all posts on MAS Connect →
          </Link>
        </div>
      )}
    </div>
  );
}
