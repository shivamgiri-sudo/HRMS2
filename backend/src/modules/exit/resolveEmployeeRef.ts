/**
 * Turn whatever identifies an employee on an exit request into their id.
 *
 * The exit form asked for a raw UUID — a free-text box labelled "Employee ID / UUID" with the
 * placeholder "Enter employee UUID" — and the schema accepted nothing else. HR knows people as
 * MAS63193, so raising an involuntary termination first required going and finding a UUID.
 *
 * Resolution is by employee_code only, and only exactly. That column is unique across active
 * employees (1,297 rows, 1,297 distinct codes, 0 duplicates, measured live 2026-08-11), so a
 * code identifies exactly one person. There is deliberately NO name or email fallback:
 * attaching a termination to the wrong person is far worse than making the caller supply a
 * code that exists.
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveEmployeeRef(
  employeeId: string | null | undefined,
  employeeCode: string | null | undefined,
): Promise<string> {
  const id = String(employeeId ?? "").trim();
  if (id && UUID_RE.test(id)) return id;

  const code = String(employeeCode ?? "").trim().toUpperCase();
  if (!code) {
    throw Object.assign(new Error("employeeId or employeeCode is required"), { statusCode: 400 });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE employee_code = ? ORDER BY active_status DESC LIMIT 1`,
    [code],
  );
  const resolved = String((rows as Array<{ id?: string }>)[0]?.id ?? "").trim();
  if (!resolved) {
    // Names the code back, because "employee not found" against a form that just took a code
    // is the kind of message that sends people looking in the wrong place.
    throw Object.assign(new Error(`No employee found with code ${code}`), { statusCode: 404 });
  }
  return resolved;
}
