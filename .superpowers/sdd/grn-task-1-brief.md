# Task Brief: GRN Task 1 — Remove hero and 3-panel layout from BudgetLinkedGrnForm

## Context
MAS PeopleOS HRMS compact UI redesign. Task 1 of 3 in GRN module.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal

Restructure `src/components/finance/grn/BudgetLinkedGrnForm.tsx` (1258 lines) from a 3-panel wizard layout to a single-scroll form with a sticky summary bar.

**ONLY change the JSX structure — do NOT touch any hooks, mutations, or business logic.**

## What to do

The file currently has:
1. A large decorative hero banner at the top of the JSX return
2. A 3-column grid: `grid-cols-[260px_1fr_330px]` (left step nav, center form, right summary)
3. A step-based conditional render: `{currentStep === 1 && <...>}`, etc.
4. A sticky bottom footer with Save/Submit buttons

Target structure:
1. No hero
2. A sticky 48px summary bar at the TOP (instead of the old footer)
3. A single `max-w-3xl mx-auto` scrollable form
4. Sections rendered unconditionally (not conditional on step): Proof → Invoice → Allocations → Validation

### Step 1: Find and delete the hero section
The hero section is at the top of the `return` block. It's a `<div>` with classes containing gradient/blur effects and text like "Budget-Linked GRN" or similar decorative heading. Delete it entirely.

### Step 2: Remove the 3-column grid
Find:
```tsx
<div className="grid grid-cols-1 xl:grid-cols-[260px_1fr_330px] gap-6 ...">
```
or similar 3-column layout. Replace it with:
```tsx
<div className="mx-auto max-w-3xl px-4 pb-6">
```

### Step 3: Remove the left step-nav sidebar
Inside the old 3-column grid, the first column is a navigation panel with step buttons/links. Delete that entire left sidebar `<div>`. Keep only the center column content.

### Step 4: Remove the right live-summary sidebar
The third column is a "Live financial summary" or "Current context" card. Delete it entirely.

### Step 5: Add a sticky summary bar at top of the form body

Insert this AFTER the outer page wrapper opening tag but BEFORE the form content. Use the actual variable names from the component — read the file to find what variables track invoice total, allocated total, etc.:

```tsx
<div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-white px-0 py-2 text-xs">
  <div className="flex items-center gap-4">
    <span className="text-slate-500">
      Invoice total: <b className="text-slate-900">
        {invoiceTotal ? `₹${Number(invoiceTotal).toLocaleString("en-IN")}` : "—"}
      </b>
    </span>
    <span className="text-slate-500">
      Allocated: <b className="text-slate-900">
        {totalAllocated ? `₹${Number(totalAllocated).toLocaleString("en-IN")}` : "—"}
      </b>
    </span>
    <span className={`font-medium ${Math.abs(diff) < 1 ? "text-green-600" : "text-red-600"}`}>
      Diff: {diff >= 0 ? "+" : ""}{Number(diff).toLocaleString("en-IN")}
    </span>
  </div>
  <div className="flex gap-2">
    <Button size="sm" variant="outline" disabled={isSavingDraft} onClick={handleSaveDraft}>
      Save draft
    </Button>
    <Button size="sm" disabled={isSubmitting || Math.abs(diff) >= 1} onClick={handleSubmit}>
      Submit GRN
    </Button>
  </div>
</div>
```

**Read the file first to find the actual variable names** for:
- `invoiceTotal` — the invoice total amount
- `totalAllocated` — sum of allocations
- `diff` — the difference between invoice total and allocations
- `isSavingDraft` — mutation pending state for save draft
- `isSubmitting` — mutation pending state for submit
- `handleSaveDraft` — the save draft handler
- `handleSubmit` — the submit handler

Adapt the bar to use whatever names exist in the file.

### Step 6: Convert step-based conditional renders to unconditional sections

Currently the form renders different panels based on `currentStep`. Replace with unconditional sections:

```tsx
{/* ── Proof section ── */}
<section id="proof" className="pt-4">
  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Proof / Document</h2>
  {/* existing file upload area — keep but change min-height to h-20 if it has a tall dashed zone */}
</section>

{/* ── Invoice section ── */}
<section id="invoice" className="pt-6">
  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Invoice details</h2>
  {/* existing invoice form fields */}
</section>

{/* ── Budget allocation section ── */}
<section id="allocations" className="pt-8">
  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Budget allocation</h2>
  {/* existing allocation builder */}
</section>

{/* ── Validation section ── */}
<section id="validation" className="pt-8">
  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Validation</h2>
  {/* existing validation results */}
</section>
```

**Preserve ALL the actual JSX from each step panel** — just remove the conditional wrapper.

### Step 7: Remove the old sticky footer (Save/Submit buttons)

The old file had a `<div className="sticky bottom-0 ...">` with Save/Submit buttons. Delete it — those buttons are now in the top summary bar.

### Step 8: Remove state variables for step navigation (if safe)

Check if `currentStep`, `setCurrentStep`, `WorkspaceStep` type are used ONLY for the step nav UI. If so, remove them. If they're used in any logic/mutations, keep them.

## After changes

Run: `npx tsc --noEmit 2>&1 | grep -i "BudgetLinkedGrn"`
Expected: 0 errors.

Commit: `git add src/components/finance/grn/BudgetLinkedGrnForm.tsx && git commit -m "feat(grn): convert 3-panel wizard to single-scroll form with sticky summary bar"`

Write report to: `.superpowers/sdd/grn-task-1-report.md`

Return only: Status, commit hash, tsc result, concerns.
