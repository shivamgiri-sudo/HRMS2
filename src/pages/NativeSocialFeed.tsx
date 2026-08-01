import { useState } from "react";
import { ExternalLink, MessageCircle, RefreshCw, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useSocialFeed, type SocialPost, type SocialPlatformFilter } from "@/hooks/useSocialFeed";
import { useQueryClient } from "@tanstack/react-query";

// ── Platform metadata ──────────────────────────────────────────────────────

const PLATFORM_META = {
  facebook: {
    label: "Facebook",
    badge: "bg-[#1877F2] text-white",
    border: "border-[#1877F2]/20",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
    ),
  },
  instagram: {
    label: "Instagram",
    badge: "bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white",
    border: "border-pink-200",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
    ),
  },
  youtube: {
    label: "YouTube",
    badge: "bg-[#FF0000] text-white",
    border: "border-red-200",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
};

// ── Single post card ──────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function PostCard({ post }: { post: SocialPost }) {
  const meta = PLATFORM_META[post.platform];
  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      {post.media_url && (
        <div className="aspect-video w-full overflow-hidden bg-slate-100">
          <img
            src={post.media_url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.badge}`}>
              {meta.icon}
              {meta.label}
            </span>
          </div>
          {post.published_at && (
            <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(post.published_at)}</span>
          )}
        </div>

        {post.content_text && (
          <p className="text-sm leading-6 text-slate-700 line-clamp-4">{post.content_text}</p>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <ThumbsUp className="h-3.5 w-3.5" />
              {post.like_count}
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-400">
              <MessageCircle className="h-3.5 w-3.5" />
              {post.comment_count}
            </span>
          </div>
          <a
            href={post.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Open post
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </article>
  );
}

// ── Feed list with pagination ──────────────────────────────────────────────

function FeedList({ platform }: { platform: SocialPlatformFilter }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch, isFetching } = useSocialFeed(platform, page, 12);
  const posts = data?.posts ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 12);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <Skeleton className="aspect-video w-full" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-3 w-24 rounded-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-12 text-center">
        <p className="text-sm font-semibold text-rose-700">Could not load posts</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center">
        <p className="text-sm font-medium text-slate-500">No posts yet for this platform.</p>
        <p className="mt-1 text-xs text-slate-400">Posts sync every 30 minutes — check back soon.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {posts.map((post) => <PostCard key={post.id} post={post} />)}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || isFetching} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ── X/Twitter embed ────────────────────────────────────────────────────────

declare global {
  interface Window { twttr?: { widgets: { load: () => void } } }
}

function TwitterEmbed() {
  // Ensure the widget script renders when this tab is activated.
  const ensureWidget = (el: HTMLDivElement | null) => {
    if (!el) return;
    if (window.twttr?.widgets?.load) {
      window.twttr.widgets.load();
    } else {
      const s = document.createElement("script");
      s.src = "https://platform.twitter.com/widgets.js";
      s.async = true;
      s.charset = "utf-8";
      document.body.appendChild(s);
    }
  };

  return (
    <div className="flex justify-center" ref={ensureWidget}>
      {/* Replace YOUR_USERNAME with the company X/Twitter handle */}
      <a
        className="twitter-timeline"
        data-width="600"
        data-height="700"
        data-theme="light"
        href="https://twitter.com/MASCallnet"
      >
        Loading X/Twitter feed…
      </a>
    </div>
  );
}

// ── LinkedIn card ─────────────────────────────────────────────────────────

function LinkedInCard() {
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#0A66C2] text-white">
          <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
        </div>
        <h3 className="text-base font-bold text-slate-900">MAS Callnet on LinkedIn</h3>
        <p className="mt-2 text-sm text-slate-500">
          LinkedIn does not offer a free public feed API. Follow our company page to stay updated with the latest news, job openings, and company milestones.
        </p>
        <a
          href="https://www.linkedin.com/company/mas-callnet"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0A66C2] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#004182]"
        >
          Follow on LinkedIn
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function NativeSocialFeed() {
  const qc = useQueryClient();

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ["social-feed"] });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Company Social Media</h1>
          <p className="mt-1 text-sm text-slate-500">
            MAS Callnet on Facebook, Instagram, YouTube, X, and LinkedIn
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Platform tabs */}
      <Tabs defaultValue="all">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="facebook">Facebook</TabsTrigger>
          <TabsTrigger value="instagram">Instagram</TabsTrigger>
          <TabsTrigger value="youtube">YouTube</TabsTrigger>
          <TabsTrigger value="twitter">X / Twitter</TabsTrigger>
          <TabsTrigger value="linkedin">LinkedIn</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="all"><FeedList platform="all" /></TabsContent>
          <TabsContent value="facebook"><FeedList platform="facebook" /></TabsContent>
          <TabsContent value="instagram"><FeedList platform="instagram" /></TabsContent>
          <TabsContent value="youtube"><FeedList platform="youtube" /></TabsContent>
          <TabsContent value="twitter"><TwitterEmbed /></TabsContent>
          <TabsContent value="linkedin"><LinkedInCard /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
