import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useWorkforceAccess } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
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
  Building2, CalendarDays, Plus, Package, Calculator, TrendingUp,
  User, Lock, ChevronDown, ChevronRight, Briefcase, BadgeCheck, Clock,
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

function KpiTile({
  label, value, sub, tone = 'slate', icon: Icon,
}: {
  label: string; value: React.ReactNode; sub?: string;
  tone?: 'slate' | 'blue' | 'green' | 'amber' | 'violet' | 'red';
  icon?: React.ElementType;
}) {
  const tones: Record<string, string> = {
    slate:  'bg-slate-50 border-slate-200 text-slate-700',
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    green:  'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-700',
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    red:    'bg-red-50 border-red-200 text-red-700',
  };
  const iconBg: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-500', blue: 'bg-blue-100 text-blue-600',
    green: 'bg-emerald-100 text-emerald-600', amber: 'bg-amber-100 text-amber-600',
    violet: 'bg-violet-100 text-violet-600', red: 'bg-red-100 text-red-600',
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
        {Icon && (
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg[tone]}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <p className="text-lg font-bold">{value}</p>
      {sub && <p className="text-[11px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionCard({
  children, gradient, title, icon: Icon, desc, action,
}: {
  children: React.ReactNode;
  gradient: string;
  title: string;
  icon: React.ElementType;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
      <div className={`${gradient} px-5 py-3.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
            <Icon className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            {desc && <p className="text-[11px] text-white/70 mt-0.5">{desc}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function SalaryRow({ label, value, sub, bold, separator }: {
  label: string; value: string | React.ReactNode; sub?: string; bold?: boolean; separator?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2 ${separator ? 'border-t-2 border-slate-200 mt-1 pt-3' : 'border-b border-slate-50'}`}>
      <span className={`text-sm ${bold ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{label}</span>
      <span className={`font-mono ${bold ? 'text-base font-bold text-slate-900' : 'text-sm text-slate-700'}`}>{value}</span>
    </div>
  );
}

function BgvBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    verified:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    clear:     'bg-emerald-50 text-emerald-700 border-emerald-200',
    waived:    'bg-blue-50 text-blue-700 border-blue-200',
    failed:    'bg-red-50 text-red-700 border-red-200',
    mismatch:  'bg-rose-50 text-rose-700 border-rose-200',
    refer:     'bg-amber-50 text-amber-700 border-amber-200',
    pending:   'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border capitalize ${cfg[status] ?? cfg.pending}`}>
      {status}
    </span>
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

  const [rejectOpen, setRejectOpen]         = useState(false);
  const [rejectCategory, setRejectCategory] = useState('');
  const [rejectCode, setRejectCode]         = useState('');
  const [rejectRemarks, setRejectRemarks]   = useState('');
  const [reasons, setReasons]               = useState<Reason[]>([]);

  const [reopenOpen, setReopenOpen]   = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const [packages, setPackages]                 = useState<any[]>([]);
  const [selectedPkgId, setSelectedPkgId]       = useState('');
  const [effectiveDate, setEffectiveDate]       = useState('');
  const [loadedSalaryStartDate, setLoadedSalaryStartDate] = useState<string>('');
  const [pkgBuilderOpen, setPkgBuilderOpen]     = useState(false);

  useEffect(() => {
    if (effectiveDate) return;
    const preferred = journey?.payroll_hr_validation?.salary_start_date
                   ?? journey?.employee?.date_of_joining;
    if (!preferred) return;
    const d = new Date(preferred);
    if (!isNaN(d.getTime())) {
      const iso = d.toISOString().slice(0, 10);
      setEffectiveDate(iso);
      setLoadedSalaryStartDate(
        journey?.payroll_hr_validation?.salary_start_date ? iso : ''
      );
    }
  }, [journey]);

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true); setError(null);
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
      .then((r: any) => setReasons(r?.data ?? [])).catch(() => {});
  }, []);

  const employeeBranch = journey?.employee?.branch_name as string | undefined;
  useEffect(() => {
    if (!employeeBranch) { setPackages([]); return; }
    hrmsApi.get<{ data: any[] }>(`/api/payroll-masters/packages?branch=${encodeURIComponent(employeeBranch)}`)
      .then((r: any) => setPackages(r?.data ?? [])).catch(() => {});
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
    } finally { setBusy(false); }
  }

  const assignExisting = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/assign`, {
      package_id: selectedPkgId, effective_date: effectiveDate,
    }), 'Package assigned successfully.'
  );

  const onPackageBuilt = async (pkgId: string) => {
    if (!effectiveDate) { setError('Please set an effective date before building a package.'); return; }
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
      setNotice('No offer history found — all payroll head users notified instead.');
    }
  });

  const submitReopen = () => run(async () => {
    await hrmsApi.post(`/api/payroll-head-review/${employeeId}/reopen`, { reason: reopenReason });
    setReopenOpen(false); setReopenReason('');
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
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          <p className="text-sm text-slate-400">Loading salary review…</p>
        </div>
      </div>
    </DashboardLayout>
  );

  const sc = journey?.salary_components;
  const sa = journey?.salary_assignment;
  const reasonsFiltered = reasons.filter((r) => r.category === rejectCategory);

  const initials = employee?.full_name?.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() ?? '?';

  const statusBadge = {
    pending_review: { cls: 'bg-amber-100 text-amber-800 border-amber-200', label: 'Pending Review', icon: Clock },
    approved:       { cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', label: 'Approved', icon: BadgeCheck },
    rejected:       { cls: 'bg-red-100 text-red-800 border-red-200', label: 'Rejected', icon: XCircle },
  }[status ?? 'pending_review'] ?? { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: status ?? '—', icon: Clock };

  const StatusIcon = statusBadge.icon;

  // Gross / net / ctc from assigned package or offer
  const grossMonthly = sc?.gross_monthly ?? sc?.gross ?? null;
  const netInHand    = sc?.net_in_hand ?? sc?.net_estimate ?? null;
  const ctcMonthly   = sc?.ctc ?? (sa?.ctc_annual ? sa.ctc_annual / 12 : null);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto pb-10">

        {/* Back */}
        <Button variant="ghost" size="sm" onClick={() => navigate('/payroll/salary-review')}
          className="cursor-pointer -ml-2 text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4 mr-1.5" />Back to Salary Review Queue
        </Button>

        {/* Banners */}
        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {!isReviewer && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3.5 text-sm text-blue-700 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-400" />
            <span>View only — you were notified about this review
              {isFixer ? '. You can resubmit once the issue is fixed.' : '.'}
              Only Payroll Head / Admin can approve, reject or reopen.</span>
          </div>
        )}

        {/* ── Hero Header ──────────────────────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden shadow-sm border border-indigo-100">
          {/* Gradient banner */}
          <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-700 px-6 py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="h-16 w-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-2xl font-bold border border-white/30 flex-shrink-0">
                  {initials}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white">{employee?.full_name ?? '—'}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="bg-white/20 text-white text-xs font-mono px-2 py-0.5 rounded-lg border border-white/20">
                      {employee?.employee_code ?? '—'}
                    </span>
                    {employee?.designation_name && (
                      <span className="text-white/80 text-sm flex items-center gap-1">
                        <Briefcase className="h-3.5 w-3.5" />{employee.designation_name}
                      </span>
                    )}
                    {employee?.branch_name && (
                      <span className="text-white/80 text-sm flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />{employee.branch_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {/* Status badge */}
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold border ${statusBadge.cls}`}>
                <StatusIcon className="h-4 w-4" />{statusBadge.label}
              </span>
            </div>

            {/* Info strip */}
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-white/20 text-sm text-white/80">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-white/50" />
                DOJ: <strong className="text-white ml-0.5">{fmtDate(employee?.date_of_joining)}</strong>
              </span>
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-white/50" />
                Type: <strong className="text-white ml-0.5">{employee?.employment_type ?? '—'}</strong>
              </span>
              <span className="flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-white/50" />
                Package: <strong className="text-white ml-0.5">
                  {review?.package_accepted ? 'Accepted ✓' : review?.salary_package_id ? 'Assigned, not accepted' : 'Not assigned'}
                </strong>
              </span>
            </div>
          </div>

          {/* Rejected / Approved banners inside header */}
          {status === 'rejected' && review?.rejection_remarks && (
            <div className="border-t border-red-100 bg-red-50 px-6 py-4">
              <p className="text-sm font-semibold text-red-800">
                Rejected — {review.rejection_category} / {review.rejection_reason_code}
              </p>
              <p className="text-sm text-red-600 mt-1">{review.rejection_remarks}</p>
              <div className="flex items-center gap-3 mt-3">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void resubmit()}
                  className="cursor-pointer border-red-200 text-red-700 hover:bg-red-50 gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />Mark Fixed &amp; Resubmit
                </Button>
                <span className="text-xs text-slate-500">Payroll HR, Branch Head, HR or Admin can resubmit.</span>
              </div>
            </div>
          )}
          {status === 'approved' && isReviewer && (
            <div className="border-t border-emerald-100 bg-emerald-50 px-6 py-3.5 flex items-center justify-between">
              <p className="text-sm text-emerald-700 font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />Approved — employee is payroll-eligible
              </p>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setReopenOpen(true)}
                className="cursor-pointer gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />Reopen for Correction
              </Button>
            </div>
          )}
        </div>

        {/* ── KPI Strip ─────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Gross Monthly" value={grossMonthly ? inr(grossMonthly) : '—'} tone="blue"
            icon={TrendingUp} sub={ctcMonthly ? `CTC: ${inr(ctcMonthly)}/mo` : undefined} />
          <KpiTile label="Net in Hand" value={netInHand ? inr(netInHand) : '—'} tone="green"
            icon={IndianRupee}
            sub={grossMonthly && netInHand ? `${Math.round((netInHand / grossMonthly) * 100)}% take-home` : undefined} />
          <KpiTile label="PF (Employee)" value={sc?.pf_employee ? inr(sc.pf_employee) : '—'} tone="violet"
            icon={ShieldCheck} sub={sc?.epf_employee ? inr(sc.epf_employee) : undefined} />
          <KpiTile label="Review Status" value={statusBadge.label}
            tone={status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'amber'}
            icon={statusBadge.icon} sub={review?.reviewed_at ? fmtDate(review.reviewed_at) : undefined} />
        </div>

        {/* ── Salary Package ─────────────────────────────────────────────────────── */}
        <SectionCard
          gradient="bg-gradient-to-r from-purple-600 to-violet-600"
          title="Salary Package"
          desc="Assign a package → accept → approve. Payroll reads salary_component_assignments."
          icon={IndianRupee}
        >
          {/* Assigned breakdown */}
          {sc ? (
            <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest text-purple-700">Assigned Package</p>
                <div className="flex items-center gap-1.5">
                  {review?.package_accepted
                    ? <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Accepted</span>
                    : <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1"><Clock className="h-3 w-3" />Pending acceptance</span>
                  }
                  <span className="text-[11px] text-slate-500">Eff. {fmtDate(review?.package_effective_from)}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Earnings</p>
                  <SalaryRow label="Basic" value={inr(sc.basic)} />
                  <SalaryRow label="HRA" value={inr(sc.hra)} />
                  <SalaryRow label="Conveyance" value={inr(sc.conveyance)} />
                  {sc.special_allowance > 0 && <SalaryRow label="Special Allowance" value={inr(sc.special_allowance)} />}
                  {sc.other_allowance > 0 && <SalaryRow label="Other Allowance" value={inr(sc.other_allowance)} />}
                  <SalaryRow label="Gross Monthly" value={inr(sc.gross_monthly ?? sc.gross)} bold separator />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Deductions</p>
                  <SalaryRow label="PF (Employee)" value={sc.pf_employee ? `− ${inr(sc.pf_employee)}` : '—'} />
                  <SalaryRow label="ESIC (Employee)" value={sc.esic_employee ? `− ${inr(sc.esic_employee)}` : '—'} />
                  <SalaryRow label="Net in Hand" value={inr(sc.net_in_hand ?? sc.net_estimate)} bold separator />
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Employer Cost</p>
                    <SalaryRow label="PF (Employer)" value={inr(sc.employer_pf ?? sc.epf_employer)} />
                    <SalaryRow label="ESIC (Employer)" value={inr(sc.employer_esi ?? sc.esic_employer)} />
                    <SalaryRow label="CTC" value={inr(sc.ctc)} bold separator />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">No salary package assigned</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Payroll will fall back to the generic template split. Assign a catalog package or build a new one below.
                </p>
              </div>
            </div>
          )}

          {/* Assign controls */}
          {status === 'pending_review' && isReviewer && (
            <div className="space-y-4 border-t border-slate-100 pt-4">
              {/* Effective date */}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <Label className="text-xs font-medium mb-1.5 block text-slate-700">
                    Effective Date <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex flex-col gap-1">
                    <Input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      onBlur={async (e) => {
                        const newDate = e.target.value;
                        if (!newDate || newDate === loadedSalaryStartDate) return;
                        try {
                          await hrmsApi.patch(`/api/payroll-head-review/${employeeId}/salary-start-date`, {
                            salary_start_date: newDate,
                          });
                          setLoadedSalaryStartDate(newDate);
                          setNotice('Salary start date updated.');
                          setTimeout(() => setNotice(null), 3000);
                        } catch {
                          setError('Failed to update salary start date.');
                        }
                      }}
                      className="w-[160px] rounded-xl"
                    />
                    {journey?.payroll_hr_validation?.salary_start_date && (
                      <p className="text-xs text-slate-400">
                        Payroll HR set:{' '}
                        {new Date(journey.payroll_hr_validation.salary_start_date)
                          .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-400 mb-2">Required for both catalog and new package.</p>
              </div>

              {/* Select from catalog */}
              <div>
                <Label className="text-xs font-medium mb-1.5 block text-slate-700 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-slate-500" />Select from Catalog
                </Label>
                <div className="flex items-center gap-3">
                  <Select value={selectedPkgId} onValueChange={setSelectedPkgId}>
                    <SelectTrigger className="flex-1 rounded-xl">
                      <SelectValue placeholder="Choose a salary package…" />
                    </SelectTrigger>
                    <SelectContent>
                      {packages.length === 0
                        ? <SelectItem value="__none__" disabled>No packages for this branch yet</SelectItem>
                        : packages.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name ?? `Band ${p.band_code}`} · {inr(p.package_amount)}/mo
                            {p.band_code ? ` · Grade ${p.band_code}` : ''}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={busy || !selectedPkgId || !effectiveDate}
                    onClick={() => void assignExisting()}
                    className="cursor-pointer shrink-0 bg-purple-600 hover:bg-purple-700 rounded-xl"
                  >
                    Assign Package
                  </Button>
                </div>
              </div>

              {/* Build new */}
              <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100">
                <p className="text-xs text-slate-500 flex-1">
                  No suitable package in catalog? Build one with the salary calculator — PF/ESIC toggles, From CTC or In-Hand.
                </p>
                <Button variant="outline" disabled={busy || !effectiveDate} onClick={() => setPkgBuilderOpen(true)}
                  className="cursor-pointer shrink-0 gap-2 rounded-xl border-purple-200 text-purple-700 hover:bg-purple-50">
                  <Calculator className="h-4 w-4" />Build New Package
                </Button>
              </div>
            </div>
          )}

          {/* Accept button */}
          {status === 'pending_review' && isReviewer && review?.salary_package_id && !review?.package_accepted && (
            <div className="border-t border-slate-100 pt-4 flex items-center gap-3 mt-4">
              <Button disabled={busy} onClick={() => void acceptPackage()}
                className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 rounded-xl gap-2">
                <CheckCircle2 className="h-4 w-4" />Accept Package
              </Button>
              <p className="text-xs text-slate-500">
                Effective {fmtDate(review.package_effective_from)} — confirms payroll will use this breakdown.
              </p>
            </div>
          )}
        </SectionCard>

        {/* ── BGV ─────────────────────────────────────────────────────────────────── */}
        <SectionCard
          gradient="bg-gradient-to-r from-indigo-600 to-blue-600"
          title="Background Verification"
          desc={(() => {
            const os = journey?.bgv?.overall_status ?? journey?.bgv?.status;
            if (!os) return 'No BGV checks initiated';
            return `Overall: ${os.toUpperCase()}`;
          })()}
          icon={ShieldCheck}
        >
          {Array.isArray(journey?.bgv?.checks) && journey.bgv.checks.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {journey.bgv.checks.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      c.status === 'verified' || c.status === 'clear' ? 'bg-emerald-500'
                        : c.status === 'failed' || c.status === 'mismatch' ? 'bg-red-500'
                        : c.status === 'waived' ? 'bg-blue-400' : 'bg-amber-400'
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-slate-800">{c.check_type}</p>
                      {c.result_summary && <p className="text-xs text-slate-500 mt-0.5">{c.result_summary}</p>}
                      {c.verified_at && <p className="text-[11px] text-slate-400">{fmtDate(c.verified_at)}</p>}
                    </div>
                    <BgvBadge status={c.status} />
                  </div>
                  {isReviewer && c.status !== 'verified' && c.status !== 'clear' && c.status !== 'waived' && bgvCandidateId && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => void bgvManual(c.id, 'verified')}
                        className="h-7 text-xs cursor-pointer text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                        <CheckCircle2 className="h-3 w-3 mr-1" />Verify
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => void bgvManual(c.id, 'failed')}
                        className="h-7 text-xs cursor-pointer text-red-600 border-red-200 hover:bg-red-50">
                        <XCircle className="h-3 w-3 mr-1" />Fail
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => void bgvWaive(c.id)}
                        className="h-7 text-xs cursor-pointer">
                        Waive
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <ShieldCheck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">{journey?.bgv?.message ?? 'No BGV checks on file.'}</p>
            </div>
          )}
        </SectionCard>

        {/* ── Bank Readiness ──────────────────────────────────────────────────────── */}
        <SectionCard
          gradient="bg-gradient-to-r from-blue-600 to-cyan-600"
          title="Bank Readiness"
          icon={Banknote}
        >
          {journey?.bank ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Readiness', value: journey.bank.readiness_class, tone: journey.bank.payable ? 'green' : 'amber' },
                  { label: 'Payable', value: journey.bank.payable ? 'Yes ✓' : 'Not yet', tone: journey.bank.payable ? 'green' : 'red' },
                  { label: 'Bank', value: journey.bank.bank_name ?? '—', tone: 'slate' },
                  { label: 'Account', value: journey.bank.account_masked ?? '—', tone: 'slate' },
                ].map((t) => (
                  <KpiTile key={t.label} label={t.label} value={t.value} tone={t.tone as any} />
                ))}
              </div>
              {journey.bank.reason_detail && (
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-sm text-slate-600">
                  <span className="font-medium text-slate-700">Note: </span>{journey.bank.reason_detail}
                </div>
              )}
              <p className="text-xs text-slate-400">
                Bank corrections go through the Bank Change Request workflow, not directly here.
              </p>
            </div>
          ) : <p className="text-sm text-slate-400">No bank readiness data available.</p>}
        </SectionCard>

        {/* ── Documents ──────────────────────────────────────────────────────────── */}
        <SectionCard
          gradient="bg-gradient-to-r from-teal-600 to-emerald-600"
          title={`Documents (${journey?.documents?.length ?? 0})`}
          icon={FileText}
        >
          {(journey?.documents ?? []).length === 0 ? (
            <div className="text-center py-5">
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No documents uploaded yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {(journey.documents as any[]).map((d) => (
                <div key={d.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-2 h-2 rounded-full ${d.verified ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <span className="text-sm text-slate-700">{d.doc_name || d.doc_type}</span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                      d.verified ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>{d.verified ? 'Verified' : 'Not verified'}</span>
                  </div>
                  {isReviewer && !d.verified && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void verifyDoc(d.id, 'verified')}
                        className="h-7 text-xs cursor-pointer text-emerald-700 border-emerald-200 hover:bg-emerald-50">Verify</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void verifyDoc(d.id, 'rejected')}
                        className="h-7 text-xs cursor-pointer text-red-600 border-red-200 hover:bg-red-50">Reject</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── Joining Kit ──────────────────────────────────────────────────────────── */}
        <SectionCard
          gradient="bg-gradient-to-r from-amber-500 to-orange-500"
          title="Joining Kit & eSign"
          icon={FileSignature}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Kit status:</span>
              <span className={`font-semibold px-2.5 py-0.5 rounded-full text-xs border ${
                journey?.joining_kit?.status === 'signed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : journey?.joining_kit?.status === 'sent' ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}>{journey?.joining_kit?.status ?? 'No kit sent yet'}</span>
            </div>
            {(journey?.joining_checklist ?? []).length > 0 && (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 overflow-hidden">
                {(journey.joining_checklist as any[]).map((c) => {
                  const isCompleted = c.status === 'signed' || c.status === 'completed' || c.status === 'esign_completed';
                  return (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        <span className="text-sm text-slate-700">{c.document_name || c.document_code}</span>
                      </div>
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                        isCompleted
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : c.status?.includes('initiated') ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}>{c.status}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Review History ──────────────────────────────────────────────────────── */}
        {Array.isArray(journey?.history) && journey.history.length > 0 && (
          <SectionCard
            gradient="bg-gradient-to-r from-slate-600 to-slate-700"
            title="Review History"
            icon={HistoryIcon}
          >
            <div className="relative pl-5">
              {/* Timeline line */}
              <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-slate-100" />
              {(journey.history as any[]).map((h, idx) => (
                <div key={h.id} className="relative pb-4 last:pb-0">
                  {/* Timeline dot */}
                  <div className={`absolute -left-3 top-1 w-3 h-3 rounded-full border-2 border-white ${
                    h.action === 'approved' ? 'bg-emerald-500'
                      : h.action === 'rejected' ? 'bg-red-500'
                      : h.action === 'reopened' ? 'bg-amber-500'
                      : 'bg-slate-400'
                  }`} />
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize border ${
                      h.action === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : h.action === 'rejected' ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>{h.action}</span>
                    <span className="text-xs text-slate-400">{fmtDate(h.created_at)}</span>
                  </div>
                  {h.rejection_category && (
                    <p className="text-sm text-slate-600">
                      <span className="font-medium">{h.rejection_category} / {h.rejection_reason_code}:</span>{' '}
                      {h.rejection_remarks}
                    </p>
                  )}
                  {h.reopen_reason && <p className="text-sm text-slate-600">Reason: {h.reopen_reason}</p>}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── Decision ────────────────────────────────────────────────────────────── */}
        {status === 'pending_review' && isReviewer && (
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 p-5">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Ready to decide?</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {review?.package_accepted
                    ? 'All checks complete — you can approve for payroll.'
                    : 'Assign and accept a salary package above before approving.'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  disabled={busy}
                  variant="destructive"
                  onClick={() => setRejectOpen(true)}
                  className="cursor-pointer rounded-xl gap-2"
                >
                  <XCircle className="h-4 w-4" />Reject
                </Button>
                <Button
                  disabled={busy || !review?.package_accepted}
                  onClick={() => void approve()}
                  className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 rounded-xl gap-2 shadow-lg shadow-emerald-500/25 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve for Payroll
                </Button>
              </div>
            </div>
            {!review?.package_accepted && (
              <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
                <Lock className="h-3 w-3" />Approve button unlocks after salary package is assigned and accepted.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────────────────── */}

      <PackageBuilderDialog
        open={pkgBuilderOpen}
        onOpenChange={setPkgBuilderOpen}
        defaultBranch={employeeBranch ?? ''}
        onPackageCreated={(pkgId) => void onPackageBuilt(pkgId)}
      />

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="h-5 w-5" />Reject Salary Review
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Category</Label>
              <Select value={rejectCategory} onValueChange={(v) => { setRejectCategory(v); setRejectCode(''); }}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="What's the issue?" /></SelectTrigger>
                <SelectContent>
                  {['salary', 'documents', 'bgv', 'bank', 'other'].map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rejectCategory === 'salary' && (
                <p className="text-xs text-amber-600 mt-1.5 bg-amber-50 border border-amber-100 rounded-lg p-2">
                  Salary rejection clears the assigned package — it must be reassigned after resubmission.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Reason</Label>
              <Select value={rejectCode} onValueChange={setRejectCode} disabled={!rejectCategory}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {reasonsFiltered.length === 0
                    ? <SelectItem value="__none__" disabled>No reasons for this category</SelectItem>
                    : reasonsFiltered.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium mb-1.5 block">
                Remarks <span className="text-slate-400 font-normal">(required — what exactly needs fixing)</span>
              </Label>
              <Textarea value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)} rows={4}
                className="rounded-xl" placeholder="Be specific — this goes to Payroll HR and the Branch Head…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} className="cursor-pointer rounded-xl">Cancel</Button>
            <Button variant="destructive" disabled={busy || !rejectCategory || !rejectCode || !rejectRemarks.trim()}
              onClick={() => void submitReject()} className="cursor-pointer rounded-xl">
              Submit Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-600" />Reopen for Correction
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-600 bg-amber-50 border border-amber-100 rounded-xl p-3">
              This moves the review back to pending — the employee will be excluded from future payroll runs
              until re-approved. It does not undo any run that already completed.
            </p>
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Reason (required)</Label>
              <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={3}
                className="rounded-xl" placeholder="What needs to be corrected…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)} className="cursor-pointer rounded-xl">Cancel</Button>
            <Button variant="destructive" disabled={busy || !reopenReason.trim()}
              onClick={() => void submitReopen()} className="cursor-pointer rounded-xl">
              Reopen Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
