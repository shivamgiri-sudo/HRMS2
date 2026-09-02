import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmployeePicker, employeeDisplayName, type EmployeeSearchResult } from '@/components/payroll/EmployeePicker';
import {
  Loader2, ShieldCheck, CalendarDays, AlertTriangle, CheckCircle2, X, Fingerprint, Clock,
} from 'lucide-react';

/**
 * Payroll Head — Exception Control.
 *
 * Two decisions the Payroll Head makes about individual people, on one screen:
 *
 *  1. Exception Bucket (employee_attendance_exception_bucket, migration 1652) — privileged
 *     employees whose COSEC day is judged differently: a lone punch counts as present, and/or
 *     their full day is 8 hours instead of 9. Read by attendance-engine.service.ts.
 *
 *  2. Payable Days (payroll_payable_days_override, migration 1653) — the month-level payable
 *     days for one employee, stated directly before payroll is released. Read by
 *     payrollCalculate.service.ts, which still caps it at the employee's active calendar days.
 *
 * Both are Payroll Head authority with no second approver, so both demand a written reason and
 * both write sensitive_action_log, which is what the drill-down drawer reads back.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface BucketRow {
  id: string;
  employee_id: string;
  single_punch_counts_as_present: number;
  full_day_threshold_minutes: number | null;
  reason: string;
  active_status: number;
  created_at: string;
  employee_name: string | null;
  employee_code: string | null;
  branch_name: string | null;
  process_name: string | null;
  designation_name: string | null;
}

interface OverrideRow {
  id: string;
  employee_id: string;
  run_month: string;
  payable_days: string | number;
  computed_days: string | number | null;
  reason: string;
  active_status: number;
  created_at: string;
  employee_name: string | null;
  employee_code: string | null;
  branch_name: string | null;
}

interface AuditRow {
  id: string;
  actor_user_id: string;
  action_type: string;
  actor_role: string | null;
  reason: string | null;
  acted_at: string;
}

interface CurrentState {
  computed_days: number | null;
  existing_override: OverrideRow | null;
  run_status: string | null;
  run_closed: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * DECIMAL columns arrive from mysql2 as strings. Number() them before any arithmetic or
 * .toFixed() — calling .toFixed() straight on the string is what took down /quality-dashboard.
 */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmtDays = (v: unknown): string => {
  const n = num(v);
  return n === null ? '—' : (Number.isInteger(n) ? String(n) : n.toFixed(2));
};

const fmtDateTime = (v: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Closed set: the threshold choices a Payroll Head may pick. Never a free-text minutes box. */
const THRESHOLD_OPTIONS = [
  { value: 'default', label: 'Standard — 9 hours (540 min)' },
  { value: '480',     label: '8 hours (480 min)' },
  { value: '420',     label: '7 hours (420 min)' },
  { value: '360',     label: '6 hours (360 min)' },
] as const;

/** Last 13 months as YYYY-MM, newest first — a closed set, so a dropdown rather than a text box. */
function recentMonths(count = 13): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{children}</div>;
}

// ── Drill-down drawer (Drill-Down Mandate) ────────────────────────────────────

