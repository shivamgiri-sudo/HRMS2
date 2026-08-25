import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Loader2, Search, RefreshCw, ShieldCheck, Clock, AlertTriangle,
  CheckCircle2, Building2, Briefcase, IndianRupee, ChevronRight,
} from 'lucide-react';
import {
  STATUS_CFG, AgingChip, OfferedSalarySection, FinalSalarySection, BgvSection, BankSection,
  inr, fmtDate, fmtTs,
  type QueueRow,
} from './PayrollHeadSalaryReviewQueue';

/**
 * Read-only view for Branch Head / Payroll HR: which of their onboarded employees are still
 * waiting on Payroll Head's salary approval, and for the approved ones, what package and
 * salary date Payroll Head actually assigned.
 *
 * Backed by the SAME /api/payroll-head-review/queue and /:employeeId endpoints the full
 * Salary Review Queue uses — that endpoint already branch/process-scopes payroll_hr/branch_head
 * server-side (see payroll-head-review.service.ts getQueue()), so this page shows exactly what
 * each caller is allowed to see, nothing more. Every section component below is reused verbatim
 * from the Queue page with isReviewer={false} — they already hide every action button under
 * that flag, so this page has zero new write paths, purely a read surface.
 */

// ── Read-only detail dialog ──────────────────────────────────────────────────

