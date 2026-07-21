# Company Feed — Compact UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove decorative hero banners from all 5 Company Feed pages, convert the post management card-list to a `<Table>`, trim sidebar cards, and add bulk grant to CreatorAccess.

**Architecture:** All pages share the same hero-removal + 48px header treatment. `NativeCompanyPostManage` gets the biggest change: card-list → proper `<Table>` with per-tab counts. `NativeCompanyPostApproval` removes the lightbox modal layer. `NativeCompanyFeedCreatorAccess` gains multi-select for bulk grant.

**Tech Stack:** React 18, TypeScript, shadcn/ui, existing `useCompanyFeed` / `useMyCompanyPosts` hooks (no API changes).

## Global Constraints

- Do not change any backend API routes or response shapes
- All mutations (create, approve, reject, revoke) stay unchanged — only wrapping JSX
- TypeScript strict — no `any`
- `MODERATOR_ROLES` set stays unchanged

---

## File Map

| Action | File |
|---|---|
| Rewrite JSX | `src/pages/NativeCompanyFeed.tsx` |
| Rewrite JSX | `src/pages/NativeCompanyPostCreate.tsx` |
| Rewrite JSX | `src/pages/NativeCompanyPostManage.tsx` |
| Rewrite JSX | `src/pages/NativeCompanyPostApproval.tsx` |
| Modify | `src/pages/NativeCompanyFeedCreatorAccess.tsx` |

---

### Task 1: NativeCompanyFeed — remove hero, compact sidebar

**Files:**
- Modify: `src/pages/NativeCompanyFeed.tsx`

- [ ] **Step 1: Delete the hero section and HERO_PANEL_COPY constant**

Find and delete:
- The `HERO_PANEL_COPY` constant (3 objects: Channel, Pace, Compliance)
- The hero `<div>` at top of return (contains gradient overlay, blur circles, grid-background pattern, MCN broadcast badge, and 3 HERO_PANEL_COPY cards)

This removes approximately 80–100 lines.

- [ ] **Step 2: Replace hero with 48px toolbar**

```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <div className="flex items-center gap-3">
    <h1 className="text-sm font-semibold">Company Feed</h1>
    {feedData && (
      <>
        <Badge variant="outline" className="text-xs">Live: {feedData.total ?? 0}</Badge>
        {myPosts && myPosts.filter(p => p.status === "pending").length > 0 && (
          <Badge variant="secondary" className="text-xs">
            Pending: {myPosts.filter(p => p.status === "pending").length}
          </Badge>
        )}
      </>
    )}
  </div>
  <Link to="/company-feed/create">
    <Button size="sm">+ New Post</Button>
  </Link>
</div>
```

- [ ] **Step 3: Trim right sidebar to My Submissions only**

Find the right sidebar `<div className="hidden xl:flex flex-col gap-4 ...">`. Remove:
- The "Workflow shortcuts" card (links to creator studio and approval queue — these are in the nav already)
- The "Publishing rules" informational card

Keep only the "My submissions" card. Simplify its header — remove the decorative gradient banner and the `-mt-12` floating icon:

```tsx
{/* Replace the my-submissions card header with: */}
<div className="border-b px-3 py-2">
  <span className="text-xs font-semibold">My submissions</span>
  <div className="flex gap-1.5 mt-1">
    <Badge variant="outline" className="text-xs">
      Awaiting: {myPosts?.filter(p => p.status === "pending").length ?? 0}
    </Badge>
    <Badge variant="outline" className="text-xs">
      Returned: {myPosts?.filter(p => p.status === "returned").length ?? 0}
    </Badge>
  </div>
</div>
```

- [ ] **Step 4: Compact FeedPostCard height**

Find the `FeedPostCard` component (inline function or separate file). Add `max-h-[160px] overflow-hidden` to the post content text div to prevent cards from growing unboundedly:

