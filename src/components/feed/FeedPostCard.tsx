import { useState } from "react";
import { Clock3, Megaphone } from "lucide-react";
import { AuthedImage } from "@/components/ui/AuthedImage";
import { ImageLightbox } from "@/components/feed/ImageLightbox";
import { PostEngagementBar } from "@/components/feed/PostEngagementBar";
import { CommentThread } from "@/components/feed/CommentThread";
import { CelebrationPostCard } from "@/components/feed/CelebrationPostCard";
import { useReactToPost, type CompanyPost } from "@/hooks/useCompanyFeed";
import { getCompanyFeedImageUrl, formatRelativeTime } from "@/lib/companyFeedUtils";

interface FeedPostCardProps {
  post: CompanyPost;
  currentUserId?: string;
  isModerator?: boolean;
  showEngagement?: boolean;
}

function PostImageGrid({
  media,
  authorLabel,
  onImageClick,
}: {
  media: CompanyPost["media"];
  authorLabel: string;
  onImageClick: (index: number) => void;
}) {
  const count = media.length;
  if (count === 0) return null;

  if (count === 1) {
    return (
      <div
        className="overflow-hidden rounded-xl cursor-pointer bg-slate-950"
        onClick={() => onImageClick(0)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onImageClick(0)}
        aria-label="Open image"
      >
        <AuthedImage
          src={getCompanyFeedImageUrl(media[0].file_id)}
          alt={`Post image by ${authorLabel}`}
          loading="lazy"
          className="max-h-[480px] w-full object-contain transition-transform duration-200 hover:scale-[1.01]"
        />
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {media.map((m, i) => (
          <div
            key={m.file_id}
            className="overflow-hidden rounded-xl cursor-pointer"
            onClick={() => onImageClick(i)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onImageClick(i)}
            aria-label={`Image ${i + 1}`}
          >
            <AuthedImage
              src={getCompanyFeedImageUrl(m.file_id)}
              alt={`Post image ${i + 1}`}
              loading="lazy"
              className="aspect-square w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
            />
          </div>
        ))}
      </div>
    );
  }

  if (count === 3) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div
          className="row-span-2 overflow-hidden rounded-xl cursor-pointer"
          onClick={() => onImageClick(0)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onImageClick(0)}
          aria-label="Image 1"
        >
          <AuthedImage
            src={getCompanyFeedImageUrl(media[0].file_id)}
            alt="Post image 1"
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
          />
        </div>
        {media.slice(1, 3).map((m, i) => (
          <div
            key={m.file_id}
            className="overflow-hidden rounded-xl cursor-pointer"
            onClick={() => onImageClick(i + 1)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onImageClick(i + 1)}
            aria-label={`Image ${i + 2}`}
          >
            <AuthedImage
              src={getCompanyFeedImageUrl(m.file_id)}
              alt={`Post image ${i + 2}`}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
            />
          </div>
        ))}
      </div>
    );
  }

  // 4+
  return (
    <div className="grid grid-cols-2 gap-2">
      {media.slice(0, 4).map((m, i) => {
        const isLast = i === 3;
        const extraCount = count - 4;
        return (
          <div
            key={m.file_id}
            className="relative overflow-hidden rounded-xl cursor-pointer"
            onClick={() => onImageClick(i)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onImageClick(i)}
            aria-label={`Image ${i + 1}${isLast && extraCount > 0 ? `, +${extraCount} more` : ""}`}
          >
            <AuthedImage
              src={getCompanyFeedImageUrl(m.file_id)}
              alt={`Post image ${i + 1}`}
              loading="lazy"
              className="aspect-square w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
            />
            {isLast && extraCount > 0 && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/55 backdrop-blur-[2px]">
                <span className="text-2xl font-bold text-white">+{extraCount}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FeedPostCard({
  post,
  currentUserId,
  isModerator = false,
  showEngagement = true,
}: FeedPostCardProps) {
  // Delegate celebration posts to their own rich card. 'festival' was missing here —
  // festival_calendar posts fell through to this plain generic card with no festive
  // visual identity at all.
  if (post.post_type === "birthday" || post.post_type === "anniversary" || post.post_type === "festival") {
    return (
      <CelebrationPostCard
        post={post}
        currentUserId={currentUserId}
        showEngagement={showEngagement}
      />
    );
  }

  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const reactMutation = useReactToPost();

  const authorLabel = post.author_name ?? "Company Update";
  const authorCode = post.author_code ? `@${post.author_code}` : null;
  const timestamp = formatRelativeTime(post.approved_at ?? post.submitted_at ?? post.created_at);
  const bodyText = post.content_text?.trim() ?? "";
  const isLong = bodyText.length > 280;
  const displayText = isLong && !expanded ? bodyText.slice(0, 280) + "…" : bodyText;
  const imageUrls = post.media.map((m) => getCompanyFeedImageUrl(m.file_id));

  function handleImageClick(index: number) {
    setLightboxIdx(index);
    setLightboxOpen(true);
  }

  return (
    <>
      <article className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]">
        {/* Brand strip */}
        <div
          className="absolute inset-x-0 top-0 h-[1.5px]"
          style={{ background: "linear-gradient(90deg, var(--sidebar-canvas) 0%, var(--brand-500) 55%, rgba(232,35,26,0.82) 100%)" }}
        />

        <div className="space-y-4 px-5 pt-5 pb-4">
          {/* Author row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-100)] text-[color:var(--brand-700)] text-sm font-bold">
                {authorLabel.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-slate-900 truncate">{authorLabel}</span>
                  {authorCode && (
                    <span className="text-[12px] text-slate-400">{authorCode}</span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--brand-100)] bg-[color:var(--brand-50)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--brand-700)]">
                    <Megaphone className="h-2.5 w-2.5" />
                    MCN
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[12px] text-slate-400">
                  <Clock3 className="h-3 w-3" />
                  {timestamp}
                </div>
              </div>
            </div>
          </div>

          {/* Body text */}
          {bodyText && (
            <div>
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
                {displayText}
              </p>
              {isLong && (
                <button
                  type="button"
                  className="mt-1 text-sm font-semibold text-[color:var(--brand-600)] hover:underline"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          )}

          {/* Image grid */}
          {post.media.length > 0 && (
            <PostImageGrid media={post.media} authorLabel={authorLabel} onImageClick={handleImageClick} />
          )}

          {/* Engagement */}
          {showEngagement && (
            <>
              <PostEngagementBar
                postId={post.id}
                likeCount={post.like_count ?? 0}
                dislikeCount={post.dislike_count ?? 0}
                commentCount={post.comment_count ?? 0}
                myReaction={post.my_reaction ?? null}
                onReact={(reaction) => reactMutation.mutate({ postId: post.id, reaction })}
                onCommentClick={() => setCommentsOpen((v) => !v)}
                commentsOpen={commentsOpen}
              />
              <CommentThread
                postId={post.id}
                open={commentsOpen}
                currentUserId={currentUserId}
                isModerator={isModerator}
              />
            </>
          )}
        </div>
      </article>

      <ImageLightbox
        images={imageUrls}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        currentIndex={lightboxIdx}
        onIndexChange={setLightboxIdx}
      />
    </>
  );
}
