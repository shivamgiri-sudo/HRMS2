# Task Brief: Vendor Task 4 — Rewrite NativeVendorManagement

## Context
MAS PeopleOS HRMS compact UI redesign. Task 4 of 4 in Vendor Payment module.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

Tasks 1-3 created these new components:
- `src/components/finance/vendor/VendorSheet.tsx` — exports `VendorSheet` and `Vendor` interface
- `src/components/finance/vendor/PaymentDispatchSheet.tsx` — for payment dispatch

## Goal

Rewrite `src/pages/NativeVendorManagement.tsx` (currently 420 lines) to:
1. Remove `HrmsModernShell` / `HrmsBentoTile` wrappers → standard `DashboardLayout` page
2. Replace stat-tiles with inline header badges
3. Replace card-list vendor view with a compact `<table>`
4. Use shadcn `Tabs` component (already partially used?)
5. Wire `VendorSheet` for create/edit/detail instead of the current inline Dialog/Sheet overlays

## What to keep

- ALL `useQuery`/`useMutation` hooks and their API calls (vendors and contracts)
- The `Vendor` and `Contract` interfaces (they're already defined in this file — keep them)
- The `VENDOR_TYPE_LABELS` and `CONTRACT_STATUS_COLOR` constants
- All filter state variables (`search`, `filterType`, `tab`)
- Contracts tab with its existing table/list

## What to change

### Remove from imports
- `HrmsModernShell`, `HrmsBentoTile` from `@/components/ui/hrms-modern`
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`
- `Label`, `Textarea` (now owned by VendorSheet)
- Redundant `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle` if VendorSheet owns them

### Add imports
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { VendorSheet, type Vendor as VendorSheetType } from "@/components/finance/vendor/VendorSheet";
```

Note on Vendor type conflict: The file already has its own `Vendor` interface. Since `VendorSheet` exports its own `Vendor` interface, you need to alias the import to avoid conflict. Actually, the safest approach: do NOT import the `Vendor` type from VendorSheet at all — just use the local `Vendor` interface from this file (they're structurally compatible). Only import the component:
```tsx
import { VendorSheet } from "@/components/finance/vendor/VendorSheet";
```
And use the local `Vendor` type for the `vendor` prop (structurally compatible).

### Replace state variables for vendor overlays

Remove `showCreate`, `editTarget`, `detailVendor`, `form`, `setForm` from state.

Add:
```tsx
const [sheetVendor, setSheetVendor] = useState<Vendor | null>(null);
const [sheetMode, setSheetMode] = useState<"create" | "edit" | "detail">("detail");
const [sheetOpen, setSheetOpen] = useState(false);
```

### New JSX return

```tsx
return (
  <DashboardLayout>
    <div className="flex h-full flex-col">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
        <h1 className="text-sm font-semibold">Vendor Management</h1>
        <div className="flex items-center gap-3">
          {vendors && (
            <>
              <span className="text-xs text-slate-500">
                Active: <b className="text-slate-900">{vendors.filter((v: Vendor) => v.is_active).length}</b>
              </span>
              <span className="text-xs text-slate-500">
                Total: <b className="text-slate-900">{vendors.length}</b>
              </span>
            </>
          )}
          {contracts && (
            <span className="text-xs text-slate-500">
              Contracts: <b className="text-slate-900">{contracts.length}</b>
            </span>
          )}
          <Button
            size="sm"
            onClick={() => { setSheetVendor(null); setSheetMode("create"); setSheetOpen(true); }}
          >
            + Add Vendor
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={tab} onValueChange={v => setTab(v as 'vendors' | 'contracts')} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
          <TabsList className="h-7">
            <TabsTrigger value="vendors" className="text-xs h-6">Vendors</TabsTrigger>
            <TabsTrigger value="contracts" className="text-xs h-6">Contracts</TabsTrigger>
          </TabsList>
          <Input
            className="h-7 w-44 text-xs"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All types</SelectItem>
              {Object.entries(VENDOR_TYPE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => { refV(); refC(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* ── Vendors tab ── */}
        <TabsContent value="vendors" className="flex-1 overflow-auto px-4 py-2 m-0">
          {loadingV ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className="h-8 text-left font-medium text-slate-500 w-24">Code</th>
                  <th className="h-8 text-left font-medium text-slate-500">Name</th>
                  <th className="h-8 text-left font-medium text-slate-500 hidden sm:table-cell w-28">Type</th>
                  <th className="h-8 text-left font-medium text-slate-500 hidden md:table-cell">GST</th>
                  <th className="h-8 text-left font-medium text-slate-500 w-16">Status</th>
                  <th className="h-8 text-left font-medium text-slate-500 w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVendors.map((v: Vendor) => (
                  <tr
                    key={v.id}
                    className="h-9 cursor-pointer border-b hover:bg-slate-50"
                    onClick={() => { setSheetVendor(v); setSheetMode("detail"); setSheetOpen(true); }}
                  >
                    <td className="py-1 font-mono text-slate-500">{v.vendor_code}</td>
                    <td className="py-1 font-medium truncate max-w-[140px]">{v.vendor_name}</td>
                    <td className="py-1 hidden sm:table-cell">{VENDOR_TYPE_LABELS[v.vendor_type] ?? v.vendor_type}</td>
                    <td className="py-1 hidden md:table-cell text-slate-500">{v.gst_number ?? "-"}</td>
                    <td className="py-1">
                      <Badge variant={v.is_active ? "default" : "secondary"} className="text-xs">
                        {v.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="py-1" onClick={e => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => { setSheetVendor(v); setSheetMode("edit"); setSheetOpen(true); }}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
                {filteredVendors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">No vendors found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </TabsContent>

        {/* ── Contracts tab ── KEEP EXISTING CONTENT UNCHANGED ── */}
        <TabsContent value="contracts" className="flex-1 overflow-auto px-4 py-2 m-0">
          {/* Keep the existing contracts table from the old file */}
        </TabsContent>
      </Tabs>
    </div>

    {/* ── VendorSheet ── */}
    <VendorSheet
      vendor={sheetVendor as any}
      mode={sheetMode}
      open={sheetOpen}
      onOpenChange={setSheetOpen}
      onSaved={() => { refV(); }}
    />
  </DashboardLayout>
);
```

Note on `filteredVendors`: The existing file likely computes this from `vendorsData`. Keep that logic unchanged.

Note on `refC`: The existing file likely has `refetch: refC` from the contracts query. If not, just use `refV()` in the refresh button.

Note on the `VendorSheet vendor` prop: since the local `Vendor` interface has `id: string` (required) but `VendorSheet`'s `Vendor` has `id?: string` (optional), and for `create` mode we pass `null`, you may need `vendor={sheetVendor as any}` or just `vendor={sheetVendor}` — TypeScript may complain about the id type difference. Use a cast if needed.

## Contracts tab
Read the existing contracts tab JSX from the file and keep it completely unchanged inside the `TabsContent value="contracts"`. Do not rewrite the contracts section.

## Steps
1. Read the full existing file to understand all variable names and the contracts tab JSX
2. Remove old overlay state variables and imports
3. Add new state and imports
4. Rewrite the JSX return with the new structure above
5. Preserve contracts tab content verbatim
6. Run `npx tsc --noEmit` and fix errors
7. Commit: `git add src/pages/NativeVendorManagement.tsx && git commit -m "feat(vendor): compact table with unified VendorSheet, remove HrmsModernShell"`
8. Write report to `.superpowers/sdd/vendor-task-4-report.md`

Return only: Status, commit hash, tsc result, concerns.
