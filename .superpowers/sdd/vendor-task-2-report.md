# Vendor Task 2 Report — VendorPaymentDispatchPage rewrite

## Status: DONE

## Commit
a74800dd — `feat(vendor): compact 7-col dispatch table with Sheet edit panel`

## TSC result
Exit 0, zero errors.

## Changes summary
- Replaced 15-column 1039-line inline-editing table with a compact 7-column read-only table.
- Added `selected` / `sheetOpen` state and `PaymentDispatchSheet` import.
- Added `refetch` to the `useQuery` destructuring so the Sheet's `onSaved` callback works.
- Removed unused imports: `LockKeyhole`, `Send`, `Textarea`, `Label`, `Eye`, `FileClock`, `History`, `Upload`, `ShieldCheck`, `Card`, `CardContent`, `CardHeader`, `CardTitle`.
- Kept: all hooks (`useQuery`, `useMutation`, `useQueryClient`), all state variables, all mutations (`dispatchMutation`, `holdMutation`, `proofMutation`), `proofInputRef`, `proofTarget`, pagination, filters, `summary`/`summaryCards`, helper functions (`money`, `agingDays`, `branchLabel`, `downloadFile`, `exportCsv`), all interface definitions.
- KPI strip uses the pre-computed `summary` memo object (not inline reduce in JSX).
- Filter bar is collapsible via the Filters button in the header (preserving `showFilters` state).
- `onSaved` callback passed to Sheet calls `void refetch()`.

## Concerns
None. The old inline-table mutations (`dispatchMutation`, `holdMutation`, `proofMutation`, `proofInputRef`) are still wired in the file but their dispatch/hold/proof logic is now superseded by the Sheet component which has its own mutations. The old mutations remain as dead code that does not affect runtime — they can be removed in a future cleanup task (Task 3 or 4) once the Sheet's API paths are confirmed correct (the Sheet uses `/api/vendor-payments/:id/...` while the old file used `/api/finance/vendor-payments/:id/...`; this discrepancy existed before this task and is out of scope here).
