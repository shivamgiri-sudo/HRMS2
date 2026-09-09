// src/pages/finance/PaymentVouchersPage.tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Circle, Clock, IndianRupee, Plus, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useHasRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import { hrmsApi } from "@/lib/hrmsApi";

type Voucher = {
  id: string;
  voucher_number: string;
  voucher_type: string;
  source_type: "vendor_grn" | "imprest_allocation";
  bank_account_id: string;
  bank_account_name: string | null;
  payable_account_id: string;
  payable_account_name: string | null;
  linked_vendor_payment_id: string | null;
  grn_number: string | null;
  vendor_name: string | null;
  linked_imprest_manager_id: string | null;
  imprest_manager_name: string | null;
  amount: number;
  remarks: string | null;
  reason: string | null;
  status: "draft" | "raised" | "ceo_approved" | "rejected" | "released";
  raised_by: string | null;
  raised_at: string | null;
  ceo_approved_by: string | null;
  ceo_approved_at: string | null;
  released_by: string | null;
  released_at: string | null;
  payment_mode: string | null;
  payment_date: string | null;
  transaction_ref: string | null;
  rejection_reason: string | null;
  created_at: string;
  approval_events?: Array<{ action: string; actor_user_id: string; actor_role: string; created_at: string; remarks: string | null }>;
  audit_log?: Array<{ action_type: string; created_at: string }>;
  consumption_since_replenishment?: { sinceDate: string; rows: Array<{ transaction_date: string; amount: number; grn_number: string | null; expense_head: string | null; narration: string | null }> } | null;
};

const PAYMENT_MODES = ["Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Cash", "Bank Transfer", "Adjustment", "Other"];

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

const STATUS_TONE: Record<Voucher["status"], string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  raised: "border-amber-200 bg-amber-50 text-amber-800",
  ceo_approved: "border-blue-200 bg-blue-50 text-blue-800",
  released: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-rose-200 bg-rose-50 text-rose-800",
};
const STATUS_LABEL: Record<Voucher["status"], string> = {
  draft: "Draft", raised: "Awaiting CEO", ceo_approved: "Awaiting Release", released: "Released", rejected: "Rejected",
};

type StageState = "done" | "current" | "rejected" | "upcoming";
type Stage = { key: string; label: string; state: StageState; who: string | null; at: string | null; note: string | null };

/** Stage state derived purely from the voucher's own columns — same principle as
 *  BudgetTopupPanel's buildApprovalStages, extended from two stages to three. */
function buildStages(v: Voucher): Stage[] {
  const rejected = v.status === "rejected";
  return [
    { key: "raised", label: "Raised", state: "done", who: v.raised_by, at: v.raised_at, note: null },
    {
      key: "ceo",
      label: "CEO Approval",
      state: rejected ? "rejected" : v.ceo_approved_at ? "done" : v.status === "raised" ? "current" : "upcoming",
      who: v.ceo_approved_by, at: v.ceo_approved_at, note: rejected ? v.rejection_reason : null,
    },
    {
      key: "release",
      label: "Release",
      state: v.released_at ? "done" : rejected ? "upcoming" : v.status === "ceo_approved" ? "current" : "upcoming",
      who: v.released_by, at: v.released_at, note: null,
    },
  ];
}
const STAGE_BAR: Record<StageState, string> = { done: "bg-emerald-500", current: "bg-amber-400", rejected: "bg-rose-500", upcoming: "bg-slate-200" };
const STAGE_TEXT: Record<StageState, string> = { done: "text-emerald-700", current: "text-amber-700", rejected: "text-rose-700", upcoming: "text-slate-400" };
function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />;
  if (state === "rejected") return <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden />;
  if (state === "current") return <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />;
}
function ApprovalTrack({ stages }: { stages: Stage[] }) {
  return (
    <ol className="flex items-stretch gap-2" aria-label="Voucher approval progress">
      {stages.map((s) => (
        <li key={s.key} className="min-w-0 flex-1">
          <div className={cn("h-1 rounded-full transition-colors duration-200", STAGE_BAR[s.state])} />
          <div className="mt-1.5 flex items-center gap-1">
            <StageIcon state={s.state} />
            <span className={cn("truncate text-[10px] font-bold uppercase tracking-wide", STAGE_TEXT[s.state])}>{s.label}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] leading-tight text-slate-500">
            {s.state === "upcoming" ? "Not yet reached" : s.state === "current" ? "Awaiting decision" : (dateTime(s.at) !== "—" ? dateTime(s.at) : (s.state === "rejected" ? "Rejected" : "Done"))}
          </p>
        </li>
      ))}
    </ol>
  );
}

