import { useState, useCallback, useEffect, useRef } from "react";
import { ExternalLink, MessageCircle, Play, RefreshCw, ThumbsUp } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoModal } from "@/components/social/VideoModal";
import { useSocialFeed, useSocialLinkMap, type SocialPost, type SocialPlatformFilter } from "@/hooks/useSocialFeed";
import { useQueryClient } from "@tanstack/react-query";

// ── MCN brand ──────────────────────────────────────────────────────────────
const MCN_NAVY  = "#073f78";
const MCN_BLUE  = "#1B6AB5";
const MCN_GREEN = "#3BAD49";
const MCN_RED   = "#E8231A";

function McnStripe({ h = 4 }: { h?: number }) {
  return (
    <div className="flex" style={{ height: h }}>
      <div className="flex-1" style={{ background: MCN_BLUE }} />
      <div className="flex-1" style={{ background: MCN_GREEN }} />
      <div className="flex-1" style={{ background: MCN_RED }} />
    </div>
  );
}

// ── Platform metadata ──────────────────────────────────────────────────────
const PLATFORM_META = {
  facebook: {
    label: "Facebook", dot: "#1877F2",
    badgeCls: "bg-[#1877F2] text-white",
    tabActive: "bg-[#1877F2] text-white shadow-sm",
    tabIdle: "bg-white text-slate-600 border border-slate-200 hover:border-[#1877F2]/40 hover:text-[#1877F2]",
    icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>,
  },
  instagram: {
    label: "Instagram", dot: "#E1306C",
    badgeCls: "bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white",
    tabActive: "bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white shadow-sm",
    tabIdle: "bg-white text-slate-600 border border-slate-200 hover:border-pink-300 hover:text-pink-600",
    icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>,
  },
  youtube: {
    label: "YouTube", dot: "#FF0000",
    badgeCls: "bg-[#FF0000] text-white",
    tabActive: "bg-[#FF0000] text-white shadow-sm",
    tabIdle: "bg-white text-slate-600 border border-slate-200 hover:border-red-300 hover:text-red-600",
    icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("v") ?? null;
  } catch { return null; }
}

// ── Thumbnail with maxres → hq fallback ───────────────────────────────────
function YtThumbnail({ videoId, alt }: { videoId: string; alt: string }) {
  const [src, setSrc] = useState(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
  return (
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      loading="lazy"
      onError={() => setSrc(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`)}
    />
  );
}

// ── Post card ──────────────────────────────────────────────────────────────
function PostCard({ post, onPlayVideo }: { post: SocialPost; onPlayVideo?: (id: string, title: string) => void }) {
  const meta = PLATFORM_META[post.platform];
  const videoId = post.platform === "youtube" ? extractYouTubeId(post.post_url) : null;

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-shadow duration-200 hover:shadow-xl">
      <McnStripe h={3} />
      {(post.media_url || videoId) && (
        <div className="relative aspect-video w-full overflow-hidden bg-slate-100">
          {videoId
            ? <YtThumbnail videoId={videoId} alt={post.content_text ?? ""} />
            : <img src={post.media_url!} alt={post.content_text ?? ""} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
          }
          {videoId && onPlayVideo && (
            <button
              onClick={() => onPlayVideo(videoId, post.content_text ?? "")}
              className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-200 group-hover:opacity-100 cursor-pointer"
              aria-label="Play video"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full shadow-xl" style={{ background: MCN_RED }}>
                <Play className="h-6 w-6 fill-white text-white ml-1" />
              </div>
            </button>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${meta.badgeCls}`}>
            {meta.icon} {meta.label}
          </span>
          {post.published_at && <span className="text-[11px] text-slate-400">{timeAgo(post.published_at)}</span>}
        </div>
        {post.content_text && <p className="flex-1 text-sm leading-6 text-slate-700 line-clamp-3">{post.content_text}</p>}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><ThumbsUp className="h-3.5 w-3.5" /> {post.like_count}</span>
            <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {post.comment_count}</span>
          </div>
          <div className="flex items-center gap-2">
            {videoId && onPlayVideo && (
              <button onClick={() => onPlayVideo(videoId, post.content_text ?? "")} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white cursor-pointer hover:opacity-90" style={{ background: MCN_RED }}>
                <Play className="h-3 w-3 fill-white" /> Play
              </button>
            )}
            <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer">
              Open <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Feed list ──────────────────────────────────────────────────────────────
function FeedList({ platform, onPlayVideo }: { platform: SocialPlatformFilter; onPlayVideo: (id: string, title: string) => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch, isFetching } = useSocialFeed(platform, page, 12);
  const posts = data?.posts ?? [];
  const totalPages = Math.ceil((data?.total ?? 0) / 12);

  if (isLoading) return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <McnStripe h={3} /><Skeleton className="aspect-video w-full" />
          <div className="space-y-2 p-4"><Skeleton className="h-3 w-24 rounded-full" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-3/4" /></div>
        </div>
      ))}
    </div>
  );
  if (isError) return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-12 text-center">
      <p className="text-sm font-semibold text-rose-700">Could not load posts</p>
      <button onClick={() => void refetch()} className="mt-3 rounded-xl border border-rose-200 bg-white px-4 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 cursor-pointer">Retry</button>
    </div>
  );
  if (posts.length === 0) return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center">
      <img src="/mcn-icon.png" alt="" className="mx-auto mb-3 h-10 opacity-20" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      <p className="text-sm font-medium text-slate-500">No posts synced yet.</p>
      <p className="mt-1 text-xs text-slate-400">Posts sync automatically every 30 minutes.</p>
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => <PostCard key={post.id} post={post} onPlayVideo={onPlayVideo} />)}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button disabled={page <= 1 || isFetching} onClick={() => setPage(p => p - 1)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer">Previous</button>
          <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages || isFetching} onClick={() => setPage(p => p + 1)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer">Next</button>
        </div>
      )}
    </div>
  );
}

