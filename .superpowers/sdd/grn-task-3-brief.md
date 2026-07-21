# Task Brief: GRN Task 3 — Simplify NativeGRNManagement

## Context
MAS PeopleOS HRMS compact UI redesign. Task 3 of 3 in GRN module.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

GRN Task 2 already updated `SmartGrnApprovalQueue` to be a compact component.
Your job is to simplify `src/pages/NativeGRNManagement.tsx` (660 lines).

## Goal

1. Remove the ~400-line inline `ApprovalQueueTab` function (duplicate of SmartGrnApprovalQueue)
2. Replace it with `<SmartGrnApprovalQueue />` in the queue tab
3. Remove the dark hero banner from the page
4. Add a 48px slim page header
5. Slim the tab bar

## Steps

### Step 1: Find and delete the inline ApprovalQueueTab component

Look for a function named something like `ApprovalQueueTab`, `function ApprovalQueue`, `const ApprovalQueueSection`, or any large inline function (roughly 200–400 lines) that duplicates the approval queue logic. Delete the entire function definition.

If there's an inline component with the approval queue JSX directly in NativeGRNManagement (not a separate named function), locate that code section inside the `<TabsContent>` for the queue tab and replace it with `<SmartGrnApprovalQueue />`.

### Step 2: Add SmartGrnApprovalQueue import if not already there

```tsx
import { SmartGrnApprovalQueue } from "@/components/finance/grn/SmartGrnApprovalQueue";
```

Check if it's already imported — if yes, keep it.

### Step 3: Replace the queue tab body

Find the `<TabsContent>` (or equivalent tab panel) for the approval queue. Replace its contents with:

```tsx
<TabsContent value="queue" className="flex-1 overflow-hidden m-0">
  <SmartGrnApprovalQueue />
</TabsContent>
```

### Step 4: Remove the dark hero section

Find the decorative hero `<div>` at the top of the JSX return (it contains gradient colors, large heading, or decorative icons). Delete it entirely.

Replace with a 48px page header:

```tsx
<div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
  <h1 className="text-sm font-semibold">GRN Management</h1>
</div>
```

### Step 5: Slim the tab bar

Find the `<TabsList>` that wraps the tab triggers. Update it:

```tsx
<TabsList className="h-7 mx-4">
  <TabsTrigger value="create" className="text-xs h-6">Create GRN</TabsTrigger>
  <TabsTrigger value="queue" className="text-xs h-6">Approval Queue</TabsTrigger>
  {/* keep any other tabs that exist */}
</TabsList>
```

### Step 6: Clean up now-unused imports

After removing the inline queue component, check which imports it was using. Remove those imports if they're not used elsewhere in the file. Typical candidates: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`, `Label`, `Textarea`, most Lucide icons. Only remove imports you can confirm are now unused.

### Step 7: Build check

```bash
npx tsc --noEmit 2>&1 | grep -i "NativeGRN"
npm run build 2>&1 | tail -5
```

Expected: 0 errors, `✓ built in ...s`

### Step 8: Commit

```bash
git add src/pages/NativeGRNManagement.tsx
git commit -m "feat(grn): remove 400-line inline queue dupe, slim page header"
```

Write report to `.superpowers/sdd/grn-task-3-report.md`

Return only: Status, commit hash, tsc result, concerns.
