/**
 * The two day counts a payslip prints, taken from one place so every slip agrees.
 *
 *  - daysInMonth: calendar days of the payroll month (31 for August) — never the working-day
 *    count, which already excludes week-offs and printed "28" for a 31-day month.
 *  - paidDays: the salary paid days, week-offs and paid holidays INCLUDED (final_payable_days).
 *    Falls back to present + leave + week-off + holiday for rows where the engine never stored it,
 *    capped at the month length, and to present days only when nothing else is known.
 */
export interface PayslipDaySource {
  run_month?: string | null;
  month?: number | null;
  year?: number | null;
  present_days?: number | string | null;
  leave_days?: number | string | null;
  working_days?: number | string | null;
  final_payable_days?: number | string | null;
  eligible_weekoff_days?: number | string | null;
  eligible_holiday_days?: number | string | null;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function payslipDays(src: PayslipDaySource): { daysInMonth: number; paidDays: number } {
  let year = n(src.year);
  let month = n(src.month);
  const m = /^(\d{4})-(\d{2})/.exec(String(src.run_month ?? ""));
  if (m) { year = Number(m[1]); month = Number(m[2]); }
  const daysInMonth = year > 0 && month >= 1 && month <= 12 ? new Date(year, month, 0).getDate() : 0;

  const stored = n(src.final_payable_days);
  const derived = n(src.present_days) + n(src.leave_days) + n(src.eligible_weekoff_days) + n(src.eligible_holiday_days);
  let paidDays = stored > 0 ? stored : derived > 0 ? derived : n(src.present_days);
  if (daysInMonth > 0) paidDays = Math.min(paidDays, daysInMonth);
  return { daysInMonth: daysInMonth || n(src.working_days), paidDays };
}
