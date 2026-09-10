// src/pages/finance/PaymentVouchersPage.tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IndianRupee, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useHasRole } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
// Voucher vocabulary, formatters and the drill-down drawer now live outside this page so the
// Vendor Payment Dispatch page renders the identical thing for the identical voucher.
import { STATUS_LABEL, STATUS_TONE, money, type Voucher } from "@/lib/finance/paymentVoucherStatus";
import { PaymentVoucherDrawer } from "@/components/finance/vendor/PaymentVoucherDrawer";


const emptyRaiseForm = {
  sourceType: "vendor_grn" as "vendor_grn" | "imprest_allocation",
  vendorId: "",
  bankAccountId: "",
  payableAccountId: "",
  /** GRN id -> allocated amount (as a string, mirroring the Amount input pattern). Supports
   *  paying several outstanding GRNs of the same vendor with one voucher. */
  grnAllocations: {} as Record<string, string>,
  linkedImprestManagerId: "",
  particulars: "",
  amount: "",
  remarks: "",
};

export default function PaymentVouchersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Role model (2026-09-10): Finance Head both raises and releases — CEO approval is the one
  // blocking gate between the two. Accounts Head no longer releases; they review afterward.
  const canRaise = useHasRole("finance_head", "super_admin");

  const [tab, setTab] = useState<"all" | "raised" | "ceo_approved" | "released" | "rejected" | "changes_requested">("all");
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseForm, setRaiseForm] = useState(emptyRaiseForm);
  const [detailId, setDetailId] = useState<string | null>(null);

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
    enabled: raiseOpen || !!detailId,
  });
  const payableAccountsQuery = useQuery({
    queryKey: ["payment-voucher-payable-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/payable-accounts")).data ?? [],
    enabled: raiseOpen,
  });
  const vendorDuesQuery = useQuery({
    queryKey: ["payment-voucher-vendor-dues"],
    queryFn: async () => {
      // Server-side outstandingOnly=1 is required, not just belt-and-suspenders: without it,
      // ORDER BY due_date ASC + LIMIT 200 can return 200 already-settled legacy rows and zero
      // real dues whenever 200+ older rows are marked Paid, which is exactly what happened here.
      const res = await hrmsApi.get<{ success: boolean; rows: any[] }>(
        "/api/finance/vendor-payments?limit=200&outstandingOnly=1",
      );
      return (res.rows ?? []).filter((r: any) => Number(r.balance_amount) > 0);
    },
    enabled: raiseOpen && raiseForm.sourceType === "vendor_grn",
  });
  const vendorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of vendorDuesQuery.data ?? []) {
      if (row.vendor_id && !seen.has(row.vendor_id)) seen.set(row.vendor_id, row.vendor_name ?? row.vendor_id);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [vendorDuesQuery.data]);
  const filteredDues = useMemo(
    () => (vendorDuesQuery.data ?? []).filter((r: any) => !raiseForm.vendorId || r.vendor_id === raiseForm.vendorId),
    [vendorDuesQuery.data, raiseForm.vendorId],
  );
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
    queryClient.invalidateQueries({ queryKey: ["payment-voucher-detail"] });
  };

  const raiseMutation = useMutation({
    mutationFn: async () => (await hrmsApi.post("/api/finance/payment-vouchers", {
      sourceType: raiseForm.sourceType,
      bankAccountId: raiseForm.bankAccountId,
      payableAccountId: raiseForm.payableAccountId,
      grnAllocations: raiseForm.sourceType === "vendor_grn"
        ? Object.entries(raiseForm.grnAllocations)
            .filter(([, amt]) => Number(amt) > 0)
            .map(([vendorPaymentTrackingId, amt]) => ({ vendorPaymentTrackingId, amount: Number(amt) }))
        : undefined,
      linkedImprestManagerId: raiseForm.sourceType === "imprest_allocation" ? raiseForm.linkedImprestManagerId : undefined,
      particulars: raiseForm.sourceType === "general" ? raiseForm.particulars.trim() : undefined,
      amount: Number(raiseForm.amount),
      remarks: raiseForm.remarks?.trim() || undefined,
    })).data,
    onSuccess: () => {
      toast({ title: "Voucher raised" });
      invalidate();
      setRaiseOpen(false);
      setRaiseForm(emptyRaiseForm);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const vouchers = vouchersQuery.data ?? [];
  // Every GRN the finance head has ticked for this voucher — drives the checklist, the running
  // total, and (via its head/sub_head) the auto-populated ledger classification below.
  const selectedGrnIds = useMemo(
    () => Object.keys(raiseForm.grnAllocations).filter((id) => Number(raiseForm.grnAllocations[id]) > 0),
    [raiseForm.grnAllocations],
  );
  const selectedGrnRows = useMemo(
    () => selectedGrnIds.map((id) => filteredDues.find((r: any) => r.id === id)).filter(Boolean) as any[],
    [selectedGrnIds, filteredDues],
  );
  const allocatedTotal = useMemo(
    () => selectedGrnIds.reduce((sum, id) => sum + (Number(raiseForm.grnAllocations[id]) || 0), 0),
    [selectedGrnIds, raiseForm.grnAllocations],
  );
  /** All selected GRNs of one vendor carry the same head/sub_head in practice (they share a
   *  vendor_id, and this table's head/sub_head is a per-vendor classification) — shown from the
   *  first selection so Finance Head sees it without opening each row. */
  const primaryGrn = selectedGrnRows[0];

  return (
    <DashboardLayout>
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
          <TabsTrigger value="changes_requested" className="cursor-pointer">Changes Requested</TabsTrigger>
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
                      <td className="px-4 py-2.5 text-gray-600">{v.source_type === "vendor_grn" ? "Vendor GRN" : v.source_type === "imprest_allocation" ? "Imprest Top-up" : "General"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{v.bank_account_name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{v.source_type === "vendor_grn" ? (v.vendor_name ?? v.grn_number ?? "—") : v.source_type === "imprest_allocation" ? (v.imprest_manager_name ?? "—") : (v.particulars ?? "—")}</td>
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
              <Select value={raiseForm.sourceType} onValueChange={(v) => setRaiseForm((f) => ({ ...f, sourceType: v as any, grnAllocations: {}, linkedImprestManagerId: "", particulars: "", amount: "" }))}>
                <SelectTrigger className="cursor-pointer"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor_grn">Vendor GRN Payment</SelectItem>
                  <SelectItem value="imprest_allocation">Imprest Float Replenishment</SelectItem>
                  <SelectItem value="general">Other / General Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {raiseForm.sourceType === "vendor_grn" ? (
              <div className="space-y-3">
                <div>
                  <Label>Vendor</Label>
                  <Select value={raiseForm.vendorId} onValueChange={(v) => setRaiseForm((f) => ({ ...f, vendorId: v, grnAllocations: {}, amount: "" }))}>
                    <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                    <SelectContent>
                      {vendorOptions.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {primaryGrn && (
                  <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Budget classification on the GRN — not the ledger account below
                    </p>
                    <div className="grid grid-cols-2 gap-y-1">
                      <span className="text-slate-500">Head</span><span className="font-semibold text-gray-800">{primaryGrn.head ?? "—"}</span>
                      <span className="text-slate-500">Sub Head</span><span className="font-semibold text-gray-800">{primaryGrn.sub_head ?? "—"}</span>
                    </div>
                  </div>
                )}

                <div>
                  <Label>Outstanding GRNs — tick one or more (same vendor, net balance shown)</Label>
                  {!raiseForm.vendorId ? (
                    <p className="mt-1 text-xs text-slate-400">Select a vendor first</p>
                  ) : filteredDues.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">No outstanding GRNs for this vendor</p>
                  ) : (
                    <ul className="mt-1 max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 p-2">
                      {filteredDues.map((r: any) => {
                        const checked = r.id in raiseForm.grnAllocations;
                        const netBalance = Math.max(0, Number(r.balance_amount) - Number(r.tds_deducted_amount ?? 0));
                        return (
                          <li key={r.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => setRaiseForm((f) => {
                                const next = { ...f.grnAllocations };
                                if (v) next[r.id] = String(netBalance > 0 ? netBalance : 0);
                                else delete next[r.id];
                                const total = Object.values(next).reduce((s, a) => s + (Number(a) || 0), 0);
                                return { ...f, grnAllocations: next, amount: total > 0 ? String(total) : "" };
                              })}
                            />
                            <span className="min-w-0 flex-1 truncate text-xs text-gray-700">
                              {r.grn_number ?? r.id} — Due {money(r.balance_amount)} · TDS {money(r.tds_deducted_amount ?? 0)}
                            </span>
                            {checked && (
                              <Input
                                type="number"
                                className="h-7 w-28 text-xs"
                                value={raiseForm.grnAllocations[r.id]}
                                onChange={(e) => setRaiseForm((f) => {
                                  const next = { ...f.grnAllocations, [r.id]: e.target.value };
                                  const total = Object.values(next).reduce((s, a) => s + (Number(a) || 0), 0);
                                  return { ...f, grnAllocations: next, amount: total > 0 ? String(total) : "" };
                                })}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {selectedGrnIds.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedGrnIds.length} GRN{selectedGrnIds.length > 1 ? "s" : ""} selected · Allocated total {money(allocatedTotal)}
                    </p>
                  )}
                </div>
              </div>
            ) : raiseForm.sourceType === "imprest_allocation" ? (
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
            ) : (
              <div>
                <Label>Particulars (what this payment is for)</Label>
                <Input
                  placeholder="e.g. March statutory PF challan, Bank charges Q2"
                  value={raiseForm.particulars}
                  onChange={(e) => setRaiseForm((f) => ({ ...f, particulars: e.target.value }))}
                />
                <p className="mt-1 text-xs text-slate-500">For anything with no vendor GRN or imprest manager behind it — the Payable Account below is the category (Salary Payable, Statutory Dues, Bank Charges, TDS Payable, Other).</p>
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
              <Label>Payable Account (bank ledger — Vendor Payables, TDS Payable, etc.)</Label>
              <Select value={raiseForm.payableAccountId} onValueChange={(v) => setRaiseForm((f) => ({ ...f, payableAccountId: v }))}>
                <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select ledger account" /></SelectTrigger>
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
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setRaiseOpen(false)}>Cancel</Button>
            <Button className="cursor-pointer bg-blue-600 hover:bg-blue-700" disabled={raiseMutation.isPending} onClick={() => raiseMutation.mutate()}>
              Raise Voucher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drill-down drawer — the same component the Vendor Payment Dispatch page opens, so a
          voucher looks and behaves identically whichever page you reached it from. */}
      <PaymentVoucherDrawer
        voucherId={detailId}
        open={!!detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
      />
    </div>
    </DashboardLayout>
  );
}
