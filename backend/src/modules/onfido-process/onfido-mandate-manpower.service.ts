import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { lmsDb } from "../../db/lms-mysql.js";

/**
 * Manpower sourced from the mandate count database and the live employee roster, for the
 * Onfido cost centre (owner ruling 2026-09-27: cost centre 567 in the request was a mix-up —
 * the real Onfido NOIDA cost centre is BSS/BO/NOIDA-2/576, confirmed against cost_centre_master
 * where client_name = 'Onfido LTD').
 *
 * Approved HC: cost_center_billing_config.current_mandate for this cost centre — the same
 * field manpower-risk.routes.ts's capacity-summary endpoint already reads as "mandated_hc".
 *
 * Active HC: active employees at this cost centre in the DOC/POA/Encord LOBs, MINUS anyone
 * currently sitting in an active NHT (New Hire Training) batch in the LMS — the same
 * trainee_master/batch_master(batch_type='NHT', batch_status='Active') query
 * workforce.mandate.routes.ts's capacity-summary endpoint already uses for "In Training HC".
 * lms_certification_snapshot carries no NHT-specific flag (its certification_name is free
 * text from the LMS classroom/batch name), so training status must come from the LMS's own
 * trainee_master/batch_master tables. trainee_master carries no HRMS employee id column, so
 * the match is by trainee_master.permanent_emp_id = employees.employee_code — the same field
 * lms-employee-mapper.ts and lms.service.ts already use as the HRMS-side key for a trainee.
 */

export const ONFIDO_MANDATE_COST_CENTRE = "BSS/BO/NOIDA-2/576";
// "Appen" from the request does not match any LOB code in lob_master (DOC_CHECK, POA, POA_TRIAL,
// ENCORD, ...); ENCORD is the closest third Onfido-related LOB, kept here pending owner confirmation.
export const ONFIDO_MANDATE_LOB_CODES = ["DOC_CHECK", "POA", "ENCORD"] as const;

export interface OnfidoMandateManpower {
  costCenterCode: string;
  approvedHc: number | null;
  activeHc: number;
  inTrainingHc: number;
  bufferPct: number | null;
}

async function getMandateConfig(
  costCenterCode: string,
): Promise<{ approvedHc: number | null; bufferPct: number | null }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT current_mandate, buffer_pct FROM cost_center_billing_config
       WHERE cost_center = ? AND active_status = 1 LIMIT 1`,
    [costCenterCode],
  );
  const row = rows[0];
  if (!row) return { approvedHc: null, bufferPct: null };
  return {
    approvedHc: Number(row.current_mandate ?? 0),
    bufferPct: Number(row.buffer_pct ?? 0),
  };
}

interface ActiveEmployee {
  id: string;
  employeeCode: string | null;
}

async function getActiveEmployees(
  costCenterCode: string,
  lobCodes: readonly string[],
): Promise<ActiveEmployee[]> {
  const placeholders = lobCodes.map(() => "?").join(",");
  // Two paths handle both data states:
  // 1. employees.lob_id set (post-migration): canonical JOIN
  // 2. employees.lob_id NULL (pre-migration): per-employee lob_master entries keyed by employee_code
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code FROM employees e
       JOIN lob_master lm ON lm.id = e.lob_id
       WHERE e.active_status = 1 AND e.cost_center_code = ? AND lm.lob_code IN (${placeholders})
     UNION
     SELECT e.id, e.employee_code FROM employees e
       JOIN lob_master per_lob ON per_lob.lob_code = e.employee_code AND per_lob.active_status = 1
       WHERE e.active_status = 1 AND e.cost_center_code = ? AND e.lob_id IS NULL
         AND per_lob.lob_name IN (SELECT canon.lob_name FROM lob_master canon WHERE canon.lob_code IN (${placeholders}))`,
    [costCenterCode, ...lobCodes, costCenterCode, ...lobCodes],
  );
  return rows.map((r) => ({
    id: String(r.id),
    employeeCode: r.employee_code ? String(r.employee_code) : null,
  }));
}

/** Employee codes currently in an active NHT batch, read-only from the LMS. Failure -> empty
 *  set, same "an LMS outage must never take the dashboard down" rule as workforce.mandate.routes.ts. */
