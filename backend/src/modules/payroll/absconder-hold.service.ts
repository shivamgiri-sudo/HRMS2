/**
 * Absconder salary hold: an employee confirmed as absconded has 0 paid days until the Branch Head and
 * then a different Payroll Head approve the release.
 *
 * DERIVED, NEVER STORED ON THE LINE. The calculator's upsert resets salary_prep_line.status and the
 * nightly worker recalculates open runs, so a persisted block would be wiped before payment. The hold
 * is re-derived from exit_request on every calculation and every export, the same way the NOC release
 * gate is (noc-release-gate.service.ts).
 *
 * Held means: the employee's LATEST exit is an absconding/abandonment exit that is still live (not
 * revoked, withdrawn, rejected, cancelled or draft), it was raised on or after absconder_hold_from, and
 * the Payroll Head has not yet recorded the release (exit_request.ff_exception_at, which the existing
 * chain only allows after the Branch Head step, by a different person).
 *
 * SWITCH. Off unless payroll_config_flags has absconder_salary_hold_enabled = 'true' AND a valid
 * absconder_hold_from date. The date keeps the historical absconders (already exited, mostly settled)
 * from being retro-zeroed by switching the feature on. Fails OFF: an unreadable flag must not
 * silently zero anybody's salary.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const ABSCONDER_HOLD_ENABLED_KEY = "absconder_salary_hold_enabled";
export const ABSCONDER_HOLD_FROM_KEY = "absconder_hold_from";

async function readFlag(key: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_value FROM payroll_config_flags
      WHERE branch_id IS NULL AND process_id IS NULL AND config_key = ?
      ORDER BY updated_at DESC, id DESC LIMIT 1`,
    [key],
  );
  return rows.length ? String(rows[0].config_value).trim() : null;
}

/** `from` is a 'YYYY-MM-DD' date when the hold is live, otherwise the hold is off. */
export async function absconderHoldConfig(): Promise<{ enabled: boolean; from: string | null }> {
  try {
    const [on, from] = await Promise.all([readFlag(ABSCONDER_HOLD_ENABLED_KEY), readFlag(ABSCONDER_HOLD_FROM_KEY)]);
    const validFrom = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
    return { enabled: on?.toLowerCase() === "true" && Boolean(validFrom), from: validFrom };
  } catch (err) {
    console.error("[absconder-hold] could not read the switch; treating the hold as OFF:", (err as Error).message);
    return { enabled: false, from: null };
  }
}

const HELD_PREDICATE = `
  (LOWER(COALESCE(er.exit_type, '')) IN ('absconding','abandonment')
   OR LOWER(COALESCE(er.exit_sub_type, '')) IN ('absconding','abandonment'))
  AND LOWER(COALESCE(er.status, '')) NOT IN ('draft','revoked','rejected','cancelled','withdrawn')
  AND er.ff_exception_at IS NULL
  AND er.created_at >= ?
  AND er.id = (SELECT x.id FROM exit_request x WHERE x.employee_id = er.employee_id
                ORDER BY x.created_at DESC, x.id DESC LIMIT 1)`;

/**
 * Of these employees, the ones whose pay is held right now. Empty set when the hold is off.
 * Loaded once per payroll run, not per employee.
 */
export async function heldAbsconderEmployeeIds(employeeIds: string[]): Promise<Set<string>> {
  const held = new Set<string>();
  if (!employeeIds.length) return held;
  const cfg = await absconderHoldConfig();
  if (!cfg.enabled || !cfg.from) return held;
  for (let i = 0; i < employeeIds.length; i += 500) {
    const chunk = employeeIds.slice(i, i + 500);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT er.employee_id FROM exit_request er
        WHERE er.employee_id IN (?) AND ${HELD_PREDICATE}`,
      [chunk, cfg.from],
    );
    for (const r of rows) held.add(String(r.employee_id));
  }
  return held;
}

/** Is this one employee held? For screens and the F&F, which ask about a single person. */
export async function isAbsconderPayHeld(employeeId: string): Promise<boolean> {
  return (await heldAbsconderEmployeeIds([employeeId])).has(employeeId);
}

export interface HeldAbsconder {
  employee_id: string;
  employee_code: string | null;
  employee_name: string | null;
  exit_request_id: string;
  branch_head_approved: boolean;
}

/**
 * Held employees who have a line in these runs, by name, for run validation and the bank exports, so a
 * hold is reported rather than silently dropping someone. [] when the hold is off.
 */
export async function heldAbsconderLinesForRuns(runIds: string[]): Promise<HeldAbsconder[]> {
  if (!runIds.length) return [];
  const cfg = await absconderHoldConfig();
  if (!cfg.enabled || !cfg.from) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT e.id AS employee_id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name,
            er.id AS exit_request_id, (er.ff_exception_bh_at IS NOT NULL) AS bh
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       JOIN exit_request er ON er.employee_id = e.id
      WHERE spl.run_id IN (?) AND ${HELD_PREDICATE}
      ORDER BY e.employee_code`,
    [runIds, cfg.from],
  );
  return rows.map((r) => ({
    employee_id: String(r.employee_id),
    employee_code: r.employee_code ?? null,
    employee_name: r.employee_name ?? null,
    exit_request_id: String(r.exit_request_id),
    branch_head_approved: Boolean(Number(r.bh)),
  }));
}
