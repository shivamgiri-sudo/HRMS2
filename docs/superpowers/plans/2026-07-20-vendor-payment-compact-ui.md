# Vendor Payment — Compact UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 15-column inline-editing dispatch table and 3-overlay vendor management page with a compact 7-column read-only table + right-side Sheet for editing.

**Architecture:** `VendorPaymentDispatchPage` keeps all existing API hooks/mutations unchanged. The JSX is rewritten to: (1) a slim 48px page header with inline KPI badges, (2) a 6-field collapsible filter bar, (3) a 7-column TanStack-powered `<Table>` with 36px rows, (4) a `<Sheet side="right" className="w-[480px]">` that opens on row click and contains the full payment form. `NativeVendorManagement` gets its 3-overlay pattern collapsed to one Sheet and its custom shell components swapped for standard page header.

**Tech Stack:** React 18, TypeScript, shadcn/ui (`Sheet`, `Table`, `Badge`, `Tabs`), TanStack Table v8 (`useReactTable`), React Query (existing hooks), Lucide icons.

## Global Constraints

- Do not change any backend API routes or response shapes
- Do not remove existing mutations (`useDispatchPayment`, `useHoldPayment`, etc.) — wire them from Sheet
- All shadcn components already installed — no new package installs
- TypeScript strict mode — no `any` types
- Keep existing `PaymentCapabilities` and `VendorPayment` interfaces unchanged

---

## File Map

| Action | File |
|---|---|
| Rewrite | `src/pages/finance/VendorPaymentDispatchPage.tsx` |
| Rewrite | `src/pages/NativeVendorManagement.tsx` |
| Create | `src/components/finance/vendor/PaymentDispatchSheet.tsx` |
| Create | `src/components/finance/vendor/VendorSheet.tsx` |

---

### Task 1: PaymentDispatchSheet component

The edit form extracted from the old inline-table into a standalone Sheet component.

**Files:**
- Create: `src/components/finance/vendor/PaymentDispatchSheet.tsx`

**Interfaces:**
- Consumes: `VendorPayment` type from `VendorPaymentDispatchPage.tsx` (copy the interface locally or import from a shared types file if one exists)
- Produces: `<PaymentDispatchSheet>` — props: `payment: VendorPayment | null`, `open: boolean`, `onOpenChange: (open: boolean) => void`, `onSaved: () => void`

- [ ] **Step 1: Create the file with imports and prop types**

```tsx
// src/components/finance/vendor/PaymentDispatchSheet.tsx
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, LockKeyhole, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

export interface VendorPayment {
  id: string;
  grn_request_id: string;
  grn_number?: string | null;
  branch_name?: string | null;
  vendor_name?: string | null;
  head?: string | null;
  amount_without_tax?: number;
  tax_amount?: number;
  amount_with_tax?: number;
  due_amount: number;
  due_date?: string | null;
  payment_mode?: string | null;
  payment_date?: string | null;
  bank_id?: string | null;
  bank_name?: string | null;
  transaction_id?: string | null;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  remarks?: string | null;
  grn_file_name?: string | null;
  payment_proof_file_name?: string | null;
  installment_number?: number;
  is_on_hold?: boolean;
  hold_reason?: string | null;
}

interface Props {
  payment: VendorPayment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}
```

- [ ] **Step 2: Add draft state and reset effect**

```tsx
export function PaymentDispatchSheet({ payment, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [installmentAmt, setInstallmentAmt] = useState("");
  const [mode, setMode] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [bank, setBank] = useState("");
  const [utr, setUtr] = useState("");
  const [remarks, setRemarks] = useState("");
  const [holdReason, setHoldReason] = useState("");

  useEffect(() => {
    if (payment) {
      setInstallmentAmt(String(payment.balance_amount ?? ""));
      setMode(payment.payment_mode ?? "");
      setPaymentDate(payment.payment_date ?? "");
      setBank(payment.bank_id ?? "");
      setUtr(payment.transaction_id ?? "");
      setRemarks(payment.remarks ?? "");
      setHoldReason(payment.hold_reason ?? "");
    }
  }, [payment]);
```

