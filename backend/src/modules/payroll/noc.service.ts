import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface NocRecord {
  id: string;
  employee_id: string;
  run_month: string | null;
  ff_calculation_id: string | null;
  noc_type: "salary" | "fnf";
  upload_status: "pending" | "uploaded" | "validated" | "rejected";
  uploaded_by: string | null;
  uploaded_at: string | null;
  doc_path: string | null;
  doc_original_name: string | null;
  validated_by: string | null;
  validated_at: string | null;
  validation_note: string | null;
  rejection_reason: string | null;
  created_at: string;
}

/** Check whether NOC is required for an employee. Returns reason or null. */
export async function nocRequired(employeeId: string): Promise<{ required: boolean; reason: string | null }> {
  // Check active employment status
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employment_status FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const emp = (empRows[0] as any);
  if (!emp) return { required: false, reason: null };

  const isInactive = !["active", "Active"].includes(emp.employment_status ?? "");
  if (!isInactive) return { required: false, reason: null };

  // Check pending FNF
  const [ffRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, net_payable, status FROM full_final_calculation
     WHERE employee_id = ? AND status NOT IN ('paid', 'cancelled')
     ORDER BY created_at DESC LIMIT 1`,
    [employeeId]
  );
  const ff = (ffRows[0] as any);
  if (ff && Number(ff.net_payable ?? 0) > 0) {
    return { required: true, reason: "FNF settlement pending" };
  }

  // Check pending salary run for this employee
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT spr.id, spr.run_month FROM salary_prep_run spr
     JOIN salary_prep_line spl ON spl.run_id = spr.id AND spl.employee_id = ?
     WHERE spr.status NOT IN ('disbursed', 'cancelled')
     ORDER BY spr.run_month DESC LIMIT 1`,
    [employeeId]
  );
  const run = (runRows[0] as any);
  if (run) {
    return { required: true, reason: `Salary pending for ${run.run_month}` };
  }

  return { required: false, reason: null };
}

/** Check whether a validated NOC exists for this employee + context */
export async function nocValidated(employeeId: string, nocType: "salary" | "fnf", runMonth?: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM payroll_noc
     WHERE employee_id = ? AND noc_type = ? AND upload_status = 'validated'
     ${runMonth ? "AND run_month = ?" : ""}
     LIMIT 1`,
    runMonth ? [employeeId, nocType, runMonth] : [employeeId, nocType]
  );
  return (rows as any[]).length > 0;
}

export async function createNoc(params: {
  employeeId: string;
  runMonth?: string;
  ffCalculationId?: string;
  nocType: "salary" | "fnf";
  uploadedBy: string;
  docPath: string;
  docOriginalName: string;
}): Promise<NocRecord> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO payroll_noc
       (id, employee_id, run_month, ff_calculation_id, noc_type, upload_status, uploaded_by, uploaded_at, doc_path, doc_original_name)
     VALUES (?, ?, ?, ?, ?, 'uploaded', ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       upload_status = 'uploaded', uploaded_by = VALUES(uploaded_by), uploaded_at = NOW(),
       doc_path = VALUES(doc_path), doc_original_name = VALUES(doc_original_name)`,
    [id, params.employeeId, params.runMonth ?? null, params.ffCalculationId ?? null,
     params.nocType, params.uploadedBy, params.docPath, params.docOriginalName]
  );
  return getNoc(id) as Promise<NocRecord>;
}

export async function getNoc(id: string): Promise<NocRecord | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT n.*,
       e.employee_code, e.full_name AS employee_name,
       up.full_name AS uploaded_by_name,
       vp.full_name AS validated_by_name
     FROM payroll_noc n
     LEFT JOIN employees e ON e.id = n.employee_id
     LEFT JOIN employees up ON up.id = n.uploaded_by
     LEFT JOIN employees vp ON vp.id = n.validated_by
     WHERE n.id = ? LIMIT 1`,
    [id]
  );
  return ((rows[0] as any) ?? null) as NocRecord | null;
}

export async function listNocs(filters: {
  employeeId?: string;
  uploadStatus?: string;
  nocType?: string;
  runMonth?: string;
}): Promise<NocRecord[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.employeeId) { conds.push("n.employee_id = ?"); params.push(filters.employeeId); }
  if (filters.uploadStatus) { conds.push("n.upload_status = ?"); params.push(filters.uploadStatus); }
  if (filters.nocType) { conds.push("n.noc_type = ?"); params.push(filters.nocType); }
  if (filters.runMonth) { conds.push("n.run_month = ?"); params.push(filters.runMonth); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT n.*, e.employee_code, e.full_name AS employee_name,
       up.full_name AS uploaded_by_name, vp.full_name AS validated_by_name
     FROM payroll_noc n
     LEFT JOIN employees e ON e.id = n.employee_id
     LEFT JOIN employees up ON up.id = n.uploaded_by
     LEFT JOIN employees vp ON vp.id = n.validated_by
     ${where}
     ORDER BY n.created_at DESC LIMIT 500`,
    params
  );
  return rows as NocRecord[];
}

export async function validateNoc(id: string, validatedBy: string, note?: string): Promise<void> {
  await db.execute(
    `UPDATE payroll_noc SET upload_status = 'validated', validated_by = ?, validated_at = NOW(), validation_note = ? WHERE id = ?`,
    [validatedBy, note ?? null, id]
  );
}

export async function rejectNoc(id: string, rejectedBy: string, reason: string): Promise<void> {
  await db.execute(
    `UPDATE payroll_noc SET upload_status = 'rejected', validated_by = ?, validated_at = NOW(), rejection_reason = ? WHERE id = ?`,
    [rejectedBy, reason, id]
  );
}
