/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Vendor Bank Details — Finance Head / Accounts Head.
 *
 * Vendor payee bank details did not exist in HRMS2 or db_bill before this page; the
 * coordinates lived in Tally. Putting them here also puts the payment-redirection fraud
 * vector here, so the page is built around the control rather than the form:
 *
 *   - Raising a change and approving one are separate tabs, because they are separate
 *     people. The server rejects an approval by the requester; the UI says so up front
 *     rather than letting someone fill a form they cannot complete.
 *   - The full account number is never fetched. Everything shown is last-4 + IFSC.
 *   - The change log is always visible in the drill-down, including rejected and
 *     cancelled attempts.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HrmsModernShell } from '@/components/ui/hrms-modern';
import { Card, CardContent } from '@/components/ui/card';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle, CheckCircle2, Loader2, Landmark, ShieldCheck, XCircle, History,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface Vendor { id: string; vendor_code: string; vendor_name: string }
interface PendingRequest {
  id: string; vendor_id: string; vendor_code: string; vendor_name: string;
  action: 'create' | 'update';
  account_holder_name: string | null;
  account_number_masked: string; ifsc: string;
  bank_name: string | null; branch_name: string | null;
  previous_account_masked: string | null; previous_ifsc: string | null;
  reason: string | null; requested_by: string; requested_by_role: string | null;
  requested_at: string;
}
interface LogRow {
  id: number; action: string;
  old_account_last4: string | null; old_ifsc: string | null;
  new_account_last4: string | null; new_ifsc: string | null;
  actor_email: string | null; actor_role: string | null;
  reason: string | null; ip_address: string | null; created_at: string;
}

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const ACTION_STYLE: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-800 border-blue-300',
  approved: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  rejected: 'bg-red-100 text-red-800 border-red-300',
  cancelled: 'bg-slate-100 text-slate-700 border-slate-300',
  viewed: 'bg-slate-100 text-slate-600 border-slate-300',
};

