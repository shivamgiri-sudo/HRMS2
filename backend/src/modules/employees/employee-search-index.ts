/**
 * Whether the employees FULLTEXT index (ft_emp_search: full_name, employee_code, official_email) exists.
 *
 * The employee search used MATCH(...) AGAINST unconditionally, but the index comes from sql/541 which is not in
 * the migration registry and was never applied in production: every search by a name or a non-"MAS" code of 3+
 * characters failed with ER_FT_MATCHING_KEY_NOT_FOUND (HTTP 500), including the Salary Change Center's employee
 * search. Callers now use MATCH only when this says the index is there and fall back to LIKE otherwise.
 * Cached: a found index for 10 minutes, a missing one for 1 minute so a later-created index is picked up.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

let cached: { value: boolean; until: number } | null = null;

export async function employeeFulltextAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.until > now) return cached.value;
  let value = false;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'
          AND INDEX_NAME = 'ft_emp_search' AND INDEX_TYPE = 'FULLTEXT' LIMIT 1`,
    );
    value = (rows as RowDataPacket[]).length > 0;
  } catch {
    value = false; // unknown means LIKE, which always works
  }
  cached = { value, until: now + (value ? 10 * 60_000 : 60_000) };
  return value;
}

/** For tests. */
export function resetEmployeeFulltextCache(): void {
  cached = null;
}