// ── Facebook embed — iframe approach (works without JS SDK) ────────────────
function FacebookEmbed() {
  const pageUrl = useSocialLinkMap().facebook.profile_url;
  const src = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(pageUrl)}&tabs=timeline&width=500&height=700&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=false`;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <McnStripe h={3} />
      <div className="relative w-full overflow-hidden bg-[#f0f2f5]">
        <iframe
          src={src}
          width="100%"
          height="700"
          style={{ border: "none", overflow: "hidden", display: "block" }}
          scrolling="no"
          frameBorder="0"
          allowFullScreen
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          title="MAS Callnet Facebook"
          className="w-full"
        />
      </div>
      <div className="flex items-center justify-end border-t border-slate-100 px-4 py-3">
        <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-semibold text-[#1877F2] hover:underline cursor-pointer">
          Open Facebook page <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

// ── Instagram embed — official iframe oEmbed ──────────────────────────────
// Instagram allows embedding individual public posts via their oEmbed endpoint.
// Without a post URL we show the profile card + recent post iframes.
const INSTAGRAM_POST_URLS = [
  // Add real post URLs from https://www.instagram.com/mascallnet/ here
  // e.g. "https://www.instagram.com/p/C_XXXXXXXX/"
];

function InstagramEmbed() {
  const ig = useSocialLinkMap().instagram;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <McnStripe h={3} />
      <div className="flex flex-col items-center gap-5 px-6 py-8">
        {/* Profile header */}
        <div className="flex items-center gap-4 w-full">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white shadow-lg" style={{ background: "linear-gradient(135deg,#833AB4,#FD1D1D,#F77737)" }}>
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
          </div>
          <div>
            <p className="text-base font-black" style={{ color: MCN_NAVY }}>{ig.handle ?? ig.label}</p>
            <p className="text-sm text-slate-500">MAS Callnet on Instagram</p>
          </div>
          <a href={ig.profile_url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm font-bold text-white cursor-pointer hover:opacity-90 shrink-0" style={{ background: "linear-gradient(135deg,#833AB4,#FD1D1D,#F77737)" }}>
            Follow <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {/* Embedded posts — if post URLs are configured */}
        {INSTAGRAM_POST_URLS.length > 0 ? (
          <div className="grid w-full gap-4 sm:grid-cols-2">
            {INSTAGRAM_POST_URLS.slice(0, 4).map((postUrl) => (
              <iframe
                key={postUrl}
                src={`${postUrl}embed/`}
                className="w-full rounded-xl border-0"
                height="480"
                scrolling="no"
                frameBorder="0"
                allowFullScreen
                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                title="Instagram post"
              />
            ))}
          </div>
        ) : (
          <div className="w-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center">
            <p className="text-sm text-slate-600 font-medium">Instagram post embedding requires individual post URLs.</p>
            <p className="mt-2 text-xs text-slate-400">
              Visit <a href={ig.profile_url} target="_blank" rel="noopener noreferrer" className="text-pink-600 underline">{ig.handle ?? ig.label}</a> and share recent post links with admin to display them here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── X / Twitter timeline embed ────────────────────────────────────────────
declare global { interface Window { twttr?: { widgets: { load: (el?: HTMLElement) => void } } } }

function TwitterEmbed() {
  const x = useSocialLinkMap().twitter;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const inject = () => {
      if (!containerRef.current) return;
      if (window.twttr?.widgets) {
        window.twttr.widgets.load(containerRef.current);
        return;
      }
      if (!document.getElementById("twitter-wjs")) {
        const s = document.createElement("script");
        s.id = "twitter-wjs";
        s.src = "https://platform.twitter.com/widgets.js";
        s.async = true;
        s.charset = "utf-8";
        s.onload = () => window.twttr?.widgets?.load(containerRef.current ?? undefined);
        document.head.appendChild(s);
      }
    };
    inject();
    // x.profile_url is a dependency: the timeline anchor below is rewritten when
    // an admin changes the handle, and widgets.load() has to run again over the
    // new href or the iframe keeps showing the previous account.
  }, [x.profile_url]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <McnStripe h={3} />
      <div className="bg-black px-4 py-3 flex items-center gap-3">
        <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.622 5.905-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
        <p className="text-white font-black text-sm">{x.handle ?? x.label} on X</p>
        <a href={x.profile_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer">
          Open <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div ref={containerRef} className="w-full overflow-hidden bg-white p-2 min-h-[400px]">
        <a
          className="twitter-timeline"
          data-chrome="nofooter noborders"
          data-height="700"
          data-theme="light"
          data-tweet-limit="6"
          key={x.profile_url}
          href={x.profile_url}
        >
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
              <p className="text-sm text-slate-500">Loading X / Twitter feed…</p>
            </div>
          </div>
        </a>
      </div>
    </div>
  );
}

// ── LinkedIn ───────────────────────────────────────────────────────────────
function LinkedInCard() {
  const li = useSocialLinkMap().linkedin;
  // The follow widget wants the company slug, which is the last path segment of
  // the page URL (…/company/<slug>[/]).
  const slug = li.profile_url.replace(/\/+$/, "").split("/").pop() || "mas-callnet";
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <McnStripe h={3} />
      <div className="flex flex-col items-center gap-4 px-8 py-10 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#0A66C2] text-white shadow-lg">
          <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
        </div>
        <div>
          <p className="text-lg font-black" style={{ color: MCN_NAVY }}>MAS Callnet on LinkedIn</p>
          <p className="mt-1 text-sm text-slate-500 max-w-sm">LinkedIn does not provide a free embeddable feed. Follow our company page directly for career opportunities, company news, and milestones.</p>
        </div>
        <a href={li.profile_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-2xl bg-[#0A66C2] px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-[#004182] cursor-pointer">
          Follow on LinkedIn <ExternalLink className="h-3.5 w-3.5" />
        </a>
        {/* LinkedIn follow button widget */}
        <div className="mt-2">
          <script src="https://platform.linkedin.com/in.js" type="text/javascript"> lang: en_US</script>
          <script type="IN/FollowCompany" data-id={slug} data-counter="bottom"></script>
        </div>
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────
function SectionHead({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex w-1.5 self-stretch flex-col overflow-hidden rounded-full">
        <div className="flex-1" style={{ background: MCN_BLUE }} />
        <div className="flex-1" style={{ background: MCN_GREEN }} />
        <div className="flex-1" style={{ background: MCN_RED }} />
      </div>
      <div className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: MCN_NAVY }}>
        {icon}
      </div>
      <p className="text-sm font-black" style={{ color: MCN_NAVY }}>{label}</p>
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────
type TabKey = "all" | "youtube" | "facebook" | "instagram" | "twitter" | "linkedin";

const TABS: { key: TabKey; label: string; icon: React.ReactNode; active: string; idle: string }[] = [
  { key: "all", label: "All",
    icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
    active: "text-white shadow-sm", idle: "bg-white text-slate-600 border border-slate-200 hover:border-slate-400" },
  { key: "youtube",   label: "YouTube",    icon: PLATFORM_META.youtube.icon,   active: PLATFORM_META.youtube.tabActive,   idle: PLATFORM_META.youtube.tabIdle },
  { key: "facebook",  label: "Facebook",   icon: PLATFORM_META.facebook.icon,  active: PLATFORM_META.facebook.tabActive,  idle: PLATFORM_META.facebook.tabIdle },
  { key: "instagram", label: "Instagram",  icon: PLATFORM_META.instagram.icon, active: PLATFORM_META.instagram.tabActive, idle: PLATFORM_META.instagram.tabIdle },
  { key: "twitter",   label: "X / Twitter",
    icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.622 5.905-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>,
    active: "bg-black text-white shadow-sm", idle: "bg-white text-slate-600 border border-slate-200 hover:border-slate-400" },
  { key: "linkedin",  label: "LinkedIn",
    icon: <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>,
    active: "bg-[#0A66C2] text-white shadow-sm", idle: "bg-white text-slate-600 border border-slate-200 hover:border-[#0A66C2]/40 hover:text-[#0A66C2]" },
];

// ── Main page ──────────────────────────────────────────────────────────────
export default function NativeSocialFeed() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [videoModal, setVideoModal] = useState<{ id: string; title: string } | null>(null);
  const handlePlayVideo = useCallback((id: string, title: string) => setVideoModal({ id, title }), []);

  return (
    <DashboardLayout>
      {videoModal && <VideoModal videoId={videoModal.id} title={videoModal.title} onClose={() => setVideoModal(null)} />}

      <div className="w-full space-y-5">

        {/* MCN branded hero */}
        <div className="overflow-hidden rounded-2xl sm:rounded-3xl shadow-lg" style={{ background: MCN_NAVY }}>
          <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm">
                <img src="/mcn-logo.png" alt="MAS Callnet" className="h-full w-full object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-black text-white tracking-tight">MAS Connect</h1>
                <p className="hidden sm:block text-sm text-blue-200">Stay connected with MAS Callnet on social media</p>
              </div>
            </div>
            <button onClick={() => qc.invalidateQueries({ queryKey: ["social-feed"] })} className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-3 py-2 sm:px-4 text-sm font-semibold text-white transition hover:bg-white/20 cursor-pointer">
              <RefreshCw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
          <McnStripe h={4} />
        </div>

        {/* Platform tabs — horizontal scroll on mobile */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-2 sm:px-4 text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer ${activeTab === tab.key ? tab.active : tab.idle}`}
              style={activeTab === tab.key && tab.key === "all" ? { background: MCN_NAVY } : undefined}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "all" && (
            <div className="space-y-8">
              <section>
                <SectionHead label="YouTube" icon={PLATFORM_META.youtube.icon} />
                <FeedList platform="youtube" onPlayVideo={handlePlayVideo} />
              </section>
              <section>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <SectionHead label="Facebook" icon={PLATFORM_META.facebook.icon} />
                    <FacebookEmbed />
                  </div>
                  <div>
                    <SectionHead label="Instagram" icon={PLATFORM_META.instagram.icon} />
                    <InstagramEmbed />
                  </div>
                </div>
              </section>
            </div>
          )}
          {activeTab === "youtube"   && <FeedList platform="youtube" onPlayVideo={handlePlayVideo} />}
          {activeTab === "facebook"  && <FacebookEmbed />}
          {activeTab === "instagram" && <InstagramEmbed />}
          {activeTab === "twitter"   && <TwitterEmbed />}
          {activeTab === "linkedin"  && <LinkedInCard />}
        </div>
      </div>
    </DashboardLayout>
  );
}

