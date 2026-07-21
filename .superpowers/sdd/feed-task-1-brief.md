# Task Brief: Feed Task 1 — NativeCompanyFeed remove hero + compact sidebar

## Context
MAS PeopleOS HRMS compact UI redesign. Company Feed module, Task 1 of 5.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/pages/NativeCompanyFeed.tsx` (662 lines):
1. Delete `HERO_PANEL_COPY` constant and the hero `<div>` (gradient overlay, blur circles, MCN broadcast badge, hero panel cards)
2. Replace hero with a 48px toolbar
3. Trim the right sidebar to "My submissions" only (remove Workflow shortcuts card and Publishing rules card)
4. Add `line-clamp-3` to post content text

## What to keep
- ALL hooks: `useCompanyFeed`, `useMyCompanyPosts`, `getStatusMeta`
- `MODERATOR_ROLES` set
- `formatPostTimestamp` helper
- `FeedPostCard` inline component (just add `line-clamp-3` to content text)
- All feed list rendering and pagination logic
- The right sidebar — just trim it to My submissions card only

## What to change

### Step 1: Delete the hero section and HERO_PANEL_COPY constant
Find and delete:
- The `HERO_PANEL_COPY` constant (3 objects: Channel, Pace, Compliance) at the top of the file
- The hero `<div>` at top of return (contains gradient overlay, blur circles, grid-background pattern, MCN broadcast badge, and 3 HERO_PANEL_COPY cards)

This removes approximately 80–100 lines.

### Step 2: Replace hero with 48px toolbar
Add at the top of the page content:
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

Note: Read the file to find the exact variable names for `feedData` and `myPosts` — these are from `useCompanyFeed` and `useMyCompanyPosts`. `feedData.total` may need adjustment based on actual response shape.

### Step 3: Trim right sidebar to My Submissions only
Find the right sidebar `<div className="hidden xl:flex flex-col gap-4 ...">`.
Remove:
- The "Workflow shortcuts" card (links to creator studio and approval queue)
- The "Publishing rules" informational card

Keep only the "My submissions" card. Simplify its header — remove any decorative gradient banner and floating icon:
```tsx
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

### Step 4: Compact FeedPostCard content
Find the post content `<p>` tag inside `FeedPostCard` (inline function). Add `line-clamp-3` class:
```tsx
<p className="text-sm text-slate-700 leading-relaxed line-clamp-3">
  {post.content}
</p>
```

### Step 5: Add Badge import
```tsx
import { Badge } from "@/components/ui/badge";
```

Remove unused imports: `Sparkles`, `ShieldCheck`, `Megaphone` if they were only used in the hero. Check carefully — only remove if not used in the remaining JSX.

### Step 6: TypeScript + commit + build
```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyFeed"
git add src/pages/NativeCompanyFeed.tsx
git commit -m "feat(feed): remove hero, compact toolbar, trim sidebar to My Submissions"
```

Write report to `.superpowers/sdd/feed-task-1-report.md`

Return only: Status, commit hash, tsc result, build result, concerns.
