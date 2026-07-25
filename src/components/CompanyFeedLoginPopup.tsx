import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Clock3, Megaphone, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCompanyFeed, type CompanyPost } from "@/hooks/useCompanyFeed";
import { getCompanyFeedImageUrl } from "@/lib/companyFeedUtils";

const SESSION_KEY = "feed_popup_shown";

function formatTimestamp(value: string | null): string {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function PostSlide({ post }: { post: CompanyPost }) {
  const [imgIdx, setImgIdx] = useState(0);
  const images = post.media;
  const timestamp = formatTimestamp(post.approved_at ?? post.submitted_at ?? post.created_at);
  const authorLabel = post.author_name ?? "Company Update";
  const authorCode = post.author_code ? `@${post.author_code}` : "";

  const prevImg = () => setImgIdx((i) => (i - 1 + images.length) % images.length);
  const nextImg = () => setImgIdx((i) => (i + 1) % images.length);

  return (
    <div className="flex flex-col">
      {images.length > 0 && (
        <div className="relative overflow-hidden bg-slate-900">
          <div className="aspect-video w-full overflow-hidden">
            <img
              src={getCompanyFeedImageUrl(images[imgIdx].file_id)}
              alt={`Announcement image ${imgIdx + 1} of ${images.length}`}
              loading="eager"
              className="h-full w-full object-cover transition-opacity duration-300"
            />
          </div>

          {images.length > 1 && (
            <>
              <button
                type="button"
                onClick={prevImg}
                aria-label="Previous image"
                className="absolute left-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/75 backdrop-blur-sm shadow-md transition hover:bg-white/95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white z-10"
              >
                <ChevronLeft className="h-5 w-5 text-slate-800" />
              </button>
              <button
                type="button"
                onClick={nextImg}
                aria-label="Next image"
                className="absolute right-3 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white/75 backdrop-blur-sm shadow-md transition hover:bg-white/95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white z-10"
              >
                <ChevronRight className="h-5 w-5 text-slate-800" />
              </button>

              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
                {images.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Go to image ${i + 1}`}
                    onClick={() => setImgIdx(i)}
                    className={`rounded-full transition-all duration-200 ${
                      i === imgIdx ? "h-2 w-5 bg-white" : "h-2 w-2 bg-white/55"
                    }`}
                  />
                ))}
              </div>

              <span className="absolute top-3 right-3 z-10 rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                {imgIdx + 1} / {images.length}
              </span>
            </>
          )}
        </div>
      )}

      <div className="space-y-3 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--brand-100)] bg-[color:var(--brand-50)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">
              <Megaphone className="h-3 w-3" />
              MCN Broadcast
            </div>
            <p className="mt-1.5 text-sm font-semibold text-slate-900">{authorLabel}</p>
            {authorCode && <p className="text-[11px] text-slate-400">{authorCode}</p>}
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap mt-1">
            <Clock3 className="h-3 w-3" />
            {timestamp}
          </span>
        </div>

        {post.content_text?.trim() && (
          <p className="text-[14px] leading-6 text-slate-700 line-clamp-4">
            {post.content_text.trim()}
          </p>
        )}
      </div>
    </div>
  );
}

export function CompanyFeedLoginPopup() {
  const [open, setOpen] = useState(false);
  const [postIdx, setPostIdx] = useState(0);

  const { data, isLoading } = useCompanyFeed({ limit: 10, page: 1 });
  const postsWithImages = (data?.posts ?? []).filter((p: CompanyPost) => p.media.length > 0);

  useEffect(() => {
    if (isLoading) return;
    if (postsWithImages.length === 0) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    setOpen(true);
    sessionStorage.setItem(SESSION_KEY, "1");
  }, [isLoading, postsWithImages.length]);

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) sessionStorage.setItem(SESSION_KEY, "1");
  };

  const total = postsWithImages.length;
  const currentPost = postsWithImages[postIdx] as CompanyPost | undefined;

  const prevPost = () => setPostIdx((i) => (i - 1 + total) % total);
  const nextPost = () => setPostIdx((i) => (i + 1) % total);

  if (!currentPost) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="overflow-hidden rounded-2xl p-0 shadow-2xl sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* Top bar */}
        <div
          className="h-1.5 w-full"
          style={{
            background:
              "linear-gradient(90deg, var(--sidebar-canvas) 0%, var(--brand-500) 55%, rgba(232,35,26,0.82) 100%)",
          }}
        />

        {/* Header row */}
        <div className="flex items-center justify-between px-5 pt-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[color:var(--brand-50)] text-[color:var(--brand-600)]">
              <Megaphone className="h-3.5 w-3.5" />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--brand-700)]">
              Announcements
            </span>
            {total > 1 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {postIdx + 1} / {total}
              </span>
            )}
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close announcements"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>

        {/* Post content */}
        <PostSlide post={currentPost} />

        {/* Post navigation dots */}
        {total > 1 && (
          <div className="flex items-center justify-center gap-1.5 pb-1">
            {postsWithImages.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to announcement ${i + 1}`}
                onClick={() => setPostIdx(i)}
                className={`rounded-full transition-all duration-200 ${
                  i === postIdx
                    ? "h-2 w-5 bg-[color:var(--brand-500)]"
                    : "h-2 w-2 bg-slate-200"
                }`}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <Link
            to="/engagement/company-feed"
            onClick={() => handleOpenChange(false)}
            className="text-xs font-semibold text-[color:var(--brand-700)] underline-offset-2 hover:underline"
          >
            View all company updates →
          </Link>
          <div className="flex items-center gap-2">
            {total > 1 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2.5 text-xs"
                  onClick={prevPost}
                  disabled={total <= 1}
                  aria-label="Previous announcement"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2.5 text-xs"
                  onClick={nextPost}
                  aria-label="Next announcement"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </>
            )}
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-lg px-3 text-xs text-slate-500"
              >
                Dismiss
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
