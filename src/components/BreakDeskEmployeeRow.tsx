import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

type DeskSession = {
  id: string;
  break_start_time: string | null;
  break_end_time: string | null;
  duration_minutes: number | null;
  break_type: string | null;
  break_reason: string;
  status: string;
  exception_reason: string | null;
};

type DeskEmployee = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  avatar_url: string | null;
  branch_name: string | null;
  process_name: string | null;
  department_name: string | null;
  designation_name: string | null;
  manager_name: string | null;
  biometric_id: string;
  biometric_punch_in_time: string | null;
  biometric_punch_out_time: string | null;
  biometric_minutes: number;
  attendance_source_system: string | null;
  shift_name: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  shift_duration_minutes: number;
  total_break_count: number;
  mini_break_count: number;
  long_break_count: number;
  total_break_minutes: number;
  total_break_minutes_overall?: number;
  remaining_daily_break_minutes?: number;
  last_break_reason: string | null;
  active_break_id: string | null;
  active_break_start_time: string | null;
  active_break_minutes: number;
  current_status: string;
  exceeded_minutes: number;
  today_sessions: DeskSession[];
  safe_actions: {
    can_punch_in: boolean;
    can_punch_out: boolean;
    can_start_break: boolean;
    can_end_break: boolean;
  };
};

interface EmployeeRowProps {
  employee: DeskEmployee;
  isActing: boolean;
  isSelected: boolean;
  onToggleSelect: (employeeId: string) => void;
  onPunchAction: (employee: DeskEmployee) => void;
  onBreakAction: (employee: DeskEmployee) => void;
  onShowDetails: (employee: DeskEmployee) => void;
  statusTone: (status: string) => string;
  shiftLabelForDisplay: (employee: DeskEmployee) => string;
  formatStamp: (stamp: string | null) => string;
  formatLiveDuration: (start: string | null, end: string | null, minutes: number) => string;
  formatMinutes: (minutes: number) => string;
  totalBreakMinutesForDisplay: (employee: DeskEmployee) => number;
}

