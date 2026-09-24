/**
 * Attaches LOB display names to result rows by a SEPARATE parameterised lookup.
 * Never JOIN lob_master: employees.lob_id and lob_master.id have mixed collations in prod,
 * and an INNER JOIN would drop unassigned employees.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';

export async function loadLobNames(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((v): v is string => !!v).map(String))];
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, lob_name FROM lob_master WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  for (const r of rows ?? []) names.set(String(r.id), String(r.lob_name));
  return names;
}

/** Returns new rows with `lob_name` (null when the employee has no LOB) added. */
export async function withLobNames<T extends Record<string, unknown>>(
  rows: T[],
  idField: string,
  nameField = 'lob_name',
): Promise<Array<T & Record<string, string | null>>> {
  const names = await loadLobNames(rows.map((r) => r[idField] as string | null | undefined));
  return rows.map((r) => {
    const id = r[idField] as string | null | undefined;
    return { ...r, [nameField]: id ? (names.get(String(id)) ?? null) : null };
  });
}
