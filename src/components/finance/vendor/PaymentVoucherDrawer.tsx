// src/components/finance/vendor/PaymentVoucherDrawer.tsx
//
// The Payment Voucher drill-down, and every decision that can be taken on a voucher:
// CEO approve / request changes / reject, Finance Head resubmit and release, Accounts Head
// post-release review.
//
// Extracted from PaymentVouchersPage.tsx, where it used to be inline, so that the Vendor
// Payment Dispatch page can open the *same* drawer. A voucher raised from either page is one
// payment_voucher row; opening it from either page must therefore offer exactly the same
// actions and show exactly the same state. Two copies of this JSX would drift within a
// release or two — one component cannot.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useHasRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import {
  PAYMENT_MODES, buildStages, dateTime, money, type Voucher,
} from "@/lib/finance/paymentVoucherStatus";
import { ApprovalTrack } from "./VoucherStatusBadge";

interface PaymentVoucherDrawerProps {
  voucherId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired after any action that changes the voucher, so the host page can refetch whatever it
   * shows alongside — the vouchers grid on one page, the vendor dues grid on the other. The
   * drawer already invalidates its own queries; this is purely the host's hook.
   */
  onChanged?: () => void;
}

export function PaymentVoucherDrawer({ voucherId, open, onOpenChange, onChanged }: PaymentVoucherDrawerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const canApprove = useHasRole("ceo", "super_admin");
  const canRelease = useHasRole("finance_head", "super_admin");
  const canReview = useHasRole("accounts_head", "super_admin");

  const [rejectNote, setRejectNote] = useState("");
  const [changesNote, setChangesNote] = useState("");
  const [resubmitBankAccountId, setResubmitBankAccountId] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [releaseForm, setReleaseForm] = useState({ paymentMode: "", paymentDate: new Date().toISOString().slice(0, 10), transactionRef: "" });

  const detailQuery = useQuery({
    queryKey: ["payment-voucher-detail", voucherId],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: Voucher }>(`/api/finance/payment-vouchers/${voucherId}`)).data,
    enabled: !!voucherId && open,
  });

  const bankAccountsQuery = useQuery({
    queryKey: ["payment-voucher-bank-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/bank-accounts")).data ?? [],
    enabled: !!voucherId && open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
    queryClient.invalidateQueries({ queryKey: ["payment-voucher-detail"] });
    // The same voucher governs a vendor_payment_tracking row on the Vendor Payment Dispatch
    // page. Releasing here moves that row's balance, so its grid must not stay stale.
    queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
    onChanged?.();
  };

  const approveMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/ceo-approve`, {})).data,
    onSuccess: () => { toast({ title: "Voucher approved" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const rejectMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/reject`, { note: rejectNote?.trim() || undefined })).data,
    onSuccess: () => { toast({ title: "Voucher rejected" }); invalidate(); setRejectNote(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const requestChangesMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/request-changes`, { note: changesNote.trim() })).data,
    onSuccess: () => { toast({ title: "Changes requested" }); invalidate(); setChangesNote(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const resubmitMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/resubmit`, {
      bankAccountId: resubmitBankAccountId || undefined,
    })).data,
    onSuccess: () => { toast({ title: "Voucher resubmitted" }); invalidate(); setResubmitBankAccountId(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const releaseMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/release`, {
      paymentMode: releaseForm.paymentMode,
      paymentDate: releaseForm.paymentDate,
      transactionRef: releaseForm.transactionRef?.trim() || undefined,
    })).data,
    onSuccess: () => { toast({ title: "Voucher released" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const reviewMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/review`, {
      note: reviewNote?.trim() || undefined,
    })).data,
    onSuccess: () => { toast({ title: "Review recorded" }); invalidate(); setReviewNote(""); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">{detailQuery.data?.voucher_number ?? "Payment Voucher"}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {detailQuery.data && (
            <>
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Approval Progress</h3>
                <ApprovalTrack stages={buildStages(detailQuery.data)} />
              </section>

              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Details</h3>
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-slate-500">Purpose</dt>
                  <dd className="font-semibold text-gray-800">
                    {detailQuery.data.source_type === "vendor_grn" ? (detailQuery.data.vendor_name ?? detailQuery.data.grn_number)
                      : detailQuery.data.source_type === "imprest_allocation" ? detailQuery.data.imprest_manager_name
                      : (detailQuery.data.particulars ?? "General payment")}
                  </dd>
                  {detailQuery.data.source_type === "vendor_grn" && (
                    <>
                      <dt className="text-slate-500">Head</dt><dd className="text-gray-600">{detailQuery.data.head ?? "—"}</dd>
                      <dt className="text-slate-500">Sub Head</dt><dd className="text-gray-600">{detailQuery.data.sub_head ?? "—"}</dd>
                    </>
                  )}
                  <dt className="text-slate-500">Bank Account</dt><dd className="font-semibold text-gray-800">{detailQuery.data.bank_account_name}</dd>
                  <dt className="text-slate-500">Ledger Head</dt><dd className="font-semibold text-gray-800">{detailQuery.data.payable_account_name}</dd>
                  <dt className="text-slate-500">Amount</dt><dd className="font-semibold text-gray-800">{money(detailQuery.data.amount)}</dd>
                  <dt className="text-slate-500">Remarks</dt><dd className="text-gray-600">{detailQuery.data.remarks ?? "—"}</dd>
                  {detailQuery.data.status === "released" && (
                    <>
                      <dt className="text-slate-500">Payment Mode</dt><dd className="text-gray-600">{detailQuery.data.payment_mode}</dd>
                      <dt className="text-slate-500">Payment Date</dt><dd className="text-gray-600">{detailQuery.data.payment_date}</dd>
                      <dt className="text-slate-500">Reference</dt><dd className="font-mono text-gray-600">{detailQuery.data.transaction_ref ?? "—"}</dd>
                      <dt className="text-slate-500">Accounts Review</dt>
                      <dd className="text-gray-600">
                        {detailQuery.data.accounts_reviewed_at
                          ? <>Reviewed {dateTime(detailQuery.data.accounts_reviewed_at)}{detailQuery.data.review_note ? ` — “${detailQuery.data.review_note}”` : ""}</>
                          : <span className="text-amber-600">Awaiting review</span>}
                      </dd>
                    </>
                  )}
                  {detailQuery.data.status === "rejected" && (
                    <><dt className="text-slate-500">Rejection Reason</dt><dd className="text-rose-600">{detailQuery.data.rejection_reason}</dd></>
                  )}
                </dl>
              </section>

              {detailQuery.data.source_type === "vendor_grn" && (detailQuery.data.grn_allocations?.length ?? 0) > 1 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">GRNs Paid by This Voucher</h3>
                  <ul className="space-y-1.5">
                    {detailQuery.data.grn_allocations!.map((a) => (
                      <li key={a.vendor_payment_tracking_id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs">
                        <span className="text-gray-600">{a.grn_number ?? a.vendor_payment_tracking_id} — {a.head ?? "—"} / {a.sub_head ?? "—"}</span>
                        <span className="font-semibold text-gray-800">{money(a.allocated_amount)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {detailQuery.data.source_type === "imprest_allocation" && detailQuery.data.consumption_since_replenishment && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                    Consumed Since Last Replenishment ({detailQuery.data.consumption_since_replenishment.sinceDate})
                  </h3>
                  {detailQuery.data.consumption_since_replenishment.rows.length === 0 ? (
                    <p className="text-sm text-slate-400">Nothing spent since the last top-up</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detailQuery.data.consumption_since_replenishment.rows.map((r, i) => (
                        <li key={i} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs">
                          <span className="text-gray-600">{r.transaction_date} — {r.grn_number ?? r.narration ?? "—"} {r.expense_head ? `(${r.expense_head})` : ""}</span>
                          <span className="font-semibold text-gray-800">{money(r.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {detailQuery.data.status === "raised" && canApprove && (
                <section className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-blue-700">CEO Decision</h3>
                  <div className="flex gap-2">
                    <Button className="cursor-pointer bg-emerald-600 hover:bg-emerald-700" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(detailQuery.data!.id)}>
                      Approve
                    </Button>
                  </div>
                  <Textarea placeholder="What needs to change? (e.g. use a different bank account)" value={changesNote} onChange={(e) => setChangesNote(e.target.value)} rows={2} />
                  <Button variant="outline" className="cursor-pointer border-amber-200 text-amber-700 hover:bg-amber-50" disabled={!changesNote.trim() || requestChangesMutation.isPending} onClick={() => requestChangesMutation.mutate(detailQuery.data!.id)}>
                    Request Changes
                  </Button>
                  <Textarea placeholder="Rejection reason (if rejecting)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2} />
                  <Button variant="outline" className="cursor-pointer border-rose-200 text-rose-700 hover:bg-rose-50" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate(detailQuery.data!.id)}>
                    Reject
                  </Button>
                </section>
              )}

              {detailQuery.data.status === "changes_requested" && String(detailQuery.data.raised_by) === String(user?.id) && (
                <section className="space-y-2 rounded-xl border border-orange-100 bg-orange-50/50 p-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-orange-700">CEO Requested Changes</h3>
                  <p className="text-sm text-gray-700">{detailQuery.data.changes_requested_note}</p>
                  <Label>Bank Account</Label>
                  <Select value={resubmitBankAccountId} onValueChange={setResubmitBankAccountId}>
                    <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Keep current, or pick a new one" /></SelectTrigger>
                    <SelectContent>
                      {(bankAccountsQuery.data ?? []).map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_name} — {a.account_number_masked}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button className="cursor-pointer bg-blue-600 hover:bg-blue-700" disabled={resubmitMutation.isPending} onClick={() => resubmitMutation.mutate(detailQuery.data!.id)}>
                    Resubmit for CEO Approval
                  </Button>
                </section>
              )}

              {detailQuery.data.status === "ceo_approved" && canRelease && (
                <section className="space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-700">Release Payment</h3>
                  <div>
                    <Label>Payment Mode</Label>
                    <Select value={releaseForm.paymentMode} onValueChange={(v) => setReleaseForm((f) => ({ ...f, paymentMode: v }))}>
                      <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select mode" /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Payment Date</Label>
                    <Input type="date" value={releaseForm.paymentDate} onChange={(e) => setReleaseForm((f) => ({ ...f, paymentDate: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Transaction Ref / UTR / Cheque No. (optional)</Label>
                    <Input value={releaseForm.transactionRef} onChange={(e) => setReleaseForm((f) => ({ ...f, transactionRef: e.target.value }))} />
                  </div>
                  <Button className="cursor-pointer bg-emerald-600 hover:bg-emerald-700" disabled={releaseMutation.isPending} onClick={() => releaseMutation.mutate(detailQuery.data!.id)}>
                    Release Payment
                  </Button>
                </section>
              )}

              {/* Non-blocking post-release sign-off — the payment has already gone out; this
                  just records that Accounts Head checked it. */}
              {detailQuery.data.status === "released" && canReview && !detailQuery.data.accounts_reviewed_at && (
                <section className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-indigo-700">Accounts Review</h3>
                  <p className="text-xs text-slate-500">Already released — this is a sign-off, not an approval gate.</p>
                  <Textarea placeholder="Review note (optional)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={2} />
                  <Button className="cursor-pointer bg-indigo-600 hover:bg-indigo-700" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate(detailQuery.data!.id)}>
                    Mark Reviewed
                  </Button>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Audit Trail</h3>
                {(detailQuery.data.audit_log ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400">None</p>
                ) : (
                  <ul className="space-y-2">
                    {(detailQuery.data.audit_log ?? []).map((entry, i) => (
                      <li key={i} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                        <span className="font-semibold text-gray-700">{entry.action_type}</span>{" "}
                        <span className="text-slate-400">— {dateTime(entry.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
