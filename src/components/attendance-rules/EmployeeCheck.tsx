import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Badge } from '@/components/ui/badge';
import { EmployeePicker, type EmployeeSearchResult } from '@/components/payroll/EmployeePicker';
import { useToast } from '@/hooks/use-toast';
import { type EmployeeLogicExplanation, LOGIC_META, minsToHM } from './types';

const DECIDED_BY: Record<EmployeeLogicExplanation['decided_by'], string> = {
  rule: 'A source rule matches this employee',
  no_matching_rule: 'No source rule matches, so the engine defaults to COSEC',
  legacy_name_match: 'No source rules exist at all, so the engine falls back to the Operations Executive name match',
};

export function EmployeeCheck() {
  const { toast } = useToast();
  const [employee, setEmployee] = useState<EmployeeSearchResult | null>(null);
  const [result, setResult] = useState<EmployeeLogicExplanation | null>(null);
  const [loading, setLoading] = useState(false);

  const pick = async (e: EmployeeSearchResult | null) => {
    setEmployee(e);
    setResult(null);
    if (!e) return;
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeLogicExplanation }>(
        `/api/wfm/attendance/attendance-logic/employee/${e.id}`);
      setResult(res.data);
    } catch {
      toast({ title: 'Could not check this employee', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const meta = result ? LOGIC_META[result.logic] : null;

  return (
    <div className="space-y-5">
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
                {result.matched_rule && (
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
                APR even where the source rules say COSEC. Review it on the Thresholds tab.
              </p>
            </div>
          )}
          <p className="text-xs text-slate-500">
            Full day is {minsToHM(result.uses_apr ? 480 : 540)} on this source unless the employee has a personal exception.
          </p>
        </div>
      )}
    </div>
  );
}
