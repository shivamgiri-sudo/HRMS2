# Task Brief: GRN Task 2 — Replace SmartGrnApprovalQueue 1180px modal with tabbed Sheet

## Context
MAS PeopleOS HRMS compact UI redesign. Task 2 of 3 in GRN module.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/components/finance/grn/SmartGrnApprovalQueue.tsx` (346 lines):
1. Replace `Dialog` review modal with a `<Sheet side="right" className="w-[560px]">` with 4 tabs
2. Compact the queue table (remove any min-w fixed widths, 8 columns, 36px rows)
3. Keep all mutations and queries unchanged

## Changes to make

### Import changes
Remove: `Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle`
Add:
```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
```

### Queue table restructure
Find the existing table (or whatever list renders GRN rows). Replace or adjust so it:
- Uses `w-full` not any `min-w-[1180px]` or similar fixed widths
- Has 8 columns: GRN, Type, Branch, Vendor, Amount, Due, Status, Review button
- Row height `h-9`, `text-xs`
- Clicking a row sets `setReviewGrn(grn)` to open the Sheet

New table structure:
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
    {filteredGrns.length === 0 && (
      <tr><td colSpan={8} className="py-8 text-center text-slate-400">No GRNs in queue</td></tr>
    )}
  </tbody>
</table>
```

Note: the variable for filtered rows might be `filteredGrns`, `grns`, `approvalQueue`, or something else — read the file to find the actual name.

### Add state for decision/review note (if not already present)
```tsx
const [decision, setDecision] = useState("");
const [reviewNote, setReviewNote] = useState("");
```

### Replace the Dialog with tabbed Sheet

Find `<Dialog open={!!reviewGrn}...>` and replace ENTIRELY with:

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
      <TabsList className="mx-4 mt-3 w-fit shrink-0">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="allocations">Allocations</TabsTrigger>
        <TabsTrigger value="validation">Validation</TabsTrigger>
        <TabsTrigger value="decision">Decision</TabsTrigger>
      </TabsList>

      <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3 m-0">
        {reviewGrn && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            {([
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
            ] as [string, string | null | undefined][]).map(([label, val]) => (
              <Fragment key={label}>
                <dt className="text-slate-500">{label}</dt>
                <dd className="font-medium text-slate-900 truncate">{val ?? "-"}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        {reviewGrn?.document_match_status && (
          <div className="mt-3 text-xs text-slate-500">
            Doc match: <Badge variant="outline" className="text-xs">{reviewGrn.document_match_status}</Badge>
          </div>
        )}
      </TabsContent>

      <TabsContent value="allocations" className="flex-1 overflow-y-auto px-4 py-3 m-0">
        {/* Move the existing allocation sub-table here if any, otherwise show a message */}
        <p className="text-xs text-slate-400">Allocation details will appear here.</p>
      </TabsContent>

      <TabsContent value="validation" className="flex-1 overflow-y-auto px-4 py-3 m-0">
        {/* Move existing validation results if any, otherwise show a message */}
        <p className="text-xs text-slate-400">Validation results will appear here.</p>
      </TabsContent>

      <TabsContent value="decision" className="flex-1 overflow-y-auto px-4 py-3 m-0">
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

Note: `reviewMutation` and `handleReviewSubmit` — read the file to find the actual mutation/handler name. If the existing Dialog had an approve button and a reject button, adapt `handleReviewSubmit` to call the right mutation based on `decision` value.

If the existing Dialog had:
- An approve mutation: call it when `decision === "approve"`
- A reject mutation: call it when `decision === "reject"`
- A request_info mutation: call it when `decision === "request_info"`

Add the dispatch logic:
```tsx
const handleReviewSubmit = () => {
  if (decision === "approve") approveMutation.mutate({ id: reviewGrn!.id, note: reviewNote });
  else if (decision === "reject") rejectMutation.mutate({ id: reviewGrn!.id, note: reviewNote });
  else if (decision === "request_info") requestInfoMutation.mutate({ id: reviewGrn!.id, note: reviewNote });
};
```

Adapt to whatever mutation names exist in the file.

Also add `import { Fragment } from "react";` to the imports.

## Steps
1. Read the full file
2. Add Sheet/Tabs/Fragment imports
3. Add `decision`, `reviewNote` state if not present
4. Compact the table (remove min-w, use 8 cols, h-9 rows)
5. Replace Dialog with tabbed Sheet
6. Run `npx tsc --noEmit` — fix errors
7. Commit: `git add src/components/finance/grn/SmartGrnApprovalQueue.tsx && git commit -m "feat(grn): replace 1180px review dialog with compact tabbed Sheet"`
8. Write report to `.superpowers/sdd/grn-task-2-report.md`

Return only: Status, commit hash, tsc result, concerns.
