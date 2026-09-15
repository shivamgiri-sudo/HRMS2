/**
 * Employee-name lookup for the live dialler dashboards.
 *
 * The dialler's agent logs identify agents only by employee code (MAS62353);
 * they carry no name. Names live in HRMS, so they are resolved from
 * mas_hrms.employees. A code with no HRMS record is simply absent from the map.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

/** Upper-cased, trimmed employee code — the form both sides are matched in. */
export const codeKey = (code: unknown) => String(code ?? '').trim().toUpperCase();

export async function resolveEmployeeNames(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map(codeKey).filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  // employee_code is compared bare so its index is used — wrapping it in
  // UPPER()/TRIM() forces a full scan. Dialler codes are already upper-case;
  // codeKey() normalises both sides for the lookup.
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT employee_code AS code,
            TRIM(COALESCE(NULLIF(TRIM(full_name), ''), CONCAT_WS(' ', first_name, last_name))) AS name
       FROM employees
      WHERE employee_code IN (?)`,
    [unique],
  );
  for (const r of rows) if (r.name) names.set(codeKey(r.code), String(r.name));
  return names;
}
