# Feed Task 3 Report — NativeCompanyPostManage Table redesign

---

## Amendment — Fix 1 & Fix 2 (2026-07-20)

**Status:** DONE  
**Commit:** 2835c1e0  
**tsc:** 0 errors (grep returned empty)

### Fix 1: Stale deleteReason on dialog close (Critical)

- `onOpenChange` on the delete Dialog updated from `!open && setDeleteTarget(null)` to a block that also calls `setDeleteReason("")`.
- Cancel button `onClick` updated to call `setDeleteReason("")` alongside `setDeleteTarget(null)`.

### Fix 2: isPending guard on Approve button (Important)

- Added optional `approving?: boolean` prop to `PostTable` component props interface.
- Approve Button gains `disabled={approving}` attribute.
- Parent call site passes `approving={approveMutation.isPending}` to `<PostTable>`, preventing duplicate mutation fires on rapid clicks.

---


**Status:** DONE
**Commit:** 03af714
**tsc:** 0 errors (grep returned empty)

## What was done

1. Deleted hero section (~45 lines of gradient markup) and replaced with 48px slim header + search Input.
2. Added `counts` useMemo with real status strings: `approved` (not `published`), `pending_approval`, `borderline_flagged`, `rejected`, `auto_rejected`.
3. Added `PostTable` sub-component above the page component with 5-col table and inline Delete Dialog.
4. Replaced card-list with `<PostTable>` — single instance covering all tabs (filteredPosts already reflects active tab).
5. Approve mutation called as `approveMutation.mutate({ postId: id })` — matches `ModerateCompanyPostPayload`.
6. Delete mutation called as `deleteMutation.mutate({ postId: id, reason })` — matches `DeleteCompanyPostPayload`.
7. `author_name` used directly (no cast) — it is `string | null` on `CompanyPost` type.
8. `content_text` used (not `content`) — matches the actual field name.
9. Removed unused imports: `Card`, `CardContent`, `ArrowRight`, `CheckCircle2`, `ChevronLeft`, `ChevronRight`, `Clock3`, `ShieldCheck`, `Trash2`, `AlertDialog*`, `Link`, `apiUrl`, `getCompanyFeedImageUrl`, `formatDateTime`, `STATUS_BORDER_MAP`, `statusBadgeClass`.

## Key adaptations vs brief

- Tab value `"approved"` (not `"published"`) — brief used `"published"` but actual status string is `"approved"`.
- Brief showed `(post as any).author_name` — not needed, field exists on type.
- Single `PostTable` instance used for all tabs rather than per-tab instances — simpler since filteredPosts already handles tab filtering.
