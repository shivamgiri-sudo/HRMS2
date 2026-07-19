import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
import {
  getStatusMeta,
  type CompanyPost,
  useApproveCompanyPost,
  useDeleteCompanyPost,
  useManageCompanyPosts,
} from "@/hooks/useCompanyFeed";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/apiBase";

type ManageTab = "all" | "approved" | "pending" | "flagged" | "rejected" | "auto_rejected";

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

function getCompanyFeedImageUrl(fileId: string): string {
  return apiUrl(`/api/files/company-feed/${fileId}`);
}

const PAGE_LIMIT = 20;

export default function NativeCompanyPostManage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const manageQuery = useManageCompanyPosts({ page, limit: PAGE_LIMIT });
  const deleteMutation = useDeleteCompanyPost();
  const approveMutation = useApproveCompanyPost();

  const [tab, setTab] = useState<ManageTab>("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CompanyPost | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [approveTarget, setApproveTarget] = useState<CompanyPost | null>(null);

  const posts = manageQuery.data?.posts ?? [];
  const total = manageQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const filteredPosts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return posts.filter((post) => {
      const statusMatch =
        tab === "all" ||
        (tab === "pending" && post.status === "pending_approval") ||
        (tab === "flagged" && post.status === "borderline_flagged") ||
        post.status === tab;

      if (!statusMatch) return false;
      if (!needle) return true;
      return [
        post.content_text ?? "",
        post.author_name ?? "",
        post.author_code ?? "",
        post.status,
        post.review_notes ?? "",
        post.rejection_reason ?? "",
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [posts, search, tab]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({
        postId: deleteTarget.id,
        reason: deleteReason.trim() || undefined,
      });
      toast({
        title: "Post removed",
        description: "The moderation management list has been refreshed.",
      });
      setDeleteTarget(null);
      setDeleteReason("");
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Unable to delete this post.",
        variant: "destructive",
      });
    }
  }

  async function handleApprove() {
    if (!approveTarget) return;
    try {
      await approveMutation.mutateAsync({ postId: approveTarget.id });
      toast({ title: "Post approved", description: "The company feed has been updated." });
      setApproveTarget(null);
    } catch (error) {
      toast({
        title: "Approval failed",
        description: error instanceof Error ? error.message : "Unable to approve this post.",
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
                Management Deck
              </div>
              <div className="space-y-3">
                <h1 className="font-['Fira_Sans'] text-3xl font-bold leading-tight tracking-[-0.04em] sm:text-4xl lg:text-[3.2rem]">
                  Keep the published and reviewed record under control.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-blue-50/92 sm:text-[15px]">
                  Filter posts by lifecycle state, inspect moderation metadata, and remove anything
                  that should no longer remain visible.
                </p>
              </div>
            </div>
            <Button
              asChild
              className="h-auto justify-between rounded-[1.15rem] bg-white px-4 py-3 text-left text-[color:var(--brand-700)] hover:bg-blue-50"
            >
              <Link to="/engagement/company-feed/approvals">
                <span>
                  <span className="block text-sm font-semibold">Back to approval queue</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Jump to the posts still waiting for action.
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
            </Button>
          </div>
        </section>

        <Card className="rounded-[1.8rem] border-slate-200 bg-white shadow-[var(--shadow-sm)]">
          <CardContent className="space-y-6 p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  setTab(value as ManageTab);
                  setPage(1);
                }}
              >
                <TabsList className="flex h-auto flex-wrap justify-start gap-2 bg-slate-50">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="approved">Published</TabsTrigger>
                  <TabsTrigger value="pending">Pending</TabsTrigger>
                  <TabsTrigger value="flagged">Flagged</TabsTrigger>
                  <TabsTrigger value="rejected">Rejected</TabsTrigger>
                  <TabsTrigger value="auto_rejected">Auto-rejected</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-3">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, content, notes…"
                  className="max-w-md rounded-2xl"
                />
                <span className="shrink-0 text-xs text-slate-500">{total} total</span>
              </div>
            </div>

            {manageQuery.isError ? (
              <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <div>
                    <p className="font-semibold">Management list failed to load</p>
                    <p className="mt-1">
                      {manageQuery.error?.message ?? "Unable to load moderation history."}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="mt-4 rounded-xl"
                  onClick={() => void manageQuery.refetch()}
                >
                  <RefreshCcw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : null}

            {manageQuery.isLoading ? (
              <div className="space-y-3">
                <div className="h-28 rounded-[1.2rem] skeleton" />
                <div className="h-28 rounded-[1.2rem] skeleton" />
                <div className="h-28 rounded-[1.2rem] skeleton" />
              </div>
            ) : null}

            {!manageQuery.isLoading && !manageQuery.isError && filteredPosts.length === 0 ? (
              <div className="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center">
                <Clock3 className="mx-auto h-6 w-6 text-[color:var(--brand-600)]" />
                <h2 className="mt-4 font-['Fira_Sans'] text-2xl font-semibold text-slate-950">
                  No posts match this view
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Try another lifecycle tab or remove the current search term.
                </p>
              </div>
            ) : null}

            {!manageQuery.isLoading && !manageQuery.isError && filteredPosts.length > 0 ? (
              <div className="space-y-4">
                {filteredPosts.map((post) => {
                  const statusMeta = getStatusMeta(post.status);
                  return (
                    <div
                      key={post.id}
                      className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass(post.status)}`}
                            >
                              {statusMeta.label}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                              {post.author_name ?? post.author_code ?? "Unknown employee"}
                            </span>
                            {post.author_code && post.author_name && (
                              <span className="text-[11px] text-slate-400">
                                @{post.author_code}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-700">
                            {post.content_text?.trim() || "Image-led post without text copy."}
                          </p>
                          {post.media.length > 0 ? (
                            <div className="grid gap-3 md:grid-cols-2">
                              {post.media.slice(0, 4).map((media) => (
                                <div
                                  key={media.file_id}
                                  className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white"
                                >
                                  <img
                                    src={getCompanyFeedImageUrl(media.file_id)}
                                    alt={`Post image ${media.sort_order}`}
                                    loading="lazy"
                                    className="h-full min-h-[180px] w-full object-cover"
                                  />
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <div className="grid gap-2 text-sm text-slate-500 md:grid-cols-2">
                            <p>
                              Created:{" "}
                              <span className="font-semibold text-slate-700">
                                {formatDateTime(post.created_at)}
                              </span>
                            </p>
                            {post.approved_at ? (
                              <p>
                                Approved:{" "}
                                <span className="font-semibold text-slate-700">
                                  {formatDateTime(post.approved_at)}
                                  {post.approved_by_name ? ` by ${post.approved_by_name}` : ""}
                                </span>
                              </p>
                            ) : null}
                            {post.rejected_at ? (
                              <p>
                                Rejected:{" "}
                                <span className="font-semibold text-slate-700">
                                  {formatDateTime(post.rejected_at)}
                                  {post.rejected_by_name ? ` by ${post.rejected_by_name}` : ""}
                                </span>
                              </p>
                            ) : null}
                          </div>
                          {post.review_notes ? (
                            <div className="rounded-[1rem] border border-slate-200 bg-white p-3 text-sm text-slate-600">
                              <span className="font-semibold text-slate-900">Review notes:</span>{" "}
                              {post.review_notes}
                            </div>
                          ) : null}
                          {post.rejection_reason ? (
                            <div className="rounded-[1rem] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                              <span className="font-semibold">Rejection reason:</span>{" "}
                              {post.rejection_reason}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-3 lg:flex-col">
                          {post.status === "pending_approval" && (
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                              disabled={approveMutation.isPending}
                              onClick={() => setApproveTarget(post)}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Approve
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={() => setDeleteTarget(post)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete post
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      disabled={page <= 1 || manageQuery.isFetching}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-sm text-slate-600">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      disabled={page >= totalPages || manageQuery.isFetching}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Approve confirmation */}
        <AlertDialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
          <AlertDialogContent className="rounded-[1.6rem]">
            <AlertDialogHeader>
              <AlertDialogTitle>Publish to entire company?</AlertDialogTitle>
              <AlertDialogDescription>
                This post will become visible to all employees immediately. This action cannot be
                undone from this page.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => void handleApprove()}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Confirm and publish
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete dialog */}
        <Dialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
        >
          <DialogContent className="max-w-md rounded-[1.6rem]">
            <DialogHeader>
              <DialogTitle>Delete company post</DialogTitle>
            </DialogHeader>
            <Textarea
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
              placeholder="Record why this post is being removed."
              className="min-h-[120px] rounded-[1.2rem]"
            />
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={deleteMutation.isPending}
                className="bg-rose-600 hover:bg-rose-700"
                onClick={() => void handleDelete()}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Confirm delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </DashboardLayout>
  );
}
