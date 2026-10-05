export type AttendanceLogic = 'apr' | 'cosec' | 'apr_validated_by_cosec';
export type AttendanceSource = 'dialler' | 'biometric';
export type ScopeType = 'designation' | 'process' | 'branch' | 'process_designation' | 'branch_process' | 'global';

export interface AttendanceRule {
  id: string;
  rule_name: string;
  scope_type: ScopeType;
  designation_id: string | null;
  process_id: string | null;
  branch_id: string | null;
  designation_code?: string;
  process_name?: string;
  branch_name?: string;
  attendance_source: AttendanceSource;
  full_day_minutes: number;
  half_day_minutes: number;
  grace_minutes: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  active_status: number;
}

export interface Designation { id: string; designation_code: string; designation_name: string }
export interface Process { id: string; process_code: string; process_name: string }
export interface Branch { id: string; branch_code: string; branch_name: string }

export interface ProcessLogicRow {
  process_id: string;
  process_name: string;
  attendance_logic: AttendanceLogic;
  is_mixed: boolean;
  has_own_rule: boolean;
  breakdown: Record<AttendanceLogic, number>;
  rule_count: number;
  override_count: number;
  employee_count: number;
  last_changed_at: string | null;
}

export interface DayThresholdsInForce {
  apr: { full_day_minutes: number; half_day_floor_minutes: number; full_day_configurable: boolean };
  cosec: { full_day_minutes: number; half_day_floor_minutes: number; per_employee_overrides: number };
}

export interface EmployeeLogicExplanation {
  employee: { id: string; employee_code: string; name: string; process: string | null;
    department: string | null; designation: string | null; branch: string | null };
  logic: AttendanceLogic;
  rules_logic: AttendanceLogic;
  override: { logic: AttendanceLogic; reason: string } | null;
  decided_by: 'employee_override' | 'rule' | 'no_matching_rule' | 'legacy_name_match';
  matched_rule: { id: string; rule_name: string | null; scope: string } | null;
  forced_apr_by_dialler_rule: boolean;
  uses_apr: boolean;
  threshold_rule: { rule_name: string; scope_type: string; full_day_minutes: number; half_day_minutes: number; grace_minutes: number };
}

export interface EmployeeOverrideRow {
  employee_id: string;
  employee_code: string;
  name: string;
  process_name: string | null;
  attendance_logic: AttendanceLogic;
  reason: string;
  set_at: string | null;
  set_by_name: string | null;
}

export const LOGIC_ORDER: AttendanceLogic[] = ['apr', 'cosec', 'apr_validated_by_cosec'];

export const LOGIC_META: Record<AttendanceLogic, { short: string; title: string; help: string; badge: string }> = {
  apr: {
    short: 'APR',
    title: 'APR (dialler)',
    help: 'Dialler net login decides the day. A short or missing login is the answer: no biometric fallback.',
    badge: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  },
  cosec: {
    short: 'COSEC',
    title: 'COSEC (biometric)',
    help: 'Card punches decide the day. Nothing from the dialler is used.',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  apr_validated_by_cosec: {
    short: 'APR + COSEC',
    title: 'APR validated by COSEC',
    help: 'APR leads. When APR falls short of a full day, or has no record at all, the biometric reading is used if it credits more. COSEC can raise a day, never lower it.',
    badge: 'border-violet-200 bg-violet-50 text-violet-800',
  },
};

export function minsToHM(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function formatChanged(value: string | null): string {
  if (!value) return 'Never edited here';
  const d = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
