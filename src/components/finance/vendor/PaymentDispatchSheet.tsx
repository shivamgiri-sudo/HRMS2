// src/components/finance/vendor/PaymentDispatchSheet.tsx
import { useEffect, useRef, useState, Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, LockKeyhole, Paperclip, Download } from "lucide-react";
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
  /**
   * Payment Voucher state joined on by the list/detail queries. When a voucher is mid-flight
   * this due must be settled through the voucher's Release action, not a direct dispatch —
   * the server enforces the same rule in vendor-payment-ledger.service.ts's dispatch().
   */
  voucher_id?: string | null;
  voucher_number?: string | null;
  voucher_status?: "raised" | "ceo_approved" | "released" | "rejected" | "changes_requested" | null;
  active_voucher?: boolean;
}

interface PaymentTransaction {
  id: string;
  sequence_no: number;
  payment_mode: string;
  payment_date: string;
  bank_name?: string | null;
  transaction_id?: string | null;
  amount: number;
  tds_amount?: number | null;
  net_amount?: number | null;
  remarks?: string | null;
  proof_file_name?: string | null;
  created_at: string;
}

interface Props {
  payment: VendorPayment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Hands the voucher off to the parent page's PaymentVoucherDrawer, which is a sibling of
   *  this sheet rather than a child — two stacked overlays trap focus badly. */
  onOpenVoucher?: (voucherId: string) => void;
}

