# Task Brief: Feed Task 2 — NativeCompanyPostCreate remove hero, compact layout

## Context
MAS PeopleOS HRMS compact UI redesign. Company Feed module, Task 2 of 5.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/pages/NativeCompanyPostCreate.tsx` JSX:
1. Delete the hero section and any hero-related constants
2. Replace hero with a 48px header
3. Collapse the right sidebar to a single compact info line + 3 recent posts max
4. Make image previews smaller (`aspect-video max-h-24`)

## What to keep
- ALL hooks and mutations (create post, file upload, etc.)
- All form state (content, images, etc.)
- All submission logic and error handling
- `useMyCompanyPosts` data if used
- `DashboardLayout` wrapper

## What to change

### Step 1: Delete the hero section
Find and delete the hero `<div>` at the top of the return (gradient background, floating brand elements, "Draft Studio" heading, or similar decorative intro). Also delete any hero-related constants at the top of the file (e.g. copy arrays, decorative text arrays).

### Step 2: Replace hero with 48px header
```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <div className="flex items-center gap-2">
    <Link to="/engagement/company-feed">
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">← Feed</Button>
    </Link>
    <h1 className="text-sm font-semibold">New Post</h1>
  </div>
</div>
```

Note: Read the file first to find the actual route path for the back link — check what route the feed uses in the app.

### Step 3: Collapse right sidebar
Find the right sidebar. Remove the "Policy brief" card's verbose paragraph text. Replace with a single compact info line:
```tsx
<div className="border rounded-lg p-3 text-xs text-slate-500">
  Posts are reviewed before publishing. Max 2000 chars. Images: JPG/PNG, max 4.
</div>
```

Keep the "My latest submissions" / recent posts status rail but limit to 3 items:
```tsx
{myRecentPosts?.slice(0, 3).map(post => (...))}
```
Find the actual variable name for recent posts in the file.

### Step 4: Make image previews smaller
Find image preview tiles with `aspect-[16/10]` or similar. Change to:
```tsx
className="... aspect-video max-h-24 ..."
```

### Step 5: Add/fix imports
- Ensure `Badge` is imported if used: `import { Badge } from "@/components/ui/badge"`
- Remove any imports that become unused after deleting the hero

### Step 6: TypeScript + commit
```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyPostCreate"
git add src/pages/NativeCompanyPostCreate.tsx
git commit -m "feat(feed): PostCreate compact layout, remove hero, slim sidebar"
```

Write report to `.superpowers/sdd/feed-task-2-report.md`

Return only: Status, commit hash, tsc result, concerns.
