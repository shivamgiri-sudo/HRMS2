/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HrmsModernShell, HrmsBentoTile } from '@/components/ui/hrms-modern';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Database, Download, Loader2, RefreshCw, Shield, ShieldAlert, ShieldCheck,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SummaryData {
  bgv_auto_approved_count: number;
  bgv_payroll_eligible_without_real_bgv: number;
  salary_annual_equals_monthly_count: number;
  employees_with_duplicate_salary: number;
  onboarded_without_employee: number;
  offer_approved_no_employee: number;
  active_employees_before_joining: number;
  sla_overdue_employees: number;
  employees_with_unassigned_tasks: number;
  it_email_sync_gap: number;
}

type Severity = 'critical' | 'warning' | 'ok';

interface Section {
  key: string;
  label: string;
  description: string;
  endpoint: string;
  summaryKey: keyof SummaryData;
  severity: (count: number) => Severity;
  columns: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  // BGV
  {
    key: 'bgv_auto_approved',
    label: 'BGV Auto-Approved Records',
    description: 'Candidates whose BGV checks were auto-approved without real provider verification.',
    endpoint: '/api/ats/reconciliation/bgv/auto-approved',
    summaryKey: 'bgv_auto_approved_count',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['candidate_code', 'full_name', 'auto_approved_checks', 'total_checks', 'overall_status', 'employee_code'],
  },
  {
    key: 'bgv_payroll_without_bgv',
    label: 'Payroll-Validated Without Real BGV',
    description: 'Candidates passed Payroll HR validation but BGV not genuinely verified.',
    endpoint: '/api/ats/reconciliation/bgv/payroll-without-bgv',
    summaryKey: 'bgv_payroll_eligible_without_real_bgv',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['candidate_code', 'full_name', 'validation_status', 'bgv_overall_status', 'bgv_auto_approved'],
  },
  {
    key: 'bgv_clear_without_checks',
    label: 'BGV Clear Without Mandatory Checks',
    description: 'BGV report marked clear but PAN/Aadhaar/Bank not all verified.',
    endpoint: '/api/ats/reconciliation/bgv/clear-without-checks',
    summaryKey: 'bgv_auto_approved_count',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['candidate_code', 'full_name', 'bgv_score', 'unverified_checks'],
  },
  // Salary
  {
    key: 'salary_annual_equals_monthly',
    label: 'Annual CTC Looks Like Monthly Gross',
    description: 'Offers where offered_ctc ≈ gross (±5%) — possible monthly value stored as annual.',
    endpoint: '/api/ats/reconciliation/salary/annual-equals-monthly',
    summaryKey: 'salary_annual_equals_monthly_count',
    severity: (n) => n > 0 ? 'warning' : 'ok',
    columns: ['candidate_code', 'full_name', 'annual_ctc_in_offer', 'monthly_gross_in_offer', 'offer_status', 'employee_code'],
  },
  {
    key: 'salary_joining_before_start',
    label: 'Salary Start Before Joining Date',
    description: 'Salary effective date is before joining date — statutory violation.',
    endpoint: '/api/ats/reconciliation/salary/joining-before-salary-start',
    summaryKey: 'salary_annual_equals_monthly_count',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['candidate_code', 'full_name', 'joining_date', 'salary_start_date', 'days_difference', 'employee_code'],
  },
  {
    key: 'salary_duplicate_assignments',
    label: 'Employees With Duplicate Active Salary',
    description: 'Multiple active salary assignments for same employee.',
    endpoint: '/api/ats/reconciliation/salary/duplicate-assignments',
    summaryKey: 'employees_with_duplicate_salary',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['employee_code', 'employee_name', 'active_assignments', 'ctc_values'],
  },
  // Lifecycle
  {
    key: 'onboarded_without_employee',
    label: 'Onboarded Without Employee Record',
    description: 'Candidate marked onboarded but no employee created in bridge.',
    endpoint: '/api/ats/reconciliation/lifecycle/onboarded-without-employee',
    summaryKey: 'onboarded_without_employee',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['candidate_code', 'full_name', 'profile_status', 'bridge_status', 'bridge_created'],
  },
  {
    key: 'offer_approved_no_employee',
    label: 'Offer Approved Without Employee Creation',
    description: 'Branch Head approved offer but no employee record exists.',
    endpoint: '/api/ats/reconciliation/lifecycle/offer-approved-no-employee',
    summaryKey: 'offer_approved_no_employee',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['candidate_code', 'full_name', 'offer_status', 'date_of_joining', 'bridge_status'],
  },
  {
    key: 'active_before_joining',
    label: 'Active Employees Before Joining Date',
    description: 'Employees with active_status=1 but joining date is in the future.',
    endpoint: '/api/ats/reconciliation/lifecycle/active-before-joining',
    summaryKey: 'active_employees_before_joining',
    severity: (n) => n > 0 ? 'warning' : 'ok',
    columns: ['employee_code', 'employee_name', 'date_of_joining', 'days_until_joining', 'employment_status'],
  },
  // Provisioning
  {
    key: 'missing_mandatory_tasks',
    label: 'Employees Missing Mandatory Tasks',
    description: 'Employees created in last 90 days with one or more mandatory provisioning tasks not created.',
    endpoint: '/api/ats/reconciliation/provisioning/missing-mandatory-tasks',
    summaryKey: 'sla_overdue_employees',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['employee_code', 'employee_name', 'date_of_joining', 'employment_status', 'missing_tasks'],
  },
  {
    key: 'email_sync_gap',
    label: 'IT Email Sync Gap',
    description: 'IT provisioning task has official email but employees.official_email differs or is null.',
    endpoint: '/api/ats/reconciliation/provisioning/email-sync-gap',
    summaryKey: 'it_email_sync_gap',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['employee_code', 'employee_name', 'task_official_email', 'employee_official_email', 'task_status'],
  },
  {
    key: 'tasks_done_inactive',
    label: 'All Tasks Done But Employee Inactive',
    description: 'All mandatory tasks actioned/waived but employee still active_status=0 past joining date.',
    endpoint: '/api/ats/reconciliation/provisioning/tasks-done-employee-inactive',
    summaryKey: 'employees_with_unassigned_tasks',
    severity: (n) => n > 0 ? 'warning' : 'ok',
    columns: ['employee_code', 'employee_name', 'date_of_joining', 'employment_status', 'total_tasks', 'completed_tasks'],
  },
  {
    key: 'duplicate_tasks',
    label: 'Duplicate Provisioning Tasks',
    description: 'Same employee has more than one task of the same type.',
    endpoint: '/api/ats/reconciliation/provisioning/duplicate-tasks',
    summaryKey: 'sla_overdue_employees',
    severity: (n) => n > 0 ? 'warning' : 'ok',
    columns: ['employee_code', 'employee_name', 'task_code', 'duplicate_count', 'statuses'],
  },
  // Duplication
  {
    key: 'candidate_multiple_employees',
    label: 'Candidates With Multiple Employees',
    description: 'One candidate linked to more than one employee record.',
    endpoint: '/api/ats/reconciliation/duplication/candidate-multiple-employees',
    summaryKey: 'onboarded_without_employee',
    severity: (n) => n > 0 ? 'critical' : 'ok',
    columns: ['candidate_code', 'full_name', 'employee_count', 'employee_codes'],
  },
  {
    key: 'employee_code_mismatch',
    label: 'Employee Code Mismatch',
    description: 'ats_candidate.employee_code differs from employees.employee_code.',
    endpoint: '/api/ats/reconciliation/duplication/employee-code-mismatch',
    summaryKey: 'onboarded_without_employee',
    severity: (n) => n > 0 ? 'warning' : 'ok',
    columns: ['candidate_code', 'full_name', 'candidate_employee_code', 'actual_employee_code'],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function exportCsv(data: any[], filename: string) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const rows = [keys.join(','), ...data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SeverityIcon({ sev }: { sev: Severity }) {
  if (sev === 'critical') return <ShieldAlert className="h-4 w-4 text-red-500" />;
  if (sev === 'warning')  return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
}

function SeverityBadge({ sev, count }: { sev: Severity; count: number }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold';
  if (sev === 'critical') return <span className={`${base} bg-red-50 text-red-700`}>{count} issues</span>;
  if (sev === 'warning')  return <span className={`${base} bg-amber-50 text-amber-700`}>{count} warnings</span>;
  return <span className={`${base} bg-emerald-50 text-emerald-700`}>Clean</span>;
}

// ── Section component ──────────────────────────────────────────────────────────

function ReconciliationSection({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reconciliation', section.key],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[]; count: number }>(section.endpoint);
      return (res as any)?.data ?? [];
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const rows: any[] = data ?? [];
  const count = rows.length;
  const sev = section.severity(count);

  return (
    <div className={`rounded-xl border bg-white shadow-sm overflow-hidden ${
      sev === 'critical' ? 'border-red-200' : sev === 'warning' ? 'border-amber-200' : 'border-slate-200'
    }`}>
      <button
        type="button"
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <SeverityIcon sev={sev} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm">{section.label}</p>
          <p className="text-xs text-slate-500 mt-0.5">{section.description}</p>
        </div>
        {isLoading && open ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400 shrink-0" />
        ) : (
          <SeverityBadge sev={sev} count={count} />
        )}
        {open ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> No anomalies found.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-slate-700">{rows.length} record{rows.length > 1 ? 's' : ''} found</p>
                <Button
                  variant="outline" size="sm"
                  className="min-h-[36px] text-xs gap-1"
                  onClick={() => { void refetch(); exportCsv(rows, `${section.key}.csv`); }}
                >
                  <Download className="h-3 w-3" /> Export CSV
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      {section.columns.map(col => (
                        <th key={col} className="text-left px-3 py-2 font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">
                          {col.replace(/_/g, ' ')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.slice(0, 100).map((row, i) => (
                      <tr key={i} className={`hover:bg-slate-50/50 ${sev === 'critical' ? 'hover:bg-red-50/30' : ''}`}>
                        {section.columns.map(col => (
                          <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                            {row[col] != null ? String(row[col]) : <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 100 && (
                  <p className="text-xs text-slate-500 px-3 py-2 border-t">
                    Showing 100 of {rows.length} records. Export CSV for full data.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeReconciliationDashboard() {
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ['reconciliation-summary'],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: SummaryData }>('/api/ats/reconciliation/summary');
      return (res as any)?.data as SummaryData;
    },
    staleTime: 5 * 60 * 1000,
  });

  const totalCritical = summary ? [
    summary.bgv_auto_approved_count,
    summary.bgv_payroll_eligible_without_real_bgv,
    summary.onboarded_without_employee,
    summary.offer_approved_no_employee,
    summary.sla_overdue_employees,
    summary.it_email_sync_gap,
  ].filter(n => n > 0).length : 0;

  const groups = [
    { title: 'BGV Anomalies', icon: <Shield className="h-4 w-4" />, keys: ['bgv_auto_approved', 'bgv_payroll_without_bgv', 'bgv_clear_without_checks'] },
    { title: 'Salary Anomalies', icon: <AlertTriangle className="h-4 w-4" />, keys: ['salary_annual_equals_monthly', 'salary_joining_before_start', 'salary_duplicate_assignments'] },
    { title: 'Lifecycle Anomalies', icon: <ShieldAlert className="h-4 w-4" />, keys: ['onboarded_without_employee', 'offer_approved_no_employee', 'active_before_joining'] },
    { title: 'Provisioning Anomalies', icon: <AlertTriangle className="h-4 w-4" />, keys: ['missing_mandatory_tasks', 'email_sync_gap', 'tasks_done_inactive', 'duplicate_tasks'] },
    { title: 'Duplication', icon: <AlertTriangle className="h-4 w-4" />, keys: ['candidate_multiple_employees', 'employee_code_mismatch'] },
  ];

  return (
    <HrmsModernShell
        eyebrow="Super Admin · Data Quality"
        title="Reconciliation Dashboard"
        description="Detect and resolve data anomalies across the candidate-to-employee lifecycle."
        icon={<Database className="h-6 w-6" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetchSummary()} disabled={summaryLoading} className="gap-2 min-h-[40px]">
            <RefreshCw className={`h-4 w-4 ${summaryLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      >
      <div className="space-y-6">

        {/* Summary tiles — HrmsBentoTile */}
        {summaryLoading ? (
          <div className="flex h-24 items-center justify-center rounded-xl border bg-white">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : summary && (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
            <HrmsBentoTile title="BGV Auto-Approved" value={summary.bgv_auto_approved_count} detail="Fake verified records" icon={<ShieldAlert className="h-5 w-5 text-red-600" />} accentClassName={summary.bgv_auto_approved_count > 0 ? 'from-red-500 to-rose-500' : 'from-emerald-500 to-teal-500'} />
            <HrmsBentoTile title="Payroll w/o BGV" value={summary.bgv_payroll_eligible_without_real_bgv} detail="Validated without real BGV" icon={<AlertTriangle className="h-5 w-5 text-red-600" />} accentClassName={summary.bgv_payroll_eligible_without_real_bgv > 0 ? 'from-red-500 to-rose-500' : 'from-emerald-500 to-teal-500'} />
            <HrmsBentoTile title="Offer → No Employee" value={summary.offer_approved_no_employee} detail="Approved offers missing record" icon={<AlertTriangle className="h-5 w-5 text-amber-600" />} accentClassName={summary.offer_approved_no_employee > 0 ? 'from-amber-500 to-orange-500' : 'from-emerald-500 to-teal-500'} />
            <HrmsBentoTile title="SLA Overdue" value={summary.sla_overdue_employees} detail="Provisioning past deadline" icon={<Shield className="h-5 w-5 text-amber-600" />} accentClassName={summary.sla_overdue_employees > 0 ? 'from-amber-500 to-orange-500' : 'from-emerald-500 to-teal-500'} />
            <HrmsBentoTile title="Email Sync Gap" value={summary.it_email_sync_gap} detail="IT task done, master not synced" icon={<ShieldAlert className="h-5 w-5 text-blue-600" />} accentClassName={summary.it_email_sync_gap > 0 ? 'from-blue-500 to-cyan-500' : 'from-emerald-500 to-teal-500'} className="col-span-2 lg:col-span-1" />
          </div>
        )}

        {totalCritical > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800 text-sm">{totalCritical} critical anomaly type{totalCritical > 1 ? 's' : ''} detected</p>
              <p className="text-xs text-red-600 mt-0.5">Expand each section below to review and export affected records.</p>
            </div>
          </div>
        )}

        {/* Grouped sections */}
        {groups.map(group => {
          const groupSections = SECTIONS.filter(s => group.keys.includes(s.key));
          return (
            <div key={group.title} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                {group.icon}
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">{group.title}</h2>
              </div>
              <div className="space-y-2">
                {groupSections.map(section => (
                  <ReconciliationSection key={section.key} section={section} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      </HrmsModernShell>
  );
}
