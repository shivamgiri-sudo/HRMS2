import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileWarning,
  Image,
  Loader2,
  RefreshCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FeedPostCard } from "@/components/feed/FeedPostCard";
import {
  useApprovalQueue,
  useApproveCompanyPost,
  useRejectCompanyPost,
} from "@/hooks/useCompanyFeed";
import { useToast } from "@/hooks/use-toast";
import { formatRelativeTime } from "@/lib/companyFeedUtils";

export default function NativeCompanyPostApproval() {
  const { toast } = useToast();
  const queueQuery = useApprovalQueue();
  const approveMutation = useApproveCompanyPost();
  const rejectMutation = useRejectCompanyPost();

  const [search, setSearch] = useState("");
  const [selectedPostId, setSelectedPostId] = useState<string>("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");

  const posts = queueQuery.data?.posts ?? [];
  const filteredPosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return posts;
    return posts.filter((post) =>
      [post.content_text ?? "", post.author_name ?? "", post.author_code ?? "", post.status]
        .some((v) => v.toLowerCase().includes(needle)),
    );
  }, [posts, search]);

  const selectedPost = filteredPosts.find((p) => p.id === selectedPostId) ?? filteredPosts[0] ?? null;
  const busy = approveMutation.isPending || rejectMutation.isPending;

  useEffect(() => {
    setReviewNotes("");
  }, [selectedPostId]);

  function advanceToNext() {
    const currentIdx = filteredPosts.findIndex((p) => p.id === selectedPost?.id);
    const next = filteredPosts[currentIdx + 1] ?? filteredPosts[0];
    setSelectedPostId(next && next.id !== selectedPost?.id ? next.id : "");
  }

  async function doApprove() {
    if (!selectedPost) return;
    try {
      await approveMutation.mutateAsync({ postId: selectedPost.id, review_notes: reviewNotes.trim() || undefined });
      toast({ title: "Post approved", description: "The company feed has been updated." });
      setReviewNotes("");
      advanceToNext();
    } catch (error) {
      toast({ title: "Approval failed", description: error instanceof Error ? error.message : "Unable to approve.", variant: "destructive" });
    }
  }

  async function doReject() {
    if (!selectedPost) return;
    try {
      await rejectMutation.mutateAsync({ postId: selectedPost.id, reason: rejectReason.trim() || undefined, review_notes: reviewNotes.trim() || undefined });
      toast({ title: "Post rejected", description: "The creator will see the moderation result." });
      setRejectReason("");
      setReviewNotes("");
      setRejectOpen(false);
      advanceToNext();
    } catch (error) {
      toast({ title: "Rejection failed", description: error instanceof Error ? error.message : "Unable to reject.", variant: "destructive" });
    }
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div
          className="shrink-0 border-b px-5 py-3"
          style={{ background: "linear-gradient(135deg, var(--brand-700) 0%, var(--brand-500) 100%)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-sm font-bold text-white">Post Approval Queue</h1>
              <p className="text-[11px] text-white/70">Review and moderate company feed submissions</p>
            </div>
            {filteredPosts.length > 0 && (
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {filteredPosts.length} pending
              </span>
            )}
          </div>
        </div>

        {/* Split pane */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left queue panel */}
          <div className="flex w-72 shrink-0 flex-col border-r overflow-hidden">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search posts…"
                className="rounded-xl text-xs"
              />

              {queueQuery.isError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p>{queueQuery.error?.message ?? "Queue load failed."}</p>
                  </div>
                  <Button variant="outline" size="sm" className="mt-2 h-7 rounded-lg text-xs" onClick={() => void queueQuery.refetch()}>
                    <RefreshCcw className="mr-1 h-3 w-3" /> Retry
                  </Button>
                </div>
              )}

              {queueQuery.isLoading && (
                <div className="space-y-2">
                  <div className="h-24 rounded-xl skeleton" />
                  <div className="h-24 rounded-xl skeleton" />
                  <div className="h-24 rounded-xl skeleton" />
                </div>
              )}

              {!queueQuery.isLoading && !queueQuery.isError && filteredPosts.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                  <Sparkles className="mx-auto h-5 w-5 text-[color:var(--brand-500)]" />
                  <p className="mt-2 text-xs font-semibold text-slate-700">Queue is clear</p>
                  <p className="mt-1 text-[11px] text-slate-500">New posts appear here automatically.</p>
                </div>
              )}

              {filteredPosts.map((post) => {
                const isSelected = selectedPost?.id === post.id;
                const timestamp = formatRelativeTime(post.submitted_at ?? post.created_at);
                const isBorderline = post.status === "borderline_flagged";
                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => setSelectedPostId(post.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? "border-[color:var(--brand-200)] bg-[color:var(--brand-50)] shadow-[var(--shadow-xs)]"
                        : "border-slate-200 bg-white hover:border-[color:var(--brand-100)] hover:bg-[color:var(--brand-50)/50]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        isBorderline
                          ? "border-orange-200 bg-orange-50 text-orange-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {isBorderline ? "Needs review" : "Awaiting"}
                      </span>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{timestamp}</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 truncate">
                      {post.author_name ?? post.author_code ?? "Unknown"}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-slate-600">
                      {post.content_text?.trim() || "Image-led post"}
                    </p>
                    {post.media.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
                        <Image className="h-3 w-3" />
                        {post.media.length} image{post.media.length !== 1 ? "s" : ""}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right detail panel */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {!selectedPost ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-16 text-center">
                <Eye className="h-8 w-8 text-slate-300" />
                <div>
                  <p className="font-semibold text-slate-700">Select a post to review</p>
                  <p className="mt-1 text-sm text-slate-500">The post preview opens here once you pick a queue item.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Real post preview — looks exactly like the published feed */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Post preview — what employees will see
                  </p>
                  <FeedPostCard post={selectedPost} showEngagement={false} isModerator={true} />
                </div>

                {/* Auto moderation note */}
                {selectedPost.auto_reject_reason && (
                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
                    <p className="font-semibold">⚠ Auto moderation flag</p>
                    <p className="mt-1">{selectedPost.auto_reject_reason}</p>
                  </div>
                )}

                {/* Review notes */}
                <div className="space-y-2">
                  <Label htmlFor="review-notes" className="text-xs">Internal review notes (optional)</Label>
                  <Textarea
                    id="review-notes"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Add internal moderation context for this decision."
                    className="min-h-[80px] rounded-xl text-sm"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={busy}
                    className="rounded-xl font-semibold"
                    style={{ backgroundColor: "var(--success-500, #3BAD49)" }}
                    onClick={() => setApproveConfirmOpen(true)}
                  >
                    {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve & Publish
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    className="rounded-xl border-[color:var(--accent-500,#E8231A)] text-[color:var(--accent-500,#E8231A)] font-semibold hover:bg-rose-50"
                    onClick={() => setRejectOpen(true)}
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Approve confirmation */}
      <AlertDialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Publish to entire company?</AlertDialogTitle>
            <AlertDialogDescription>
              This post will become immediately visible to all employees on the company feed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              style={{ backgroundColor: "var(--success-500, #3BAD49)" }}
              onClick={() => { setApproveConfirmOpen(false); void doApprove(); }}
            >
              Confirm & Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Reject company post</DialogTitle>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Tell the creator what needs to change."
            className="min-h-[100px] rounded-xl"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={rejectMutation.isPending}
              style={{ backgroundColor: "var(--accent-500, #E8231A)" }}
              className="text-white hover:opacity-90"
              onClick={() => void doReject()}
            >
              {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileWarning className="h-4 w-4" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
