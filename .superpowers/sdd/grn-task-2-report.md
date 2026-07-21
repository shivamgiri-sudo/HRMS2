# GRN Task 2 Report — SmartGrnApprovalQueue Sheet rewrite

## Status: COMPLETE

## Commit hash
4db2f3a1

## tsc result
`npx tsc --noEmit` — no output, zero errors.

## What changed
- Removed: `Dialog`, `DialogContent`, `DialogFooter`, `DialogHeader`, `DialogTitle` imports and usage.
- Added: `Sheet`, `SheetContent`, `SheetFooter`, `SheetHeader`, `SheetTitle` from `@/components/ui/sheet`.
- Added: `Tabs`, `TabsContent`, `TabsList`, `TabsTrigger` from `@/components/ui/tabs`.
- Added: `Fragment` from `react`.
- Removed unused Lucide icons: `ClipboardList`, `Eye`, `FileCheck2` (replaced inline).
- Table: removed `min-w-[1160px]` fixed width; replaced 10-column full-width table with compact 8-column `w-full text-xs` table using `h-9` rows and responsive `hidden sm:` / `hidden md:` / `hidden lg:` columns.
- Sheet: `side="right"` `w-[560px]` with 4 tabs — Details, Allocations, Validation, Decision.
- Details tab: metric row (3 metrics), GRN facts dl grid, documents card.
- Allocations tab: compact table of cost-centre splits; legacy fallback message.
- Validation tab: validation controls with Finance override flow; duplicates card.
- Decision tab: approve/reject select + review note; blocker warning; read-only notice when canReview is false.
- Footer: Close + conditional Submit button (colour-coded approve/reject), delegates to existing `submitDecision()` → `reviewMutation`.

## Mutations — all unchanged
- `submitMutation` — draft → submit
- `reviewMutation` — approved | rejected (decision type preserved as `"approved" | "rejected"`)
- `cancelMutation` — cancel draft/submitted
- `overrideMutation` — Finance validation override

## Concerns
- `decision` type kept as `"approved" | "rejected"` (not extended to `request_info`) because the backend `reviewMutation` only accepts those two values — adding `request_info` without a matching API endpoint would be a breaking/dead code change.
- Sheet width 560px is hardcoded via className; shadcn Sheet default max-width may need a `max-w-none` override if the design system applies one globally.
- Allocation sub-table still has a horizontal scroll wrapper; columns were reduced from 11 to 6 to stay readable at 560px.