export default function NativeVendorBankDetails() {
  const qc = useQueryClient();
  const { user } = useAuth() as any;
  const myId = String(user?.id ?? user?.userId ?? '');

  const [vendorId, setVendorId] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [drawerVendor, setDrawerVendor] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ req: PendingRequest; mode: 'approve' | 'reject' } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');

  const [form, setForm] = useState({
    accountNumber: '', confirmAccountNumber: '', ifsc: '',
    accountHolderName: '', bankName: '', branchName: '', reason: '',
  });

  const vendors = useQuery({
    queryKey: ['vendors-lite', vendorSearch],
    queryFn: async () => {
      const r = await hrmsApi.get<any>(`/api/erp/vendors?q=${encodeURIComponent(vendorSearch)}&limit=50&is_active=1`);
      return (r?.data ?? r ?? []) as Vendor[];
    },
  });

  const pending = useQuery({
    queryKey: ['vendor-bank-pending'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/finance/vendor-bank/requests');
      return (r?.data ?? []) as PendingRequest[];
    },
  });

  const active = useQuery({
    queryKey: ['vendor-bank-active', vendorId],
    enabled: !!vendorId,
    queryFn: async () => {
      const r = await hrmsApi.get<any>(`/api/finance/vendors/${vendorId}/bank`);
      return r?.data ?? null;
    },
  });

  const log = useQuery({
    queryKey: ['vendor-bank-log', drawerVendor],
    enabled: !!drawerVendor,
    queryFn: async () => {
      const r = await hrmsApi.get<any>(`/api/finance/vendors/${drawerVendor}/bank/log`);
      return (r?.data ?? []) as LogRow[];
    },
  });

  const raise = useMutation({
    mutationFn: (body: any) => hrmsApi.post(`/api/finance/vendors/${vendorId}/bank/requests`, body),
    onSuccess: () => {
      toast.success('Change raised — it needs a second approver before it takes effect');
      setFormOpen(false);
      setForm({ accountNumber: '', confirmAccountNumber: '', ifsc: '', accountHolderName: '', bankName: '', branchName: '', reason: '' });
      qc.invalidateQueries({ queryKey: ['vendor-bank-pending'] });
      qc.invalidateQueries({ queryKey: ['vendor-bank-active'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? e?.message ?? 'Could not raise the change'),
  });

  const decide = useMutation({
    mutationFn: ({ id, mode, reason }: { id: string; mode: 'approve' | 'reject'; reason: string }) =>
      hrmsApi.post(`/api/finance/vendor-bank/requests/${id}/${mode}`, { reason }),
    onSuccess: (_d, v) => {
      toast.success(v.mode === 'approve' ? 'Approved — the vendor account is now live' : 'Request closed');
      setDecision(null); setDecisionReason('');
      qc.invalidateQueries({ queryKey: ['vendor-bank-pending'] });
      qc.invalidateQueries({ queryKey: ['vendor-bank-active'] });
      qc.invalidateQueries({ queryKey: ['vendor-bank-log'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? e?.message ?? 'Could not record the decision'),
  });

  const accountsMatch =
    form.accountNumber.length > 0 && form.accountNumber === form.confirmAccountNumber;
  const canSubmit = !!vendorId && accountsMatch && /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(form.ifsc);

  return (
    <DashboardLayout>
      <HrmsModernShell
        title="Vendor Bank Details"
        description="Payee accounts — every change needs a second approver"
      >
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            A vendor bank account cannot be changed by one person. Whoever raises a change
            needs a different Finance Head or Accounts Head to approve it. Full account
            numbers are never displayed — only the last four digits and the IFSC.
          </p>
        </div>

        <Tabs defaultValue="maintain">
          <TabsList>
            <TabsTrigger value="maintain">Maintain</TabsTrigger>
            <TabsTrigger value="approvals">
              Approvals {pending.data?.length ? `(${pending.data.length})` : ''}
            </TabsTrigger>
          </TabsList>

          {/* ── Maintain ─────────────────────────────────────────────── */}
          <TabsContent value="maintain" className="space-y-4">
            <Card><CardContent className="p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="vendor-search">Find vendor</Label>
                  <Input
                    id="vendor-search"
                    placeholder="Vendor name or code"
                    value={vendorSearch}
                    onChange={(e) => setVendorSearch(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="vendor-pick">Vendor</Label>
                  <select
                    id="vendor-pick"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                  >
                    <option value="">Select a vendor…</option>
                    {(vendors.data ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.vendor_code} — {v.vendor_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardContent></Card>

            {vendorId && (
              <Card><CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      Current account
                    </p>
                    {active.isLoading ? (
                      <Loader2 className="mt-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : active.data ? (
                      <div className="mt-1 space-y-0.5 text-sm">
                        <p className="font-mono text-base">{active.data.accountNumberMasked}</p>
                        <p className="text-slate-600">
                          {active.data.ifsc}
                          {active.data.bankName ? ` · ${active.data.bankName}` : ''}
                          {active.data.branchName ? ` · ${active.data.branchName}` : ''}
                        </p>
                        <p className="text-xs text-slate-500">
                          {active.data.accountHolderName ?? 'No holder name recorded'} · effective{' '}
                          {fmtDate(active.data.effectiveFrom)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        No bank account on record — payments for this vendor still run through Tally.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setDrawerVendor(vendorId)} className="min-h-[44px]">
                      <History className="mr-1.5 h-4 w-4" aria-hidden="true" /> Change log
                    </Button>
                    <Button onClick={() => setFormOpen(true)} className="min-h-[44px]">
                      <Landmark className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {active.data ? 'Change account' : 'Add account'}
                    </Button>
                  </div>
                </div>
              </CardContent></Card>
            )}
          </TabsContent>

          {/* ── Approvals ────────────────────────────────────────────── */}
          <TabsContent value="approvals">
            <Card><CardContent className="p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Raised by</TableHead>
                    <TableHead>Raised</TableHead>
                    <TableHead className="text-right">Decision</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(pending.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                        Nothing waiting for approval.
                      </TableCell>
                    </TableRow>
                  )}
                  {(pending.data ?? []).map((r) => {
                    const mine = String(r.requested_by) === myId;
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setDrawerVendor(r.vendor_id)}
                      >
                        <TableCell>
                          <p className="font-medium">{r.vendor_name}</p>
                          <p className="text-xs text-slate-500">{r.vendor_code}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.previous_account_masked ?? '—'}
                          {r.previous_ifsc ? <span className="block text-slate-500">{r.previous_ifsc}</span> : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.account_number_masked}
                          <span className="block text-slate-500">{r.ifsc}</span>
                        </TableCell>
                        <TableCell className="text-xs">{r.requested_by_role ?? '—'}</TableCell>
                        <TableCell className="text-xs">{fmtDate(r.requested_at)}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {mine ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-xs text-amber-700">
                                You raised this — someone else must approve
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[36px]"
                                onClick={() => { setDecision({ req: r, mode: 'reject' }); setDecisionReason(''); }}
                              >
                                Cancel it
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                className="min-h-[36px]"
                                onClick={() => { setDecision({ req: r, mode: 'approve' }); setDecisionReason(''); }}
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[36px]"
                                onClick={() => { setDecision({ req: r, mode: 'reject' }); setDecisionReason(''); }}
                              >
                                <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Reject
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>

        {/* ── Raise a change ─────────────────────────────────────────── */}
        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{active.data ? 'Change bank account' : 'Add bank account'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="acc">Account number</Label>
                <Input
                  id="acc" inputMode="numeric" autoComplete="off"
                  value={form.accountNumber}
                  onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="acc2">Re-enter account number</Label>
                <Input
                  id="acc2" inputMode="numeric" autoComplete="off"
                  value={form.confirmAccountNumber}
                  onChange={(e) => setForm({ ...form, confirmAccountNumber: e.target.value })}
                />
                {form.confirmAccountNumber.length > 0 && !accountsMatch && (
                  <p className="mt-1 text-xs text-red-600">The two account numbers do not match.</p>
                )}
              </div>
              <div>
                <Label htmlFor="ifsc">IFSC</Label>
                <Input
                  id="ifsc" value={form.ifsc} maxLength={11}
                  onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="holder">Account holder name</Label>
                  <Input id="holder" value={form.accountHolderName}
                    onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="bank">Bank</Label>
                  <Input id="bank" value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
                </div>
              </div>
              <div>
                <Label htmlFor="reason">Why is this changing?</Label>
                <Textarea id="reason" value={form.reason} rows={2}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFormOpen(false)} className="min-h-[44px]">Cancel</Button>
              <Button
                disabled={!canSubmit || raise.isPending}
                className="min-h-[44px]"
                onClick={() => raise.mutate({
                  accountNumber: form.accountNumber,
                  ifsc: form.ifsc,
                  accountHolderName: form.accountHolderName || null,
                  bankName: form.bankName || null,
                  branchName: form.branchName || null,
                  reason: form.reason || null,
                })}
              >
                {raise.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                Send for approval
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Decision ───────────────────────────────────────────────── */}
        <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {decision?.mode === 'approve' ? 'Approve bank change' : 'Close this request'}
              </DialogTitle>
            </DialogHeader>
            {decision && (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-medium">{decision.req.vendor_name}</span> — payments will move to{' '}
                  <span className="font-mono">{decision.req.account_number_masked}</span> ({decision.req.ifsc}).
                </p>
                <div>
                  <Label htmlFor="dreason">Reason</Label>
                  <Textarea id="dreason" rows={2} value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDecision(null)} className="min-h-[44px]">Back</Button>
              <Button
                disabled={decide.isPending}
                className="min-h-[44px]"
                onClick={() => decision && decide.mutate({
                  id: decision.req.id, mode: decision.mode, reason: decisionReason,
                })}
              >
                {decide.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Drill-down: the change log ─────────────────────────────── */}
        <Sheet open={!!drawerVendor} onOpenChange={(o) => !o && setDrawerVendor(null)}>
          <SheetContent className="w-full max-w-2xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Bank change history</SheetTitle>
            </SheetHeader>
            <p className="mt-1 text-xs text-slate-500">
              Every attempt is recorded, including rejected and cancelled ones.
            </p>
            <div className="mt-4 space-y-3">
              {log.isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {!log.isLoading && (log.data ?? []).length === 0 && (
                <p className="text-sm text-slate-500">None</p>
              )}
              {(log.data ?? []).map((row) => (
                <div key={row.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={ACTION_STYLE[row.action] ?? ''}>
                      {row.action}
                    </Badge>
                    <span className="text-xs text-slate-500">{fmtDate(row.created_at)}</span>
                  </div>
                  <p className="mt-2 font-mono text-xs">
                    {row.old_account_last4 ? `XXXXXX${row.old_account_last4} (${row.old_ifsc ?? '—'})` : '—'}
                    {' → '}
                    {row.new_account_last4 ? `XXXXXX${row.new_account_last4} (${row.new_ifsc ?? '—'})` : '—'}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {row.actor_email ?? 'system'}{row.actor_role ? ` · ${row.actor_role}` : ''}
                    {row.ip_address ? ` · ${row.ip_address}` : ''}
                  </p>
                  {row.reason && <p className="mt-1 text-xs italic text-slate-600">“{row.reason}”</p>}
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </HrmsModernShell>
    </DashboardLayout>
  );
}
