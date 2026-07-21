# GRN Management — Compact UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-panel step-wizard GRN form and the 1180px approval modal with a single-scroll form and a compact table + tabbed right-side Sheet.

**Architecture:** `BudgetLinkedGrnForm` becomes a single scrollable page with three anchor-linked sections (Invoice → Allocations → Validation). The 3-panel layout (left step nav, center form, right summary) is removed; a sticky 48px header bar shows the 3 key totals. `SmartGrnApprovalQueue` replaces its full-screen Dialog with a `<Sheet side="right" className="w-[560px]">` containing 4 tabs (Details / Allocations / Validation / Decision). `NativeGRNManagement` removes its 400-line inline queue duplication by delegating entirely to `SmartGrnApprovalQueue`.

**Tech Stack:** React 18, TypeScript, shadcn/ui (`Sheet`, `Tabs`, `Table`), React Query (existing hooks), Lucide icons.

## Global Constraints

- Do not change any backend API routes or response shapes
- Do not remove existing mutations in `BudgetLinkedGrnForm` (draft save, submit, validate)
- `SmartGrnApprovalQueue` review/approve/reject mutations stay unchanged — only JSX changes
- TypeScript strict — no `any`

---

## File Map

| Action | File |
|---|---|
| Rewrite JSX | `src/components/finance/grn/BudgetLinkedGrnForm.tsx` |
| Rewrite JSX | `src/components/finance/grn/SmartGrnApprovalQueue.tsx` |
| Simplify | `src/pages/NativeGRNManagement.tsx` |

---

### Task 1: Remove hero and 3-panel layout from BudgetLinkedGrnForm

The form logic (state, hooks, mutations) is untouched. Only the structural JSX wrapper changes.

**Files:**
- Modify: `src/components/finance/grn/BudgetLinkedGrnForm.tsx`

- [ ] **Step 1: Remove the hero section**

Find the hero div (contains "Intelligent GRN Control Room", radial gradient, blur circles). Delete from opening `<div className="relative overflow-hidden ...">` through its closing `</div>`. This is approximately lines 1–80 of the JSX return.

- [ ] **Step 2: Remove the 3-column grid wrapper**

Find:
```tsx
<div className="grid grid-cols-1 xl:grid-cols-[260px_1fr_330px] gap-6 ...">
```
Replace with a simple single-column container:
```tsx
<div className="mx-auto max-w-3xl px-4 pb-24">
```
The `pb-24` creates space for the sticky footer.

- [ ] **Step 3: Remove the left step-nav sidebar**

Delete the entire left sidebar `<div>` that contains the step navigator card and the productivity shortcuts panel (approximately 60–80 lines).

- [ ] **Step 4: Remove the right live-summary sidebar**

Delete the entire right sidebar `<div>` that contains "Live financial summary" and "Current context" cards (approximately 60 lines).

- [ ] **Step 5: Add sticky slim summary bar at top of form**

Replace the removed hero with a sticky summary bar. Insert this as the first child inside the `max-w-3xl` container:

```tsx
<div className="sticky top-0 z-10 flex items-center gap-4 border-b bg-white px-0 py-2 text-xs">
  <span className="text-slate-500">
    Invoice total: <b className="text-slate-900">
      {invoiceTotal ? `₹${invoiceTotal.toLocaleString("en-IN")}` : "—"}
    </b>
  </span>
  <span className="text-slate-500">
    Allocated: <b className="text-slate-900">
      {allocatedTotal ? `₹${allocatedTotal.toLocaleString("en-IN")}` : "—"}
    </b>
  </span>
  <span className={`font-medium ${Math.abs(diff) < 1 ? "text-green-600" : "text-red-600"}`}>
    Diff: {diff >= 0 ? "+" : ""}{diff.toLocaleString("en-IN")}
  </span>
  <div className="ml-auto flex gap-2">
    <Button size="sm" variant="outline" disabled={saveDraftPending} onClick={handleSaveDraft}>
      Save draft
    </Button>
    <Button size="sm" disabled={submitPending || Math.abs(diff) >= 1} onClick={handleSubmit}>
      Submit GRN
    </Button>
  </div>
</div>
```

