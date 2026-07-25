import { useRef, useState } from "react";
import { Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAddComment, useComments, useDeleteComment, type CommentItem } from "@/hooks/useCompanyFeed";
import { formatRelativeTime } from "@/lib/companyFeedUtils";

interface CommentThreadProps {
  postId: string;
  open: boolean;
  currentUserId?: string;
  isModerator?: boolean;
}

function Avatar({ name }: { name: string | null }) {
  const initials = name
    ? name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")
    : "?";
  return (
    <div
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-50)] text-[color:var(--brand-700)] text-xs font-bold"
    >
      {initials}
    </div>
  );
}

function CommentRow({
  comment,
  canDelete,
  onDelete,
  deleting,
}: {
  comment: CommentItem;
  canDelete: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="group flex gap-2.5 py-2">
      <Avatar name={comment.author_name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-slate-900 truncate">
            {comment.author_name ?? "Employee"}
          </span>
          {comment.author_code && (
            <span className="text-[11px] text-slate-400">@{comment.author_code}</span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">
            {formatRelativeTime(comment.created_at)}
          </span>
        </div>
        <p className="mt-0.5 text-[14px] leading-6 text-slate-700 whitespace-pre-wrap break-words">
          {comment.body}
        </p>
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          aria-label="Delete comment"
          className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

export function CommentThread({ postId, open, currentUserId, isModerator = false }: CommentThreadProps) {
  const [draft, setDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const commentsQuery = useComments(postId, open);
  const addMutation = useAddComment();
  const deleteMutation = useDeleteComment();

  const comments = commentsQuery.data?.comments ?? [];

  async function submitComment() {
    const body = draft.trim();
    if (!body) return;
    try {
      await addMutation.mutateAsync({ postId, body });
      setDraft("");
    } catch {
      // error visible via toast or comment state
    }
  }

  async function handleDelete(commentId: string) {
    setDeletingId(commentId);
    try {
      await deleteMutation.mutateAsync({ postId, commentId });
    } finally {
      setDeletingId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
      {commentsQuery.isLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        </div>
      )}

      {!commentsQuery.isLoading && comments.length === 0 && (
        <p className="py-3 text-center text-xs text-slate-400">No comments yet. Be the first!</p>
      )}

      {comments.map((c) => (
        <CommentRow
          key={c.id}
          comment={c}
          canDelete={!!currentUserId && (c.user_id === currentUserId || isModerator)}
          onDelete={() => void handleDelete(c.id)}
          deleting={deletingId === c.id}
        />
      ))}

      {/* Add comment */}
      <div className="flex gap-2 pt-2">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          className="min-h-[40px] resize-none rounded-xl py-2 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submitComment();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={!draft.trim() || addMutation.isPending}
          onClick={() => void submitComment()}
          className="self-end rounded-xl bg-[color:var(--brand-600)] hover:bg-[color:var(--brand-700)]"
          aria-label="Post comment"
        >
          {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