async function getInTrainingEmployeeCodes(): Promise<Set<string>> {
  try {
    const [rows] = await lmsDb.query<RowDataPacket[]>(
      `SELECT tm.permanent_emp_id AS employee_code
         FROM trainee_master tm
         JOIN batch_master bm ON bm.batch_no = tm.batch_no
        WHERE bm.batch_type = 'NHT' AND bm.batch_status = 'Active'
          AND tm.permanent_emp_id IS NOT NULL AND tm.permanent_emp_id <> ''`,
    );
    return new Set(rows.map((r) => String(r.employee_code)));
  } catch (err: unknown) {
    console.error(
      "[onfido-mandate-manpower] LMS in-training lookup failed, treating as none:",
      err,
    );
    return new Set();
  }
}

export async function getOnfidoMandateManpower(
  costCenterCode: string = ONFIDO_MANDATE_COST_CENTRE,
  lobCodes: readonly string[] = ONFIDO_MANDATE_LOB_CODES,
): Promise<OnfidoMandateManpower> {
  const [{ approvedHc, bufferPct }, activeEmployees, inTrainingCodes] =
    await Promise.all([
      getMandateConfig(costCenterCode),
      getActiveEmployees(costCenterCode, lobCodes),
      getInTrainingEmployeeCodes(),
    ]);
  const inTrainingHc = activeEmployees.filter(
    (e) => e.employeeCode !== null && inTrainingCodes.has(e.employeeCode),
  ).length;
  return {
    costCenterCode,
    approvedHc,
    activeHc: activeEmployees.length - inTrainingHc,
    inTrainingHc,
    bufferPct,
  };
}

// ── Capacity Builder (LOB Wise) ────────────────────────────────────────────────

export interface CapacityBuilderRow {
  lob: string;
  activeHc: number;
  approvedHc: number | null;
  inTraining: number;
  bufferPct: number | null;
}

export async function getOnfidoCapacityBuilder(
  costCenterCode: string = ONFIDO_MANDATE_COST_CENTRE,
): Promise<CapacityBuilderRow[]> {
  const canonCodes = ONFIDO_MANDATE_LOB_CODES;
  const canonPh = canonCodes.map(() => "?").join(",");
  const [lobRows, inTrainingCodes] = await Promise.all([
    db.execute<RowDataPacket[]>(
      // Same two-path pattern as getActiveEmployees: canonical lob_id (post-migration)
      // and per-employee lob_master entries keyed by employee_code (pre-migration).
      `SELECT lob_code, lob_name, SUM(active_hc) AS active_hc,
              GROUP_CONCAT(emp_codes) AS emp_codes
       FROM (
         SELECT lm.lob_code, lm.lob_name, COUNT(e.id) AS active_hc,
                GROUP_CONCAT(e.employee_code) AS emp_codes
         FROM employees e
         JOIN lob_master lm ON lm.id = e.lob_id
         WHERE e.active_status = 1 AND e.cost_center_code = ?
         GROUP BY lm.lob_code, lm.lob_name
         UNION ALL
         SELECT canon.lob_code, canon.lob_name, COUNT(e.id) AS active_hc,
                GROUP_CONCAT(e.employee_code) AS emp_codes
         FROM employees e
         JOIN lob_master per_lob ON per_lob.lob_code = e.employee_code AND per_lob.active_status = 1
         JOIN lob_master canon ON canon.lob_name = per_lob.lob_name AND canon.lob_code IN (${canonPh})
         WHERE e.active_status = 1 AND e.cost_center_code = ? AND e.lob_id IS NULL
         GROUP BY canon.lob_code, canon.lob_name
       ) combined
       GROUP BY lob_code, lob_name
       ORDER BY lob_name`,
      [costCenterCode, ...canonCodes, costCenterCode],
    ),
    getInTrainingEmployeeCodes(),
  ]);

  const rows: CapacityBuilderRow[] = [];
  for (const r of lobRows[0]) {
    const codes: string[] = r.emp_codes
      ? String(r.emp_codes).split(",").filter(Boolean)
      : [];
    const inTraining = codes.filter((c) => inTrainingCodes.has(c)).length;
    const activeHc = Number(r.active_hc) - inTraining;
    rows.push({
      lob: r.lob_name || r.lob_code,
      activeHc,
      approvedHc: null,
      inTraining,
      bufferPct: null,
    });
  }
  return rows;
}
