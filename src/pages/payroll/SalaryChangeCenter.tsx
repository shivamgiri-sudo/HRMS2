import { useState, useEffect, useRef, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, Search, IndianRupee, User, CheckCircle2, AlertTriangle, History, Calculator,
} from 'lucide-react';
import { PackageBuilderDialog } from '@/components/payroll/PackageBuilderDialog';
import { inr, fmtDate } from './PayrollHeadSalaryReviewQueue';
import { pfYesNo, esicYesNo } from '@/lib/salaryEligibility';
import { earningRows, otherDeductionRows, employerCostRows } from '@/lib/salaryComponentRows';

/**
 * Salary Change Center — Payroll Head searches any active employee, sees their full current
 * salary, and changes it via the same PackageBuilderDialog used in Salary Review (pick a
 * catalog package or build one). Submitting writes a new active salary_component_assignments
 * row and supersedes the old one (backend: salary-change.service.ts), plus a full audit trail
 * in employee_salary_change_log — including who requested the change, picked from a search,
 * separate from who actually submitted it.
 */

interface EmployeeSearchResult {
  id: string;
  employee_code: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
}
interface EmployeeSearchApiResponse { employees?: EmployeeSearchResult[]; data?: EmployeeSearchResult[]; }

function displayName(e: EmployeeSearchResult) {
  return e.full_name ?? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
}

// ── Reusable debounced employee search combobox ──────────────────────────────