function ReadOnlyDetailDialog({
  employeeId, open, onClose,
}: { employeeId: string | null; open: boolean; onClose: () => void }) {
  const [journey, setJourney] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !employeeId) { setJourney(null); return; }
    setLoading(true);
    hrmsApi.get<{ data: any }>(`/api/payroll-head-review/${employeeId}`)
      .then((r: any) => setJourney(r?.data ?? null))
      .catch(() => setJourney(null))
      .finally(() => setLoading(false));
  }, [open, employeeId]);

  const review = journey?.review;
  const employee = journey?.employee;
  const status = review?.status;
  const statusCfg = STATUS_CFG[status as keyof typeof STATUS_CFG] ?? STATUS_CFG.pending_review;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {employee?.full_name ?? '…'}
            {status && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border ${statusCfg.chip}`}>
                <statusCfg.icon className="h-3 w-3" />{statusCfg.label}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        ) : !journey ? (
          <p className="text-sm text-slate-400 py-6 text-center">Could not load this employee.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
              {employee?.employee_code && <span>{employee.employee_code}</span>}
              {employee?.designation_name && <span>{employee.designation_name}</span>}
              {employee?.branch_name && <span>{employee.branch_name}</span>}
              {employee?.cost_centre_name && <span>{employee.cost_centre_name}</span>}
              {employee?.process_name && <span>{employee.process_name}</span>}
            </div>

            {status === 'approved' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 space-y-0.5">
                <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />Approved for payroll</p>
                <p className="text-xs">Payroll effective date: <strong>{fmtDate(review?.package_effective_from)}</strong></p>
                {journey?.payroll_hr_validation?.salary_start_date && (
                  <p className="text-xs">Payroll HR reference date: {fmtDate(journey.payroll_hr_validation.salary_start_date)}</p>
                )}
                {review?.reviewed_at && <p className="text-xs">Approved on {fmtDate(review.reviewed_at)}</p>}
              </div>
            )}
            {status === 'rejected' && review?.rejection_remarks && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <p className="font-semibold">Rejected — {review.rejection_category} / {review.rejection_reason_code}</p>
                <p className="text-xs mt-1">{review.rejection_remarks}</p>
              </div>
            )}
            {status === 'pending_review' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />Still waiting on Payroll Head's decision.
              </div>
            )}

            {journey?.offered_salary && (
              <OfferedSalarySection
                os={journey.offered_salary} sc={journey.salary_components} review={review}
                status={status} isReviewer={false} effectiveDate="" setEffectiveDate={() => {}}
                busy={false} onApprove={() => {}} payrollHrValidation={journey?.payroll_hr_validation}
              />
            )}
            <FinalSalarySection
              sc={journey?.salary_components} os={journey?.offered_salary} review={review}
              status={status} isReviewer={false} effectiveDate="" setEffectiveDate={() => {}} busy={false}
              packages={[]} selectedGrade="" setSelectedGrade={() => {}} selectedPkgId="" setSelectedPkgId={() => {}}
              assignExisting={() => {}} acceptPackage={() => {}} onBuildPackage={() => {}}
            />
            <BgvSection
              bgv={journey?.bgv} bgvOverall={journey?.bgv?.overall_status ?? journey?.bgv?.status}
              isReviewer={false} bgvCandidateId={null} bgvManual={() => {}} bgvWaive={() => {}}
            />
            <BankSection bank={journey?.bank} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PayrollApprovalStatusView() {
  const [tab, setTab] = useState<'pending_review' | 'approved' | 'rejected'>('pending_review');
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [detailEmployee, setDetailEmployee] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: tab });
      if (q.trim()) params.set('q', q.trim());
      if (branch) params.set('branch', branch);
      const r = await hrmsApi.get<{ data: QueueRow[] }>(`/api/payroll-head-review/queue?${params}`);
      const data = (r as any)?.data ?? [];
      setRows(data);
      setCounts((prev) => ({ ...prev, [tab]: data.length }));
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [tab, q, branch]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    hrmsApi.get<{ data: string[] }>('/api/payroll-head-review/branches')
      .then((r: any) => setBranches(r?.data ?? [])).catch(() => {});
  }, []);

  const tabLabel = (s: string) => {
    const c = counts[s];
    const base = STATUS_CFG[s as keyof typeof STATUS_CFG]?.label ?? s;
    return c != null ? `${base} (${c})` : base;
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5">

        <div className="rounded-2xl bg-gradient-to-br from-slate-700 via-slate-600 to-slate-800 text-white px-6 py-5 shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Salary Approval Status</h1>
                <p className="text-slate-300 text-sm mt-0.5">
                  Read-only — which onboarded employees are still waiting on Payroll Head, and what was assigned once approved
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}
              className="border-white/30 bg-white/15 text-white hover:bg-white/25 cursor-pointer">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="rounded-xl">
              <TabsTrigger value="pending_review" className="cursor-pointer text-xs">{tabLabel('pending_review')}</TabsTrigger>
              <TabsTrigger value="approved" className="cursor-pointer text-xs">{tabLabel('approved')}</TabsTrigger>
              <TabsTrigger value="rejected" className="cursor-pointer text-xs">{tabLabel('rejected')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input placeholder="Name or employee code…" value={q} onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-9 text-sm rounded-xl" />
          </div>
          <Select value={branch || '__all__'} onValueChange={(v) => setBranch(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[160px] h-9 text-sm rounded-xl"><SelectValue placeholder="All branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All branches</SelectItem>
              {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-16 rounded-2xl border border-dashed border-slate-200 text-slate-400">
              <ShieldCheck className="h-10 w-10 mb-3 text-slate-300" />
              <p className="font-medium text-slate-600">No employees in this state</p>
            </div>
          ) : (
            rows.map((row) => {
              const cfg = STATUS_CFG[row.status];
              const Icon = cfg.icon;
              const isOverdue = row.status === 'pending_review' && row.pending_hours >= 48;
              const initials = row.full_name?.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() ?? '?';
              return (
                <div
                  key={row.review_id}
                  onClick={() => { setDetailEmployee(row.employee_id); setDetailOpen(true); }}
                  className={`group flex items-center gap-4 rounded-2xl border bg-white px-4 py-3.5 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-slate-300 ${
                    isOverdue ? 'border-l-4 border-l-red-400 border-red-100' : row.status === 'pending_review' ? 'border-l-4 border-l-amber-400 border-slate-100' : row.status === 'approved' ? 'border-l-4 border-l-emerald-400 border-slate-100' : 'border-l-4 border-l-rose-400 border-slate-100'
                  }`}
                >
                  <div className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-sm flex-shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900 text-sm">{row.full_name}</p>
                      <span className="font-mono text-[11px] text-slate-400 bg-slate-50 rounded px-1">{row.employee_code}</span>
                      {isOverdue && <span className="text-[10px] font-bold text-red-600 bg-red-50 rounded-full px-1.5 py-0.5 flex items-center gap-0.5 border border-red-200"><AlertTriangle className="h-2.5 w-2.5" />Overdue</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      {row.designation_name && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3 text-slate-300" />{row.designation_name}</span>}
                      {row.branch_name && <span className="flex items-center gap-1"><Building2 className="h-3 w-3 text-slate-300" />{row.branch_name}</span>}
                    </div>
                    {(row.cost_centre_name || row.process_name || row.emp_type) && (
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {[row.cost_centre_name, row.process_name, row.emp_type].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Raised: {fmtTs(row.created_at)}
                      {row.reviewed_at && <> &nbsp;·&nbsp; Approved: {fmtTs(row.reviewed_at)}</>}
                    </p>
                  </div>
                  <div className="hidden sm:flex flex-col items-end min-w-[90px]">
                    <p className="text-sm font-bold text-slate-900 tabular-nums flex items-center gap-1">
                      <IndianRupee className="h-3 w-3 text-slate-400" />
                      {row.final_ctc ? `${inr(row.final_ctc)}/mo` : row.offered_ctc ? `${inr(row.offered_ctc)}/mo` : '—'}
                    </p>
                    <p className="text-[10px] text-slate-400">{row.status === 'approved' ? 'assigned package' : 'monthly CTC'}</p>
                  </div>
                  <div className="hidden md:flex flex-col items-center gap-1 min-w-[110px]">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border ${cfg.chip}`}>
                      <Icon className="h-3 w-3" />{cfg.label}
                    </span>
                    <AgingChip hours={row.pending_hours} status={row.status} />
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                </div>
              );
            })
          )}
        </div>

        {rows.length > 0 && (
          <p className="text-xs text-slate-400">{rows.length} employee{rows.length !== 1 ? 's' : ''} shown</p>
        )}
      </div>

      <ReadOnlyDetailDialog
        employeeId={detailEmployee}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </DashboardLayout>
  );
}