function DetailDrawer({
  title, open, onClose, detail, loading, children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  detail: { audit_timeline?: AuditRow[] } | null;
  loading: boolean;
  children?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading detail…
            </div>
          ) : (
            <>
              {children}
              <div>
                <SectionLabel>Audit trail</SectionLabel>
                {detail?.audit_timeline?.length ? (
                  <div className="space-y-3">
                    {detail.audit_timeline.map((a) => (
                      <div key={a.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-800">{a.action_type}</span>
                          <span className="text-xs text-slate-500">{fmtDateTime(a.acted_at)}</span>
                        </div>
                        {a.actor_role && (
                          <div className="mt-1 text-xs text-slate-500">Role: {a.actor_role}</div>
                        )}
                        {a.reason && <div className="mt-1 text-sm text-slate-600">{a.reason}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">None</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PayrollExceptionControl() {
  const [tab, setTab] = useState('bucket');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 6000);
  }, []);

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Exception Control</h1>
          <p className="mt-1 text-sm text-slate-600">
            Attendance exceptions for named employees, and month-level payable days — both Payroll Head authority,
            both permanently audited.
          </p>
        </div>

        {toast && (
          <div
            role="status"
            className={`mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
              toast.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {toast.kind === 'ok'
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
            <span>{toast.text}</span>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5">
            <TabsTrigger value="bucket" className="cursor-pointer gap-1.5">
              <ShieldCheck className="h-4 w-4" /> Exception Bucket
            </TabsTrigger>
            <TabsTrigger value="payable" className="cursor-pointer gap-1.5">
              <CalendarDays className="h-4 w-4" /> Payable Days
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bucket">
            <ExceptionBucketTab flash={flash} />
          </TabsContent>
          <TabsContent value="payable">
            <PayableDaysTab flash={flash} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ── Tab 1: Exception Bucket ───────────────────────────────────────────────────

function ExceptionBucketTab({ flash }: { flash: (k: 'ok' | 'err', t: string) => void }) {
  const [rows, setRows] = useState<BucketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [employee, setEmployee] = useState<EmployeeSearchResult | null>(null);
  const [singlePunch, setSinglePunch] = useState(false);
  const [threshold, setThreshold] = useState<string>('default');
  const [reason, setReason] = useState('');

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ data: BucketRow[] }>('/api/wfm/attendance-exception-bucket');
      setRows(res.data ?? []);
    } catch (e: any) {
      flash('err', e?.message ?? 'Could not load the exception bucket');
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => { void load(); }, [load]);

  const openDrawer = async (id: string) => {
    setDrawerId(id);
    setDrawerLoading(true);
    try {
      const res = await hrmsApi.get<{ data: any }>(`/api/wfm/attendance-exception-bucket/${id}`);
      setDrawerDetail(res.data ?? null);
    } catch (e: any) {
      flash('err', e?.message ?? 'Could not load detail');
      setDrawerDetail(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const submit = async () => {
    if (!employee) return flash('err', 'Pick an employee first');
    if (reason.trim().length < 10) return flash('err', 'Give a reason of at least 10 characters');
    if (!singlePunch && threshold === 'default') {
      return flash('err', 'Set at least one exception — single punch, or a shorter full day');
    }
    setSaving(true);
    try {
      const res = await hrmsApi.post<{ message?: string }>('/api/wfm/attendance-exception-bucket', {
        employee_id: employee.id,
        single_punch_counts_as_present: singlePunch,
        full_day_threshold_minutes: threshold === 'default' ? null : Number(threshold),
        reason: reason.trim(),
      });
      flash('ok', res.message ?? 'Exception saved');
      setEmployee(null); setSinglePunch(false); setThreshold('default'); setReason('');
      await load();
    } catch (e: any) {
      flash('err', e?.message ?? 'Could not save the exception');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: BucketRow) => {
    const why = window.prompt(
      `Remove ${row.employee_name ?? row.employee_code} from the exception bucket?\n\n`
      + 'Standard COSEC rules (9-hour full day, single punch goes to review) will apply from the '
      + 'next processing run.\n\nReason (at least 10 characters):'
    );
    if (why === null) return;
    if (why.trim().length < 10) return flash('err', 'A reason of at least 10 characters is required');
    try {
      const res = await hrmsApi.delete<{ message?: string }>(
        `/api/wfm/attendance-exception-bucket/${row.id}`, { data: { reason: why.trim() } }
      );
      flash('ok', res?.message ?? 'Removed from the bucket');
      await load();
    } catch (e: any) {
      flash('err', e?.message ?? 'Could not remove the entry');
    }
  };

  return (
    <div className="space-y-6">
      {/* Add form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionLabel>Add an employee to the bucket</SectionLabel>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm">Employee</Label>
            <EmployeePicker
              placeholder="Search by name or employee code…"
              value={employee}
              onSelect={setEmployee}
              disabled={saving}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">Full day counts as</Label>
            <Select value={threshold} onValueChange={setThreshold} disabled={saving}>
              <SelectTrigger className="h-9 rounded-xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THRESHOLD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <Switch
            id="single-punch"
            checked={singlePunch}
            onCheckedChange={setSinglePunch}
            disabled={saving}
          />
          <div>
            <Label htmlFor="single-punch" className="cursor-pointer text-sm font-medium text-slate-800">
              A single COSEC punch counts as present
            </Label>
            <p className="mt-0.5 text-xs text-slate-600">
              For employees who tap in and then leave the premises on work. Without this, a day with one punch
              records zero minutes and waits in the missing-punch review queue. A day with no punch at all is
              still not credited.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Label className="mb-1.5 block text-sm">Reason <span className="text-red-600">*</span></Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving}
            rows={2}
            placeholder="Why this employee is exempt from the standard COSEC rules…"
            className="rounded-xl text-sm"
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={submit} disabled={saving} className="cursor-pointer gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Save exception
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <SectionLabel>Employees in the bucket ({rows.length})</SectionLabel>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500">
              No employees are in the exception bucket. Everyone is judged on the standard 9-hour COSEC day.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Single punch</TableHead>
                  <TableHead>Full day</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    onClick={() => void openDrawer(r.id)}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                  >
                    <TableCell>
                      <div className="font-medium text-slate-800">{r.employee_name ?? '—'}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {r.employee_code ?? '—'}{r.branch_name ? ` · ${r.branch_name}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      {Number(r.single_punch_counts_as_present) === 1 ? (
                        <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                          <Fingerprint className="h-3 w-3" /> Counts as present
                        </Badge>
                      ) : (
                        <span className="text-sm text-slate-500">Standard</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.full_day_threshold_minutes ? (
                        <Badge className="gap-1 bg-amber-100 text-amber-900 hover:bg-amber-100">
                          <Clock className="h-3 w-3" />
                          {(Number(r.full_day_threshold_minutes) / 60).toFixed(0)} hrs
                        </Badge>
                      ) : (
                        <span className="text-sm text-slate-500">9 hrs (standard)</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-2 text-sm text-slate-600">{r.reason}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-600">
                      {fmtDateTime(r.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); void remove(r); }}
                        className="cursor-pointer text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <DetailDrawer
        title="Exception detail"
        open={drawerId !== null}
        onClose={() => { setDrawerId(null); setDrawerDetail(null); }}
        detail={drawerDetail}
        loading={drawerLoading}
      >
        {drawerDetail && (
          <div>
            <SectionLabel>Exception</SectionLabel>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Employee</dt><dd className="font-medium text-slate-800">{drawerDetail.employee_name ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Code</dt><dd className="font-mono text-slate-800">{drawerDetail.employee_code ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Branch</dt><dd className="text-slate-800">{drawerDetail.branch_name ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Process</dt><dd className="text-slate-800">{drawerDetail.process_name ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Designation</dt><dd className="text-slate-800">{drawerDetail.designation_name ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Status</dt><dd className="text-slate-800">{Number(drawerDetail.active_status) === 1 ? 'Active' : 'Removed'}</dd></div>
              <div>
                <dt className="text-slate-500">Single punch</dt>
                <dd className="text-slate-800">
                  {Number(drawerDetail.single_punch_counts_as_present) === 1 ? 'Counts as present' : 'Standard'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Full day</dt>
                <dd className="text-slate-800">
                  {drawerDetail.full_day_threshold_minutes
                    ? `${drawerDetail.full_day_threshold_minutes} min`
                    : `${drawerDetail.default_full_day_minutes ?? 540} min (standard)`}
                </dd>
              </div>
              <div className="col-span-2"><dt className="text-slate-500">Reason</dt><dd className="text-slate-800">{drawerDetail.reason}</dd></div>
              {Number(drawerDetail.active_status) === 0 && drawerDetail.deactivation_reason && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Removal reason</dt>
                  <dd className="text-slate-800">{drawerDetail.deactivation_reason}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

// ── Tab 2: Payable Days ───────────────────────────────────────────────────────

/**
 * Payroll Head's standing list of employees who get payable days set directly, no reason
 * required — an explicit exception the Payroll Head asked for on top of the general rule
 * (every other employee still requires a reason). Their code/name surface as one-click chips
 * so the Payroll Head never has to search for them by name.
 */
const QUICK_PICK_EMPLOYEES: { code: string; name: string }[] = [
  { code: 'MAS00001', name: 'DEEPAK KASHYAP' },
  { code: 'MAS00183', name: 'ASHWANI WADHWA' },
  { code: 'MAS07197', name: 'SADHNA WADHWA' },
  { code: 'MAS63086', name: 'NAYANDEEP KAUR' },
  { code: 'MAS63087', name: 'AMIT KAUR' },
  { code: 'MAS63088', name: 'RITA DEVI' },
];
const QUICK_PICK_CODES = new Set(QUICK_PICK_EMPLOYEES.map((e) => e.code));
const QUICK_PICK_REASON = 'Pre-approved payable-days entry — Payroll Head standing list, no reason required.';

function PayableDaysTab({ flash }: { flash: (k: 'ok' | 'err', t: string) => void }) {
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [employee, setEmployee] = useState<EmployeeSearchResult | null>(null);
  const [current, setCurrent] = useState<CurrentState | null>(null);
  const [checking, setChecking] = useState(false);
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [resolvingQuick, setResolvingQuick] = useState<string | null>(null);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ data: OverrideRow[] }>(
        `/api/payroll/payable-days-overrides?runMonth=${encodeURIComponent(month)}`
      );
      setRows(res.data ?? []);
    } catch (e: any) {
      flash('err', e?.message ?? 'Could not load overrides');
    } finally {
      setLoading(false);
    }
  }, [month, flash]);

  useEffect(() => { void load(); }, [load]);

  // Fetch what the engine currently says as soon as an employee+month pair exists, so the
  // Payroll Head types against a real number and a closed run is refused before they compose
  // a reason for it.
  useEffect(() => {
    if (!employee) { setCurrent(null); return; }
    let cancelled = false;
    setChecking(true);
    (async () => {
      try {
        const res = await hrmsApi.get<{ data: CurrentState }>(
          `/api/payroll/payable-days-overrides/current?employeeId=${encodeURIComponent(employee.id)}`
          + `&runMonth=${encodeURIComponent(month)}`
        );
        if (!cancelled) {
          setCurrent(res.data ?? null);
          const existing = res.data?.existing_override;
          setDays(existing && Number(existing.active_status) === 1 ? String(num(existing.payable_days) ?? '') : '');
        }
      } catch (e: any) {
        if (!cancelled) { setCurrent(null); flash('err', e?.message ?? 'Could not read the current payable days'); }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee, month, flash]);

  const openDrawer = async (id: string) => {
    setDrawerId(id);
    setDrawerLoading(true);
    try {
      const res = await hrmsApi.get<{ data: any }>(`/api/payroll/payable-days-overrides/${id}`);
      setDrawerDetail(res.data ?? null);
    } catch (e: any) {
      flash('err', e?.message ?? 'Could not load detail');
      setDrawerDetail(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const submit = async () => {
    if (!employee) return flash('err', 'Pick an employee first');
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0 || n > 31) return flash('err', 'Payable days must be between 0 and 31');
    if (Math.round(n * 2) !== n * 2) return flash('err', 'Payable days must be a whole or half day (e.g. 25 or 25.5)');
    if (!waiveReason && reason.trim().length < 10) return flash('err', 'Give a reason of at least 10 characters');

    setSaving(true);
    try {
      const res = await hrmsApi.post<{ message?: string }>('/api/payroll/payable-days-overrides', {
        employee_id: employee.id,
        run_month: month,
        payable_days: n,
        reason: waiveReason ? QUICK_PICK_REASON : reason.trim(),
      });
      flash('ok', res.message ?? 'Payable days set');
      setEmployee(null); setDays(''); setReason(''); setCurrent(null);
      await load();
    } catch (e: any) {
      flash('err', e?.message ?? 'Could not set the payable days');
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (row: OverrideRow) => {
    const why = window.prompt(
      `Withdraw the payable-days override for ${row.employee_name ?? row.employee_code} (${row.run_month})?\n\n`
      + 'The calculated payable days will apply again from the next calculation.\n\n'
      + 'Reason (at least 10 characters):'
    );
    if (why === null) return;
    if (why.trim().length < 10) return flash('err', 'A reason of at least 10 characters is required');
    try {
      const res = await hrmsApi.delete<{ message?: string }>(
        `/api/payroll/payable-days-overrides/${row.id}`, { data: { reason: why.trim() } }
      );
      flash('ok', res?.message ?? 'Override withdrawn');
      await load();
    } catch (e: any) {
      flash('err', e?.message ?? 'Could not withdraw the override');
    }
  };

  const runClosed = current?.run_closed === true;
  const waiveReason = employee ? QUICK_PICK_CODES.has(employee.employee_code) : false;

  const pickQuickEmployee = async (code: string) => {
    setResolvingQuick(code);
    try {
      const res = await hrmsApi.get<
        { employees?: EmployeeSearchResult[]; data?: EmployeeSearchResult[] } | EmployeeSearchResult[]
      >(`/api/employees?search=${encodeURIComponent(code)}&limit=5`);
      const list = Array.isArray(res) ? res : (res.employees ?? res.data ?? []);
      const found = list.find((e) => e.employee_code === code);
      if (!found) { flash('err', `Could not find ${code} — check they are still an active employee`); return; }
      setEmployee(found);
    } catch (e: any) {
      flash('err', e?.message ?? `Could not look up ${code}`);
    } finally {
      setResolvingQuick(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionLabel>Set payable days for a month</SectionLabel>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label className="mb-1.5 block text-sm">Payroll month</Label>
            <Select value={month} onValueChange={setMonth} disabled={saving}>
              <SelectTrigger className="h-9 rounded-xl text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="mb-1.5 block text-sm">Employee</Label>
            <EmployeePicker
              placeholder="Search by name or employee code…"
              value={employee}
              onSelect={setEmployee}
              disabled={saving}
            />
            {!employee && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500">Quick select:</span>
                {QUICK_PICK_EMPLOYEES.map((q) => (
                  <button
                    key={q.code}
                    type="button"
                    onClick={() => void pickQuickEmployee(q.code)}
                    disabled={saving || resolvingQuick !== null}
                    className="cursor-pointer rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {resolvingQuick === q.code ? (
                      <Loader2 className="inline h-3 w-3 animate-spin" />
                    ) : (
                      <>{q.name} <span className="font-mono text-[10px] text-slate-400">({q.code})</span></>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {employee && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {checking ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading the current payroll position…
              </div>
            ) : runClosed ? (
              <div className="flex items-start gap-2 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  Payroll for {month} is already <strong>{current?.run_status}</strong> and cannot be recalculated.
                  An override entered now would never reach a payslip.
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-slate-600">
                  Calculated payable days:{' '}
                  <strong className="text-slate-900">
                    {current?.computed_days === null || current?.computed_days === undefined
                      ? 'not calculated yet'
                      : fmtDays(current.computed_days)}
                  </strong>
                </span>
                {current?.existing_override && Number(current.existing_override.active_status) === 1 && (
                  <span className="text-amber-800">
                    Override already standing: <strong>{fmtDays(current.existing_override.payable_days)}</strong>
                  </span>
                )}
                <span className="text-slate-500">Run status: {current?.run_status ?? 'no run yet'}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <Label className="mb-1.5 block text-sm">Payable days <span className="text-red-600">*</span></Label>
            {/* A number, not a closed set — a plain input is correct here. */}
            <Input
              type="number"
              min={0}
              max={31}
              step={0.5}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={saving || runClosed}
              placeholder="e.g. 26"
              className="h-9 rounded-xl text-sm"
            />
            <p className="mt-1 text-xs text-slate-500">
              Still capped at the employee's active days in the month.
            </p>
          </div>
          <div className="md:col-span-2">
            {waiveReason ? (
              <>
                <Label className="mb-1.5 block text-sm">Reason</Label>
                <div className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  Not required for {employee ? employeeDisplayName(employee) : 'this employee'} — Payroll Head standing list.
                </div>
              </>
            ) : (
              <>
                <Label className="mb-1.5 block text-sm">Reason <span className="text-red-600">*</span></Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={saving || runClosed}
                  rows={2}
                  placeholder="Why the calculated days are being overridden…"
                  className="rounded-xl text-sm"
                />
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={submit} disabled={saving || runClosed} className="cursor-pointer gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
            Set payable days
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3">
          <SectionLabel>Overrides for {month} ({rows.length})</SectionLabel>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500">
              No payable-days overrides for {month}. Every employee is paid on calculated attendance.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Calculated</TableHead>
                  <TableHead>Override</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Set on</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    onClick={() => void openDrawer(r.id)}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                  >
                    <TableCell>
                      <div className="font-medium text-slate-800">{r.employee_name ?? '—'}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {r.employee_code ?? '—'}{r.branch_name ? ` · ${r.branch_name}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{fmtDays(r.computed_days)}</TableCell>
                    <TableCell>
                      <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
                        {fmtDays(r.payable_days)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-2 text-sm text-slate-600">{r.reason}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-600">
                      {fmtDateTime(r.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); void withdraw(r); }}
                        className="cursor-pointer text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        Withdraw
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <DetailDrawer
        title="Payable days override"
        open={drawerId !== null}
        onClose={() => { setDrawerId(null); setDrawerDetail(null); }}
        detail={drawerDetail}
        loading={drawerLoading}
      >
        {drawerDetail && (
          <div>
            <SectionLabel>Override</SectionLabel>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Employee</dt><dd className="font-medium text-slate-800">{drawerDetail.employee_name ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Code</dt><dd className="font-mono text-slate-800">{drawerDetail.employee_code ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Month</dt><dd className="text-slate-800">{drawerDetail.run_month}</dd></div>
              <div><dt className="text-slate-500">Run status</dt><dd className="text-slate-800">{drawerDetail.run_status ?? 'no run yet'}</dd></div>
              <div><dt className="text-slate-500">Calculated days</dt><dd className="text-slate-800">{fmtDays(drawerDetail.computed_days)}</dd></div>
              <div><dt className="text-slate-500">Override days</dt><dd className="font-medium text-slate-900">{fmtDays(drawerDetail.payable_days)}</dd></div>
              <div><dt className="text-slate-500">Status</dt><dd className="text-slate-800">{Number(drawerDetail.active_status) === 1 ? 'Active' : 'Withdrawn'}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Reason</dt><dd className="text-slate-800">{drawerDetail.reason}</dd></div>
              {Number(drawerDetail.active_status) === 0 && drawerDetail.revoke_reason && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Withdrawal reason</dt>
                  <dd className="text-slate-800">{drawerDetail.revoke_reason}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