function EmployeePicker({
  placeholder, value, onSelect,
}: { placeholder: string; value: EmployeeSearchResult | null; onSelect: (e: EmployeeSearchResult | null) => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<EmployeeSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim() || value) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await hrmsApi.get<EmployeeSearchApiResponse | EmployeeSearchResult[]>(
          `/api/employees?search=${encodeURIComponent(search.trim())}&limit=10`
        );
        const list = Array.isArray(data) ? data : (data.employees ?? data.data ?? []);
        setResults(list);
        setOpen(list.length > 0);
      } catch { setResults([]); setOpen(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <User className="h-4 w-4 text-slate-400 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-800 flex-1 truncate">{displayName(value)} ({value.employee_code})</span>
        <button type="button" onClick={() => { onSelect(null); setSearch(''); }}
          className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer">Change</button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
      <Input placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)}
        className="pl-8 h-9 text-sm rounded-xl" />
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {results.map((r) => (
            <button key={r.id} type="button"
              onClick={() => { onSelect(r); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer flex items-center justify-between">
              <span className="font-medium text-slate-800">{displayName(r)}</span>
              <span className="font-mono text-[11px] text-slate-400">{r.employee_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SalaryChangeCenter() {
  const [targetEmployee, setTargetEmployee] = useState<EmployeeSearchResult | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pkgBuilderOpen, setPkgBuilderOpen] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [requestor, setRequestor] = useState<EmployeeSearchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadProfile = useCallback(async (employeeId: string) => {
    setLoading(true); setError(null); setProfile(null);
    try {
      const r = await hrmsApi.get<{ data: any }>(`/api/salary-change/employee/${employeeId}`);
      setProfile((r as any)?.data ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load employee.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (targetEmployee) void loadProfile(targetEmployee.id);
    else setProfile(null);
  }, [targetEmployee, loadProfile]);

  const sc = profile?.salary_components;
  const employee = profile?.employee;

  const submitChange = async (packageId: string) => {
    if (!targetEmployee) return;
    if (!effectiveDate) { setError('Set an effective date first.'); return; }
    if (!reason.trim()) { setError('A reason is required.'); return; }
    if (!requestor) { setError('Select who requested this change.'); return; }
    setSubmitting(true); setError(null); setNotice(null);
    try {
      await hrmsApi.post(`/api/salary-change/${targetEmployee.id}`, {
        package_id: packageId,
        effective_date: effectiveDate,
        reason: reason.trim(),
        requested_by_user_id: requestor.id,
        requested_by_name: displayName(requestor),
      });
      setNotice('Salary changed and fully audited.');
      setReason(''); setRequestor(null);
      await loadProfile(targetEmployee.id);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to change salary.');
    } finally { setSubmitting(false); }
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">

        <div className="rounded-2xl bg-gradient-to-br from-purple-600 via-violet-600 to-indigo-700 text-white px-6 py-5 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <IndianRupee className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Salary Change Center</h1>
              <p className="text-indigo-200 text-sm mt-0.5">
                Search an active employee, review current salary, and change it — fully audited
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Employee</Label>
          <EmployeePicker placeholder="Search by name or employee code…" value={targetEmployee} onSelect={setTargetEmployee} />
        </div>

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

        {loading && (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
        )}

        {profile && employee && (
          <>
            {/* Tabular profile */}
            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Employee Profile</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-100">
                {[
                  ['Name', employee.full_name], ['Code', employee.employee_code],
                  ['Branch', employee.branch_name ?? '—'], ['Designation', employee.designation_name ?? '—'],
                  ['Cost Centre', employee.cost_centre_name ?? '—'], ['Process', employee.process_name ?? '—'],
                  ['Emp Type', employee.emp_type ?? '—'], ['DOJ', fmtDate(employee.date_of_joining)],
                ].map(([label, value]) => (
                  <div key={label as string} className="bg-white px-3 py-2">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{label}</p>
                    <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Current salary */}
            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-purple-600 to-violet-600 px-4 py-2.5 flex items-center gap-2">
                <IndianRupee className="h-3.5 w-3.5 text-white" />
                <p className="text-xs font-semibold text-white">Current Active Salary</p>
              </div>
              <div className="p-4">
                {sc ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    {[
                      // Same row list as the Salary Review screens — see salaryComponentRows.ts.
                      // Bonus and admin charges reach this card through the
                      // salary_package_master join added to getEmployeeSalaryProfile.
                      ...earningRows(sc).map((r) => [r.label, inr(r.value)]),
                      ['Gross', inr(sc.gross)],
                      ...otherDeductionRows(sc).map((r) => [r.label, `− ${inr(r.value)}`]),
                      ...employerCostRows(sc).map((r) => [r.label, inr(r.value)]),
                      ['CTC', inr(sc.ctc)], ['Net in Hand', inr(sc.net_in_hand)],
                      // pf_applicable / esi_applicable are the enrolment flags. This card used
                      // to read pf_employee / esic_employee — the DEDUCTION AMOUNTS, which are
                      // NULL on 3,577 of the 4,290 active assignments because migration 445
                      // added them and never backfilled. That is why PF and ESIC read "No" for
                      // employees who are enrolled: 3,124 rows carry pf_applicable = 1.
                      ['PF', pfYesNo(sc)],
                      ['ESIC', esicYesNo(sc)],
                      ['Effective From', fmtDate(sc.effective_date)],
                    ].map(([l, v]) => (
                      <div key={l as string} className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{l}</p>
                        <p className="font-semibold text-slate-800 mt-0.5">{v}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />No active salary package on file.</p>
                )}
              </div>
            </div>

            {/* Edit salary */}
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-900">Change Salary</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-medium mb-1.5 block text-slate-600">
                    Effective Date <span className="text-red-500">*</span>
                  </Label>
                  <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)}
                    className="h-9 text-sm rounded-xl" />
                </div>
                <div>
                  <Label className="text-xs font-medium mb-1.5 block text-slate-600">
                    Requested By <span className="text-red-500">*</span>
                  </Label>
                  <EmployeePicker placeholder="Who asked for this change…" value={requestor} onSelect={setRequestor} />
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block text-slate-600">
                  Reason <span className="text-red-500">*</span>
                </Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  placeholder="e.g. Annual increment, role change, correction…" className="text-sm rounded-xl" />
              </div>
              <Button
                disabled={submitting || !effectiveDate || !reason.trim() || !requestor}
                onClick={() => setPkgBuilderOpen(true)}
                className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 rounded-xl gap-2"
              >
                <Calculator className="h-4 w-4" />Select / Build Package
              </Button>
              <p className="text-[11px] text-slate-400">
                Opens pre-filled with the current active package. Four ways to set the new one:
                edit any component manually, apply an increment %, derive from a target CTC or
                net in-hand, or pick an existing catalog package. Submitting takes effect
                immediately — you're the final approver — and writes a full audit trail
                (old vs new, who requested, who submitted).
              </p>
            </div>

            {/* Change history */}
            {profile.change_history?.length > 0 && (
              <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
                <div className="bg-slate-700 px-4 py-2.5 flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-white" />
                  <p className="text-xs font-semibold text-white">Change History</p>
                </div>
                <div className="divide-y divide-slate-50">
                  {profile.change_history.map((h: any) => (
                    <div key={h.id} className="px-4 py-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-700">{inr(h.old_ctc)} → {inr(h.new_ctc)}</span>
                        <span className="text-slate-400">{fmtDate(h.created_at)}</span>
                      </div>
                      <p className="text-slate-500 mt-0.5">{h.reason}</p>
                      <p className="text-slate-400 mt-0.5">
                        Requested by {h.requested_by_name ?? '—'} · effective {fmtDate(h.effective_date)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <PackageBuilderDialog
        open={pkgBuilderOpen}
        onOpenChange={setPkgBuilderOpen}
        defaultBranch={employee?.branch_name ?? ''}
        // Opens on the employee's current package instead of blank, which also unlocks
        // the "% increment" mode (it needs a current CTC to raise from).
        currentComponents={sc}
        enablePickExisting
        submitLabel="Save & Apply Salary Change"
        onPackageCreated={(pkgId) => void submitChange(pkgId)}
      />
    </DashboardLayout>
  );
}
