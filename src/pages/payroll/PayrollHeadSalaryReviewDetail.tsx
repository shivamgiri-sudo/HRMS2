import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useWorkforceAccess } from '@/hooks/useUserRole';
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
  IndianRupee, FileSignature, AlertTriangle, RotateCcw, History as HistoryIcon,
  User, Building2, Briefcase, CalendarDays, Plus, Package, Calculator,
} from 'lucide-react';
import { PackageBuilderDialog } from '@/components/payroll/PackageBuilderDialog';

// ── Helpers ─────────────────────────────────────────────────────────────────────

const inr = (v: number | null | undefined) =>
  v == null ? '—' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const REVIEWER_ROLES = ['payroll_head', 'admin', 'super_admin'];
const FIXER_ROLES   = ['payroll_hr', 'branch_head', 'hr', 'admin', 'super_admin'];

interface Reason { code: string; category: string; label: string; }

// ── Sub-components ────────────────────────────────────────────────────────────

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SalaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm py-2 ${highlight ? 'font-semibold text-slate-900 border-t border-slate-200 mt-1 pt-3' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className={highlight ? 'text-base' : ''}>{value}</span>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc?: string }) {
  return (
    <CardHeader className="pb-3">
      <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-800">
        <div className="h-6 w-6 rounded-md bg-slate-100 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-slate-600" />
        </div>
        {title}
      </CardTitle>
      {desc && <CardDescription className="text-xs">{desc}</CardDescription>}
    </CardHeader>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PayrollHeadSalaryReviewDetail() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { hasAnyRole } = useWorkforceAccess();
  const isReviewer = hasAnyRole(...REVIEWER_ROLES);
  const isFixer    = hasAnyRole(...FIXER_ROLES);

  const [journey, setJourney] = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);

  // Reject dialog
  const [rejectOpen, setRejectOpen]         = useState(false);
  const [rejectCategory, setRejectCategory] = useState('');
  const [rejectCode, setRejectCode]         = useState('');
  const [rejectRemarks, setRejectRemarks]   = useState('');
  const [reasons, setReasons]               = useState<Reason[]>([]);

  // Reopen dialog
  const [reopenOpen, setReopenOpen]   = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  // Package assignment
  const [packages, setPackages]                 = useState<any[]>([]);
  const [selectedPkgId, setSelectedPkgId]       = useState('');
  const [effectiveDate, setEffectiveDate]       = useState('');
  const [pkgBuilderOpen, setPkgBuilderOpen]     = useState(false);

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
      .catch(() => {});
  }, []);

  const employeeBranch = journey?.employee?.branch_name as string | undefined;
  useEffect(() => {
    if (!employeeBranch) { setPackages([]); return; }
    hrmsApi.get<{ data: any[] }>(`/api/payroll-masters/packages?branch=${encodeURIComponent(employeeBranch)}`)
      .then((r: any) => setPackages(r?.data ?? []))
      .catch(() => {});
  }, [employeeBranch]);

  const review   = journey?.review;
  const employee = journey?.employee;
  const status   = review?.status as string | undefined;
  const bgvCandidateId = journey?.bgv?.candidateId as string | null | undefined;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  const assignExisting = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/assign`, {
      package_id: selectedPkgId, effective_date: effectiveDate,
    }), 'Package assigned.'
  );

  const onPackageBuilt = async (pkgId: string) => {
    if (!effectiveDate) {
      setError('Please set an effective date before building a package.');
      return;
    }
    await run(() =>
      hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/assign`, {
        package_id: pkgId, effective_date: effectiveDate,
      }), 'New package created and assigned.'
    );
  };

  const acceptPackage = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/accept`, {}),
    'Package accepted.'
  );

  const approve = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/approve`, {})
  );

  const resubmit = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/resubmit`, {}),
    'Marked as fixed — back in the review queue.'
  );

  const submitReject = () => run(async () => {
    const res: any = await hrmsApi.post(`/api/payroll-head-review/${employeeId}/reject`, {
      category: rejectCategory, reason_code: rejectCode, remarks: rejectRemarks,
    });
    setRejectOpen(false);
    setRejectCategory(''); setRejectCode(''); setRejectRemarks('');
    if (res?.data?.notification?.usedFallback) {
      setNotice('No offer history found to route this — all payroll head users notified instead.');
    }
  });

  const submitReopen = () => run(async () => {
    await hrmsApi.post(`/api/payroll-head-review/${employeeId}/reopen`, { reason: reopenReason });
    setReopenOpen(false);
    setReopenReason('');
  }, 'Review reopened — employee excluded from payroll until re-approved.');

  const verifyDoc = (docId: string, action: 'verified' | 'rejected') => run(() =>
    hrmsApi.patch(`/api/employee-docs/${employeeId}/${docId}/verify`, { action })
  );

  const bgvManual = (checkId: string, s: 'verified' | 'mismatch' | 'failed') => run(() =>
    hrmsApi.post(`/api/ats/bgv/candidates/${bgvCandidateId}/manual-review`, {
      checkId, status: s, remarks: `Reviewed from Payroll Head screen (${s}).`,
    })
  );

  const bgvWaive = (checkId: string) => run(() =>
    hrmsApi.post(`/api/ats/bgv/candidates/${bgvCandidateId}/waive`, {
      checkId, exceptionType: 'waiver', reason: 'Waived from Payroll Head salary review screen.',
    })
  );

  if (loading) return (
    <DashboardLayout>
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
      </div>
    </DashboardLayout>
  );

  const sc = journey?.salary_components;
  const sa = journey?.salary_assignment;
  const reasonsFiltered = reasons.filter((r) => r.category === rejectCategory);

  const statusCfg = {
    pending_review: { chip: 'bg-amber-50 text-amber-700 border border-amber-200', label: 'Pending Review' },
    approved:       { chip: 'bg-emerald-50 text-emerald-700 border border-emerald-200', label: 'Approved' },
    rejected:       { chip: 'bg-rose-50 text-rose-700 border border-rose-200', label: 'Rejected' },
  }[status ?? 'pending_review'] ?? { chip: 'bg-slate-100 text-slate-600 border border-slate-200', label: status ?? '—' };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-5 max-w-5xl mx-auto">

        {/* Back */}
        <Button variant="ghost" size="sm" onClick={() => navigate('/payroll/salary-review')} className="cursor-pointer -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1.5" />Back to Salary Review Queue
        </Button>

        {/* Banners */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />{error}
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />{notice}
          </div>
        )}
        {!isReviewer && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            You're viewing this because you were notified about it
            {isFixer ? ' — you can resubmit once the issue is fixed' : ''}.
            Only Payroll Head / Admin can approve, reject, or reopen.
          </div>
        )}

        {/* ── Employee Header ────────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 to-indigo-400" />
          <CardContent className="pt-5 pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 text-xl font-bold flex-shrink-0">
                  {employee?.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{employee?.full_name ?? '—'}</h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-slate-500">
                    <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{employee?.employee_code ?? '—'}</span>
                    {employee?.designation_name && <><span className="text-slate-300">·</span><span>{employee.designation_name}</span></>}
                    {employee?.branch_name && <><span className="text-slate-300">·</span><span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{employee.branch_name}</span></>}
                  </div>
                </div>
              </div>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusCfg.chip}`}>
                {statusCfg.label}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
              <StatTile label="Date of Joining" value={fmtDate(employee?.date_of_joining)} />
              <StatTile label="Employment Type" value={employee?.employment_type ?? '—'} />
              <StatTile
                label="Offer CTC"
                value={sa?.ctc_annual ? `${inr(sa.ctc_annual / 12)}/mo` : '—'}
                sub={sa?.ctc_annual ? `${inr(sa.ctc_annual)} p.a.` : undefined}
              />
              <StatTile
                label="Package Status"
                value={review?.package_accepted ? 'Accepted ✓' : review?.salary_package_id ? 'Assigned, not accepted' : 'Not assigned'}
              />
            </div>
          </CardContent>

          {/* Rejected banner */}
          {status === 'rejected' && review?.rejection_remarks && (
            <div className="border-t border-red-100 bg-red-50 px-5 py-4">
              <p className="text-sm font-semibold text-red-800">
                Rejected — {review.rejection_category} / {review.rejection_reason_code}
              </p>
              <p className="text-sm text-red-700 mt-1">{review.rejection_remarks}</p>
              <div className="flex items-center gap-3 mt-3">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void resubmit()} className="cursor-pointer border-red-200 text-red-700 hover:bg-red-50">
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Mark Fixed &amp; Resubmit
                </Button>
                <span className="text-xs text-slate-500">Only Payroll HR, Branch Head, HR, or Admin can resubmit.</span>
              </div>
            </div>
          )}

          {/* Approved — reopen */}
          {status === 'approved' && isReviewer && (
            <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 flex items-center justify-between">
              <p className="text-sm text-emerald-700 font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />Approved — employee is payroll-eligible
              </p>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setReopenOpen(true)} className="cursor-pointer">
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Reopen for Correction
              </Button>
            </div>
          )}
        </Card>

        {/* ── Salary Package ─────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={IndianRupee} title="Salary Package"
            desc="Assign a catalog package, accept it, then approve. Payroll reads salary_component_assignments — not the offer." />
          <CardContent className="space-y-4">

            {/* Current component breakdown — shown when assigned */}
            {sc ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-3">
                  Assigned Package — Real Breakdown
                </p>
                <div className="divide-y divide-emerald-100">
                  <SalaryRow label="Basic" value={inr(sc.basic)} />
                  <SalaryRow label="HRA" value={inr(sc.hra)} />
                  <SalaryRow label="Conveyance" value={inr(sc.conveyance)} />
                  <SalaryRow label="Special Allowance" value={inr(sc.special_allowance)} />
                  {sc.other_allowance ? <SalaryRow label="Other Allowance" value={inr(sc.other_allowance)} /> : null}
                  <SalaryRow label="Gross Monthly" value={inr(sc.gross_monthly ?? sc.gross)} highlight />
                  {sc.pf_employee ? <SalaryRow label="PF (Employee)" value={`− ${inr(sc.pf_employee)}`} /> : null}
                  {sc.esic_employee ? <SalaryRow label="ESIC (Employee)" value={`− ${inr(sc.esic_employee)}`} /> : null}
                  <SalaryRow label="Net in Hand" value={inr(sc.net_in_hand)} highlight />
                </div>
                <p className="text-[11px] text-emerald-600 mt-3">
                  Effective from {fmtDate(review?.package_effective_from)}
                  {review?.package_accepted ? ' · Accepted ✓' : ' · Pending acceptance'}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 inline mr-1.5 mb-0.5" />
                No real salary breakdown on file — payroll will fall back to the generic template split.
                Assign a catalog package below to fix this.
              </div>
            )}

            {/* Assign controls — only for reviewer on pending */}
            {status === 'pending_review' && isReviewer && (
              <div className="border-t border-slate-100 pt-4 space-y-4">
                {/* Effective date — required for both paths */}
                <div className="flex items-end gap-3">
                  <div>
                    <Label className="text-xs mb-1.5 block">Effective Date <span className="text-rose-500">*</span></Label>
                    <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="w-[160px]" />
                  </div>
                  <p className="text-xs text-slate-400 mb-2">Set this first — required for both catalog and new package.</p>
                </div>

                {/* Select from catalog */}
                <div>
                  <Label className="text-xs mb-1.5 block flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-slate-500" />Select from Catalog
                  </Label>
                  <div className="flex items-center gap-3">
                    <Select value={selectedPkgId} onValueChange={setSelectedPkgId}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Choose a package…" /></SelectTrigger>
                      <SelectContent>
                        {packages.length === 0
                          ? <SelectItem value="__none__" disabled>No packages for this branch yet</SelectItem>
                          : packages.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name ?? `Band ${p.band_code}`} · {inr(p.package_amount / 12)}/mo
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button disabled={busy || !selectedPkgId || !effectiveDate} onClick={() => void assignExisting()} className="cursor-pointer shrink-0">
                      Assign
                    </Button>
                  </div>
                </div>

                {/* Build new */}
                <div className="flex items-center gap-3 pt-1 border-t border-slate-100">
                  <p className="text-xs text-slate-500 flex-1">
                    No suitable package in catalog? Build one with the salary calculator — PF/ESIC toggles, From CTC or From In-Hand, all statutory components included.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy || !effectiveDate}
                    onClick={() => setPkgBuilderOpen(true)}
                    className="cursor-pointer shrink-0 gap-2"
                  >
                    <Calculator className="h-4 w-4" />Build New Package
                  </Button>
                </div>
              </div>
            )}

            {/* Accept button */}
            {status === 'pending_review' && isReviewer && review?.salary_package_id && !review?.package_accepted && (
              <div className="border-t border-slate-100 pt-4 flex items-center gap-3">
                <Button disabled={busy} onClick={() => void acceptPackage()} className="cursor-pointer">
                  Accept Package
                </Button>
                <p className="text-xs text-slate-500">
                  Effective {fmtDate(review.package_effective_from)} — locking this confirms payroll will use the breakdown above.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── BGV ────────────────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={ShieldCheck} title="BGV Status"
            desc={journey?.bgv?.overall_status ?? journey?.bgv?.status ?? 'No BGV checks initiated'} />
          <CardContent>
            {Array.isArray(journey?.bgv?.checks) && journey.bgv.checks.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {journey.bgv.checks.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-slate-700">{c.check_type}</span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                        c.status === 'verified' || c.status === 'waived'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : c.status === 'failed' || c.status === 'mismatch'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}>{c.status}</span>
                    </div>
                    {isReviewer && c.status !== 'verified' && c.status !== 'waived' && bgvCandidateId && (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void bgvManual(c.id, 'verified')} className="h-7 text-xs cursor-pointer">Verify</Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void bgvManual(c.id, 'failed')} className="h-7 text-xs cursor-pointer text-rose-600 border-rose-200 hover:bg-rose-50">Fail</Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void bgvWaive(c.id)} className="h-7 text-xs cursor-pointer">Waive</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">{journey?.bgv?.message ?? 'No BGV checks on file.'}</p>
            )}
          </CardContent>
        </Card>

        {/* ── Bank ───────────────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={Banknote} title="Bank Readiness" />
          <CardContent>
            {journey?.bank ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatTile label="Readiness" value={journey.bank.readiness_class} />
                  <StatTile label="Payable" value={journey.bank.payable ? 'Yes' : 'No'} />
                  <StatTile label="Bank" value={journey.bank.bank_name ?? '—'} />
                  <StatTile label="Account" value={journey.bank.account_masked ?? '—'} />
                  {journey.bank.reason_detail && (
                    <div className="col-span-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Note</p>
                      <p className="mt-1 text-sm text-slate-600">{journey.bank.reason_detail}</p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-3">
                  Bank corrections go through the Bank Change Request workflow, not directly here.
                </p>
              </>
            ) : <p className="text-sm text-slate-400">No bank readiness data available.</p>}
          </CardContent>
        </Card>

        {/* ── Documents ──────────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={FileText} title={`Documents (${journey?.documents?.length ?? 0})`} />
          <CardContent>
            {(journey?.documents ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">No documents uploaded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {(journey.documents as any[]).map((d) => (
                  <div key={d.id} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-slate-700">{d.doc_name || d.doc_type}</span>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                        d.verified
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}>
                        {d.verified ? 'Verified' : 'Not verified'}
                      </span>
                      {isReviewer && !d.verified && (
                        <>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void verifyDoc(d.id, 'verified')} className="h-7 text-xs cursor-pointer">Verify</Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void verifyDoc(d.id, 'rejected')} className="h-7 text-xs cursor-pointer text-rose-600 border-rose-200 hover:bg-rose-50">Reject</Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Joining Kit ────────────────────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={FileSignature} title="Joining Kit / e-Sign" />
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Kit status:</span>
              <span className="font-medium text-slate-700">{journey?.joining_kit?.status ?? 'No kit sent yet'}</span>
            </div>
            {(journey?.joining_checklist ?? []).length > 0 && (
              <div className="divide-y divide-slate-100">
                {(journey.joining_checklist as any[]).map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2">
                    <span className="text-sm text-slate-700">{c.document_name || c.document_code}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                      c.status === 'signed' || c.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>{c.status}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── History ────────────────────────────────────────────────────────── */}
        {Array.isArray(journey?.history) && journey.history.length > 0 && (
          <Card>
            <SectionHeader icon={HistoryIcon} title="Review History" />
            <CardContent>
              <div className="divide-y divide-slate-100">
                {(journey.history as any[]).map((h) => (
                  <div key={h.id} className="py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize border ${
                        h.action === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : h.action === 'rejected' ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}>{h.action}</span>
                      <span className="text-slate-400 text-xs">{fmtDate(h.created_at)}</span>
                    </div>
                    {h.rejection_category && (
                      <p className="mt-1.5 text-slate-600">
                        <span className="font-medium">{h.rejection_category} / {h.rejection_reason_code}:</span>{' '}
                        {h.rejection_remarks}
                      </p>
                    )}
                    {h.reopen_reason && <p className="mt-1.5 text-slate-600">Reason: {h.reopen_reason}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Decision ───────────────────────────────────────────────────────── */}
        {status === 'pending_review' && isReviewer && (
          <Card className="border-indigo-100 bg-indigo-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800">Decision</CardTitle>
              <CardDescription className="text-xs">
                {review?.package_accepted
                  ? 'All checks complete — ready to approve.'
                  : 'Assign and accept a salary package above before approving.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Button
                  disabled={busy || !review?.package_accepted}
                  onClick={() => void approve()}
                  className="bg-emerald-600 hover:bg-emerald-700 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />Approve for Payroll
                </Button>
                <Button
                  disabled={busy}
                  variant="destructive"
                  onClick={() => setRejectOpen(true)}
                  className="cursor-pointer"
                >
                  <XCircle className="h-4 w-4 mr-2" />Reject
                </Button>
                {!review?.package_accepted && (
                  <p className="text-xs text-slate-500">Approve button unlocks after package acceptance.</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Package Builder Dialog ─────────────────────────────────────────────── */}
      <PackageBuilderDialog
        open={pkgBuilderOpen}
        onOpenChange={setPkgBuilderOpen}
        defaultBranch={employeeBranch ?? ''}
        onPackageCreated={(pkgId) => void onPackageBuilt(pkgId)}
      />

      {/* ── Reject Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Salary Review</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs mb-1.5 block">Category</Label>
              <Select value={rejectCategory} onValueChange={(v) => { setRejectCategory(v); setRejectCode(''); }}>
                <SelectTrigger><SelectValue placeholder="What's the issue?" /></SelectTrigger>
                <SelectContent>
                  {['salary', 'documents', 'bgv', 'bank', 'other'].map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rejectCategory === 'salary' && (
                <p className="text-xs text-amber-600 mt-1.5">
                  Salary rejection clears the assigned package — it must be reassigned after resubmission.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Reason</Label>
              <Select value={rejectCode} onValueChange={setRejectCode} disabled={!rejectCategory}>
                <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {reasonsFiltered.length === 0
                    ? <SelectItem value="__none__" disabled>No reasons for this category</SelectItem>
                    : reasonsFiltered.map((r) => (
                      <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Remarks <span className="text-slate-400">(required — what exactly needs fixing)</span></Label>
              <Textarea
                value={rejectRemarks}
                onChange={(e) => setRejectRemarks(e.target.value)}
                rows={4}
                placeholder="Be specific — this goes to Payroll HR and the Branch Head…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} className="cursor-pointer">Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || !rejectCategory || !rejectCode || !rejectRemarks.trim()}
              onClick={() => void submitReject()}
              className="cursor-pointer"
            >
              Submit Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reopen Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reopen for Correction</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600">
              This moves the review back to pending — the employee will be excluded from future payroll runs
              until re-approved. It does not undo any run that already completed.
            </p>
            <div>
              <Label className="text-xs mb-1.5 block">Reason (required)</Label>
              <Textarea
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                rows={3}
                placeholder="What needs to be corrected…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)} className="cursor-pointer">Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || !reopenReason.trim()}
              onClick={() => void submitReopen()}
              className="cursor-pointer"
            >
              Reopen Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
