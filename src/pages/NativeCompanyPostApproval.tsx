import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  FileWarning,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type CompanyPost,
  useApprovalQueue,
  useApproveCompanyPost,
  useRejectCompanyPost,
} from "@/hooks/useCompanyFeed";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/apiBase";

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

function statusTone(status: CompanyPost["status"]): string {
  if (status === "pending_approval") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "borderline_flagged") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected" || status === "auto_rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function getCompanyFeedImageUrl(fileId: string): string {
  return apiUrl(`/api/files/company-feed/${fileId}`);
}

export default function NativeCompanyPostApproval() {
  const { toast } = useToast();
  const queueQuery = useApprovalQueue();
  const approveMutation = useApproveCompanyPost();
  const rejectMutation = useRejectCompanyPost();

  const [search, setSearch] = useState("");
  const [selectedPostId, setSelectedPostId] = useState<string>("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");

  const posts = queueQuery.data ?? [];
  const filteredPosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return posts;
    return posts.filter((post) =>
      [
        post.content_text ?? "",
        post.author_employee_id,
        post.status,
        post.auto_reject_reason ?? "",
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [posts, search]);

  const selectedPost = filteredPosts.find((post) => post.id === selectedPostId) ?? filteredPosts[0] ?? null;
  const busy = approveMutation.isPending || rejectMutation.isPending;

  async function handleApprove() {
    if (!selectedPost) return;
    try {
      await approveMutation.mutateAsync({
        postId: selectedPost.id,
        review_notes: reviewNotes.trim() || undefined,
      });
      toast({ title: "Post approved", description: "The company feed has been updated." });
      setReviewNotes("");
    } catch (error) {
      toast({
        title: "Approval failed",
        description: error instanceof Error ? error.message : "Unable to approve this post.",
        variant: "destructive",
      });
    }
  }

  async function handleReject() {
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
      <main className="space-y-8 p-4 sm:p-6 lg:p-8">
        <section
          className="relative overflow-hidden rounded-[2rem] border border-white/30 px-5 py-6 text-white shadow-[var(--shadow-brand-lg)] sm:px-7 sm:py-8 lg:px-9"
          style={{
            background:
              "linear-gradient(135deg, var(--sidebar-canvas) 0%, var(--brand-700) 35%, var(--brand-500) 74%, rgba(232,35,26,0.84) 115%)",
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.18)_0%,_rgba(255,255,255,0)_34%),radial-gradient(circle_at_bottom_right,_rgba(255,255,255,0.14)_0%,_rgba(255,255,255,0)_30%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/90 backdrop-blur">
                <ShieldCheck className="h-3.5 w-3.5" />
                Approval Queue
              </div>
              <div className="space-y-3">
                <h1 className="font-['Fira_Sans'] text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl lg:text-[3.2rem]">
                  Review the posts waiting to go company-wide.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-blue-50/92 sm:text-[15px]">
                  Moderation-eligible posts land here first. Approve to publish, or reject with a clear reason so the creator gets a useful next step.
                </p>
              </div>
            </div>
            <Button asChild className="h-auto justify-between rounded-[1.15rem] bg-white px-4 py-3 text-left text-[color:var(--brand-700)] hover:bg-blue-50">
              <Link to="/engagement/company-feed/manage">
                <span>
                  <span className="block text-sm font-semibold">Open management deck</span>
                  <span className="mt-1 block text-xs text-slate-500">See published and reviewed posts too.</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
            </Button>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[23rem_minmax(0,1fr)]">
          <Card className="rounded-[1.8rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
            <CardContent className="space-y-4 p-5">
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
                placeholder="Search by copy, employee ID, or status"
                className="rounded-2xl"
              />

              {queueQuery.isError ? (
                <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <div>
                      <p className="font-semibold">Queue load failed</p>
                      <p className="mt-1">{queueQuery.error?.message ?? "Unable to load moderation queue."}</p>
                    </div>
                  </div>
                  <Button variant="outline" className="mt-4 rounded-xl" onClick={() => void queueQuery.refetch()}>
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
                  {filteredPosts.map((post) => (
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
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(post.status)}`}>
                            {post.status.replace(/_/g, " ")}
                          </span>
                          <p className="line-clamp-2 text-sm leading-6 text-slate-700">
                            {post.content_text?.trim() || "Image-led post awaiting review."}
                          </p>
                        </div>
                        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                          {formatDateTime(post.submitted_at ?? post.created_at)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

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
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(selectedPost.status)}`}>
                        {selectedPost.status.replace(/_/g, " ")}
                      </span>
                      <div>
                        <h2 className="font-['Fira_Sans'] text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                          Moderation review
                        </h2>
                        <p className="mt-2 text-sm text-slate-500">
                          Creator employee ID: <span className="font-semibold text-slate-700">{selectedPost.author_employee_id}</span>
                        </p>
                      </div>
                    </div>
                    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <p className="font-semibold text-slate-900">Submitted</p>
                      <p className="mt-1">{formatDateTime(selectedPost.submitted_at ?? selectedPost.created_at)}</p>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-5">
                    <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
                      {selectedPost.content_text?.trim() || "This post was submitted with image media and no text copy."}
                    </p>
                    {selectedPost.media.length > 0 ? (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-[1.15rem] border border-slate-200 bg-white p-4 text-sm text-slate-600">
                          {selectedPost.media.length} image{selectedPost.media.length === 1 ? "" : "s"} submitted with this post.
                        </div>
                        <div className={`grid gap-3 ${selectedPost.media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                          {selectedPost.media.slice(0, 4).map((media) => (
                            <div
                              key={media.file_id}
                              className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-slate-100"
                            >
                              <img
                                src={getCompanyFeedImageUrl(media.file_id)}
                                alt={`Moderation preview ${media.sort_order}`}
                                className="h-full min-h-[220px] w-full object-cover"
                              />
                            </div>
                          ))}
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
                    <label className="text-sm font-semibold text-slate-900">Review notes</label>
                    <Textarea
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
                      onClick={() => void handleApprove()}
                    >
                      {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
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
              <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
              <Button
                type="button"
                disabled={rejectMutation.isPending}
                className="bg-rose-600 hover:bg-rose-700"
                onClick={() => void handleReject()}
              >
                {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileWarning className="h-4 w-4" />}
                Confirm rejection
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </DashboardLayout>
  );
}