export function PaymentDispatchSheet({ payment, open, onOpenChange, onSaved, onOpenVoucher }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [installmentAmt, setInstallmentAmt] = useState("");
  const [mode, setMode] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [bank, setBank] = useState("");
  const [utr, setUtr] = useState("");
  const [remarks, setRemarks] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [proofTargetId, setProofTargetId] = useState<string | null>(null);

  const banksQuery = useQuery({
    queryKey: ["vendor-payment-banks"],
    queryFn: async () => {
      // Registered as /banks (mounted at /api/finance), not under /vendor-payments/*
      // like every sibling route in vendor-payment.routes.ts — confirmed live.
      const res = await hrmsApi.get<{ success: boolean; data: Array<{ id: string; bank_name: string }> }>(
        "/api/finance/banks"
      );
      return res.data ?? [];
    },
    enabled: open,
  });
  const banks = banksQuery.data ?? [];

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
      // The router mounts at /api/finance, and the service reads camelCase keys. Both were wrong
      // here: the path 404'd, and had it resolved, snake_case keys would have arrived undefined and
      // failed validation as "Invalid payment mode". Sent as undefined rather than null when empty,
      // because the service trims and tests these for presence.
      const res = await hrmsApi.post(`/api/finance/vendor-payments/${payment!.id}/dispatch`, {
        paymentAmount: Number(installmentAmt),
        paymentMode: mode,
        paymentDate: paymentDate,
        bankId: bank || undefined,
        transactionId: utr?.trim() || undefined,
        remarks: remarks?.trim() || undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Payment dispatched" });
      queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-payment-transactions", payment?.id] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const holdMutation = useMutation({
    mutationFn: async (hold: boolean) => {
      const res = await hrmsApi.post(`/api/finance/vendor-payments/${payment!.id}/hold`, {
        hold,
        reason: holdReason?.trim() || undefined,
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

  // Installment history — the backend has tracked every partial payment against a GRN
  // (vendor_payment_transaction, one row per dispatch, with its own proof file) since this
  // module shipped, but no page anywhere ever rendered it. A vendor paid in 3 installments
  // showed only the current aggregate paid/balance, with no way to see which installment was
  // which, when, by what reference, or open its proof.
  const transactionsQuery = useQuery({
    queryKey: ["vendor-payment-transactions", payment?.id],
    enabled: open && Boolean(payment?.id),
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PaymentTransaction[] }>(
        `/api/finance/vendor-payments/${payment!.id}/transactions`
      );
      return res.data ?? [];
    },
  });
  const transactions = transactionsQuery.data ?? [];

  const proofMutation = useMutation({
    mutationFn: async ({ transactionRowId, file }: { transactionRowId: string; file: File }) => {
      const formData = new FormData();
      formData.append("proof", file);
      return hrmsApi.postForm(
        `/api/finance/vendor-payments/${payment!.id}/transactions/${transactionRowId}/upload-proof`,
        formData
      );
    },
    onSuccess: () => {
      toast({ title: "Installment proof uploaded" });
      setProofTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["vendor-payment-transactions", payment?.id] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  function onProofFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && proofTargetId) proofMutation.mutate({ transactionRowId: proofTargetId, file });
    e.target.value = "";
  }

  async function downloadProof(transactionRowId: string, filename: string) {
    try {
      const blob = await hrmsApi.getBlob(
        `/api/finance/vendor-payments/${payment!.id}/transactions/${transactionRowId}/proof`
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: "Could not open proof",
        description: e instanceof Error ? e.message : "Download failed",
        variant: "destructive",
      });
    }
  }

  if (!payment) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[480px] flex-col gap-0 p-0">
        <input
          ref={proofInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={onProofFileSelected}
        />
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
            <TabsTrigger value="history">
              Installments {transactions.length > 0 ? `(${transactions.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>

          {/* --- DISPATCH TAB --- */}
          <TabsContent value="dispatch" className="flex-1 overflow-y-auto px-4 py-3">
            {payment.active_voucher ? (
              /* Not an error state — the due is simply being settled the other way. Explain
                 which route owns it and hand the user straight to it, rather than showing a
                 form whose submit the server would reject with a 409. */
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-amber-800">
                  Awaiting Payment Voucher
                </h3>
                <p className="mt-1.5 text-sm text-amber-900">
                  Payment Voucher <span className="font-semibold">{payment.voucher_number}</span> is
                  {payment.voucher_status === "raised" ? " awaiting CEO approval" :
                   payment.voucher_status === "ceo_approved" ? " approved and awaiting release by Finance Head" :
                   " awaiting changes from the Finance Head who raised it"} for this due.
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  Direct dispatch is blocked while a voucher is in flight, so the same payment
                  cannot go out twice. Release it from the voucher instead.
                </p>
                {payment.voucher_id && onOpenVoucher && (
                  <Button
                    size="sm"
                    className="mt-3 cursor-pointer bg-amber-600 hover:bg-amber-700"
                    onClick={() => onOpenVoucher(payment.voucher_id!)}
                  >
                    Open Voucher
                  </Button>
                )}
              </div>
            ) : (
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
                <Select value={bank} onValueChange={setBank}>
                  <SelectTrigger className="mt-1 h-8 text-sm">
                    <SelectValue placeholder={banksQuery.isLoading ? "Loading…" : "Select bank"} />
                  </SelectTrigger>
                  <SelectContent>
                    {banks.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.bank_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            )}
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

          {/* --- INSTALLMENT HISTORY TAB --- */}
          <TabsContent value="history" className="flex-1 overflow-y-auto px-4 py-3">
            {transactionsQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : transactions.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No installments dispatched yet.
              </p>
            ) : (
              <div className="space-y-2">
                {transactions.map((t) => (
                  <div key={t.id} className="rounded-md border border-slate-200 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">
                        Installment #{t.sequence_no}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        ₹{Number(t.amount ?? 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500">
                      <span>{t.payment_mode}{t.bank_name ? ` · ${t.bank_name}` : ""}</span>
                      <span className="text-right">{t.payment_date ? String(t.payment_date).slice(0, 10) : "-"}</span>
                      {t.transaction_id && <span className="col-span-2 font-mono">{t.transaction_id}</span>}
                      {(t.tds_amount != null && Number(t.tds_amount) > 0) && (
                        <span className="col-span-2">
                          TDS ₹{Number(t.tds_amount).toLocaleString("en-IN")} · Net ₹{Number(t.net_amount ?? 0).toLocaleString("en-IN")}
                        </span>
                      )}
                      {t.remarks && <span className="col-span-2 italic text-slate-400">{t.remarks}</span>}
                    </div>
                    <div className="mt-1.5">
                      {t.proof_file_name ? (
                        <Button
                          size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-blue-600"
                          onClick={() => downloadProof(t.id, t.proof_file_name!)}
                        >
                          <Download className="mr-1 h-3 w-3" />{t.proof_file_name}
                        </Button>
                      ) : (
                        <Button
                          size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-slate-500"
                          disabled={proofMutation.isPending}
                          onClick={() => { setProofTargetId(t.id); proofInputRef.current?.click(); }}
                        >
                          <Paperclip className="mr-1 h-3 w-3" />Attach proof
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                <Fragment key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium text-slate-900 truncate">{val ?? "-"}</dd>
                </Fragment>
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
            // active_voucher repeats the tab-level guard on purpose: the footer button stays
            // mounted across tabs, so without it a voucher-owned due is still one click away.
            disabled={dispatchMutation.isPending || !installmentAmt || !mode || !paymentDate || !!payment.active_voucher}
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