Note: `invoiceTotal`, `allocatedTotal`, `diff`, `saveDraftPending`, `submitPending`, `handleSaveDraft`, `handleSubmit` — use the existing variable names from the component's state/mutation section. Adjust names to match whatever they are in the file.

- [ ] **Step 6: Convert steps to anchor-linked sections**

Replace the step-panel conditional render (`{currentStep === 1 && <StepPanel>...`) with unconditionally rendered sections one after another:

```tsx
{/* ── Section 1: Invoice details ── */}
<section id="invoice" className="pt-6">
  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
    Invoice details
  </h2>
  {/* existing Step 2 invoice form fields — paste as-is */}
</section>

{/* ── Section 2: Budget allocation ── */}
<section id="allocations" className="pt-8">
  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
    Budget allocation
  </h2>
  {/* existing Step 3 allocation builder — paste as-is */}
</section>

{/* ── Section 3: Validation & review ── */}
<section id="validation" className="pt-8">
  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
    Validation
  </h2>
  {/* existing Step 4 validation results + Step 5 review summary — paste as-is */}
</section>
```

The file upload (old Step 1) can be added as a compact row above the Invoice section:
```tsx
<section id="proof" className="pt-4">
  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Proof</h2>
  {/* existing file upload area — keep but remove the large dashed drop-zone min-height, replace with h-20 */}
</section>
```

- [ ] **Step 7: Remove old sticky footer (replaced by top bar)**

Find and delete the old `<div className="sticky bottom-0 ...">` that contained Save draft + Submit buttons.

- [ ] **Step 8: Build check**