- [ ] **Step 3: Add dispatch and hold mutations**

```tsx
  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const res = await hrmsApi.post(`/api/vendor-payments/${payment!.id}/dispatch`, {
        installment_amount: Number(installmentAmt),
        payment_mode: mode,
        payment_date: paymentDate,
        bank_id: bank || null,
        transaction_id: utr || null,
        remarks: remarks || null,
      });
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Payment dispatched" });
      queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const holdMutation = useMutation({
    mutationFn: async (hold: boolean) => {
      const res = await hrmsApi.post(`/api/vendor-payments/${payment!.id}/hold`, {
        hold,
        reason: holdReason || null,
      });
      return res.data;
    },
    onSuccess: (_d, hold) => {
      toast({ title: hold ? "Payment held" : "Hold released" });
      queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      onSaved();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
```

- [ ] **Step 4: Add the Sheet JSX with tabs**

```tsx
  if (!payment) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[480px] flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            {payment.grn_number ?? payment.grn_request_id}
          </SheetTitle>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge variant="outline" className="text-xs">{payment.branch_name}</Badge>
            <Badge variant="outline" className="text-xs">{payment.vendor_name}</Badge>
            <Badge variant="outline" className="text-xs">
              Balance: ₹{(payment.balance_amount ?? 0).toLocaleString("en-IN")}
            </Badge>
          </div>
        </SheetHeader>

        <Tabs defaultValue="dispatch" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 w-fit">
            <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
            <TabsTrigger value="hold">Hold</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          {/* --- DISPATCH TAB --- */}
          <TabsContent value="dispatch" className="flex-1 overflow-y-auto px-4 py-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Installment amount *</Label>
                <Input
                  type="number"
                  value={installmentAmt}
                  onChange={e => setInstallmentAmt(e.target.value)}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Payment mode *</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {["NEFT", "RTGS", "IMPS", "Cheque", "Cash", "UPI"].map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Payment date *</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  className="mt-1 h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Bank</Label>
                <Input
                  value={bank}
                  onChange={e => setBank(e.target.value)}
                  className="mt-1 h-8 text-sm"
                  placeholder="Bank name"
                />
              </div>
              <div>
                <Label className="text-xs">UTR / Cheque no.</Label>
                <Input
                  value={utr}
                  onChange={e => setUtr(e.target.value)}
                  className="mt-1 h-8 text-sm"
                  placeholder="Reference"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Remarks</Label>
                <Textarea
                  value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  className="mt-1 min-h-[64px] text-sm"
                />
              </div>
            </div>
          </TabsContent>

          {/* --- HOLD TAB --- */}
          <TabsContent value="hold" className="flex-1 overflow-y-auto px-4 py-3">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={payment.is_on_hold ? "destructive" : "secondary"}>
                  {payment.is_on_hold ? "On Hold" : "Not Held"}
                </Badge>
              </div>
              <div>
                <Label className="text-xs">Hold reason</Label>
                <Textarea
                  value={holdReason}
                  onChange={e => setHoldReason(e.target.value)}
                  className="mt-1 min-h-[80px] text-sm"
                  placeholder="Reason for hold / release"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={holdMutation.isPending || !!payment.is_on_hold}
                  onClick={() => holdMutation.mutate(true)}
                >
                  <LockKeyhole className="mr-1.5 h-3.5 w-3.5" /> Place Hold
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={holdMutation.isPending || !payment.is_on_hold}
                  onClick={() => holdMutation.mutate(false)}
                >
                  Release Hold
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* --- DETAILS TAB --- */}
          <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {[
                ["GRN", payment.grn_number],
                ["Branch", payment.branch_name],
                ["Vendor", payment.vendor_name],
                ["Head", payment.head],
                ["Due date", payment.due_date ? formatISTDate(payment.due_date) : "-"],
                ["Due amount", `₹${(payment.due_amount ?? 0).toLocaleString("en-IN")}`],
                ["Without tax", `₹${(payment.amount_without_tax ?? 0).toLocaleString("en-IN")}`],
                ["Tax", `₹${(payment.tax_amount ?? 0).toLocaleString("en-IN")}`],
                ["With tax", `₹${(payment.amount_with_tax ?? 0).toLocaleString("en-IN")}`],
                ["Paid", `₹${(payment.paid_amount ?? 0).toLocaleString("en-IN")}`],
                ["Balance", `₹${(payment.balance_amount ?? 0).toLocaleString("en-IN")}`],
                ["Status", payment.payment_status],
              ].map(([label, val]) => (
                <>
                  <dt key={`l-${label}`} className="text-slate-500">{label}</dt>
                  <dd key={`v-${label}`} className="font-medium text-slate-900 truncate">{val ?? "-"}</dd>
                </>
              ))}
            </dl>
          </TabsContent>
        </Tabs>

        <SheetFooter className="border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={dispatchMutation.isPending || !installmentAmt || !mode || !paymentDate}
            onClick={() => dispatchMutation.mutate()}
          >
            {dispatchMutation.isPending
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Dispatch
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Build check**

```bash
cd C:\Users\ADMIN\Desktop\HRMS2-latest
npx tsc --noEmit 2>&1 | grep -i "PaymentDispatchSheet"
```
Expected: no errors for the new file.

- [ ] **Step 6: Commit**

```bash
git add src/components/finance/vendor/PaymentDispatchSheet.tsx
git commit -m "feat(vendor): add PaymentDispatchSheet right-side edit panel"
```

---

### Task 2: Rewrite VendorPaymentDispatchPage to compact table + Sheet

**Files:**
- Modify: `src/pages/finance/VendorPaymentDispatchPage.tsx`

**Interfaces:**
- Consumes: `PaymentDispatchSheet` from `@/components/finance/vendor/PaymentDispatchSheet`
- Keeps: all existing `useQuery`/`useMutation` hooks, `PaymentCapabilities` interface, filter state, pagination

- [ ] **Step 1: Replace the top-level JSX structure**

Find the return statement in `VendorPaymentDispatchPage`. Replace everything inside `<DashboardLayout>` with this skeleton (keep all hooks and state above the return unchanged):

```tsx
return (
  <DashboardLayout>
    <div className="flex h-full flex-col">
      {/* ── Slim page header ── */}
      <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
        <h1 className="text-sm font-semibold text-slate-900">Vendor Payment Dispatch</h1>
        <div className="flex items-center gap-2">
          {/* keep existing access badges here */}
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
        <span className="text-slate-500">Page due: <b className="text-slate-900">₹{pageDue}</b></span>
        <span className="text-slate-500">Paid: <b className="text-slate-900">₹{pagePaid}</b></span>
        <span className="text-slate-500">Balance: <b className="text-slate-900">₹{pageBalance}</b></span>
        {overdueBalance > 0 && (
          <Badge variant="destructive" className="text-xs">Overdue ₹{overdueBalance}</Badge>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-2 border-b px-4 py-2 shrink-0">
        {/* keep existing 6 filter inputs, use h-7 size */}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto px-4 py-2">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b">
              <th className="h-8 w-8 text-left"><input type="checkbox" /></th>
              <th className="h-8 min-w-[120px] text-left font-medium text-slate-500">GRN / Branch</th>
              <th className="h-8 min-w-[120px] text-left font-medium text-slate-500">Vendor</th>
              <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Head</th>
              <th className="h-8 min-w-[80px] text-right font-medium text-slate-500">Balance</th>
              <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Due date</th>
              <th className="h-8 min-w-[80px] text-left font-medium text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr
                key={p.id}
                className="h-9 cursor-pointer border-b hover:bg-slate-50"
                onClick={() => { setSelected(p); setSheetOpen(true); }}
              >
                <td onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected?.id === p.id} readOnly />
                </td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between border-t px-4 py-2 text-xs shrink-0">
        {/* keep existing pagination controls */}
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
);
```

- [ ] **Step 2: Add missing state variables at top of component**

Add alongside existing state:
```tsx
const [selected, setSelected] = useState<VendorPayment | null>(null);
const [sheetOpen, setSheetOpen] = useState(false);
```

- [ ] **Step 3: Add import for PaymentDispatchSheet**

```tsx
import { PaymentDispatchSheet } from "@/components/finance/vendor/PaymentDispatchSheet";
```

Remove the old imports that are no longer used (e.g. `Textarea`, `LockKeyhole`, `Send` if moved to Sheet).

- [ ] **Step 4: TypeScript build check**

```bash
npx tsc --noEmit 2>&1 | grep "VendorPaymentDispatch"
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/finance/VendorPaymentDispatchPage.tsx
git commit -m "feat(vendor): compact 7-col dispatch table with Sheet edit panel"
```

---

### Task 3: VendorSheet component (create/edit/detail unified)

**Files:**
- Create: `src/components/finance/vendor/VendorSheet.tsx`

**Interfaces:**
- Consumes: vendor object shape from existing `NativeVendorManagement.tsx` (copy the `Vendor` interface)
- Produces: `<VendorSheet>` — props: `vendor: Vendor | null`, `mode: "create" | "edit" | "detail"`, `open: boolean`, `onOpenChange: (open: boolean) => void`, `onSaved: () => void`

- [ ] **Step 1: Create file**

```tsx
// src/components/finance/vendor/VendorSheet.tsx
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

export interface Vendor {
  id?: string;
  vendor_code?: string;
  vendor_name: string;
  vendor_type?: string;
  payment_terms?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  gst_number?: string;
  pan_number?: string;
  address?: string;
  is_active?: number;
}

interface Props {
  vendor: Vendor | null;
  mode: "create" | "edit" | "detail";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function VendorSheet({ vendor, mode, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Vendor>({ vendor_name: "" });

  useEffect(() => {
    if (vendor) setForm(vendor);
    else setForm({ vendor_name: "" });
  }, [vendor, open]);

  const set = (key: keyof Vendor) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        return (await hrmsApi.post("/api/erp/vendors", form)).data;
      }
      return (await hrmsApi.put(`/api/erp/vendors/${vendor!.id}`, form)).data;
    },
    onSuccess: () => {
      toast({ title: mode === "create" ? "Vendor created" : "Vendor updated" });
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isReadOnly = mode === "detail";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[420px] flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            {mode === "create" ? "Add Vendor" : mode === "edit" ? "Edit Vendor" : "Vendor Details"}
          </SheetTitle>
          {vendor?.vendor_code && (
            <Badge variant="outline" className="w-fit text-xs">{vendor.vendor_code}</Badge>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "vendor_name" as const, label: "Vendor name *", span: 2 },
              { key: "vendor_code" as const, label: "Vendor code" },
              { key: "vendor_type" as const, label: "Type" },
              { key: "payment_terms" as const, label: "Payment terms" },
              { key: "contact_name" as const, label: "Contact name" },
              { key: "contact_email" as const, label: "Contact email" },
              { key: "contact_phone" as const, label: "Contact phone" },
              { key: "gst_number" as const, label: "GST number" },
              { key: "pan_number" as const, label: "PAN number" },
            ].map(({ key, label, span }) => (
              <div key={key} className={span === 2 ? "col-span-2" : ""}>
                <Label className="text-xs">{label}</Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  value={(form[key] as string) ?? ""}
                  onChange={set(key)}
                  readOnly={isReadOnly}
                  disabled={isReadOnly}
                />
              </div>
            ))}
            <div className="col-span-2">
              <Label className="text-xs">Address</Label>
              <Textarea
                className="mt-1 min-h-[60px] text-sm"
                value={form.address ?? ""}
                onChange={set("address")}
                readOnly={isReadOnly}
                disabled={isReadOnly}
              />
            </div>
          </div>
        </div>

        {!isReadOnly && (
          <SheetFooter className="border-t px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" disabled={saveMutation.isPending || !form.vendor_name} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/finance/vendor/VendorSheet.tsx
git commit -m "feat(vendor): unified VendorSheet replaces 3 separate overlays"
```

---

### Task 4: Rewrite NativeVendorManagement to compact table

**Files:**
- Modify: `src/pages/NativeVendorManagement.tsx`

- [ ] **Step 1: Replace shell and stat tiles**

Find and remove the `HrmsModernShell`/`HrmsBentoTile` wrapper. Replace with:

```tsx
<DashboardLayout>
  <div className="flex h-full flex-col">
    <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
      <h1 className="text-sm font-semibold">Vendor Management</h1>
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">
          Active: <b className="text-slate-900">{activeCount}</b>
        </span>
        <span className="text-xs text-slate-500">
          Contracts: <b className="text-slate-900">{contractCount}</b>
        </span>
        <Button size="sm" onClick={() => { setSheetMode("create"); setSheetVendor(null); setSheetOpen(true); }}>
          + Add Vendor
        </Button>
      </div>
    </div>
```

- [ ] **Step 2: Replace custom tab buttons with shadcn Tabs**

```tsx
    <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <TabsList className="h-7">
          <TabsTrigger value="vendors" className="text-xs h-6">Vendors</TabsTrigger>
          <TabsTrigger value="contracts" className="text-xs h-6">Contracts</TabsTrigger>
        </TabsList>
        <Input
          className="h-7 w-48 text-xs"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
```

- [ ] **Step 3: Replace card-list with table and wire VendorSheet**

For vendors tab:
```tsx
      <TabsContent value="vendors" className="flex-1 overflow-auto px-4 py-2 m-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b">
              <th className="h-8 text-left font-medium text-slate-500">Code</th>
              <th className="h-8 text-left font-medium text-slate-500">Name</th>
              <th className="h-8 text-left font-medium text-slate-500 hidden sm:table-cell">Type</th>
              <th className="h-8 text-left font-medium text-slate-500 hidden md:table-cell">GST</th>
              <th className="h-8 text-left font-medium text-slate-500">Status</th>
              <th className="h-8 text-left font-medium text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredVendors.map(v => (
              <tr
                key={v.id}
                className="h-9 cursor-pointer border-b hover:bg-slate-50"
                onClick={() => { setSheetVendor(v); setSheetMode("detail"); setSheetOpen(true); }}
              >
                <td className="py-1 font-mono text-slate-500">{v.vendor_code}</td>
                <td className="py-1 font-medium truncate max-w-[140px]">{v.vendor_name}</td>
                <td className="py-1 hidden sm:table-cell">{v.vendor_type ?? "-"}</td>
                <td className="py-1 hidden md:table-cell">{v.gst_number ?? "-"}</td>
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
          </tbody>
        </table>
      </TabsContent>
```

- [ ] **Step 4: Add VendorSheet at end of component**

```tsx
    <VendorSheet
      vendor={sheetVendor}
      mode={sheetMode}
      open={sheetOpen}
      onOpenChange={setSheetOpen}
      onSaved={() => refetch()}
    />
```

Add state:
```tsx
const [sheetVendor, setSheetVendor] = useState<Vendor | null>(null);
const [sheetMode, setSheetMode] = useState<"create" | "edit" | "detail">("detail");
const [sheetOpen, setSheetOpen] = useState(false);
```

Add import:
```tsx
import { VendorSheet, type Vendor } from "@/components/finance/vendor/VendorSheet";
```

Remove old Dialog/Sheet imports that are no longer used directly in this file.

- [ ] **Step 5: Build check**

```bash
npx tsc --noEmit 2>&1 | grep -i vendor
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/NativeVendorManagement.tsx
git commit -m "feat(vendor): compact table with unified VendorSheet, remove HrmsModernShell"
```

---

## Verification Checklist

- [ ] `npm run build` completes with 0 errors
- [ ] At 1280px viewport: vendor table shows without horizontal scroll
- [ ] At 1280px viewport: dispatch table shows without horizontal scroll  
- [ ] Clicking a dispatch row opens Sheet with correct GRN data
- [ ] Filling form and clicking Dispatch triggers mutation, Sheet closes, table refreshes
- [ ] Hold/Release buttons in Sheet work correctly
- [ ] Clicking a vendor row opens detail Sheet
- [ ] Edit button opens edit Sheet with pre-filled data
- [ ] Add Vendor opens blank create Sheet
- [ ] No card-within-card nesting in either page
