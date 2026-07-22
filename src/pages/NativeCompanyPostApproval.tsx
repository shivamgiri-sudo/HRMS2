import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileWarning,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getStatusMeta,
  useApprovalQueue,
  useApproveCompanyPost,
  useRejectCompanyPost,
} from "@/hooks/useCompanyFeed";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

const STATUS_BORDER_MAP: Record<string, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending_approval: "border-amber-200 bg-amber-50 text-amber-700",
  borderline_flagged: "border-orange-200 bg-orange-50 text-orange-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  auto_rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

function statusBadgeClass(status: string): string {
  return STATUS_BORDER_MAP[status] ?? "border-slate-200 bg-slate-100 text-slate-600";
}

function formatDateTime(value: string | null): string {
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

function AuthImage({ path, className, onClick }: { path: string; className?: string; onClick?: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    if (prevPath.current === path) return;
    prevPath.current = path;
    let active = true;
    hrmsApi.getBlob(path)
      .then((blob) => {
        if (active) setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => {
      active = false;
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [path]);

  if (!blobUrl) return <div className={`${className ?? ""} bg-slate-100 animate-pulse rounded`} />;
  return <img src={blobUrl} alt="" className={className} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} />;
}

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
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const posts = queueQuery.data?.posts ?? [];
  const filteredPosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return posts;
    return posts.filter((post) =>
      [
        post.content_text ?? "",
        post.author_name ?? "",
        post.author_code ?? "",
        post.status,
        post.auto_reject_reason ?? "",
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [posts, search]);

  const selectedPost =
    filteredPosts.find((post) => post.id === selectedPostId) ?? filteredPosts[0] ?? null;
  const busy = approveMutation.isPending || rejectMutation.isPending;

  // Clear review notes when switching posts
  useEffect(() => {
    setReviewNotes("");
  }, [selectedPostId]);

  // Escape key dismiss for expanded image overlay
  useEffect(() => {
    if (!expandedImage) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpandedImage(null); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [expandedImage]);

  function advanceToNext() {
    const currentIdx = filteredPosts.findIndex((p) => p.id === selectedPost?.id);
    const next = filteredPosts[currentIdx + 1] ?? filteredPosts[0];
    if (next && next.id !== selectedPost?.id) {
      setSelectedPostId(next.id);
    } else {
      setSelectedPostId("");
    }
  }

  async function doApprove() {
    if (!selectedPost) return;
    try {
      await approveMutation.mutateAsync({
        postId: selectedPost.id,
        review_notes: reviewNotes.trim() || undefined,
      });
      toast({ title: "Post approved", description: "The company feed has been updated." });
      setReviewNotes("");
      advanceToNext();
    } catch (error) {
      toast({
        title: "Approval failed",
        description: error instanceof Error ? error.message : "Unable to approve this post.",
        variant: "destructive",
      });
    }
  }

  async function doReject() {
    if (!selectedPost) return;
    try {
      await rejectMutation.mutateAsync({
        postId: selectedPost.id,
        reason: rejectReason.trim() || undefined,
        review_notes: reviewNotes.trim() || undefined,
      });
      toast({ title: "Post rejected", description: "The creator will see the moderation result." });
      setRejectReason("");
      setReviewNotes("");
      setRejectOpen(false);
      advanceToNext();
    } catch (error) {
      toast({
        title: "Rejection failed",
        description: error instanceof Error ? error.message : "Unable to reject this post.",
        variant: "destructive",
      });
    }
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Slim header */}
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
          <h1 className="text-sm font-semibold">Post Approval Queue</h1>
          {filteredPosts.length > 0 && (
            <Badge variant="outline" className="text-xs">
              Pending: {filteredPosts.length}
            </Badge>
          )}
        </div>

        {/* Split pane */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left list panel */}
          <div className="w-72 shrink-0 border-r flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--brand-700)]">
                    Moderator lane
                  </p>
                  <h2 className="mt-2 font-['Fira_Sans'] text-xl font-semibold tracking-[-0.03em] text-slate-950">
                    Pending posts
                  </h2>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {filteredPosts.length} live
                </span>
              </div>

              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, code, or content"
                className="rounded-2xl"
              />

              {queueQuery.isError ? (
                <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <div>
                      <p className="font-semibold">Queue load failed</p>
                      <p className="mt-1">
                        {queueQuery.error?.message ?? "Unable to load moderation queue."}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-4 rounded-xl"
                    onClick={() => void queueQuery.refetch()}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Retry
                  </Button>
                </div>
              ) : null}

              {queueQuery.isLoading ? (
                <div className="space-y-3">
                  <div className="h-24 rounded-[1.2rem] skeleton" />
                  <div className="h-24 rounded-[1.2rem] skeleton" />
                  <div className="h-24 rounded-[1.2rem] skeleton" />
                </div>
              ) : null}

              {!queueQuery.isLoading && !queueQuery.isError && filteredPosts.length === 0 ? (
                <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center">
                  <Sparkles className="mx-auto h-6 w-6 text-[color:var(--brand-600)]" />
                  <h3 className="mt-4 font-['Fira_Sans'] text-xl font-semibold text-slate-950">
                    Queue is clear
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    New moderation-ready posts will appear here automatically.
                  </p>
                </div>
              ) : null}

              {!queueQuery.isLoading && !queueQuery.isError ? (
                <div className="space-y-3">
                  {filteredPosts.map((post) => {
                    const statusMeta = getStatusMeta(post.status);
                    return (
                      <button
                        key={post.id}
                        type="button"
                        onClick={() => setSelectedPostId(post.id)}
                        className={`w-full rounded-[1.25rem] border p-4 text-left transition ${
                          selectedPost?.id === post.id
                            ? "border-[color:var(--brand-200)] bg-[color:var(--brand-50)] shadow-[var(--shadow-xs)]"
                            : "border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass(post.status)}`}
                            >
                              {statusMeta.label}
                            </span>
                            <p className="text-xs font-medium text-slate-600">
                              {post.author_name ?? post.author_code ?? "Unknown creator"}
                            </p>
                            <p className="line-clamp-2 text-sm leading-6 text-slate-700">
                              {post.content_text?.trim() || "Image-led post awaiting review."}
                            </p>
                          </div>
                          <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                            {formatDateTime(post.submitted_at ?? post.created_at)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {/* Right detail panel */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <Card className="rounded-[1.8rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
              <CardContent className="space-y-6 p-5 sm:p-6">
                {!selectedPost ? (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
                    <Eye className="mx-auto h-6 w-6 text-[color:var(--brand-600)]" />
                    <h2 className="mt-4 font-['Fira_Sans'] text-2xl font-semibold text-slate-950">
                      Select a post to review
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      The moderation detail panel opens here once you pick a queue item.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass(selectedPost.status)}`}
                        >
                          {getStatusMeta(selectedPost.status).label}
                        </span>
                        <div>
                          <h2 className="font-['Fira_Sans'] text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                            Moderation review
                          </h2>
                          <p className="mt-2 text-sm text-slate-500">
                            Creator:{" "}
                            <span className="font-semibold text-slate-700">
                              {selectedPost.author_name ?? selectedPost.author_code ?? "Unknown"}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        <p className="font-semibold text-slate-900">Submitted</p>
                        <p className="mt-1">
                          {formatDateTime(selectedPost.submitted_at ?? selectedPost.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-5">
                      <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
                        {selectedPost.content_text?.trim() ||
                          "This post was submitted with image media and no text copy."}
                      </p>
                      {selectedPost.media.length > 0 ? (
                        <div className="mt-4 space-y-3">
                          <div className="rounded-[1.15rem] border border-slate-200 bg-white p-4 text-sm text-slate-600">
                            {selectedPost.media.length} image
                            {selectedPost.media.length === 1 ? "" : "s"} submitted with this post.
                            Click any image to view full size.
                          </div>
                          <div
                            className={`grid gap-3 ${selectedPost.media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
                          >
                            {selectedPost.media.slice(0, 4).map((media) => {
                              const imgPath = `/api/files/company-feed/${media.file_id}`;
                              return (
                                <Fragment key={media.file_id}>
                                  <AuthImage
                                    path={imgPath}
                                    className="cursor-zoom-in rounded object-cover w-full h-44"
                                    onClick={() =>
                                      setExpandedImage(expandedImage === imgPath ? null : imgPath)
                                    }
                                  />
                                  {expandedImage === imgPath && (
                                    <div
                                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
                                      onClick={() => setExpandedImage(null)}
                                    >
                                      <AuthImage
                                        path={imgPath}
                                        className="max-h-[90vh] max-w-[90vw] rounded"
                                      />
                                    </div>
                                  )}
                                </Fragment>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {selectedPost.auto_reject_reason ? (
                        <div className="mt-4 rounded-[1.15rem] border border-orange-200 bg-orange-50 p-4 text-sm text-orange-700">
                          Auto moderation note: {selectedPost.auto_reject_reason}
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="review-notes">Review notes</Label>
                      <Textarea
                        id="review-notes"
                        value={reviewNotes}
                        onChange={(event) => setReviewNotes(event.target.value)}
                        placeholder="Add internal moderation context for this decision."
                        className="min-h-[120px] rounded-[1.3rem]"
                      />
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        disabled={busy}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => setApproveConfirmOpen(true)}
                      >
                        {approveMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Approve and publish
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        onClick={() => setRejectOpen(true)}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject with reason
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Approve confirmation dialog */}
      <AlertDialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
        <AlertDialogContent className="rounded-[1.6rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>Publish to entire company?</AlertDialogTitle>
            <AlertDialogDescription>
              This post will become visible to all employees on the company feed immediately.
              This action cannot be undone from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                setApproveConfirmOpen(false);
                void doApprove();
              }}
            >
              Confirm and publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md rounded-[1.6rem]">
          <DialogHeader>
            <DialogTitle>Reject company post</DialogTitle>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Tell the creator what needs to change."
            className="min-h-[120px] rounded-[1.2rem]"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={rejectMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => void doReject()}
            >
              {rejectMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileWarning className="h-4 w-4" />
              )}
              Confirm rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
