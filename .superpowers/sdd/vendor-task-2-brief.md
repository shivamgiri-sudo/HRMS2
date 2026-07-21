# Task Brief: Vendor Task 2 — Rewrite VendorPaymentDispatchPage

## Context
MAS PeopleOS HRMS compact UI redesign. Task 2 of 4 in Vendor Payment module.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

Task 1 already created `src/components/finance/vendor/PaymentDispatchSheet.tsx`.
Your job is to rewrite `src/pages/finance/VendorPaymentDispatchPage.tsx` (currently 1039 lines).

## Goal

Replace the 15-column inline-editing table with a 7-column read-only table + right-side Sheet.

## What to keep unchanged
- ALL hooks at top of component: `useQuery`, `useMutation`, `useQueryClient`, state variables for filters/pagination/capabilities
- The `PaymentCapabilities` interface (keep it or remove it only if truly unused after rewrite)
- The `VendorPayment` interface **already defined in this file** — but note: Task 1 created a DUPLICATE `VendorPayment` in `PaymentDispatchSheet.tsx`. Since both files coexist, keep the one in this file as-is and import from the Sheet's file only the component (not the interface). Actually, the simplest approach: keep the existing `VendorPayment` interface in this file and do NOT import it from PaymentDispatchSheet — the Sheet component exports its own copy independently (they're compatible). The component import is: `import { PaymentDispatchSheet } from "@/components/finance/vendor/PaymentDispatchSheet";` — import only the component, not the type.

## What to change

### 1. Remove from imports (no longer needed in this file after Sheet takes over)
Look at the current imports and remove only ones that become unused. The Sheet now owns: `LockKeyhole`, `Send`, `Textarea`, `Label`. Keep `Loader2`, `Download`, `RefreshCw`, `Search`, `Filter`, and all query/mutation hooks.

### 2. Add state variables (add these to the existing state block)
```tsx
const [selected, setSelected] = useState<VendorPayment | null>(null);
const [sheetOpen, setSheetOpen] = useState(false);
```

### 3. Add import for the new Sheet component
```tsx
import { PaymentDispatchSheet } from "@/components/finance/vendor/PaymentDispatchSheet";
```

### 4. Rewrite the JSX return

Replace everything inside `<DashboardLayout>` with this structure:

```tsx
<DashboardLayout>
  <div className="flex h-full flex-col">
    {/* ── Slim page header ── */}
    <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
      <h1 className="text-sm font-semibold text-slate-900">Vendor Payment Dispatch</h1>
      <div className="flex items-center gap-2">
        {/* Keep any existing access/capability badges here if they exist in the old JSX */}
        <Button size="sm" variant="outline" onClick={handleExportCsv}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Export
        </Button>
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    {/* ── KPI strip ── */}
    <div className="flex gap-3 border-b px-4 py-2 text-xs shrink-0">
      {/* compute pageDue, pagePaid, pageBalance, overdueBalance from payments array */}
      <span className="text-slate-500">Page due: <b className="text-slate-900">₹{(payments ?? []).reduce((s, p) => s + (p.due_amount ?? 0), 0).toLocaleString("en-IN")}</b></span>
      <span className="text-slate-500">Paid: <b className="text-slate-900">₹{(payments ?? []).reduce((s, p) => s + (p.paid_amount ?? 0), 0).toLocaleString("en-IN")}</b></span>
      <span className="text-slate-500">Balance: <b className="text-slate-900">₹{(payments ?? []).reduce((s, p) => s + (p.balance_amount ?? 0), 0).toLocaleString("en-IN")}</b></span>
    </div>

    {/* ── Filter bar ── */}
    {/* Keep existing filter inputs — just change their height to h-7 and add a flex gap-2 wrapper with border-b */}
    <div className="flex flex-wrap gap-2 border-b px-4 py-2 shrink-0">
      {/* existing filter inputs go here — keep them all, just reduce their height class to h-7 */}
    </div>

    {/* ── Table ── */}
    <div className="flex-1 overflow-auto px-4 py-2">
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b">
              <th className="h-8 min-w-[120px] text-left font-medium text-slate-500">GRN / Branch</th>
              <th className="h-8 min-w-[120px] text-left font-medium text-slate-500">Vendor</th>
              <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Head</th>
              <th className="h-8 min-w-[80px] text-right font-medium text-slate-500">Balance</th>
              <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Due date</th>
              <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Status</th>
              <th className="h-8 w-16 text-left font-medium text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody>
            {(payments ?? []).map(p => (
              <tr
                key={p.id}
                className="h-9 cursor-pointer border-b hover:bg-slate-50"
                onClick={() => { setSelected(p); setSheetOpen(true); }}
              >
                <td className="py-1">
                  <div className="font-medium truncate max-w-[120px]">{p.grn_number ?? p.grn_request_id}</div>
                  <div className="text-slate-400 truncate max-w-[120px]">{p.branch_name}</div>
                </td>
                <td className="truncate max-w-[120px] py-1">{p.vendor_name ?? "-"}</td>
                <td className="truncate max-w-[80px] py-1">{p.head ?? "-"}</td>
                <td className="py-1 text-right font-medium">
                  ₹{(p.balance_amount ?? 0).toLocaleString("en-IN")}
                </td>
                <td className="py-1">{p.due_date ? formatISTDate(p.due_date) : "-"}</td>
                <td className="py-1">
                  <Badge
                    variant={p.payment_status === "paid" ? "default" : p.is_on_hold ? "destructive" : "secondary"}
                    className="text-xs"
                  >
                    {p.payment_status}
                  </Badge>
                </td>
                <td className="py-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={e => { e.stopPropagation(); setSelected(p); setSheetOpen(true); }}
                  >
                    Pay
                  </Button>
                </td>
              </tr>
            ))}
            {(payments ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">No payments found</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>

    {/* ── Pagination ── */}
    <div className="flex items-center justify-between border-t px-4 py-2 text-xs shrink-0">
      {/* keep existing pagination — just make sure buttons are size="sm" */}
    </div>
  </div>

  {/* ── Edit Sheet ── */}
  <PaymentDispatchSheet
    payment={selected}
    open={sheetOpen}
    onOpenChange={setSheetOpen}
    onSaved={() => refetch()}
  />
</DashboardLayout>
```

## IMPORTANT: Variable names
The existing file uses specific variable names. Read the file carefully first and use whatever variables already exist:
- The payments array may be called `data`, `payments`, `filteredPayments` or similar — find it
- The refetch may be `refetch` from `useQuery` destructuring
- The loading state may be `isLoading` or `isFetching`
- `handleExportCsv` may be a different name — find it or inline a stub if it doesn't exist
- `payments ?? []` — use the actual variable name from the file

## Steps
1. Read the existing file top-to-bottom to understand variable names and existing state/hooks
2. Add `selected`/`sheetOpen` state and `PaymentDispatchSheet` import
3. Remove the old JSX return body and replace with the compact version above (adapting variable names)
4. Remove imports that are now unused (safe: only remove an import if you verified it's not used anywhere in the file)
5. Run `npx tsc --noEmit` — fix all errors
6. Commit: `git add src/pages/finance/VendorPaymentDispatchPage.tsx && git commit -m "feat(vendor): compact 7-col dispatch table with Sheet edit panel"`
7. Write report to `.superpowers/sdd/vendor-task-2-report.md`

Return only: Status, commit hash, tsc result, concerns.
