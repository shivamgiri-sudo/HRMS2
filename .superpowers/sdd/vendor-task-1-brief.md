# Task Brief: Vendor Task 1 — PaymentDispatchSheet Component

## Context
You are implementing a compact UI redesign for the MAS PeopleOS HRMS project.
This is Task 1 of 4 in the Vendor Payment module. The goal is to create a new
right-side Sheet component that houses the payment dispatch form, extracted
from the old inline-editing table.

Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`
Stack: React 18 + TypeScript + Vite + Tailwind + shadcn/ui
No new packages — all shadcn components already installed.

## Your Task

Create a new file: `src/components/finance/vendor/PaymentDispatchSheet.tsx`

This is a self-contained Sheet component. It has NO dependencies on any existing
file except standard imports (hrmsApi, shadcn, lucide, react-query).

### Complete implementation to write:

```tsx
// src/components/finance/vendor/PaymentDispatchSheet.tsx
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, LockKeyhole } from "lucide-react";
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
              {([
                ["GRN", payment.grn_number],
                ["Branch", payment.branch_name],
                ["Vendor", payment.vendor_name],
                ["Head", payment.head],
                ["Due date", payment.due_date ?? "-"],
                ["Due amount", `₹${(payment.due_amount ?? 0).toLocaleString("en-IN")}`],
                ["Without tax", `₹${(payment.amount_without_tax ?? 0).toLocaleString("en-IN")}`],
                ["Tax", `₹${(payment.tax_amount ?? 0).toLocaleString("en-IN")}`],
                ["With tax", `₹${(payment.amount_with_tax ?? 0).toLocaleString("en-IN")}`],
                ["Paid", `₹${(payment.paid_amount ?? 0).toLocaleString("en-IN")}`],
                ["Balance", `₹${(payment.balance_amount ?? 0).toLocaleString("en-IN")}`],
                ["Status", payment.payment_status],
              ] as [string, string | null | undefined][]).map(([label, val]) => (
                <React.Fragment key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-900 truncate">{val ?? "-"}</dd>
                </React.Fragment>
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

Note: The plan used array `.map()` with React fragments using key on `<>`. The correct pattern is `React.Fragment` with explicit key. The implementation above already uses `React.Fragment` — make sure to add `import React from "react"` or use the named import `import { Fragment } from "react"`. Actually, since the project uses React 18 with the new JSX transform, you don't need to import React explicitly, but `React.Fragment` won't be available without importing React. Use `Fragment` from react instead:

```tsx
import { useState, useEffect, Fragment } from "react";
```
And change `React.Fragment` to `Fragment` in the dl map.

Also note: `formatISTDate` was referenced in the plan but may not exist — check `src/lib/utils.ts` for a date formatting helper. If it doesn't exist, just render the date string directly (it's already a string field).

## Steps

1. Check if `src/components/finance/vendor/` directory exists; create if not
2. Check `src/lib/utils.ts` or `src/lib/hrmsApi.ts` for `formatISTDate` — use if available, otherwise use the raw date string
3. Write the complete file
4. Run `npx tsc --noEmit 2>&1 | grep -i "PaymentDispatchSheet"` — fix any errors
5. Commit: `git add src/components/finance/vendor/PaymentDispatchSheet.tsx && git commit -m "feat(vendor): add PaymentDispatchSheet right-side edit panel"`
6. Report DONE with the commit hash

## Report contract

Write your full report to: `.superpowers/sdd/vendor-task-1-report.md`

Return only:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit hash
- One-line test summary (tsc result)
- Any concerns
