import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Loader2,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FeedPostCard } from "@/components/feed/FeedPostCard";
import {
  getStatusMeta,
  type CompanyPost,
  useApproveCompanyPost,
  useDeleteCompanyPost,
  useManageCompanyPosts,
} from "@/hooks/useCompanyFeed";
import { useToast } from "@/hooks/use-toast";
import { formatRelativeTime } from "@/lib/companyFeedUtils";

function getCurrentUserId(): string | undefined {
  try {
    const token = localStorage.getItem("hrms_access_token");
    if (!token) return undefined;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload?.id === "string" ? payload.id : (typeof payload?.sub === "string" ? payload.sub : undefined);
  } catch { return undefined; }
}

type ManageTab = "all" | "approved" | "pending" | "flagged" | "rejected" | "auto_rejected";

const TABS: { key: ManageTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "approved", label: "Published" },
  { key: "pending", label: "Pending" },
  { key: "flagged", label: "Flagged" },
  { key: "rejected", label: "Rejected" },
  { key: "auto_rejected", label: "Auto-rejected" },
];

const PAGE_LIMIT = 20;

function StatusChip({ status }: { status: string }) {
  const meta = getStatusMeta(status as Parameters<typeof getStatusMeta>[0]);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.bg} ${meta.color} border-current/20`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

export default function NativeCompanyPostManage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const manageQuery = useManageCompanyPosts({ page, limit: PAGE_LIMIT });
  const deleteMutation = useDeleteCompanyPost();
  const approveMutation = useApproveCompanyPost();

  const [tab, setTab] = useState<ManageTab>("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [previewPost, setPreviewPost] = useState<CompanyPost | null>(null);
  const currentUserId = getCurrentUserId();

  const posts = manageQuery.data?.posts ?? [];
  const total = manageQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const counts = useMemo(
    () => ({
      all: posts.length,
      approved: posts.filter((p) => p.status === "approved").length,
      pending: posts.filter((p) => p.status === "pending_approval").length,
      flagged: posts.filter((p) => p.status === "borderline_flagged").length,
      rejected: posts.filter((p) => p.status === "rejected").length,
      auto_rejected: posts.filter((p) => p.status === "auto_rejected").length,
    }),
    [posts],
  );

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
      return [post.content_text ?? "", post.author_name ?? "", post.author_code ?? "", post.status]
        .some((v) => v.toLowerCase().includes(needle));
    });
  }, [posts, search, tab]);

  function doDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { postId: deleteTarget, reason: deleteReason },
      {
        onSuccess: () => { toast({ title: "Post removed" }); setDeleteTarget(null); setDeleteReason(""); },
        onError: (e) => toast({ title: "Delete failed", description: e instanceof Error ? e.message : "Unable to delete.", variant: "destructive" }),
      },
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
          <div>
            <h1 className="text-sm font-bold text-slate-900">Post Management</h1>
            <p className="text-[11px] text-slate-500">{total} total posts</p>
          </div>
          <div className="relative">
            <Input
              className="h-8 w-48 rounded-lg pl-3 text-xs"
              placeholder="Search posts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-0 overflow-x-auto border-b bg-white px-5">
          {TABS.map(({ key, label }) => {
            const count = counts[key];
            const isActive = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setTab(key); setPage(1); }}
                className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-3 text-xs font-medium transition-colors ${
                  isActive
                    ? "text-[color:var(--brand-700)]"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                    isActive ? "bg-[color:var(--brand-100)] text-[color:var(--brand-700)]" : "bg-slate-100 text-slate-500"
                  }`}>{count}</span>
                )}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[color:var(--brand-600)]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {/* Error */}
          {manageQuery.isError && (
            <div className="m-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <p className="flex-1 text-sm text-rose-700">{manageQuery.error?.message ?? "Failed to load posts."}</p>
              <Button variant="outline" size="sm" className="border-rose-200 text-rose-700 hover:bg-rose-100" onClick={() => void manageQuery.refetch()}>
                <RefreshCcw className="mr-1 h-3 w-3" /> Retry
              </Button>
            </div>
          )}

          {/* Loading */}
          {manageQuery.isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}

          {/* Empty */}
          {!manageQuery.isLoading && !manageQuery.isError && filteredPosts.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm font-medium text-slate-600">
                {search ? `No posts matching "${search}"` : `No ${tab === "all" ? "" : TABS.find((t) => t.key === tab)?.label.toLowerCase() + " "}posts`}
              </p>
              {search && <Button variant="ghost" size="sm" onClick={() => setSearch("")}>Clear search</Button>}
            </div>
          )}

          {/* Table */}
          {!manageQuery.isLoading && !manageQuery.isError && filteredPosts.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 border-b bg-white">
                <tr>
                  <th className="h-9 w-28 px-4 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Status</th>
                  <th className="h-9 min-w-[120px] px-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Author</th>
                  <th className="h-9 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Content</th>
                  <th className="h-9 w-20 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Images</th>
                  <th className="h-9 w-28 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Date</th>
                  <th className="h-9 w-20 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPosts.map((post) => (
                  <tr key={post.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-2.5">
                      <StatusChip status={post.status} />
                    </td>
                    <td className="max-w-[130px] truncate px-3 py-2.5 font-medium text-slate-800">
                      {post.author_name ?? post.author_code ?? "—"}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2.5 text-slate-600">
                      {post.content_text?.trim() || <span className="italic text-slate-400">Image-only post</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">
                      {post.media.length > 0 ? `${post.media.length} img` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
                      {formatRelativeTime(post.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Preview post"
                          onClick={() => setPreviewPost(post)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[color:var(--brand-50)] hover:text-[color:var(--brand-600)]"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {post.status === "pending_approval" && (
                          <button
                            type="button"
                            title="Approve"
                            disabled={approveMutation.isPending}
                            onClick={() => approveMutation.mutate({ postId: post.id })}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {approveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => setDeleteTarget(post.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          {totalPages > 1 && !manageQuery.isLoading && (
            <div className="flex items-center justify-center gap-3 border-t py-4">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1 || manageQuery.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className="text-xs text-slate-600">Page {page} of {totalPages}</span>
              <Button type="button" variant="outline" size="sm" disabled={page >= totalPages || manageQuery.isFetching} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Post preview dialog */}
      <Dialog open={!!previewPost} onOpenChange={(open) => { if (!open) setPreviewPost(null); }}>
        <DialogContent className="max-w-lg p-0 overflow-hidden rounded-2xl">
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle className="text-sm">Post Preview</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[80vh] px-0 pb-4">
            {previewPost && (
              <FeedPostCard
                post={previewPost}
                currentUserId={currentUserId}
                isModerator={true}
                showEngagement={false}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteReason(""); } }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete post</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason for deletion (required)"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            className="min-h-[80px] rounded-xl text-sm"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setDeleteTarget(null); setDeleteReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!deleteReason.trim() || deleteMutation.isPending}
              onClick={doDelete}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
