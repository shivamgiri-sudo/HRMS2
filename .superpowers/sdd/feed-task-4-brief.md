# Task Brief: Feed Task 4 — NativeCompanyPostApproval remove lightbox modal layer

## Context
MAS PeopleOS HRMS compact UI redesign. Company Feed module, Task 4 of 5.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/pages/NativeCompanyPostApproval.tsx`:
1. Delete hero + add slim 48px header with pending count badge
2. Fix list panel to `w-72 shrink-0`
3. Remove lightbox Dialog, replace with `expandedImage` inline state + fixed overlay div

## What to keep
- ALL hooks and mutations: approve, reject, and any others — read the file
- The 2-panel split layout (list + detail)
- All post list rendering logic
- All moderation action logic (approve/reject buttons, reason inputs)
- `DashboardLayout` wrapper

## What to change

### Step 1: Delete hero + add slim header
Find and delete the dark hero `<div>` or `<section>` at the top of the return. Replace with:
```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <h1 className="text-sm font-semibold">Post Approval Queue</h1>
  {pendingCount > 0 && (
    <Badge variant="outline" className="text-xs">
      Pending: {pendingCount}
    </Badge>
  )}
</div>
```
Note: Find the actual variable for pending count — it may be `queue?.length`, `pendingPosts?.length`, or similar. Read the file.

### Step 2: Fix list panel width
Find the left queue list panel div. Change it to:
```tsx
<div className="w-72 shrink-0 border-r flex flex-col overflow-hidden">
```

### Step 3: Remove lightbox Dialog, replace with expandedImage state
Find the image lightbox Dialog (usually `open={!!lightboxImage}` or similar). Delete the entire Dialog block.

Add state near top of component:
```tsx
const [expandedImage, setExpandedImage] = useState<string | null>(null);
```
Remove the old `lightboxImage` state.

In the post image grid inside the detail panel, find where images are rendered. Replace the `onClick` that opened the lightbox:
```tsx
{/* Replace each image's onClick with: */}
<img
  src={imgUrl}
  alt=""
  onClick={() => setExpandedImage(expandedImage === imgUrl ? null : imgUrl)}
  className="cursor-zoom-in rounded object-cover w-full"
/>
{expandedImage === imgUrl && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    onClick={() => setExpandedImage(null)}
  >
    <img src={imgUrl} className="max-h-[90vh] max-w-[90vw] rounded" alt="" />
  </div>
)}
```

Note: The images may be in an array — find how the file iterates them and apply the pattern to each. The key point is: no Dialog, just a fixed overlay `<div>` that renders inline next to each image.

### Step 4: Add Badge import if missing
```tsx
import { Badge } from "@/components/ui/badge";
```
Remove lightbox-related Dialog import if Dialog is now fully unused.

### Step 5: TypeScript + commit
```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyPostApproval"
git add src/pages/NativeCompanyPostApproval.tsx
git commit -m "feat(feed): PostApproval fixed-width list panel, remove lightbox modal layer"
```

Write report to `.superpowers/sdd/feed-task-4-report.md`

Return only: Status, commit hash, tsc result, concerns.
