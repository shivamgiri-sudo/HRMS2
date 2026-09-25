import { useWorkforceAccess } from '@/hooks/useUserRole';

/** Today's date in IST as YYYY-MM-DD (never UTC: before 05:30 IST that is still yesterday). */
export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

/**
 * `min` for joining-date / salary-date pickers. Nobody may pick a day before today,
 * except super_admin and payroll_head (exception handling) -- the server enforces the
 * same rule, this only stops the picker offering days it would refuse.
 */
export function useDateLockMin(): string | undefined {
  const { hasAnyRole } = useWorkforceAccess();
  return hasAnyRole('payroll_head', 'super_admin') ? undefined : todayIst();
}

/**
 * A salary date before today or before the date of joining can only be picked by payroll_head /
 * super_admin (see useDateLockMin) and the server then requires a written reason (REASON_REQUIRED).
 * Both dates are YYYY-MM-DD; a missing joining date only leaves the before-today rule.
 */
export function backdateNeedsReason(date: string, joiningDate?: string | null): boolean {
  const d = (date ?? '').slice(0, 10);
  if (!d) return false;
  const doj = (joiningDate ?? '').slice(0, 10);
  return d < todayIst() || (!!doj && d < doj);
}