```tsx
<p className="text-sm text-slate-700 leading-relaxed max-h-[80px] overflow-hidden line-clamp-3">
  {post.content}
</p>
```

- [ ] **Step 5: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyFeed\b"
git add src/pages/NativeCompanyFeed.tsx
git commit -m "feat(feed): remove hero, compact toolbar, trim sidebar to My Submissions"
```

---

### Task 2: NativeCompanyPostCreate — remove hero, compact layout

**Files:**
- Modify: `src/pages/NativeCompanyPostCreate.tsx`

- [ ] **Step 1: Delete the hero section**

Find and delete the hero `<div>` (gradient background, floating brand elements, "Draft Studio" heading). Also delete any hero-related constants at the top of the file.

- [ ] **Step 2: Replace hero with 48px header**

```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <div className="flex items-center gap-2">
    <Link to="/company-feed">
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">← Feed</Button>
    </Link>
    <h1 className="text-sm font-semibold">New Post</h1>
  </div>
</div>
```

- [ ] **Step 3: Collapse right sidebar**

Find the right sidebar. Remove the "Policy brief" card's verbose paragraph text. Replace with a single compact info line:

```tsx
<div className="border rounded-lg p-3 text-xs text-slate-500">
  Posts are reviewed before publishing. Max 2000 chars. Images: JPG/PNG, max 4.
</div>
```

Keep the "My latest submissions" status rail but limit to 3 items (slice):
```tsx
{myRecentPosts?.slice(0, 3).map(post => (...))}
```

- [ ] **Step 4: Make image previews smaller**

Find image preview tiles with `aspect-[16/10]`. Change to `aspect-video max-h-24` to reduce vertical space per preview.

- [ ] **Step 5: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyPostCreate"
git add src/pages/NativeCompanyPostCreate.tsx
git commit -m "feat(feed): PostCreate compact layout, remove hero, slim sidebar"
```

---

### Task 3: NativeCompanyPostManage — convert card-list to Table with tab counts

**Files:**
- Modify: `src/pages/NativeCompanyPostManage.tsx`

- [ ] **Step 1: Delete hero + add slim header**

Same as other pages — delete dark hero, add:
```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <h1 className="text-sm font-semibold">Post Management</h1>
  <Input className="h-7 w-44 text-xs" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
</div>
```

- [ ] **Step 2: Add per-tab counts to tab labels**

Find the `Tabs` with 6 triggers (All, Published, Pending, Flagged, Rejected, Auto-rejected). Replace static tab labels with dynamic counts:

```tsx
{/* Compute counts from loaded posts data: */}
const counts = useMemo(() => ({
  all: posts?.length ?? 0,
  published: posts?.filter(p => p.status === "published").length ?? 0,
  pending: posts?.filter(p => p.status === "pending").length ?? 0,
  flagged: posts?.filter(p => p.status === "flagged").length ?? 0,
  rejected: posts?.filter(p => p.status === "rejected").length ?? 0,
  auto_rejected: posts?.filter(p => p.status === "auto_rejected").length ?? 0,
}), [posts]);

{/* In TabsList: */}
<TabsTrigger value="all" className="text-xs">All {counts.all > 0 && <Badge className="ml-1 h-4 min-w-[16px] text-[10px] px-1">{counts.all}</Badge>}</TabsTrigger>
<TabsTrigger value="published" className="text-xs">Published {counts.published > 0 && <Badge className="ml-1 h-4 min-w-[16px] text-[10px] px-1">{counts.published}</Badge>}</TabsTrigger>
<TabsTrigger value="pending" className="text-xs">Pending {counts.pending > 0 && <Badge variant="secondary" className="ml-1 h-4 min-w-[16px] text-[10px] px-1">{counts.pending}</Badge>}</TabsTrigger>
<TabsTrigger value="flagged" className="text-xs">Flagged {counts.flagged > 0 && <Badge variant="destructive" className="ml-1 h-4 min-w-[16px] text-[10px] px-1">{counts.flagged}</Badge>}</TabsTrigger>
<TabsTrigger value="rejected" className="text-xs">Rejected</TabsTrigger>
<TabsTrigger value="auto_rejected" className="text-xs">Auto-rejected</TabsTrigger>
```