const emptyRaiseForm = {
  sourceType: "vendor_grn" as "vendor_grn" | "imprest_allocation",
  bankAccountId: "",
  payableAccountId: "",
  linkedVendorPaymentId: "",
  linkedImprestManagerId: "",
  amount: "",
  remarks: "",
  reason: "",
};

export default function PaymentVouchersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canRaise = useHasRole("finance_head", "super_admin");
  const canApprove = useHasRole("ceo", "super_admin");
  const canRelease = useHasRole("accounts_head", "super_admin");

  const [tab, setTab] = useState<"all" | "raised" | "ceo_approved" | "released" | "rejected">("all");
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseForm, setRaiseForm] = useState(emptyRaiseForm);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [releaseForm, setReleaseForm] = useState({ paymentMode: "", paymentDate: new Date().toISOString().slice(0, 10), transactionRef: "" });

  const vouchersQuery = useQuery({
    queryKey: ["payment-vouchers", tab],
    queryFn: async () => {
      const qs = tab === "all" ? "" : `?status=${tab}`;
      const res = await hrmsApi.get<{ success: boolean; data: Voucher[] }>(`/api/finance/payment-vouchers${qs}`);
      return res.data ?? [];
    },
  });

  const bankAccountsQuery = useQuery({
    queryKey: ["payment-voucher-bank-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/bank-accounts")).data ?? [],
    enabled: raiseOpen,
  });
  const payableAccountsQuery = useQuery({
    queryKey: ["payment-voucher-payable-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/payable-accounts")).data ?? [],
    enabled: raiseOpen,
  });
  const vendorDuesQuery = useQuery({
    queryKey: ["payment-voucher-vendor-dues"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { rows: any[] } }>("/api/finance/vendor-payments?limit=200");
      return (res.data?.rows ?? []).filter((r: any) => Number(r.balance_amount) > 0);
    },
    enabled: raiseOpen && raiseForm.sourceType === "vendor_grn",
  });
  const imprestManagersQuery = useQuery({
    queryKey: ["payment-voucher-imprest-managers"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/imprest/managers")).data ?? [],
    enabled: raiseOpen && raiseForm.sourceType === "imprest_allocation",
  });
  // "% of sanctioned float" auto-flag (PRD §10) — badges the managers who are actually low, so
  // Finance doesn't have to check each one's balance by hand before deciding who to top up.
  const replenishmentFlagsQuery = useQuery({
    queryKey: ["payment-voucher-replenishment-flags"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/imprest/replenishment-flags")).data ?? [],
    enabled: raiseOpen && raiseForm.sourceType === "imprest_allocation",
  });
  const flaggedManagerIds = new Set((replenishmentFlagsQuery.data ?? []).map((f: any) => f.id));

  const detailQuery = useQuery({
    queryKey: ["payment-voucher-detail", detailId],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: Voucher }>(`/api/finance/payment-vouchers/${detailId}`)).data,
    enabled: !!detailId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
    queryClient.invalidateQueries({ queryKey: ["payment-voucher-detail"] });
  };

  const raiseMutation = useMutation({
    mutationFn: async () => (await hrmsApi.post("/api/finance/payment-vouchers", {
      sourceType: raiseForm.sourceType,
      bankAccountId: raiseForm.bankAccountId,
      payableAccountId: raiseForm.payableAccountId,
      linkedVendorPaymentId: raiseForm.sourceType === "vendor_grn" ? raiseForm.linkedVendorPaymentId : undefined,
      linkedImprestManagerId: raiseForm.sourceType === "imprest_allocation" ? raiseForm.linkedImprestManagerId : undefined,
      amount: Number(raiseForm.amount),
      remarks: raiseForm.remarks?.trim() || undefined,
      reason: raiseForm.reason?.trim() || undefined,
    })).data,
    onSuccess: () => {
      toast({ title: "Voucher raised" });
      invalidate();
      setRaiseOpen(false);
      setRaiseForm(emptyRaiseForm);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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
  const releaseMutation = useMutation({
    mutationFn: async (id: string) => (await hrmsApi.post(`/api/finance/payment-vouchers/${id}/release`, {
      paymentMode: releaseForm.paymentMode,
      paymentDate: releaseForm.paymentDate,
      transactionRef: releaseForm.transactionRef?.trim() || undefined,
    })).data,
    onSuccess: () => { toast({ title: "Voucher released" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const vouchers = vouchersQuery.data ?? [];
  const selectedDue = useMemo(
    () => (vendorDuesQuery.data ?? []).find((r: any) => r.id === raiseForm.linkedVendorPaymentId),
    [vendorDuesQuery.data, raiseForm.linkedVendorPaymentId],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <IndianRupee className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-bold">Payment Vouchers</h1>
              <p className="text-sm text-blue-100">Raise → CEO Approve → Release — three people, three actions, one bank ledger.</p>
            </div>
          </div>
          {canRaise && (
            <Button className="cursor-pointer bg-white text-blue-700 hover:bg-blue-50" onClick={() => { setRaiseForm(emptyRaiseForm); setRaiseOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" /> Raise Voucher
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="all" className="cursor-pointer">All</TabsTrigger>
          <TabsTrigger value="raised" className="cursor-pointer">Awaiting CEO</TabsTrigger>
          <TabsTrigger value="ceo_approved" className="cursor-pointer">Awaiting Release</TabsTrigger>
          <TabsTrigger value="released" className="cursor-pointer">Released</TabsTrigger>
          <TabsTrigger value="rejected" className="cursor-pointer">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
                  <tr>
                    <th className="px-4 py-2.5">Voucher No.</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Bank Account</th>
                    <th className="px-4 py-2.5">Purpose</th>
                    <th className="px-4 py-2.5">Amount</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-100">
                  {vouchersQuery.isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
                  {!vouchersQuery.isLoading && vouchers.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No vouchers here</td></tr>}
                  {vouchers.map((v) => (
                    <tr key={v.id} className="cursor-pointer transition-colors duration-150 hover:bg-blue-50/50" onClick={() => setDetailId(v.id)}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{v.voucher_number}</td>
                      <td className="px-4 py-2.5 text-gray-600">{v.source_type === "vendor_grn" ? "Vendor GRN" : "Imprest Top-up"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{v.bank_account_name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{v.source_type === "vendor_grn" ? (v.vendor_name ?? v.grn_number ?? "—") : (v.imprest_manager_name ?? "—")}</td>
                      <td className="px-4 py-2.5 font-semibold text-gray-800">{money(v.amount)}</td>
                      <td className="px-4 py-2.5"><Badge className={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Raise form */}
      <Dialog open={raiseOpen} onOpenChange={setRaiseOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Raise Payment Voucher</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Purpose</Label>
              <Select value={raiseForm.sourceType} onValueChange={(v) => setRaiseForm((f) => ({ ...f, sourceType: v as any, linkedVendorPaymentId: "", linkedImprestManagerId: "", amount: "" }))}>
                <SelectTrigger className="cursor-pointer"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor_grn">Vendor GRN Payment</SelectItem>
                  <SelectItem value="imprest_allocation">Imprest Float Replenishment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {raiseForm.sourceType === "vendor_grn" ? (
              <div>
                <Label>Vendor GRN (net balance shown)</Label>
                <Select
                  value={raiseForm.linkedVendorPaymentId}
                  onValueChange={(v) => {
                    const row = (vendorDuesQuery.data ?? []).find((r: any) => r.id === v);
                    const netBalance = row ? Number(row.balance_amount) - Number(row.tds_deducted_amount ?? 0) : 0;
                    setRaiseForm((f) => ({ ...f, linkedVendorPaymentId: v, amount: netBalance > 0 ? String(netBalance) : f.amount }));
                  }}
                >
                  <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select GRN" /></SelectTrigger>
                  <SelectContent>
                    {(vendorDuesQuery.data ?? []).map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.grn_number ?? r.id} — {r.vendor_name} — {money(r.balance_amount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedDue && (
                  <p className="mt-1 text-xs text-slate-500">
                    Due {money(selectedDue.balance_amount)} · TDS {money(selectedDue.tds_deducted_amount ?? 0)} · Suggested net {money(Number(selectedDue.balance_amount) - Number(selectedDue.tds_deducted_amount ?? 0))}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label>Imprest Manager</Label>
                <Select value={raiseForm.linkedImprestManagerId} onValueChange={(v) => setRaiseForm((f) => ({ ...f, linkedImprestManagerId: v }))}>
                  <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select imprest manager" /></SelectTrigger>
                  <SelectContent>
                    {(imprestManagersQuery.data ?? []).map((m: any) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span className="inline-flex items-center gap-1.5">
                          {flaggedManagerIds.has(m.id) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />}
                          {m.tally_name ?? m.employee_name ?? m.id} — {m.branch_name}
                          {flaggedManagerIds.has(m.id) && <span className="text-[10px] font-bold uppercase text-rose-600">Needs Replenishment</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Bank Account (paying)</Label>
              <Select value={raiseForm.bankAccountId} onValueChange={(v) => setRaiseForm((f) => ({ ...f, bankAccountId: v }))}>
                <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select bank account" /></SelectTrigger>
                <SelectContent>
                  {(bankAccountsQuery.data ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name} — {a.account_number_masked}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payable Account (ledger head)</Label>
              <Select value={raiseForm.payableAccountId} onValueChange={(v) => setRaiseForm((f) => ({ ...f, payableAccountId: v }))}>
                <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select ledger head" /></SelectTrigger>
                <SelectContent>
                  {(payableAccountsQuery.data ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (net payable)</Label>
              <Input type="number" value={raiseForm.amount} onChange={(e) => setRaiseForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea value={raiseForm.remarks} onChange={(e) => setRaiseForm((f) => ({ ...f, remarks: e.target.value }))} rows={2} />
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea value={raiseForm.reason} onChange={(e) => setRaiseForm((f) => ({ ...f, reason: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setRaiseOpen(false)}>Cancel</Button>
            <Button className="cursor-pointer bg-blue-600 hover:bg-blue-700" disabled={raiseMutation.isPending} onClick={() => raiseMutation.mutate()}>
              Raise Voucher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drill-down drawer */}
      <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
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
                    <dd className="font-semibold text-gray-800">{detailQuery.data.source_type === "vendor_grn" ? (detailQuery.data.vendor_name ?? detailQuery.data.grn_number) : detailQuery.data.imprest_manager_name}</dd>
                    <dt className="text-slate-500">Bank Account</dt><dd className="font-semibold text-gray-800">{detailQuery.data.bank_account_name}</dd>
                    <dt className="text-slate-500">Ledger Head</dt><dd className="font-semibold text-gray-800">{detailQuery.data.payable_account_name}</dd>
                    <dt className="text-slate-500">Amount</dt><dd className="font-semibold text-gray-800">{money(detailQuery.data.amount)}</dd>
                    <dt className="text-slate-500">Remarks</dt><dd className="text-gray-600">{detailQuery.data.remarks ?? "—"}</dd>
                    <dt className="text-slate-500">Reason</dt><dd className="text-gray-600">{detailQuery.data.reason ?? "—"}</dd>
                    {detailQuery.data.status === "released" && (
                      <>
                        <dt className="text-slate-500">Payment Mode</dt><dd className="text-gray-600">{detailQuery.data.payment_mode}</dd>
                        <dt className="text-slate-500">Payment Date</dt><dd className="text-gray-600">{detailQuery.data.payment_date}</dd>
                        <dt className="text-slate-500">Reference</dt><dd className="font-mono text-gray-600">{detailQuery.data.transaction_ref ?? "—"}</dd>
                      </>
                    )}
                    {detailQuery.data.status === "rejected" && (
                      <><dt className="text-slate-500">Rejection Reason</dt><dd className="text-rose-600">{detailQuery.data.rejection_reason}</dd></>
                    )}
                  </dl>
                </section>

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
                    <Textarea placeholder="Rejection reason (if rejecting)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2} />
                    <Button variant="outline" className="cursor-pointer border-rose-200 text-rose-700 hover:bg-rose-50" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate(detailQuery.data!.id)}>
                      Reject
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
                      <Label>Transaction Ref / UTR / Cheque No.</Label>
                      <Input value={releaseForm.transactionRef} onChange={(e) => setReleaseForm((f) => ({ ...f, transactionRef: e.target.value }))} />
                    </div>
                    <Button className="cursor-pointer bg-emerald-600 hover:bg-emerald-700" disabled={releaseMutation.isPending} onClick={() => releaseMutation.mutate(detailQuery.data!.id)}>
                      Release Payment
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
    </div>
  );
}
