import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Is this login account still entitled to hold a live session?
 *
 * Both gates below already existed — but only at the two moments a session is
 * *created*. login() rejects a blocked account and an employee whose
 * active_status is 0, and refreshAccess() repeats both checks before it will
 * rotate a refresh token (auth.service.ts). Nothing re-checked them on an
 * ordinary API request: requireAuth verified the JWT signature and nothing
 * else, so a correctly-signed token stayed good for its full 24h life no
 * matter what happened to the account behind it.
 *
 * That is the hole this closes. Deactivating an employee did not end their
 * access — it only stopped the next refresh, up to a day later. And because
 * HR's "Inactive" action on the employee directory writes employment_status
 * while every one of these gates reads active_status, the usual way of marking
 * a leaver inactive ended their access never.
 *
 * The semantics are copied from refreshAccess deliberately, so the three gates
 * cannot drift apart: only an explicit active_status = 0 blocks. An auth_user
 * with no employees row (service and admin accounts) is not an employee and is
 * left alone, exactly as COALESCE(e.active_status, 1) does there.
 *
 * MAX() rather than the plain LEFT JOIN used at refresh because 6 user_ids
 * currently own more than one employees row (rehires, measured 2026-08-10).
 * Any one row still active keeps the login working, so a stale duplicate can
 * never lock out an employee who is genuinely on the payroll.
 */
export async function isAccountRevoked(userId: string): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(au.is_blocked, 0) AS is_blocked,
              (SELECT MAX(e.active_status) FROM employees e WHERE e.user_id = au.id) AS employee_active
         FROM auth_user au
        WHERE au.id = ?
        LIMIT 1`,
      [userId]
    );

    const row = rows[0];
    // No auth_user row: the token's signature is still valid, so this is a
    // deleted or migrated account rather than an attack. Left to the route's
    // own checks — widening this to a hard block is a separate decision.
    if (!row) return false;

    if (Number(row.is_blocked) === 1) return true;

    const employeeActive = (row as { employee_active: unknown }).employee_active;
    return employeeActive != null && Number(employeeActive) === 0;
  } catch (err) {
    // Fail OPEN on infrastructure failure, and loudly. This runs on every
    // authenticated request: failing closed would sign out the entire company
    // for the duration of a database blip. login() and refreshAccess() still
    // fail closed, so an outage cannot be used to obtain a *new* session — it
    // can only extend one that already exists, for as long as the outage lasts.
    process.stderr.write(
      JSON.stringify({
        level: "critical",
        module: "accountStatus",
        event: "ACCOUNT_STATUS_CHECK_FAILED",
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }) + "\n"
    );
    return false;
  }
}