```bash
npx tsc --noEmit 2>&1 | grep -i "BudgetLinkedGrn"
```
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/finance/grn/BudgetLinkedGrnForm.tsx
git commit -m "feat(grn): convert 3-panel wizard to single-scroll form with sticky summary bar"
```

---

### Task 2: Replace SmartGrnApprovalQueue 1180px modal with tabbed Sheet

**Files:**
- Modify: `src/components/finance/grn/SmartGrnApprovalQueue.tsx`

- [ ] **Step 1: Replace Dialog with Sheet import**

In the imports, remove `Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle` and add:

```tsx
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
```

- [ ] **Step 2: Compact the queue table**

Find the `<table>` or `<Table>` in the queue list. Change the wrapper from `min-w-[1180px]` to `w-full`. Reduce columns to 8 by hiding low-priority columns with responsive classes:

```tsx
<table className="w-full text-xs">
  <thead className="sticky top-0 bg-white">
    <tr className="border-b">
      <th className="h-8 text-left font-medium text-slate-500 w-[110px]">GRN</th>
      <th className="h-8 text-left font-medium text-slate-500 hidden sm:table-cell">Type</th>
      <th className="h-8 text-left font-medium text-slate-500">Branch</th>
      <th className="h-8 text-left font-medium text-slate-500 hidden md:table-cell">Vendor</th>
      <th className="h-8 text-right font-medium text-slate-500">Amount</th>
      <th className="h-8 text-left font-medium text-slate-500 hidden lg:table-cell">Due</th>
      <th className="h-8 text-left font-medium text-slate-500">Status</th>
      <th className="h-8 text-left font-medium text-slate-500">Review</th>
    </tr>
  </thead>
  <tbody>
    {filteredGrns.map(grn => (
      <tr
        key={grn.id}
        className="h-9 border-b hover:bg-slate-50 cursor-pointer"
        onClick={() => setReviewGrn(grn)}
      >
        <td className="py-1 font-mono text-xs">{grn.grn_number}</td>
        <td className="py-1 hidden sm:table-cell">
          <Badge variant="outline" className="text-xs">{grn.grn_type}</Badge>
        </td>
        <td className="py-1 truncate max-w-[100px]">{grn.branch_name ?? "-"}</td>
        <td className="py-1 hidden md:table-cell truncate max-w-[100px]">{grn.vendor_name ?? "-"}</td>
        <td className="py-1 text-right font-medium">
          ₹{((grn.amount_with_tax ?? grn.amount) ?? 0).toLocaleString("en-IN")}
        </td>
        <td className="py-1 hidden lg:table-cell">{grn.due_date ?? "-"}</td>
        <td className="py-1">
          <Badge variant="secondary" className="text-xs">{grn.status}</Badge>
        </td>
        <td className="py-1">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
            Review
          </Button>
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

- [ ] **Step 3: Replace the review Dialog with a tabbed Sheet**

Find the `<Dialog open={!!reviewGrn}...>` block and replace it entirely:

```tsx
<Sheet open={!!reviewGrn} onOpenChange={open => !open && setReviewGrn(null)}>
  <SheetContent side="right" className="flex w-[560px] flex-col gap-0 p-0">
    <SheetHeader className="border-b px-4 py-3">
      <SheetTitle className="text-sm font-semibold">
        {reviewGrn?.grn_number} — Review
      </SheetTitle>
      <div className="flex gap-1.5 pt-1">
        <Badge variant="outline" className="text-xs">{reviewGrn?.branch_name}</Badge>
        <Badge variant="outline" className="text-xs">{reviewGrn?.vendor_name}</Badge>
      </div>
    </SheetHeader>

    <Tabs defaultValue="details" className="flex flex-1 flex-col overflow-hidden">
      <TabsList className="mx-4 mt-3 w-fit">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="allocations">Allocations</TabsTrigger>
        <TabsTrigger value="validation">Validation</TabsTrigger>
        <TabsTrigger value="decision">Decision</TabsTrigger>
      </TabsList>

      <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3 m-0">
        {/* 
          Move the invoice details grid (12 read-only fields) here.
          Use a <dl> grid instead of the 3-col grid cards:
        */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {reviewGrn && [
            ["GRN Number", reviewGrn.grn_number],
            ["Type", reviewGrn.grn_type],
            ["Branch", reviewGrn.branch_name],
            ["Vendor", reviewGrn.vendor_name],
            ["Head", reviewGrn.head],
            ["Sub-head", reviewGrn.sub_head],
            ["Amount", `₹${(reviewGrn.amount ?? 0).toLocaleString("en-IN")}`],
            ["With tax", `₹${(reviewGrn.amount_with_tax ?? 0).toLocaleString("en-IN")}`],
            ["Bill date", reviewGrn.bill_date ?? "-"],
            ["Due date", reviewGrn.due_date ?? "-"],
            ["Allocation", reviewGrn.allocation_mode ?? "-"],
            ["Validation score", reviewGrn.validation_score != null ? `${reviewGrn.validation_score}%` : "-"],
          ].map(([label, val]) => (
            <>
              <dt key={`l-${label}`} className="text-slate-500">{label}</dt>
              <dd key={`v-${label}`} className="font-medium text-slate-900 truncate">{val}</dd>
            </>
          ))}
        </dl>
        {/* Keep document display section — remove the full document card, just show filename links */}
        {reviewGrn?.document_match_status && (
          <div className="mt-3 text-xs text-slate-500">
            Doc match: <Badge variant="outline" className="text-xs">{reviewGrn.document_match_status}</Badge>
          </div>
        )}
      </TabsContent>

      <TabsContent value="allocations" className="flex-1 overflow-y-auto px-4 py-3 m-0">
        {/* Move the allocation sub-table here. Keep existing table columns but remove min-w-[1050px] */}
        {/* The existing AllocationTable or allocation rows render here unchanged */}
      </TabsContent>

      <TabsContent value="validation" className="flex-1 overflow-y-auto px-4 py-3 m-0">
        {/* Move the validation result grid + duplicate review card here */}
        {/* Keep the Finance Override inline expand pattern here */}
      </TabsContent>

      <TabsContent value="decision" className="flex-1 overflow-y-auto px-4 py-3 m-0">
        {/* 
          The decision form: Decision select + review note textarea.
          Keep existing mutation (approve/reject/request_info calls).
        */}
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Decision *</Label>
            <Select value={decision} onValueChange={setDecision}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue placeholder="Select decision" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approve">Approve</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
                <SelectItem value="request_info">Request info</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Review note</Label>
            <Textarea
              value={reviewNote}
              onChange={e => setReviewNote(e.target.value)}
              className="mt-1 min-h-[80px] text-sm"
              placeholder="Add review notes..."
            />
          </div>
        </div>
      </TabsContent>
    </Tabs>

    <SheetFooter className="border-t px-4 py-3">
      <Button variant="outline" size="sm" onClick={() => setReviewGrn(null)}>
        Close
      </Button>
      <Button
        size="sm"
        disabled={!decision || reviewMutation.isPending}
        onClick={() => handleReviewSubmit()}
      >
        {reviewMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Submit decision
      </Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

Note: `decision`, `reviewNote`, `setDecision`, `setReviewNote`, `reviewMutation`, `handleReviewSubmit` — use the existing variable/function names from the component. Add state vars if they don't exist yet:
```tsx
const [decision, setDecision] = useState("");
const [reviewNote, setReviewNote] = useState("");
```

- [ ] **Step 4: Build check**

```bash
npx tsc --noEmit 2>&1 | grep -i "SmartGrn"
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/finance/grn/SmartGrnApprovalQueue.tsx
git commit -m "feat(grn): replace 1180px review dialog with compact tabbed Sheet"
```

---

### Task 3: Simplify NativeGRNManagement — remove 400-line inline duplicate

**Files:**
- Modify: `src/pages/NativeGRNManagement.tsx`

- [ ] **Step 1: Remove the inline ApprovalQueueTab component**

Find `function ApprovalQueueTab(` (approximately line 200+ in the file) and delete the entire inline component definition (≈400 lines ending at its closing `}`).

- [ ] **Step 2: Replace the tab body for queue tab**

In the `<TabsContent value="queue">` (or equivalent), replace whatever was rendering `<ApprovalQueueTab>` with:

```tsx
<TabsContent value="queue" className="flex-1 overflow-hidden m-0">
  <SmartGrnApprovalQueue />
</TabsContent>
```

- [ ] **Step 3: Remove the hero section**

Find the dark hero banner at the top of the return (contains gradient background + "GRN Control Room" heading). Delete it. Replace with the 48px header pattern:

```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <h1 className="text-sm font-semibold">GRN Management</h1>
</div>
```

- [ ] **Step 4: Slim the tab bar**

Reduce the tab trigger size to match the standard:
```tsx
<TabsList className="h-7 mx-4">
  <TabsTrigger value="create" className="text-xs h-6">Create GRN</TabsTrigger>
  <TabsTrigger value="queue" className="text-xs h-6">Approval Queue</TabsTrigger>
</TabsList>
```

- [ ] **Step 5: Build check**

```bash
npx tsc --noEmit 2>&1 | grep -i "NativeGRN"
```
Expected: 0 errors.

- [ ] **Step 6: Final build**

```bash
npm run build 2>&1 | tail -5
```
Expected: `✓ built in ...s`

- [ ] **Step 7: Commit**

```bash
git add src/pages/NativeGRNManagement.tsx
git commit -m "feat(grn): remove 400-line inline queue dupe, slim page header"
```

---

## Verification Checklist

- [ ] `npm run build` — 0 errors
- [ ] GRN form renders at 1280px without horizontal scroll
- [ ] Proof → Invoice → Allocations → Validation sections all visible by scrolling
- [ ] Sticky summary bar shows correct totals as form changes
- [ ] Save draft and Submit buttons work from the top bar
- [ ] Approval queue table shows at 1280px without horizontal scroll
- [ ] Clicking a queue row opens the Sheet with Details tab active
- [ ] All 4 tabs in review Sheet show correct data
- [ ] Decision tab submit fires the review mutation and Sheet closes
