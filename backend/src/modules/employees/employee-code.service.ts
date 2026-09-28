/**
 * Employee code generation — single source of truth.
 *
 * Three generators previously existed with three formats sharing one counter:
 *   MAS{n}            (orchestrator, on-roll)
 *   {n}C              (orchestrator, trainee / off-roll)
 *   MAS{YYMM}{00000}  (employee-code-gate route)
 *
 * They are not merely inconsistent, they corrupt each other. The max query below
 * matches `^MAS[0-9]+$`, which also matches a gate-route code like
 * MAS260700001 — casting it to 260,700,001. A single code issued in that format
 * would permanently jump the sequence into the hundreds of millions.
 *
 * An audit of production found 0 codes in the gate-route format (all 58,591 are
 * MAS{n} or {n}C), so standardising on this generator is safe and needs no
 * back-fill.
 */
import type { PoolConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

/** Employment types issued an off-roll style code, matched exactly (kept for reference --
 *  isOffRollType() below is what actually runs; this is retained as the exact-match core). */
const OFF_ROLL_TYPES = new Set(['Trainee', 'OffRoll']);

/**
 * Whether an employment-type label should get an off-roll {n}C code.
 *
 * OFF_ROLL_TYPES above only matched the exact strings 'Trainee'/'OffRoll'. The real,
 * dominant label for this designation across 13,833 existing employees is
 * "MGMT. TRAINEE" (with the period and full wording) -- which is NOT in that set, so
 * `OFF_ROLL_TYPES.has('MGMT. TRAINEE')` silently returned false and any new trainee hire
 * converted through this generator got a MAS{n} code instead of the historically-correct
 * {n}C code. Confirmed live 2026-09-09 (Vijal Ramsingh Bhati -> MAS63510, should have been
 * {n}C like every one of the 13,833 other MGMT. TRAINEE employees). The bug was introduced
 * 2026-07-29 when three separate code generators were consolidated into this one using only
 * two example off-roll labels instead of checking the real production distribution, and sat
 * undetected for six weeks because no MGMT. TRAINEE hire went through this live path in
 * that window.
 *
 * Matched case/whitespace-insensitively, and by substring for "TRAINEE" specifically, so
 * the next label variant (there is no single canonical spelling in this system's history --
 * see employees.emp_type having ONROLL/MGMT. TRAINEE/FIELD/ON SITE all as free-form values)
 * doesn't reopen the same hole.
 */
export function isOffRollType(empType: string | null | undefined): boolean {
  if (OFF_ROLL_TYPES.has(String(empType))) return true;
  const normalized = String(empType ?? '').trim().toUpperCase();
  if (!normalized) return false;
  if (normalized.includes('TRAINEE')) return true;
  return normalized === 'OFFROLL' || normalized === 'OFF ROLL' || normalized === 'OFF-ROLL';
}

/**
 * Reserves and returns the next employee code.
 *
 * Must be called inside the caller's transaction: the max-scan and the sequence
 * advance have to be atomic with the employee insert, or two concurrent
 * approvals can take the same number.
 */
export async function generateEmployeeCode(conn: PoolConnection, empType: string): Promise<string> {
  const isOffRoll = isOffRollType(empType);

  // One shared counter across every historical format, so on-roll and off-roll
  // codes never collide on the same number.
  const [maxRows] = await conn.execute<RowDataPacket[]>(
    `SELECT GREATEST(
       IFNULL((SELECT MAX(current_sequence) FROM employee_code_sequence), 0),
       IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^MAS[0-9]+$'),0),
       IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^IDC[0-9]+$'),0),
       IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,1,CHAR_LENGTH(employee_code)-1) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^[0-9]+C$'),0),
       IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4,CHAR_LENGTH(employee_code)-4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^IDC[0-9]+C$'),0)
     ) AS global_max`
  );

  const nextSeq = (Number((maxRows as RowDataPacket[])[0]?.global_max) || 0) + 1;

  // Keep the bookkeeping table in step. It is advisory only — the max scan
  // above is authoritative, which is why the table currently lags reality.
  await conn.execute(
    `UPDATE employee_code_sequence SET current_sequence = ?, last_generated_at = NOW()
     WHERE current_sequence < ?`,
    [nextSeq, nextSeq]
  );

  return isOffRoll ? `${nextSeq}C` : `MAS${nextSeq}`;
}
