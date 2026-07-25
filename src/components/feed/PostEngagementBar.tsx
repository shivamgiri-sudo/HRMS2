import { MessageCircle, ThumbsDown, ThumbsUp } from "lucide-react";

interface PostEngagementBarProps {
  postId: string;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  myReaction: "like" | "dislike" | null;
  onReact: (reaction: "like" | "dislike") => void;
  onCommentClick: () => void;
  commentsOpen?: boolean;
}

export function PostEngagementBar({
  likeCount,
  dislikeCount,
  commentCount,
  myReaction,
  onReact,
  onCommentClick,
  commentsOpen = false,
}: PostEngagementBarProps) {
  return (
    <div className="flex items-center gap-1 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => onReact("like")}
        aria-label={`Like — ${likeCount}`}
        aria-pressed={myReaction === "like"}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
          myReaction === "like"
            ? "bg-[color:var(--brand-50)] text-[color:var(--brand-700)] shadow-[inset_0_0_0_1.5px_var(--brand-200)]"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        }`}
      >
        <ThumbsUp className={`h-4 w-4 ${myReaction === "like" ? "fill-[color:var(--brand-600)] stroke-[color:var(--brand-600)]" : ""}`} />
        <span className="tabular-nums">{likeCount}</span>
      </button>

      <button
        type="button"
        onClick={() => onReact("dislike")}
        aria-label={`Dislike — ${dislikeCount}`}
        aria-pressed={myReaction === "dislike"}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
          myReaction === "dislike"
            ? "bg-rose-50 text-rose-700 shadow-[inset_0_0_0_1.5px_theme(colors.rose.200)]"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        }`}
      >
        <ThumbsDown className={`h-4 w-4 ${myReaction === "dislike" ? "fill-rose-600 stroke-rose-600" : ""}`} />
        <span className="tabular-nums">{dislikeCount}</span>
      </button>

      <button
        type="button"
        onClick={onCommentClick}
        aria-label={`Comments — ${commentCount}`}
        aria-pressed={commentsOpen}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
          commentsOpen
            ? "bg-[color:var(--brand-50)] text-[color:var(--brand-700)]"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        }`}
      >
        <MessageCircle className="h-4 w-4" />
        <span className="tabular-nums">{commentCount}</span>
      </button>
    </div>
  );
}