function EmployeeRowComponent({
  employee,
  isActing,
  isSelected,
  onToggleSelect,
  onPunchAction,
  onBreakAction,
  onShowDetails,
  statusTone,
  shiftLabelForDisplay,
  formatStamp,
  formatLiveDuration,
  formatMinutes,
  totalBreakMinutesForDisplay,
}: EmployeeRowProps) {
  const punchLabel = employee.safe_actions.can_punch_in
    ? 'Punch In'
    : employee.safe_actions.can_punch_out
      ? 'Punch Out'
      : 'Completed';

  const breakLabel = employee.safe_actions.can_end_break ? 'Break Out' : 'Break In';
  const canBreak = employee.safe_actions.can_start_break || employee.safe_actions.can_end_break;

  return (
    <tr
      key={employee.employee_id}
      className={cn(
        "align-top transition hover:bg-slate-50/70",
        isSelected && "bg-blue-50/50"
      )}
    >
      {/* Checkbox Column */}
      <td className="px-3 py-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(employee.employee_id)}
          className="h-6 w-6 touch-none"
          disabled={isActing}
        />
      </td>

      {/* Employee Info */}
      <td className="px-3 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-[linear-gradient(145deg,rgba(20,93,160,0.12),rgba(67,160,71,0.14))] text-sm font-bold text-[#145da0]">
            {employee.avatar_url ? (
              <img src={employee.avatar_url} alt={employee.employee_name} className="h-full w-full object-cover" />
            ) : (
              employee.employee_name.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="truncate text-[15px] font-bold tracking-[-0.03em] text-slate-900"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                {employee.employee_name}
              </div>
              <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1', statusTone(employee.current_status))}>
                {employee.current_status}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">{employee.employee_code}</span>
              {employee.designation_name ? <span>{employee.designation_name}</span> : null}
              <span>ID {employee.biometric_id}</span>
            </div>
          </div>
        </div>
      </td>

      {/* Team Info */}
      <td className="px-3 py-3">
        <div className="space-y-1 text-xs text-slate-600">
          <div className="font-semibold text-slate-800">{employee.process_name ?? '-'}</div>
          <div>{employee.department_name ?? '-'}</div>
          <div>{employee.branch_name ?? '-'}</div>
          <div className="truncate text-slate-500">RM: {employee.manager_name ?? 'Not mapped'}</div>
        </div>
      </td>

      {/* Shift / Punch */}
      <td className="px-3 py-3">
        <div className="space-y-1 text-xs text-slate-600">
          <div className="font-semibold text-slate-800">{shiftLabelForDisplay(employee)}</div>
          <div>In: {formatStamp(employee.biometric_punch_in_time)}</div>
          <div>Out: {formatStamp(employee.biometric_punch_out_time)}</div>
          <div className="text-slate-500">Source: {employee.attendance_source_system ?? 'biometric / sync'}</div>
        </div>
      </td>

      {/* Break Status */}
      <td className="px-3 py-3">
        <div className="space-y-1 text-xs text-slate-600">
          <div className="font-semibold text-slate-800">
            {employee.active_break_id
              ? `Active ${formatLiveDuration(employee.active_break_start_time, null, employee.active_break_minutes)}`
              : 'No active break'}
          </div>
          <div>Last: {employee.last_break_reason ?? '-'}</div>
          <div>
            {employee.exceeded_minutes > 0
              ? `Exceeded by ${employee.exceeded_minutes} min`
              : Number(employee.remaining_daily_break_minutes ?? 1) <= 0
                ? 'Daily break limit reached'
                : `Remaining today ${formatMinutes(Number(employee.remaining_daily_break_minutes ?? 0))}`}
          </div>
        </div>
      </td>

      {/* Total Breaks */}
      <td className="px-3 py-3 text-center font-semibold text-slate-800">{employee.total_break_count}</td>

      {/* Mini */}
      <td className="px-3 py-3 text-center font-semibold text-sky-700">{employee.mini_break_count}</td>

      {/* Long */}
      <td className="px-3 py-3 text-center font-semibold text-violet-700">{employee.long_break_count}</td>

      {/* Break Min */}
      <td className="px-3 py-3 text-center font-semibold text-slate-800">{formatMinutes(totalBreakMinutesForDisplay(employee))}</td>

      {/* Shift Time */}
      <td className="px-3 py-3 text-center font-semibold text-slate-800">{formatMinutes(employee.shift_duration_minutes)}</td>

      {/* Punch Action */}
      <td className="px-3 py-3">
        <button
          onClick={() => onPunchAction(employee)}
          disabled={isActing || (!employee.safe_actions.can_punch_in && !employee.safe_actions.can_punch_out)}
          className={cn(
            'inline-flex h-10 min-w-[112px] items-center justify-center rounded-2xl px-4 text-sm font-semibold transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
            employee.safe_actions.can_punch_in
              ? 'bg-[linear-gradient(120deg,#145da0,#1b6ab5)] text-white shadow-[0_12px_24px_rgba(20,93,160,0.18)] hover:shadow-2xl'
              : employee.safe_actions.can_punch_out
                ? 'bg-[linear-gradient(120deg,#e75149,#ef5350)] text-white shadow-[0_12px_24px_rgba(239,83,80,0.18)] hover:shadow-2xl'
                : 'border border-slate-200 bg-slate-100 text-slate-400'
          )}
        >
          {isActing && (employee.safe_actions.can_punch_in || employee.safe_actions.can_punch_out) ? 'Processing...' : punchLabel}
        </button>
      </td>

      {/* Break Action */}
      <td className="px-3 py-3">
        <button
          onClick={() => onBreakAction(employee)}
          disabled={isActing || !canBreak}
          className={cn(
            'inline-flex h-10 min-w-[112px] items-center justify-center rounded-2xl px-4 text-sm font-semibold transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
            employee.safe_actions.can_end_break
              ? 'bg-[linear-gradient(120deg,#ef8f2f,#f59e0b)] text-white shadow-[0_12px_24px_rgba(245,158,11,0.2)] hover:shadow-2xl'
              : employee.safe_actions.can_start_break
                ? 'bg-[linear-gradient(120deg,#2a8f4d,#43a047)] text-white shadow-[0_12px_24px_rgba(67,160,71,0.2)] hover:shadow-2xl'
                : 'border border-slate-200 bg-slate-100 text-slate-400'
          )}
        >
          {isActing && canBreak ? 'Processing...' : breakLabel}
        </button>
      </td>

      {/* Info */}
      <td className="px-3 py-3">
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onShowDetails(employee)}
            className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Today Details
          </button>
          {employee.attendance_source_system === 'manual_kiosk' ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">
              Manual Override
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export const EmployeeRow = memo(EmployeeRowComponent);
