/**
 * Single-employee salary/journey review — BGV, documents, bank, joining-kit
 * e-sign status, and the salary package itself, all in one place, with the
 * approve/reject/accept-package actions that gate payroll eligibility
 * (employee_payroll_head_review, migration 1541).
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2, ArrowLeft, CheckCircle2, XCircle, FileText, ShieldCheck, Banknote,
  IndianRupee, FileSignature, AlertTriangle,
} from 'lucide-react';

const fmt = (v: number | null | undefined) => v == null ? '—' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;

interface Reason { code: string; category: string; label: string; }

export default function PayrollHeadSalaryReviewDetail() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const [journey, setJourney] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reasons, setReasons] = useState<Reason[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCategory, setRejectCategory] = useState('');
  const [rejectReasonCode, setRejectReasonCode] = useState('');
  const [rejectRemarks, setRejectRemarks] = useState('');

  const [packages, setPackages] = useState<any[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [acceptEffectiveFrom, setAcceptEffectiveFrom] = useState('');

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await hrmsApi.get<{ success: boolean; data: any }>(`/api/payroll-head-review/${employeeId}`);
      setJourney((r as any)?.data ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load review.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    hrmsApi.get<{ success: boolean; data: Reason[] }>('/api/payroll-head-review/reasons')
      .then((r: any) => setReasons(r?.data ?? []))
      .catch(() => setReasons([]));
  }, []);

  // Scoped to the employee's own branch — salary_package_master is keyed by
  // branch + cost centre + band, and an unfiltered fetch here would repeat
  // the exact bug already fixed on the offer-creation page (every package,
  // any branch, in one dropdown).
  const employeeBranch = journey?.employee?.branch_name as string | undefined;
  useEffect(() => {
    if (!employeeBranch) { setPackages([]); return; }
    const params = new URLSearchParams({ branch: employeeBranch });
    hrmsApi.get<{ success: boolean; data: any[] }>(`/api/payroll-masters/packages?${params}`)
      .then((r: any) => setPackages(r?.data ?? []))
      .catch(() => setPackages([]));
  }, [employeeBranch]);

  const review = journey?.review;
  const employee = journey?.employee;
  const status = review?.status as string | undefined;

  async function runAction(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  const assignPackage = () => runAction(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/assign`, {
      package_id: selectedPackageId, effective_date: effectiveDate,
    })
  );

  const acceptPackage = () => runAction(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/accept`, {
      effective_from: acceptEffectiveFrom,
    })
  );

  const approve = () => runAction(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/approve`, {})
  );

  // Deliberately callable by whoever can reach this page — the backend is the
  // real gate (resubmit is role-restricted to payroll_hr/branch_head/hr/admin
  // /super_admin, not payroll_head, since the reviewer isn't the fixer). A
  // payroll_head clicking this sees a clear 403 via the error banner below,
  // rather than the action being silently unreachable.
  const resubmit = () => runAction(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/resubmit`, {})
  );

  const submitReject = () => runAction(async () => {
    await hrmsApi.post(`/api/payroll-head-review/${employeeId}/reject`, {
      category: rejectCategory, reason_code: rejectReasonCode, remarks: rejectRemarks,
    });
    setRejectOpen(false);
    setRejectCategory(''); setRejectReasonCode(''); setRejectRemarks('');
  });

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </DashboardLayout>
    );
  }

  const reasonsForCategory = reasons.filter((r) => r.category === rejectCategory);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/payroll/salary-review')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to queue
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">{employee?.full_name ?? '—'}</CardTitle>
                <CardDescription>
                  {employee?.employee_code} · {employee?.designation_name ?? '—'} · {employee?.branch_name ?? '—'}
                </CardDescription>
              </div>
              <Badge className={
                status === 'approved' ? 'bg-emerald-100 text-emerald-800'
                : status === 'rejected' ? 'bg-red-100 text-red-800'
                : 'bg-amber-100 text-amber-800'
              }>
                {status ?? '—'}
              </Badge>
            </div>
          </CardHeader>
          {status === 'rejected' && review?.rejection_remarks && (
            <CardContent className="pt-0 space-y-3">
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                <div className="font-semibold">Rejected — {review.rejection_category} / {review.rejection_reason_code}</div>
                <div className="mt-1">{review.rejection_remarks}</div>
              </div>
              <Button disabled={busy} variant="outline" onClick={() => void resubmit()}>
                Mark Fixed &amp; Resubmit for Review
              </Button>
            </CardContent>
          )}
        </Card>

        {/* Salary package */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><IndianRupee className="h-4 w-4" /> Salary Package</CardTitle>
            <CardDescription>Assign a catalog package, then accept it before it can be approved for payroll.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-500">Current CTC (offer):</span> {fmt(journey?.salary_assignment?.ctc_annual ? journey.salary_assignment.ctc_annual / 12 : null)}/mo</div>
              <div><span className="text-slate-500">Assigned package:</span> {review?.salary_package_id ? 'Assigned' : 'Not assigned'}</div>
              <div><span className="text-slate-500">Package accepted:</span> {review?.package_accepted ? `Yes (from ${review.package_effective_from ?? '—'})` : 'No'}</div>
              <div><span className="text-slate-500">Real component breakdown on file:</span> {journey?.salary_components ? 'Yes' : 'No — falls back to generic template split'}</div>
            </div>

            {status === 'pending_review' && (
              <div className="grid grid-cols-[1fr,auto,auto] gap-2 items-end pt-2 border-t border-slate-100">
                <div>
                  <Label className="text-xs">Salary Package</Label>
                  <Select value={selectedPackageId} onValueChange={setSelectedPackageId}>
                    <SelectTrigger><SelectValue placeholder="Select a package" /></SelectTrigger>
                    <SelectContent>
                      {packages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.branch_name} · Band {p.band_code} · {fmt(p.package_amount)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Effective Date</Label>
                  <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                </div>
                <Button disabled={busy || !selectedPackageId || !effectiveDate} onClick={() => void assignPackage()}>
                  Assign
                </Button>
              </div>
            )}

            {status === 'pending_review' && review?.salary_package_id && !review?.package_accepted && (
              <div className="grid grid-cols-[1fr,auto] gap-2 items-end pt-2 border-t border-slate-100">
                <div>
                  <Label className="text-xs">Accept package effective from</Label>
                  <Input type="date" value={acceptEffectiveFrom} onChange={(e) => setAcceptEffectiveFrom(e.target.value)} />
                </div>
                <Button disabled={busy || !acceptEffectiveFrom} onClick={() => void acceptPackage()}>
                  Accept Package
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* BGV */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> BGV Status</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-slate-50 rounded-lg p-3 overflow-auto max-h-64">
              {JSON.stringify(journey?.bgv, null, 2)}
            </pre>
          </CardContent>
        </Card>

        {/* Bank */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Banknote className="h-4 w-4" /> Bank Readiness</CardTitle>
          </CardHeader>
          <CardContent>
            {journey?.bank ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">Class:</span> {journey.bank.readiness_class}</div>
                <div><span className="text-slate-500">Payable:</span> {journey.bank.payable ? 'Yes' : 'No'}</div>
                <div><span className="text-slate-500">Bank:</span> {journey.bank.bank_name ?? '—'}</div>
                <div><span className="text-slate-500">Account:</span> {journey.bank.account_masked ?? '—'}</div>
                <div className="col-span-2"><span className="text-slate-500">Reason:</span> {journey.bank.reason_detail}</div>
              </div>
            ) : <div className="text-sm text-slate-400">No bank readiness data available.</div>}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Documents ({journey?.documents?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {(journey?.documents ?? []).map((d: any) => (
                <div key={d.id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                  <span>{d.doc_name || d.doc_type}</span>
                  <Badge className={d.verified ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}>
                    {d.verified ? 'Verified' : 'Not verified'}
                  </Badge>
                </div>
              ))}
              {(!journey?.documents || journey.documents.length === 0) && (
                <div className="text-sm text-slate-400">No documents uploaded.</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Joining kit */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileSignature className="h-4 w-4" /> Joining Kit / e-Sign</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              <span className="text-slate-500">Kit status:</span> {journey?.joining_kit?.status ?? 'No kit sent yet'}
            </div>
            <div className="mt-2 space-y-1">
              {(journey?.joining_checklist ?? []).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between text-sm py-1 border-b border-slate-100 last:border-0">
                  <span>{c.document_name || c.document_code}</span>
                  <Badge className="bg-slate-100 text-slate-600">{c.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Decision */}
        {status === 'pending_review' && (
          <Card className="border-slate-300">
            <CardHeader>
              <CardTitle className="text-base">Decision</CardTitle>
              <CardDescription>
                {review?.package_accepted
                  ? 'Ready for approval.'
                  : 'Approval is blocked until the salary package is assigned and accepted above.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-3">
              <Button
                disabled={busy || !review?.package_accepted}
                onClick={() => void approve()}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Approve
              </Button>
              <Button disabled={busy} variant="destructive" onClick={() => setRejectOpen(true)}>
                <XCircle className="h-4 w-4 mr-2" /> Reject
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Salary Review</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={rejectCategory} onValueChange={(v) => { setRejectCategory(v); setRejectReasonCode(''); }}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="salary">Salary</SelectItem>
                  <SelectItem value="documents">Documents</SelectItem>
                  <SelectItem value="bgv">BGV</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reason</Label>
              <Select value={rejectReasonCode} onValueChange={setRejectReasonCode} disabled={!rejectCategory}>
                <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                <SelectContent>
                  {reasonsForCategory.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Remarks</Label>
              <Textarea value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)} rows={4} placeholder="What exactly needs fixing…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || !rejectCategory || !rejectReasonCode || !rejectRemarks.trim()}
              onClick={() => void submitReject()}
            >
              Submit Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
