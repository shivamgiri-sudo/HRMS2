import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EmployeePicker, type EmployeeSearchResult } from '@/components/payroll/EmployeePicker';
import { useToast } from '@/hooks/use-toast';
import {
  type AttendanceLogic, type EmployeeLogicExplanation, type EmployeeOverrideRow,
  LOGIC_META, LOGIC_ORDER, formatChanged, minsToHM,
} from './types';

const DECIDED_BY: Record<EmployeeLogicExplanation['decided_by'], string> = {
  employee_override: 'A personal source was set for this employee',
  rule: 'A source rule matches this employee',
  no_matching_rule: 'No source rule matches, so the engine defaults to COSEC',
  legacy_name_match: 'No source rules exist at all, so the engine falls back to the Operations Executive name match',
};

export function EmployeeCheck({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [employee, setEmployee] = useState<EmployeeSearchResult | null>(null);
  const [result, setResult] = useState<EmployeeLogicExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState<EmployeeOverrideRow[]>([]);
  const [draftLogic, setDraftLogic] = useState<AttendanceLogic | ''>('');
  const [draftReason, setDraftReason] = useState('');
  const [saving, setSaving] = useState(false);

  const loadOverrides = useCallback(async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeOverrideRow[] }>(
        '/api/wfm/attendance/attendance-logic/overrides');
      setOverrides(res.data ?? []);
    } catch { /* the list is secondary; the check itself still works */ }
  }, []);
  useEffect(() => { void loadOverrides(); }, [loadOverrides]);

  const check = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeLogicExplanation }>(
        `/api/wfm/attendance/attendance-logic/employee/${id}`);
      setResult(res.data);
      setDraftLogic(res.data.override?.logic ?? '');
      setDraftReason(res.data.override?.reason ?? '');
    } catch {
      setResult(null);
      toast({ title: 'Could not check this employee', description: 'The server may be restarting. Try again in a moment.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const pick = async (e: EmployeeSearchResult | null) => {
    setEmployee(e);
    setResult(null);
    if (e) await check(e.id);
  };

  const save = async () => {
    if (!result || !draftLogic) return;
    setSaving(true);
    try {
      await hrmsApi.put(`/api/wfm/attendance/attendance-logic/employee/${result.employee.id}`,
        { attendance_logic: draftLogic, reason: draftReason.trim() });
      toast({
        title: `${result.employee.name} is now ${LOGIC_META[draftLogic].short}`,
        description: 'Applies from the next attendance run. Rebuild a past month to restate it.',
      });
      await Promise.all([check(result.employee.id), loadOverrides()]);
      onChanged();
    } catch (e: any) {
      toast({ title: 'Could not save', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (employeeId: string, name: string) => {
    try {
      await hrmsApi.delete(`/api/wfm/attendance/attendance-logic/employee/${employeeId}`);
      toast({ title: `${name} is back on the process rules` });
      await loadOverrides();
      if (result?.employee.id === employeeId) await check(employeeId);
      onChanged();
    } catch (e: any) {
      toast({ title: 'Could not remove', description: e?.message, variant: 'destructive' });
    }
  };

  const meta = result ? LOGIC_META[result.logic] : null;
  const dirty = !!result && !!draftLogic
    && (draftLogic !== result.override?.logic || draftReason.trim() !== (result.override?.reason ?? ''));

  return (
    <div className="space-y-6">
      <div className="max-w-md space-y-2">
        <p className="text-sm font-medium text-slate-800">Which source decides this employee's attendance?</p>
        <p className="text-xs text-slate-500">
          Search by name or code. The answer comes from the same rules the engine uses, so it is what the next run will do.
        </p>
        <EmployeePicker placeholder="Search employee" value={employee} onSelect={(e) => void pick(e)} />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking…
        </div>
      )}

      {result && meta && (
        <div className="max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-slate-900">{result.employee.name}</p>
              <p className="text-xs text-slate-500">
                {[result.employee.employee_code, result.employee.designation, result.employee.department,
                  result.employee.process, result.employee.branch].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Badge variant="outline" className={`${meta.badge} px-3 py-1 text-sm`}>{meta.title}</Badge>
          </div>

          <p className="text-sm text-slate-700">{meta.help}</p>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why</dt>
              <dd className="mt-0.5 text-slate-800">
                {DECIDED_BY[result.decided_by]}
                {result.override && (
                  <span className="block text-xs text-slate-500">
                    “{result.override.reason}”. The rules alone would give {LOGIC_META[result.rules_logic].short}.
                  </span>
                )}
                {!result.override && result.matched_rule && (
                  <span className="block text-xs text-slate-500">
                    {result.matched_rule.rule_name ?? 'Unnamed rule'} (scoped to {result.matched_rule.scope})
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Late-mark grace</dt>
              <dd className="mt-0.5 text-slate-800">
                {result.threshold_rule.grace_minutes} min
                <span className="block text-xs text-slate-500">
                  From “{result.threshold_rule.rule_name}”. Applies to biometric days only.
                </span>
              </dd>
            </div>
          </dl>

          {result.forced_apr_by_dialler_rule && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <p>
                A threshold rule scoped to this employee is set to “dialler”, which makes the engine treat them as
                APR even where the source rules say COSEC. A personal source below overrides it.
              </p>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Full day is {minsToHM(result.uses_apr ? 480 : 540)} on this source unless the employee has a personal exception.
          </p>

          {canEdit && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Personal source</p>
                <p className="text-xs text-slate-500">
                  Use only when this one person must differ from their process. It beats every process rule.
                </p>
              </div>
              <ToggleGroup
                type="single"
                value={draftLogic}
                onValueChange={(v) => setDraftLogic((v as AttendanceLogic) || draftLogic)}
                aria-label="Personal source"
                className="justify-start gap-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit"
              >
                {LOGIC_ORDER.map((k) => (
                  <ToggleGroupItem key={k} value={k} size="sm"
                    className="h-8 px-3 text-xs data-[state=on]:bg-white data-[state=on]:font-semibold data-[state=on]:shadow-sm">
                    {LOGIC_META[k].short}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {draftLogic && <p className="text-xs text-slate-500">{LOGIC_META[draftLogic].help}</p>}
              <div className="space-y-1">
                <Label htmlFor="override-reason">Reason *</Label>
                <Textarea id="override-reason" rows={2} value={draftReason} maxLength={500}
                  placeholder="e.g. Moved to the dialler team on 1 Oct, process still on COSEC"
                  onChange={(e) => setDraftReason(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void save()} disabled={saving || !dirty || draftReason.trim().length < 3}>
                  {saving ? 'Saving…' : result.override ? 'Update personal source' : 'Set personal source'}
                </Button>
                {result.override && (
                  <Button variant="outline" onClick={() => void remove(result.employee.id, result.employee.name)}>
                    Back to process rules
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Employees with a personal source <span className="font-normal text-slate-500">({overrides.length})</span>
        </h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {overrides.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              No one has a personal source. Everyone follows their process rules.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Employee</th>
                    <th scope="col" className="px-4 py-3">Source</th>
                    <th scope="col" className="px-4 py-3">Reason</th>
                    <th scope="col" className="px-4 py-3">Set</th>
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overrides.map((o) => (
                    <tr key={o.employee_id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <button type="button" className="text-left font-medium text-slate-900 hover:underline"
                          onClick={() => { setEmployee({ id: o.employee_id, employee_code: o.employee_code, full_name: o.name }); void check(o.employee_id); }}>
                          {o.name}
                        </button>
                        <p className="text-xs text-slate-500">{o.employee_code}{o.process_name ? ` · ${o.process_name}` : ''}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={LOGIC_META[o.attendance_logic].badge}>{LOGIC_META[o.attendance_logic].short}</Badge>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-slate-600">{o.reason}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {formatChanged(o.set_at)}{o.set_by_name ? ` by ${o.set_by_name}` : ''}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit && (
                          <Button variant="ghost" size="sm" aria-label={`Remove personal source for ${o.name}`}
                            onClick={() => void remove(o.employee_id, o.name)}>
                            <Trash2 className="h-4 w-4 text-slate-500" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
