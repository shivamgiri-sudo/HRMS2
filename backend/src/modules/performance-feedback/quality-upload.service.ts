import { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";

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
