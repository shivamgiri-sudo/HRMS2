import type { RowDataPacket } from "mysql2";
import type { RehireFacts } from "./rehireEligibility.js";

/** Anything with mysql2's execute — the pool, or a connection inside a transaction. */
export interface SqlExecutor {
  execute<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

export interface LoadedRehireFacts {
  facts: RehireFacts;
  /** The exit_request the facts were read from; activation closes this one. */
  exitRequestId: string | null;
  /** Last day of the previous stint, 'YYYY-MM-DD'. */
  previousEndDate: string | null;
  ffAlreadyPaid: boolean;
}

const DAY_MS = 86_400_000;

/** Whole days between two 'YYYY-MM-DD' strings, timezone-independent (UTC midnight both sides). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

export async function loadRehireFacts(
  db: SqlExecutor,
  employeeId: string,
  proposedJoiningDate: string,
): Promise<LoadedRehireFacts | null> {
  // Dates are formatted in SQL so they stay strings end to end (see payroll/employment-end-date.ts).
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employment_status,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS date_of_exit,
            COALESCE(c.disciplinary_flag, 0) AS disciplinary_flag,
            c.block_lifted_at AS rehire_block_lifted_at
       FROM employees e LEFT JOIN employee_rehire_control c ON c.employee_id = e.id
      WHERE e.id = ?`,
    [employeeId],
  );
  const emp = empRows[0];
  if (!emp) return null;

  // Latest exit that is still the operative one. 'rejoined' exits are history, not facts.
  const [exitRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, exit_type, exit_sub_type, exit_reason_category,
            DATE_FORMAT(COALESCE(last_working_day_confirmed, last_working_day_proposed), '%Y-%m-%d') AS lwd
       FROM exit_request
      WHERE employee_id = ? AND LOWER(status) NOT IN ('rejoined', 'revoked', 'draft')
      ORDER BY created_at DESC LIMIT 1`,
    [employeeId],
  );
  const exit = exitRows[0] ?? null;

  const [abscondRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM exit_request
      WHERE employee_id = ? AND (LOWER(exit_sub_type) IN ('absconding','abandonment') OR LOWER(exit_reason_category) = 'absconding')`,
    [employeeId],
  );
  const [stintRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM employment_stint WHERE employee_id = ? AND stint_no > 1`,
    [employeeId],
  );
  const [clearRows] = exit
    ? await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM exit_clearance_checklist WHERE exit_request_id = ? AND LOWER(status) = 'pending'`,
        [exit.id],
      )
    : [[{ n: 0 }] as RowDataPacket[]];
  const [assetRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM asset_assignment WHERE employee_id = ? AND returned_date IS NULL`,
    [employeeId],
  );
  const [ffRows] = await db.execute<RowDataPacket[]>(
    `SELECT IF(ff_paid_at IS NOT NULL, 1, 0) AS ff_paid FROM full_final_calculation
      WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1`,
    [employeeId],
  );

  const previousEndDate: string | null = exit?.lwd ?? emp.date_of_exit ?? null;
  const gapDays = previousEndDate ? daysBetween(previousEndDate, proposedJoiningDate) : 0;
  const ffAlreadyPaid = Number(ffRows[0]?.ff_paid ?? 0) === 1;

  return {
    exitRequestId: exit?.id ?? null,
    previousEndDate,
    ffAlreadyPaid,
    facts: {
      hasExitRecord: Boolean(exit),
      exitType: exit?.exit_type ?? null,
      exitSubType: exit?.exit_sub_type ?? null,
      exitReasonCategory: exit?.exit_reason_category ?? null,
      legacyStatusText: emp.employment_status ?? null,
      disciplinaryFlag: Number(emp.disciplinary_flag) === 1,
      blockLifted: emp.rehire_block_lifted_at != null,
      gapDays,
      priorRejoinCount: Number(stintRows[0]?.n ?? 0),
      totalAbscondingExits: Number(abscondRows[0]?.n ?? 0),
      openClearanceCase: Number(clearRows[0]?.n ?? 0) > 0,
      assetsUnreturned: Number(assetRows[0]?.n ?? 0) > 0,
      ffAlreadyPaid,
    },
  };
}