- [ ] **Step 3: Replace card-list with Table inside each TabsContent**

Replace the existing post card-list with a proper `<table>` for ALL 6 tabs (use a shared `PostTable` sub-component):

```tsx
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

  return (
    <>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b">
            <th className="h-8 w-20 text-left font-medium text-slate-500">Status</th>
            <th className="h-8 min-w-[100px] text-left font-medium text-slate-500">Author</th>
            <th className="h-8 text-left font-medium text-slate-500">Content</th>
            <th className="h-8 w-24 text-left font-medium text-slate-500">Date</th>
            <th className="h-8 w-20 text-left font-medium text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          {posts.map(post => (
            <tr key={post.id} className="h-9 border-b hover:bg-slate-50">
              <td className="py-1">
                <Badge
                  variant={
                    post.status === "published" ? "default"
                    : post.status === "pending" ? "secondary"
                    : "destructive"
                  }
                  className="text-xs"
                >
                  {post.status}
                </Badge>
              </td>
              <td className="py-1 truncate max-w-[100px]">{post.author_name ?? "-"}</td>
              <td className="py-1 truncate max-w-[320px] text-slate-600">{post.content}</td>
              <td className="py-1 text-slate-500">{post.created_at ? formatPostTimestamp(post.created_at) : "-"}</td>
              <td className="py-1">
                <div className="flex gap-1">
                  {onApprove && post.status === "pending" && (
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

      {/* Delete confirmation dialog */}
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
              onClick={() => { onDelete(deleteTarget!, deleteReason); setDeleteTarget(null); setDeleteReason(""); }}
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

Use `<PostTable>` inside each `<TabsContent>`, passing filtered posts:
```tsx
<TabsContent value="pending" className="flex-1 overflow-auto px-4 py-2 m-0">
  <PostTable
    posts={filteredPosts.filter(p => p.status === "pending")}
    onApprove={id => approveMutation.mutate(id)}
    onDelete={(id, reason) => deleteMutation.mutate({ id, reason })}
  />
</TabsContent>
```

- [ ] **Step 4: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyPostManage"
git add src/pages/NativeCompanyPostManage.tsx
git commit -m "feat(feed): PostManage card-list → Table with per-tab counts, slim header"
```

---

### Task 4: NativeCompanyPostApproval — remove lightbox modal layer

**Files:**
- Modify: `src/pages/NativeCompanyPostApproval.tsx`

- [ ] **Step 1: Delete hero + add slim header**

```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <h1 className="text-sm font-semibold">Post Approval Queue</h1>
  <Badge variant="outline" className="text-xs">
    Pending: {pendingCount}
  </Badge>
</div>
```

- [ ] **Step 2: Fix list panel width**

Find the left queue list panel. Change any flexible width to fixed:
```tsx
<div className="w-72 shrink-0 border-r flex flex-col overflow-hidden">
```

- [ ] **Step 3: Remove lightbox Dialog, replace with inline image expand**

Find the image lightbox `<Dialog open={!!lightboxImage}...>`. Delete the entire Dialog block.

In the post image grid inside the detail panel, replace the `onClick` that opened the lightbox:
```tsx
{/* Before: */}
<img onClick={() => setLightboxImage(src)} ... />

{/* After: */}
<img
  onClick={() => setExpandedImage(expandedImage === src ? null : src)}
  className="cursor-zoom-in rounded object-cover w-full"
  src={src}
  alt=""
/>
{expandedImage === src && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    onClick={() => setExpandedImage(null)}
  >
    <img src={src} className="max-h-[90vh] max-w-[90vw] rounded" alt="" />
  </div>
)}
```

Add state: `const [expandedImage, setExpandedImage] = useState<string | null>(null);`

