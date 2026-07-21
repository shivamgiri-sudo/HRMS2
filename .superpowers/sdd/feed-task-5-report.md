# Feed Task 5 Report — NativeCompanyFeedCreatorAccess bulk grant + roster pagination

## Status: DONE

## Commit: b8495c7d

## tsc result: 0 errors (no output for NativeCompanyFeedCreatorAccess)

## Changes made

### Multi-select state
- Added `selectedIds: Set<string>` and `toggleSelect(id)` using functional update pattern
- Added `useEffect` on `debouncedSearch` to clear `selectedIds` on new search

### Checkboxes in search results
- Employee field used: `employee.id` (confirmed from existing code at line 183/184)
- Checkbox added before each employee row; disabled when `isGranted`
- Layout changed from `rounded-[1.2rem] border... p-4` wrapper to `flex items-center gap-2` outer with inner flex for name+button

### Bulk grant button
- Appears below search results when `selectedIds.size > 0`
- Calls `grantMutation.mutate({ employeeId: id })` in a loop (grant mutation takes one ID at a time per `GrantCompanyPostCreatorPayload`)
- Clears selection after firing
- Disabled while `grantMutation.isPending`

### Roster pagination
- `ROSTER_PAGE_SIZE = 20` constant
- `rosterPage` state starting at 1
- `paginatedRoster` slices `creatorsQuery.data` up to `rosterPage * ROSTER_PAGE_SIZE`
- "Show more (N remaining)" ghost button appended after list when more records exist

## No concerns
All hooks, mutations, grant/revoke logic, and DashboardLayout wrapper preserved unchanged.

---

# Feed Task 5 Follow-up — Bulk grant race condition fixes

## Status: DONE

## Commit: 5f8b8aa9

## tsc result: 0 errors (no output for NativeCompanyFeedCreatorAccess)

## Fixes applied

### Fix 1 — Silent retry loss on bulk grant failure (Important)
- Replaced `grantMutation.mutate()` loop + immediate `setSelectedIds(new Set())` with a proper async handler `handleBulkGrant`
- Uses `mutateAsync` + `Promise.allSettled` so all mutations run concurrently and results are examined individually
- Only IDs whose mutation settled as `"fulfilled"` are removed from `selectedIds`; failed IDs remain in the set so the user can retry

### Fix 2 — Duplicate grant risk from isPending tracking only last mutation (Important)
- Added local `isBulkPending: boolean` state (starts `false`)
- `handleBulkGrant` sets it `true` at start, resets in `finally` block
- Bulk grant button now uses `disabled={isBulkPending}` and `onClick={() => void handleBulkGrant()}`
- Loading spinner in button now keyed off `isBulkPending` instead of `grantMutation.isPending`

### Fix M-1 — Conflicting padding (Minor)
- Changed `p-4 py-1.5` to `px-4 py-1.5` on the employee row container inside the search results list
- `p-4` set all four sides to 1rem; `py-1.5` overrode vertical but `p-4` still won on horizontal — now both axes are explicitly set
