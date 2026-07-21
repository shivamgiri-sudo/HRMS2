# Task Brief: Feed Task 3 — NativeCompanyPostManage card-list → Table with tab counts

## Context
MAS PeopleOS HRMS compact UI redesign. Company Feed module, Task 3 of 5.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/pages/NativeCompanyPostManage.tsx` (475 lines):
1. Delete hero + add slim 48px header with search input
2. Add `useMemo` tab counts to tab labels
3. Replace card-list with a compact `<PostTable>` sub-component (5-col table with inline delete Dialog)

## What to keep
- ALL hooks and mutations: keep `useMyCompanyPosts`, `useApprovalQueue`, `useDeleteCompanyPost`, `useApproveCompanyPost` and any others — read the file to find exact names
- All filter/tab state variables
- `formatPostTimestamp` helper if it exists, or import from hooks
- `MODERATOR_ROLES` check if present
- `DashboardLayout` wrapper
- The 6-tab structure (All, Published, Pending, Flagged, Rejected, Auto-rejected) — just add counts

## What to change

### Step 1: Delete hero + add slim header
Find and delete the dark hero `<div>` or `<section>` at top of return. Replace with:
```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <h1 className="text-sm font-semibold">Post Management</h1>
  <Input
    className="h-7 w-44 text-xs"
    placeholder="Search..."
    value={search}
    onChange={e => setSearch(e.target.value)}
  />
</div>
```
Note: Find the actual `search` state variable name in the file. If it doesn't exist, add `const [search, setSearch] = useState("")` and filter posts by it.

### Step 2: Add per-tab counts to tab labels
Add after existing state declarations:
```tsx
const counts = useMemo(() => ({
  all: posts?.length ?? 0,
  published: posts?.filter(p => p.status === "published").length ?? 0,
  pending: posts?.filter(p => p.status === "pending_approval" || p.status === "pending").length ?? 0,
  flagged: posts?.filter(p => p.status === "flagged" || p.status === "borderline_flagged").length ?? 0,
  rejected: posts?.filter(p => p.status === "rejected").length ?? 0,
  auto_rejected: posts?.filter(p => p.status === "auto_rejected").length ?? 0,
}), [posts]);
```
Note: Read the file to find the actual variable for the posts array and the actual status strings used. Adapt the filter predicates to match real status values.

Update TabsTriggers to show counts:
```tsx
<TabsTrigger value="all" className="text-xs h-7">All {counts.all > 0 && <Badge variant="secondary" className="ml-1 h-4 min-w-[16px] text-[10px] px-1">{counts.all}</Badge>}</TabsTrigger>
<TabsTrigger value="published" className="text-xs h-7">Published {counts.published > 0 && <Badge className="ml-1 h-4 min-w-[16px] text-[10px] px-1">{counts.published}</Badge>}</TabsTrigger>
<TabsTrigger value="pending" className="text-xs h-7">Pending {counts.pending > 0 && <Badge variant="secondary" className="ml-1 h-4 min-w-[16px] text-[10px] px-1">{counts.pending}</Badge>}</TabsTrigger>
<TabsTrigger value="flagged" className="text-xs h-7">Flagged {counts.flagged > 0 && <Badge variant="destructive" className="ml-1 h-4 min-w-[16px] text-[10px] px-1">{counts.flagged}</Badge>}</TabsTrigger>
<TabsTrigger value="rejected" className="text-xs h-7">Rejected</TabsTrigger>
<TabsTrigger value="auto_rejected" className="text-xs h-7">Auto-rejected</TabsTrigger>
```
Note: Match actual tab values from the file. Add `import { Badge } from "@/components/ui/badge"` if not present.

### Step 3: Add PostTable sub-component + replace card-lists
Add this sub-component ABOVE the main page component (not inside it):

```tsx
import { type CompanyPost } from "@/hooks/useCompanyFeed";

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
          {posts.map(post => (
            <tr key={post.id} className="h-9 border-b hover:bg-slate-50">
              <td className="px-3 py-1">
                <Badge
                  variant={
                    post.status === "published" ? "default"
                    : post.status === "pending_approval" ? "secondary"
                    : "destructive"
                  }
                  className="text-[10px]"
                >
                  {post.status}
                </Badge>
              </td>
              <td className="px-3 py-1 truncate max-w-[120px]">{(post as any).author_name ?? "-"}</td>
              <td className="px-3 py-1 truncate max-w-[320px] text-slate-600">{post.content}</td>
              <td className="px-3 py-1 text-slate-500 whitespace-nowrap">
                {post.created_at ? new Date(post.created_at).toLocaleDateString("en-IN") : "-"}
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

      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Delete post</DialogTitle></DialogHeader>
          <Textarea
            placeholder="Reason for deletion"
            value={deleteReason}
            onChange={e => setDeleteReason(e.target.value)}
            className="min-h-[60px] text-sm"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
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
```

IMPORTANT: The `author_name` cast `(post as any).author_name` is a workaround — first check if `CompanyPost` actually has `author_name` on the type. If it does, use it directly without the cast. If it doesn't, just show `"-"` without a cast.

Replace the existing card-list in EACH TabsContent with `<PostTable>`, passing filtered posts:
```tsx
<TabsContent value="pending" className="flex-1 overflow-auto m-0">
  <PostTable
    posts={filteredByTab.filter(p => p.status === "pending_approval")}
    onApprove={id => approveMutation?.mutate(id)}
    onDelete={(id, reason) => deleteMutation.mutate({ id, reason })}
  />
</TabsContent>
```
Adapt mutation call signatures to match the actual mutation shapes in the file. Read the file carefully for `deleteMutation.mutate(...)` call pattern.

### Step 4: Remove now-unused imports
After replacing card-lists, remove unused imports. Likely no longer needed: `Card`, `CardContent`, most Lucide icons that were only in hero/cards. Keep `Dialog`, `DialogContent`, `DialogFooter`, `DialogHeader`, `DialogTitle`, `Textarea` (used in PostTable), and `Badge`.

### Step 5: TypeScript + commit
```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyPostManage"
git add src/pages/NativeCompanyPostManage.tsx
git commit -m "feat(feed): PostManage card-list → Table with per-tab counts, slim header"
```

Write report to `.superpowers/sdd/feed-task-3-report.md`

Return only: Status, commit hash, tsc result, concerns.