Remove `lightboxImage` state if it existed.

- [ ] **Step 4: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyPostApproval"
git add src/pages/NativeCompanyPostApproval.tsx
git commit -m "feat(feed): PostApproval fixed-width list panel, remove lightbox modal layer"
```

---

### Task 5: NativeCompanyFeedCreatorAccess — bulk grant + roster pagination

**Files:**
- Modify: `src/pages/NativeCompanyFeedCreatorAccess.tsx`

- [ ] **Step 1: Add multi-select to search results**

Find the employee search results list. Add a checkbox per result and a "Grant selected" button:

```tsx
{/* Replace the existing single-grant button pattern with: */}
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

const toggleSelect = (id: string) =>
  setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

{searchResults.map(emp => (
  <div key={emp.id} className="flex items-center gap-2 py-1.5 border-b last:border-0">
    <input
      type="checkbox"
      checked={selectedIds.has(emp.id)}
      onChange={() => toggleSelect(emp.id)}
      className="h-3.5 w-3.5"
    />
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium truncate">{emp.name}</div>
      <div className="text-xs text-slate-500">{emp.employee_code}</div>
    </div>
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-xs"
      disabled={grantedIds.has(emp.id)}
      onClick={() => grantMutation.mutate([emp.id])}
    >
      {grantedIds.has(emp.id) ? "Granted" : "Grant"}
    </Button>
  </div>
))}

{selectedIds.size > 0 && (
  <div className="mt-2 flex justify-end">
    <Button
      size="sm"
      onClick={() => { grantMutation.mutate(Array.from(selectedIds)); setSelectedIds(new Set()); }}
      disabled={grantMutation.isPending}
    >
      Grant {selectedIds.size} selected
    </Button>
  </div>
)}
```

Note: Update `grantMutation` to accept `string[]` (array of IDs). Check the existing mutation — if it only accepts one ID, update the `mutationFn` to loop or use a batch endpoint:
```tsx
mutationFn: async (ids: string[]) => {
  return Promise.all(ids.map(id => hrmsApi.post(`/api/company-feed/creator-access/${id}/grant`)));
},
```

- [ ] **Step 2: Add roster pagination**

Find the creator roster list. After the list, add simple pagination:

```tsx
const ROSTER_PAGE_SIZE = 20;
const [rosterPage, setRosterPage] = useState(1);
const paginatedRoster = roster?.slice(0, rosterPage * ROSTER_PAGE_SIZE) ?? [];
const hasMore = (roster?.length ?? 0) > rosterPage * ROSTER_PAGE_SIZE;

{/* After roster list: */}
{hasMore && (
  <Button
    variant="ghost"
    size="sm"
    className="w-full text-xs mt-2"
    onClick={() => setRosterPage(p => p + 1)}
  >
    Show more ({(roster?.length ?? 0) - paginatedRoster.length} remaining)
  </Button>
)}
```

- [ ] **Step 3: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyFeedCreatorAccess"
git add src/pages/NativeCompanyFeedCreatorAccess.tsx
git commit -m "feat(feed): CreatorAccess bulk grant multi-select + roster pagination"
```

---

### Task 6: Final build verification

- [ ] **Step 1: Full build**

```bash
cd C:\Users\ADMIN\Desktop\HRMS2-latest
npm run build 2>&1 | tail -10
```
Expected: `✓ built in ...s` 0 errors.

- [ ] **Step 2: Verify checklist**

- [ ] `NativeCompanyFeed`: Feed visible immediately below 48px toolbar
- [ ] `NativeCompanyPostManage`: Posts in table rows (not stacked cards), tab counts show
- [ ] `NativeCompanyPostApproval`: No modal layer when clicking images — inline expand only
- [ ] `NativeCompanyFeedCreatorAccess`: Checkbox multi-select + "Grant X selected" button works
- [ ] No decorative hero on any of the 5 feed pages
