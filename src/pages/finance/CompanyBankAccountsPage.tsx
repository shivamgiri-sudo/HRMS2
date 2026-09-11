// src/pages/finance/CompanyBankAccountsPage.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Plus, ShieldCheck, XCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type BankAccount = {
  id: string;
  bank_id: string;
  bank_name: string | null;
  account_name: string;
  account_number_masked: string | null;
  ifsc_code: string;
  branch_id: string;
  branch_name: string | null;
  tally_ledger_name: string;
  opening_balance: number;
  opening_balance_as_of: string | null;
  active_status: boolean;
  closed_date: string | null;
  created_at: string;
  updated_at: string;
};

type BalanceChangeRequest = {
  id: string;
  bank_account_id: string;
  current_value: number;
  requested_value: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_remarks: string | null;
};

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

const emptyForm = {
  id: "",
  bankId: "",
  accountName: "",
  accountNumber: "",
  ifscCode: "",
  branchId: "",
  tallyLedgerName: "",
  openingBalance: "0",
};

export default function CompanyBankAccountsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [balanceRequestOpen, setBalanceRequestOpen] = useState(false);
  const [balanceRequestValue, setBalanceRequestValue] = useState("");
  const [balanceRequestReason, setBalanceRequestReason] = useState("");
  const [decisionRemarks, setDecisionRemarks] = useState<Record<string, string>>({});

  const accountsQuery = useQuery({
    queryKey: ["company-bank-accounts"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: BankAccount[] }>("/api/finance/bank-accounts?includeInactive=1");
      return res.data ?? [];
    },
  });
  const banksQuery = useQuery({
    queryKey: ["company-bank-accounts-banks"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: Array<{ id: string; bank_name: string }> }>(
        "/api/finance/bank-accounts/banks",
      );
      return res.data ?? [];
    },
    enabled: formOpen,
  });
  const branchesQuery = useQuery({
    queryKey: ["org-branches-for-bank-accounts"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: Array<{ id: string; branch_name: string }> }>("/api/org/branches");
      return res.data ?? [];
    },
    enabled: formOpen,
  });

  const detailQuery = useQuery({
    queryKey: ["company-bank-account-detail", detailId],
    queryFn: async () => {
      // Fetched separately (not Promise.all) on purpose: a failure in the audit-trail
      // call must never blank out the account details the user actually clicked for.
      const account = await hrmsApi.get<{ success: boolean; data: BankAccount }>(`/api/finance/bank-accounts/${detailId}`);
      let audit: any[] = [];
      let auditError: string | null = null;
      try {
        const auditRes = await hrmsApi.get<{ success: boolean; data: any[] }>(`/api/finance/bank-accounts/${detailId}/audit`);
        audit = auditRes.data ?? [];
      } catch (e) {
        auditError = e instanceof Error ? e.message : "Failed to load audit trail";
      }
      let balanceRequests: BalanceChangeRequest[] = [];
      let balanceRequestsError: string | null = null;
      try {
        const res = await hrmsApi.get<{ success: boolean; data: BalanceChangeRequest[] }>(
          `/api/finance/bank-accounts/${detailId}/balance-change-requests`,
        );
        balanceRequests = res.data ?? [];
      } catch (e) {
        balanceRequestsError = e instanceof Error ? e.message : "Failed to load balance change requests";
      }
      return { account: account.data, audit, auditError, balanceRequests, balanceRequestsError };
    },
    enabled: !!detailId,
  });

  const requestBalanceChangeMutation = useMutation({
    mutationFn: async () => {
      if (!detailId) throw new Error("No account selected");
      return (await hrmsApi.post(`/api/finance/bank-accounts/${detailId}/balance-change-requests`, {
        requestedValue: Number(balanceRequestValue || 0),
        reason: balanceRequestReason.trim(),
      })).data;
    },
    onSuccess: () => {
      toast({ title: "Balance change requested — awaiting a second approver" });
      queryClient.invalidateQueries({ queryKey: ["company-bank-account-detail", detailId] });
      setBalanceRequestOpen(false);
      setBalanceRequestValue("");
      setBalanceRequestReason("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const decideBalanceChangeMutation = useMutation({
    mutationFn: async ({ requestId, decision }: { requestId: string; decision: "approve" | "reject" }) =>
      (await hrmsApi.post(`/api/finance/bank-accounts/balance-change-requests/${requestId}/${decision}`, {
        remarks: decisionRemarks[requestId] ?? "",
      })).data,
    onSuccess: (_data, vars) => {
      toast({ title: vars.decision === "approve" ? "Balance change approved" : "Balance change rejected" });
      queryClient.invalidateQueries({ queryKey: ["company-bank-account-detail", detailId] });
      queryClient.invalidateQueries({ queryKey: ["company-bank-accounts"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (form.id) {
        // Opening balance is intentionally excluded here — it cannot be changed via this
        // edit form. See the "Request Balance Change" flow in the drawer, which requires
        // a second, different approver before the value actually moves.
        const payload = {
          bankId: form.bankId,
          accountName: form.accountName.trim(),
          accountNumber: form.accountNumber?.trim() || undefined,
          ifscCode: form.ifscCode.trim(),
          branchId: form.branchId,
          tallyLedgerName: form.tallyLedgerName.trim(),
        };
        return (await hrmsApi.put(`/api/finance/bank-accounts/${form.id}`, payload)).data;
      }
      const payload = {
        bankId: form.bankId,
        accountName: form.accountName.trim(),
        accountNumber: form.accountNumber?.trim() || undefined,
        ifscCode: form.ifscCode.trim(),
        branchId: form.branchId,
        tallyLedgerName: form.tallyLedgerName.trim(),
        openingBalance: Number(form.openingBalance || 0),
      };
      return (await hrmsApi.post("/api/finance/bank-accounts", payload)).data;
    },
    onSuccess: () => {
      toast({ title: form.id ? "Bank account updated" : "Bank account created" });
      queryClient.invalidateQueries({ queryKey: ["company-bank-accounts"] });
      setFormOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await hrmsApi.post(`/api/finance/bank-accounts/${id}/${active ? "reactivate" : "close"}`, {})).data,
    onSuccess: () => {
      toast({ title: "Status updated" });
      queryClient.invalidateQueries({ queryKey: ["company-bank-accounts"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const accounts = accountsQuery.data ?? [];

  return (
    <DashboardLayout>
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Landmark className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-bold">Company Bank Accounts</h1>
              <p className="text-sm text-blue-100">
                The company's own paying/receiving accounts — the base the Payment Voucher chain and the Bank Ledger are built on.
              </p>
            </div>
          </div>
          <Button
            className="cursor-pointer bg-white text-blue-700 hover:bg-blue-50"
            onClick={() => { setForm(emptyForm); setFormOpen(true); }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New Bank Account
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
              <tr>
                <th className="px-4 py-2.5">Account</th>
                <th className="px-4 py-2.5">Bank</th>
                <th className="px-4 py-2.5">Branch</th>
                <th className="px-4 py-2.5">Account No.</th>
                <th className="px-4 py-2.5">Tally Ledger</th>
                <th className="px-4 py-2.5">Opening Balance</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-100">
              {accountsQuery.isLoading && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
              )}
              {!accountsQuery.isLoading && accounts.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No bank accounts yet</td></tr>
              )}
              {accounts.map((a) => (
                <tr
                  key={a.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-blue-50/50"
                  onClick={() => setDetailId(a.id)}
                >
                  <td className="px-4 py-2.5 font-semibold text-gray-800">{a.account_name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{a.bank_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{a.branch_name ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-600">{a.account_number_masked ?? "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{a.tally_ledger_name}</td>
                  <td className="px-4 py-2.5 font-semibold text-gray-800">{money(a.opening_balance)}</td>
                  <td className="px-4 py-2.5">
                    {a.active_status ? (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Active</Badge>
                    ) : (
                      <Badge className="border-rose-200 bg-rose-50 text-rose-700">Closed</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Bank Account" : "New Bank Account"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Bank</Label>
              <Select value={form.bankId} onValueChange={(v) => setForm((f) => ({ ...f, bankId: v }))}>
                <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select bank" /></SelectTrigger>
                <SelectContent>
                  {(banksQuery.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.bank_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Account Name</Label>
              <Input value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} placeholder="e.g. HDFC Current Account — HQ" />
            </div>
            <div>
              <Label>Account Number {form.id && <span className="text-xs text-slate-400">(leave blank to keep unchanged)</span>}</Label>
              <Input value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} placeholder="9–18 digits" />
            </div>
            <div>
              <Label>IFSC Code</Label>
              <Input value={form.ifscCode} onChange={(e) => setForm((f) => ({ ...f, ifscCode: e.target.value.toUpperCase() }))} placeholder="HDFC0001234" maxLength={11} />
            </div>
            <div>
              <Label>Branch</Label>
              <Select value={form.branchId} onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}>
                <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {(branchesQuery.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tally Ledger Name</Label>
              <Input value={form.tallyLedgerName} onChange={(e) => setForm((f) => ({ ...f, tallyLedgerName: e.target.value }))} placeholder="Exact ledger name as it exists in Tally" />
            </div>
            <div>
              <Label>Opening Balance {form.id && <span className="text-xs text-slate-400">(locked — use 'Request Balance Change' in the account drawer)</span>}</Label>
              <Input
                type="number"
                value={form.openingBalance}
                disabled={!!form.id}
                onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              className="cursor-pointer bg-blue-600 hover:bg-blue-700"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {form.id ? "Save Changes" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Opening balance change request — maker-checker, requires a second approver */}
      <Dialog open={balanceRequestOpen} onOpenChange={setBalanceRequestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Opening Balance Change</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-sm text-slate-500">
              Current balance: <span className="font-semibold text-gray-800">{money(detailQuery.data?.account?.opening_balance)}</span>.
              This does not change the balance — it raises a request that a different Finance Head/Accounts Head/Super Admin must approve.
            </p>
            <div>
              <Label>New Opening Balance</Label>
              <Input type="number" value={balanceRequestValue} onChange={(e) => setBalanceRequestValue(e.target.value)} />
            </div>
            <div>
              <Label>Reason (required)</Label>
              <Textarea
                value={balanceRequestReason}
                onChange={(e) => setBalanceRequestReason(e.target.value)}
                placeholder="Why is this changing — e.g. correcting a migration error, reconciled against bank statement dated ..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setBalanceRequestOpen(false)}>Cancel</Button>
            <Button
              className="cursor-pointer bg-amber-600 hover:bg-amber-700"
              disabled={requestBalanceChangeMutation.isPending || !balanceRequestReason.trim()}
              onClick={() => requestBalanceChangeMutation.mutate()}
            >
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Drill-down drawer — mandatory per repo drill-down rule */}
      <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm font-semibold">{detailQuery.data?.account?.account_name ?? "Bank Account"}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {detailQuery.isLoading && (
              <p className="text-sm text-slate-400">Loading…</p>
            )}
            {detailQuery.isError && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                Could not load this account: {(detailQuery.error as Error)?.message ?? "Unknown error"}
              </p>
            )}
            {detailQuery.data?.account && (
              <>
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Details</h3>
                  <dl className="grid grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-slate-500">Bank</dt><dd className="font-semibold text-gray-800">{detailQuery.data.account.bank_name ?? "—"}</dd>
                    <dt className="text-slate-500">Branch</dt><dd className="font-semibold text-gray-800">{detailQuery.data.account.branch_name ?? "—"}</dd>
                    <dt className="text-slate-500">Account No.</dt><dd className="font-mono text-gray-800">{detailQuery.data.account.account_number_masked ?? "—"}</dd>
                    <dt className="text-slate-500">IFSC</dt><dd className="font-mono text-gray-800">{detailQuery.data.account.ifsc_code}</dd>
                    <dt className="text-slate-500">Tally Ledger</dt><dd className="font-semibold text-gray-800">{detailQuery.data.account.tally_ledger_name}</dd>
                    <dt className="text-slate-500">Opening Balance</dt><dd className="font-semibold text-gray-800">{money(detailQuery.data.account.opening_balance)}</dd>
                    <dt className="text-slate-500">Created</dt><dd className="text-gray-600">{dateTime(detailQuery.data.account.created_at)}</dd>
                    <dt className="text-slate-500">Updated</dt><dd className="text-gray-600">{dateTime(detailQuery.data.account.updated_at)}</dd>
                  </dl>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Actions</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() => {
                        const a = detailQuery.data!.account;
                        setForm({
                          id: a.id, bankId: a.bank_id, accountName: a.account_name, accountNumber: "",
                          ifscCode: a.ifsc_code, branchId: a.branch_id, tallyLedgerName: a.tally_ledger_name,
                          openingBalance: String(a.opening_balance),
                        });
                        setDetailId(null);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="cursor-pointer border-amber-200 text-amber-700 hover:bg-amber-50"
                      onClick={() => {
                        setBalanceRequestValue(String(detailQuery.data!.account.opening_balance));
                        setBalanceRequestReason("");
                        setBalanceRequestOpen(true);
                      }}
                    >
                      Request Balance Change
                    </Button>
                    {detailQuery.data.account.active_status ? (
                      <Button
                        variant="outline"
                        className="cursor-pointer border-rose-200 text-rose-700 hover:bg-rose-50"
                        onClick={() => toggleActiveMutation.mutate({ id: detailQuery.data!.account.id, active: false })}
                      >
                        <XCircle className="mr-1.5 h-4 w-4" /> Close Account
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="cursor-pointer border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => toggleActiveMutation.mutate({ id: detailQuery.data!.account.id, active: true })}
                      >
                        <ShieldCheck className="mr-1.5 h-4 w-4" /> Reactivate
                      </Button>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                    Opening Balance Change Requests
                  </h3>
                  {detailQuery.data.balanceRequestsError ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Failed to load: {detailQuery.data.balanceRequestsError}
                    </p>
                  ) : detailQuery.data.balanceRequests.length === 0 ? (
                    <p className="text-sm text-slate-400">None</p>
                  ) : (
                    <ul className="space-y-2">
                      {detailQuery.data.balanceRequests.map((r) => (
                        <li key={r.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-gray-800">
                              {money(r.current_value)} → {money(r.requested_value)}
                            </span>
                            {r.status === "pending" && (
                              <Badge className="border-amber-200 bg-amber-50 text-amber-700">Pending</Badge>
                            )}
                            {r.status === "approved" && (
                              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Approved</Badge>
                            )}
                            {r.status === "rejected" && (
                              <Badge className="border-rose-200 bg-rose-50 text-rose-700">Rejected</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-slate-600">Reason: {r.reason}</p>
                          <p className="mt-1 text-slate-400">Requested {dateTime(r.requested_at)}</p>
                          {r.decided_at && (
                            <p className="mt-1 text-slate-400">
                              {r.status === "approved" ? "Approved" : "Rejected"} {dateTime(r.decided_at)}
                              {r.decision_remarks ? ` — ${r.decision_remarks}` : ""}
                            </p>
                          )}
                          {r.status === "pending" && (
                            <div className="mt-2 space-y-1.5">
                              <Textarea
                                className="h-14 text-xs"
                                placeholder="Approval/rejection remarks (optional)"
                                value={decisionRemarks[r.id] ?? ""}
                                onChange={(e) => setDecisionRemarks((d) => ({ ...d, [r.id]: e.target.value }))}
                              />
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  className="cursor-pointer bg-emerald-600 hover:bg-emerald-700"
                                  disabled={decideBalanceChangeMutation.isPending}
                                  onClick={() => decideBalanceChangeMutation.mutate({ requestId: r.id, decision: "approve" })}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="cursor-pointer border-rose-200 text-rose-700 hover:bg-rose-50"
                                  disabled={decideBalanceChangeMutation.isPending}
                                  onClick={() => decideBalanceChangeMutation.mutate({ requestId: r.id, decision: "reject" })}
                                >
                                  Reject
                                </Button>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                Must be approved by someone other than whoever requested it.
                              </p>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Audit Trail</h3>
                  {detailQuery.data.auditError ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Audit trail failed to load: {detailQuery.data.auditError}
                    </p>
                  ) : detailQuery.data.audit.length === 0 ? (
                    <p className="text-sm text-slate-400">None</p>
                  ) : (
                    <ul className="space-y-2">
                      {detailQuery.data.audit.map((entry: any, i: number) => (
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
    </DashboardLayout>
  );
}
