/**
 * Former-employee facts keyed by number, rebuilt set-based from employees + their latest exit_request.
 * Read-only on the hot tables; writes only he_ex_employee.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { isCleanVoluntary } from "./he-eligibility.js";

const BATCH = 500;

/** One batch of former employees (keyset on employees.id). Call again with `next` until it is null. */
export async function refreshExEmployees(o: { after?: string | null; limit?: number } = {}): Promise<{ scanned: number; clean: number; next: string | null }> {
  const limit = Math.min(10_000, Math.max(100, Math.floor(o.limit ?? 4000)));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT RIGHT(REGEXP_REPLACE(e.mobile, '[^0-9]', ''), 10) AS mobile10, e.id AS employee_id, e.employment_status,
            e.process_id, e.branch_id, COALESCE(e.date_of_exit, x.last_working_day_confirmed) AS exit_date,
            x.exit_type, x.exit_sub_type, x.exit_reason_category,
            COALESCE(c.disciplinary_flag, 0) AS disciplinary_flag, i.would_rejoin
       FROM employees e
       LEFT JOIN exit_request x ON x.id = (SELECT x2.id FROM exit_request x2 WHERE x2.employee_id = e.id
                                              AND x2.status NOT IN ('draft','revoked') ORDER BY x2.created_at DESC LIMIT 1)
       LEFT JOIN employee_rehire_control c ON c.employee_id = e.id
       LEFT JOIN exit_interview_response i ON i.exit_request_id = x.id
      WHERE e.active_status = 0 AND e.mobile IS NOT NULL AND e.mobile <> '' AND e.id > ?
      ORDER BY e.id LIMIT ${limit}`, [o.after ?? ""]);
  const out: unknown[][] = [];
  const seen = new Set<string>();
  let clean = 0;
  for (const r of rows) {
    const m = String(r.mobile10 ?? "");
    if (!/^\d{10}$/.test(m) || seen.has(m)) continue;
    seen.add(m);
    const ok = isCleanVoluntary({
      exitType: r.exit_type, exitSubType: r.exit_sub_type, reasonCategory: r.exit_reason_category,
      employmentStatus: r.employment_status, disciplinaryFlag: Number(r.disciplinary_flag) === 1,
    });
    if (ok) clean++;
    out.push([m, r.employee_id, r.exit_type ?? null, r.exit_sub_type ?? null, r.exit_reason_category ?? null,
      r.exit_date ? new Date(r.exit_date as string).toISOString().slice(0, 10) : null, r.process_id ?? null, r.branch_id ?? null,
      r.would_rejoin == null ? null : Number(r.would_rejoin), ok ? 1 : 0]);
  }
  for (let i = 0; i < out.length; i += BATCH) {
    const slice = out.slice(i, i + BATCH);
    await db.execute(
      `INSERT INTO he_ex_employee (mobile10, employee_id, exit_type, exit_sub_type, exit_reason, exit_date, last_process_id, last_branch_id, would_rejoin, clean_voluntary)
       VALUES ${slice.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",")}
       ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id), exit_type = VALUES(exit_type), exit_sub_type = VALUES(exit_sub_type),
         exit_reason = VALUES(exit_reason), exit_date = VALUES(exit_date), last_process_id = VALUES(last_process_id),
         last_branch_id = VALUES(last_branch_id), would_rejoin = VALUES(would_rejoin), clean_voluntary = VALUES(clean_voluntary)`,
      slice.flat() as never[]);
  }
  const next = rows.length === limit ? String(rows[rows.length - 1].employee_id) : null;
  // Last batch: rehired people are active again, so drop them (they are employees, not leavers).
  if (!next) await db.execute("DELETE x FROM he_ex_employee x JOIN employees e ON e.id = x.employee_id WHERE e.active_status = 1");
  return { scanned: rows.length, clean, next };
}

/** All batches in one go (nightly job). */
export async function refreshAllExEmployees(): Promise<{ scanned: number; clean: number }> {
  let after: string | null = null, scanned = 0, clean = 0;
  do { const r = await refreshExEmployees({ after }); scanned += r.scanned; clean += r.clean; after = r.next; } while (after);
  return { scanned, clean };
}
