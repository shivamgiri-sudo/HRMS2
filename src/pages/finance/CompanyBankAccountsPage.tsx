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
  /** The "as of" date this opening balance is true on — the real bank statement/passbook
   *  figure for a date you're confident about, not the account's creation date. This is what
   *  makes an opening balance entered today stand in for months of transaction history that
   *  never made it into HRMS: everything from this date forward is tracked by the system's
   *  own ledger, so nothing earlier needs to be reconstructed. */
  openingBalanceAsOf: new Date().toISOString().slice(0, 10),
};

export default function CompanyBankAccountsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<string | null>(null);

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
      return { account: account.data, audit, auditError };
    },
    enabled: !!detailId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        bankId: form.bankId,
        accountName: form.accountName.trim(),
        accountNumber: form.accountNumber?.trim() || undefined,
        ifscCode: form.ifscCode.trim(),
        branchId: form.branchId,
        tallyLedgerName: form.tallyLedgerName.trim(),
        openingBalance: Number(form.openingBalance || 0),
        openingBalanceAsOf: form.openingBalanceAsOf || undefined,
      };
      if (form.id) {
        return (await hrmsApi.put(`/api/finance/bank-accounts/${form.id}`, payload)).data;
      }
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
            {!!form.id && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Changing Opening Balance here only takes effect if this account has never had a
                Payment Voucher released against it. Once any payment has gone through, the
                running balance in Bank Ledger continues from that payment, not from this field —
                editing it will not correct an in-use account.
              </div>
            )}
            <div>
              <Label>Opening Balance</Label>
              <Input type="number" value={form.openingBalance} onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))} />
            </div>
            <div>
              <Label>Opening Balance As Of</Label>
              <Input type="date" value={form.openingBalanceAsOf} onChange={(e) => setForm((f) => ({ ...f, openingBalanceAsOf: e.target.value }))} />
              <p className="mt-1 text-xs text-slate-400">
                The real bank statement figure on this date. Every payment made through HRMS after
                this date is tracked automatically — earlier months don't need to be entered.
              </p>
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
                    <dt className="text-slate-500">As Of</dt>
                    <dd className="text-gray-600">
                      {detailQuery.data.account.opening_balance_as_of
                        ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(detailQuery.data.account.opening_balance_as_of))
                        : <span className="text-amber-600">Not set</span>}
                    </dd>
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
                          // Falls back to today rather than "" — editing an account that already
                          // has transactions can't actually move the running balance (see the
                          // date field's own note below), so there's no live number to preserve
                          // here; a blank date field would just read as a bug.
                          openingBalanceAsOf: a.opening_balance_as_of ?? new Date().toISOString().slice(0, 10),
                        });
                        setDetailId(null);
                        setFormOpen(true);
                      }}
                    >
                      Edit
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
