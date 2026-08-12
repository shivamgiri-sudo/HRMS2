import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import { tableExists } from "../../shared/dbHelpers.js";

export interface QualityUploadRow {
  employee_code: string;
  call_date: string;
  quality_score: number;
  total_score?: number;
  max_score?: number;
  parameter_name?: string;
  parameter_pass?: boolean | string | number;
  auditor_code?: string;
  remarks?: string;
}

export interface QualityUploadResult {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

export async function importQualityRows(
  rows: QualityUploadRow[],
  importedByUserId: string
): Promise<QualityUploadResult> {
  // mas_hrms.quality_audit does not exist, so every INSERT below throws. Because
  // each one sits in a per-row try/catch, an upload of 300 rows returned 300
  // copies of "Table 'mas_hrms.quality_audit' doesn't exist" and imported = 0 -
  // technically honest, unreadable in practice, and it says nothing about why.
  //
  // The table is absent by circumstance rather than accident, which is why this
  // fails fast instead of creating it:
  //
  //   nothing reads quality_audit. There is no SELECT or JOIN against it
  //   anywhere in backend or frontend, so importing into it would write rows no
  //   feature consumes.
  //
  //   the data already arrives another way. db_audit.call_quality_assessment
  //   holds 282,642 audited calls, and kpi-data-connector reads it through the
  //   'quality_audit' INTEGRATION POOL - a connection key, not this table - to
  //   build the quality KPI facts. Importing here would duplicate a working feed
  //   in a second shape.
  //
  //   no UI calls this endpoint. It is reachable by API only.
  //
  // Provisioning the table is therefore a product decision - is manual upload a
  // supported path alongside the dialler feed, and if so what is the dedupe key
  // for its ON DUPLICATE KEY UPDATE? - not a rename. The route is left in place
  // and answers clearly until that is decided.
  if (!(await tableExists("quality_audit"))) {
    throw Object.assign(
      new Error(
        "Manual quality upload is not provisioned: mas_hrms.quality_audit does not exist, " +
        "and nothing in the application reads it. Call-audit quality already reaches HRMS " +
        "from db_audit.call_quality_assessment via the 'quality_audit' integration pool. " +
        "If manual upload should be supported, the table must be created deliberately, " +
        "including the unique key its ON DUPLICATE KEY UPDATE relies on."
      ),
      { statusCode: 501, code: "QUALITY_AUDIT_STORAGE_ABSENT" }
    );
  }

  let imported = 0;
  let skipped = 0;
  const errors: { row: number; reason: string }[] = [];

  // Build employee code → id map for the batch
  const codes = [...new Set(rows.map((r) => r.employee_code).filter(Boolean))];
  let empMap = new Map<string, string>();
  if (codes.length > 0) {
    const placeholders = codes.map(() => "?").join(",");
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_code, id FROM employees WHERE employee_code IN (${placeholders})`,
      codes
    );
    for (const e of empRows) {
      empMap.set(String(e.employee_code), String(e.id));
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      if (!row.employee_code || !row.call_date || row.quality_score === undefined) {
        errors.push({ row: i + 1, reason: "employee_code, call_date, quality_score are required" });
        skipped++;
        continue;
      }

      const empId = empMap.get(String(row.employee_code).trim());
      if (!empId) {
        errors.push({ row: i + 1, reason: `Employee not found: ${row.employee_code}` });
        skipped++;
        continue;
      }

      const callDate = String(row.call_date).slice(0, 10);
      const score = parseFloat(String(row.quality_score));
      if (isNaN(score)) {
        errors.push({ row: i + 1, reason: `Invalid quality_score: ${row.quality_score}` });
        skipped++;
        continue;
      }

      const passVal = row.parameter_pass;
      const parameterPass =
        passVal === true || passVal === 1 || String(passVal).toLowerCase() === "yes" || String(passVal).toLowerCase() === "pass" || String(passVal).toLowerCase() === "true"
          ? 1 : 0;

      await db.execute(
        `INSERT INTO quality_audit
           (id, employee_id, employee_code, call_date, quality_score,
            total_score, max_score, parameter_name, parameter_pass,
            auditor_code, remarks, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE
           quality_score = VALUES(quality_score),
           total_score = COALESCE(VALUES(total_score), total_score),
           max_score = COALESCE(VALUES(max_score), max_score),
           parameter_pass = VALUES(parameter_pass),
           remarks = VALUES(remarks)`,
        [
          randomUUID(), empId, row.employee_code, callDate, score,
          row.total_score ?? null, row.max_score ?? null,
          row.parameter_name ?? null, parameterPass,
          row.auditor_code ?? null, row.remarks ?? null,
          importedByUserId,
        ]
      );
      imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ row: i + 1, reason: msg });
      skipped++;
    }
  }

  return { imported, skipped, errors };
}
