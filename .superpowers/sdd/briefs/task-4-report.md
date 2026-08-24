# Task 4 Report — Frontend: Wire bulk groups into the main component

## Status: DONE

## Commit SHA
`5460989cae2f938be7f801b2e972fcc7148dc634`

## TypeScript Summary
`npx tsc --noEmit` — zero errors, zero warnings.

## Changes Made

### Change 1 — New state variables (line 893+)
Added `expandedGroups` (Set<string>) and `bulkActingKeys` (Set<string>) immediately after the existing `actingIds` state.

### Change 2 — `bulkActGroup` handler
Added full async handler between the `completeTask` closing brace and `return (`. Uses `hrmsApi.post` (same client confirmed in the existing file at line 9), calls `/api/inbox/bulk-actioned`, optimistically removes succeeded IDs from `items`, appends a batch entry to `actedItems`, decrements `summary` counts, and invalidates notification query keys. Shows sonner toasts for partial failures and errors.

### Change 3 — Table body rendering
Replaced `filtered.map(task => <TaskRow .../>)` with `groupItems(filtered).map(row => ...)` which routes group rows to `<GroupRow>` (with `expandedGroups`, `bulkActingKeys`, `bulkActGroup` wired in) and individual rows to `<TaskRow>` unchanged.

## Concerns
None. All three edits were targeted and non-breaking. The existing `GroupRow` and `TaskRow` components were already defined in the file; this task only connected them to live state and handlers in the main component body.
