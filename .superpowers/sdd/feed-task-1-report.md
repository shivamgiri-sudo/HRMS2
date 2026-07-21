# Feed Task 1 Report — NativeCompanyFeed remove hero + compact sidebar

## Status: DONE

## Commit
`aa311ff` — feat(feed): remove hero, compact toolbar, trim sidebar to My Submissions

## Changes Applied
1. Deleted `HERO_PANEL_COPY` constant and the entire hero `<section>` (~100 lines removed).
2. Added 48px compact toolbar with `h1`, live count Badge, pending Badge, and `+ New Post` button linking to `/company-feed/create`.
3. Trimmed right sidebar to My Submissions card only — removed Workflow shortcuts card and Publishing rules card.
4. Slimmed My Submissions card header: removed gradient banner and floating icon; replaced with compact `border-b` header with Awaiting/Returned badges.
5. Added `line-clamp-3` to `FeedPostCard` content `<p>`.
6. Added `Badge` import; removed unused imports: `ArrowRight`, `Sparkles`, `ShieldCheck`, `FileText`, `useUserRole`.
7. Removed unused variables: `roleQuery`, `roleKeys`, `isLikelyModerator`, `returnedPosts`.
8. `MODERATOR_ROLES` set retained unchanged.

## TypeScript
0 errors in NativeCompanyFeed.tsx

## Build
✓ built in 16.06s

## Notes
- `feedData.total` exists on `CompanyFeedPageResult` type — used `feedQuery.data.total` directly.
- `myPosts` statuses use `pending_approval` (not `pending`) — toolbar and sidebar badges correctly filter on `pending_approval`.
- Net change: 31 insertions, 234 deletions.

---

## Feed Task 1 — Fix 2: Count consistency + double-filter cleanup

### Status: DONE

### Commit
`f9a11691` — fix(feed): align sidebar awaiting count with waitingForReview predicate

### Problem 1 (Important): Awaiting count mismatch
The `waitingForReview` variable (line 254) counted `pending_approval OR borderline_flagged`.
The sidebar Awaiting badge (line 383) only counted `pending_approval`.
Both numbers appeared on the same page and could confuse users.

### Problem 2 (Minor): Double-filter in toolbar
`myPosts.filter(p => p.status === "pending_approval")` was called twice per render in the toolbar guard and label.

### Fix Applied
1. Sidebar Awaiting badge updated to use `waitingForReview` directly — now both the stat tile ("My queue") and the sidebar badge agree: they include `pending_approval` and `borderline_flagged`.
2. Extracted `const pendingApprovalPosts = myPosts.filter(p => p.status === "pending_approval")` before the return; toolbar guard and label both reference the single const.

### TypeScript
0 errors in NativeCompanyFeed.tsx

### Net change
5 insertions, 3 deletions
