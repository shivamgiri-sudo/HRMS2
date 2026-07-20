import { useMemo, useState } from "react";
import { AlertCircle, Loader2, RefreshCcw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getStatusMeta,
  type CompanyPost,
  useApproveCompanyPost,
  useDeleteCompanyPost,
  useManageCompanyPosts,
} from "@/hooks/useCompanyFeed";
import { useToast } from "@/hooks/use-toast";

type ManageTab = "all" | "approved" | "pending" | "flagged" | "rejected" | "auto_rejected";

const PAGE_LIMIT = 20;

function PostTable({
  posts,
  onApprove,
  onDelete,
}: {
  posts: CompanyPost[];
  onApprove?: (id: string) => void;
  onDelete: (id: string, reason: string) => void;
}) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  if (posts.length === 0) {
    return <p className="px-4 py-8 text-center text-xs text-slate-500">No posts</p>;
  }

  return (
    <>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white border-b">
          <tr>
            <th className="h-8 w-24 px-3 text-left font-medium text-slate-500">Status</th>
            <th className="h-8 min-w-[100px] px-3 text-left font-medium text-slate-500">Author</th>
            <th className="h-8 px-3 text-left font-medium text-slate-500">Content</th>
            <th className="h-8 w-28 px-3 text-left font-medium text-slate-500">Date</th>
            <th className="h-8 w-24 px-3 text-left font-medium text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id} className="h-9 border-b hover:bg-slate-50">
              <td className="px-3 py-1">
                <Badge
                  variant={
                    post.status === "approved"
                      ? "default"
                      : post.status === "pending_approval"
                        ? "secondary"
                        : "destructive"
                  }
                  className="text-[10px]"
                >
                  {getStatusMeta(post.status).label}
                </Badge>
              </td>
              <td className="px-3 py-1 truncate max-w-[120px]">{post.author_name ?? "-"}</td>
              <td className="px-3 py-1 truncate max-w-[320px] text-slate-600">
                {post.content_text ?? ""}
              </td>
              <td className="px-3 py-1 text-slate-500 whitespace-nowrap">
                {post.created_at
                  ? new Date(post.created_at).toLocaleDateString("en-IN")
                  : "-"}
              </td>
              <td className="px-3 py-1">
                <div className="flex gap-1">
                  {onApprove && post.status === "pending_approval" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-green-700"
                      onClick={() => onApprove(post.id)}
                    >
                      Approve
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-red-600"
                    onClick={() => setDeleteTarget(post.id)}
                  >
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete post</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason for deletion"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            className="min-h-[60px] text-sm"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!deleteReason}
              onClick={() => {
                if (deleteTarget) {
                  onDelete(deleteTarget, deleteReason);
                  setDeleteTarget(null);
                  setDeleteReason("");
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        {/* Slim header */}
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
          <h1 className="text-sm font-semibold">Post Management</h1>
          <Input
            className="h-7 w-44 text-xs"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {/* Tabs with counts */}
          <div className="mb-3">
            <Tabs
              value={tab}
              onValueChange={(value) => {
                setTab(value as ManageTab);
                setPage(1);
              }}
            >
              <TabsList className="flex h-auto flex-wrap justify-start gap-1 bg-slate-50">
                <TabsTrigger value="all" className="text-xs h-7">
                  All{" "}
                  {counts.all > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1 h-4 min-w-[16px] text-[10px] px-1"
                    >
                      {counts.all}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="approved" className="text-xs h-7">
                  Published{" "}
                  {counts.approved > 0 && (
                    <Badge className="ml-1 h-4 min-w-[16px] text-[10px] px-1">
                      {counts.approved}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="pending" className="text-xs h-7">
                  Pending{" "}
                  {counts.pending > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1 h-4 min-w-[16px] text-[10px] px-1"
                    >
                      {counts.pending}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="flagged" className="text-xs h-7">
                  Flagged{" "}
                  {counts.flagged > 0 && (
                    <Badge
                      variant="destructive"
                      className="ml-1 h-4 min-w-[16px] text-[10px] px-1"
                    >
                      {counts.flagged}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="rejected" className="text-xs h-7">
                  Rejected
                </TabsTrigger>
                <TabsTrigger value="auto_rejected" className="text-xs h-7">
                  Auto-rejected
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Total count */}
          <p className="text-xs text-slate-500 mb-2">{total} total</p>

          {/* Error state */}
          {manageQuery.isError ? (
            <div className="rounded border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
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
                className="mt-4"
                onClick={() => void manageQuery.refetch()}
              >
                <RefreshCcw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          ) : null}

          {/* Loading state */}
          {manageQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : null}

          {/* Table */}
          {!manageQuery.isLoading && !manageQuery.isError ? (
            <PostTable
              posts={filteredPosts}
              onApprove={(id) => approveMutation.mutate({ postId: id })}
              onDelete={(id, reason) => {
                deleteMutation.mutate(
                  { postId: id, reason },
                  {
                    onSuccess: () => toast({ title: "Post removed" }),
                    onError: (error) =>
                      toast({
                        title: "Delete failed",
                        description:
                          error instanceof Error
                            ? error.message
                            : "Unable to delete this post.",
                        variant: "destructive",
                      }),
                  },
                );
              }}
            />
          ) : null}

          {/* Pagination */}
          {totalPages > 1 && !manageQuery.isLoading && (
            <div className="flex items-center justify-center gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || manageQuery.isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-slate-600">
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages || manageQuery.isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
