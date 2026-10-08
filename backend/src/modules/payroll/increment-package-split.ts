/**
 * Increment-aware package pricing, with a calendar-day split for a mid-month effective date.
 *
 * WHY: payroll prices a month from the employee's active salary_component_assignments (sca) row and ignores
 * salary_increment_request. Implementing an increment writes only employee_salary_assignment, so for an employee
 * with a package row the increment never reaches pay, and when it does reach it (through a package row) the whole
 * month is priced at the new figure whatever the effective date.
 *
 * WHAT (only when the flag is on, and for increment requests only - the Salary Change screen is untouched):
 *   - take the latest approved + implemented increment whose effective_from is on or before the end of the
 *     employee's paid window in the run month, and only when the current package row is OLDER than it (a package
 *     row dated on or after the increment already reflects it);
 *   - the new package is the single active catalog package whose package_amount equals the approved monthly CTC
 *     (proposed_ctc is annual); none, or several differing, means no change is made;
 *   - effective_from on or before the window start: the new package for the whole month;
 *     effective_from inside the window: days before it at the old package, the rest at the new one, blended per
 *     component by calendar days of the employee's paid window. The blend then goes through the unchanged
 *     proration, so gross, PF base, ESIC and the payslip components all follow it.
 * Default OFF: a missing flag row, a non-'true' value or any read error means off.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const INCREMENT_SPLIT_FLAG_KEY = "increment_package_split_enabled";

export interface Executor {
  execute<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

export async function isIncrementSplitEnabled(exec: Executor = db as unknown as Executor): Promise<boolean> {
  try {
    const [rows] = await exec.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ? LIMIT 1`,
      [INCREMENT_SPLIT_FLAG_KEY],
    );
    if (!rows.length) return false;
    return String(rows[0]!.config_value).trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

/** The package columns payroll reads (names match salary_component_assignments). */
export const PACKAGE_KEYS = [
  "basic", "hra", "conveyance", "special_allowance", "bonus", "portfolio",
  "medical_allowance", "lta", "other_allowance", "pli", "gross",
] as const;
export type PackageParts = Record<(typeof PACKAGE_KEYS)[number], number>;

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
const DAY = 86400000;
const utc = (isoDate: string) => Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)));

/** Inclusive day count, 0 when to < from. */
export function daysInclusive(from: string, to: string): number {
  const d = Math.round((utc(to) - utc(from)) / DAY) + 1;
  return d > 0 ? d : 0;
}

/**
 * Days of the paid window [windowStart, windowEnd] spent before and from the effective date.
 * An effective date on or before the window start puts every day at the new package.
 */
export function splitDays(windowStart: string, windowEnd: string, effectiveFrom: string): { daysOld: number; daysNew: number } {
  if (effectiveFrom <= windowStart) return { daysOld: 0, daysNew: daysInclusive(windowStart, windowEnd) };
  if (effectiveFrom > windowEnd) return { daysOld: daysInclusive(windowStart, windowEnd), daysNew: 0 };
  return {
    daysOld: daysInclusive(windowStart, addDays(effectiveFrom, -1)),
    daysNew: daysInclusive(effectiveFrom, windowEnd),
  };
}

function addDays(isoDate: string, n: number): string {
  return new Date(utc(isoDate) + n * DAY).toISOString().slice(0, 10);
}

/** Per-component weighted average by days, rounded to paise. Zero total days returns the new package. */
export function blendPackages(oldP: PackageParts, newP: PackageParts, daysOld: number, daysNew: number): PackageParts {
  const total = daysOld + daysNew;
  if (total <= 0 || daysOld <= 0) return { ...newP };
  if (daysNew <= 0) return { ...oldP };
  const out = {} as PackageParts;
  for (const k of PACKAGE_KEYS) out[k] = r2((oldP[k] * daysOld + newP[k] * daysNew) / total);
  return out;
}

export function toPackageParts(row: Record<string, unknown>): PackageParts {
  const out = {} as PackageParts;
  for (const k of PACKAGE_KEYS) out[k] = num(row[k]);
  return out;
}

/** The catalog row's columns, mapped to package columns (the master calls medical_allowance "medical"). */
function catalogToParts(p: Record<string, unknown>): PackageParts {
  return toPackageParts({ ...p, medical_allowance: p.medical });
}

export interface IncrementPackageResult {
  package: PackageParts;
  incrementId: string;
  effectiveFrom: string;
  daysOld: number;
  daysNew: number;
}

/**
 * The package to price this employee's month with, or null to leave the current package untouched.
 * `windowStart`/`windowEnd` are the employee's paid window in the run month (joining/exit trimmed), ISO dates.
 */
export async function resolveIncrementPackage(
  exec: Executor,
  args: { employeeId: string; current: PackageParts; currentEffectiveDate: unknown; windowStart: string; windowEnd: string },
): Promise<IncrementPackageResult | null> {
  const { employeeId, current, windowStart, windowEnd } = args;
  const [incRows] = await exec.execute<RowDataPacket[]>(
    `SELECT id, proposed_ctc, effective_from
       FROM salary_increment_request
      WHERE employee_id = ? AND source = 'hrms' AND status = 'implemented' AND approved_at IS NOT NULL AND effective_from <= ?
      ORDER BY effective_from DESC, implemented_at DESC
      LIMIT 1`,
    [employeeId, windowEnd],
  );
  const inc = (incRows as RowDataPacket[])[0];
  if (!inc) return null;
  const effectiveFrom = iso(inc.effective_from);
  // The package row is the later truth when it is dated on or after the increment.
  const scaDate = iso(args.currentEffectiveDate);
  if (scaDate && scaDate >= effectiveFrom) return null;

  const monthlyCtc = num(inc.proposed_ctc) / 12;
  if (!(monthlyCtc > 0)) return null;
  const [pkgRows] = await exec.execute<RowDataPacket[]>(
    `SELECT basic, hra, conveyance, special_allowance, bonus, portfolio, medical, lta, other_allowance, pli, gross,
            epf_employee, esic_employee, admin_charges, net_in_hand
       FROM salary_package_master
      WHERE active_status = 1 AND ABS(package_amount - ?) <= 0.01`,
    [monthlyCtc],
  );
  const list = pkgRows as RowDataPacket[];
  if (!list.length) return null;
  const sig = (r: RowDataPacket) => [...PACKAGE_KEYS.map((k) => (k === "medical_allowance" ? r.medical : r[k])), r.epf_employee, r.esic_employee, r.admin_charges, r.net_in_hand]
    .map((v) => Math.round(num(v) * 100)).join("|");
  if (!list.every((r) => sig(r) === sig(list[0]!))) return null;
  const next = catalogToParts(list[0] as unknown as Record<string, unknown>);
  if (!(next.gross > 0)) return null;

  const { daysOld, daysNew } = splitDays(windowStart, windowEnd, effectiveFrom);
  if (daysOld + daysNew <= 0) return null;
  return { package: blendPackages(current, next, daysOld, daysNew), incrementId: String(inc.id), effectiveFrom, daysOld, daysNew };
}
