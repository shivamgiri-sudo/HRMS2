# GRN Task 1 Report

## Status
COMPLETE

## Changes made
- Deleted the decorative hero `<section>` (dark gradient banner with MetricCard grid and badges).
- Deleted the 3-column `grid xl:grid-cols-[260px_1fr_330px]` wrapper.
- Deleted the left step-nav `<aside>` (Five-step workflow card + productivity shortcuts card).
- Deleted the right live-summary `<aside>` (Live financial summary card + Current context card).
- Deleted the old sticky bottom footer (`sticky bottom-4`) with Save/Submit buttons.
- Added a sticky top summary bar (48px, `sticky top-0 z-10`) showing invoice total (`form.invoiceTotal`), allocated (`totals.gross`), diff (`allocationDifference`), Save draft button (`persistMutation.mutate(false)`), Submit GRN button (`persistMutation.mutate(true)`).
- Wrapped all content in `<div className="mx-auto max-w-3xl px-4 pb-6">`.
- Converted step-conditional renders (`activeStep === "proof"` etc.) to unconditional `<section>` blocks with label headings.
- All 5 original step panels (proof, invoice, budget/allocations, validation, review) are preserved and rendered unconditionally.
- All hooks, mutations, state, and business logic are untouched.

## Variable mapping used
| Brief name | Actual name |
|---|---|
| `invoiceTotal` | `form.invoiceTotal` |
| `totalAllocated` | `totals.gross` |
| `diff` | `allocationDifference` |
| `isSavingDraft` | `persistMutation.isPending` (same mutation) |
| `isSubmitting` | `persistMutation.isPending` (same mutation) |
| `handleSaveDraft` | `() => persistMutation.mutate(false)` |
| `handleSubmit` | `() => { setActiveStep("review"); persistMutation.mutate(true); }` |

## Step nav state
`activeStep`, `setActiveStep`, `WorkspaceStep`, `stepCompleted` were kept — they are still referenced in mutation `onSuccess` callbacks, `applyExtractedFields`, and `resetForm`. Removing them would require touching business logic.

## tsc result
0 errors (`npx tsc --noEmit` — no output, clean).

## Concerns
- `stepCompleted` is computed but no longer rendered. It is harmless (noUnusedLocals: false) and kept because removing it would touch non-JSX logic scope.
- The `STEPS` array and `StepPill` sub-component are now dead code but cause no errors. They can be removed in a cleanup pass.
- `activeStep` is still mutated by mutations and helpers; the value is never consumed in JSX now but kept to avoid touching logic.
