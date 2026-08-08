/**
 * Deduction Entry Service
 * Handles CRUD for payroll_deduction_type and employee_deduction_entries.
 */

import { randomUUID } from "crypto";
import { sqlLimitOffset } from "../../db/pagination.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeductionType {
  id: string;
  deduction_code: string;
  deduction_name: string;
  description: string | null;
  is_prorated: 0 | 1;
  active_status: 0 | 1;
  created_at: string;
}

export interface DeductionEntry {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  process_name: string | null;
  deduction_type_code: string;
  deduction_type_name: string;
  amount: number;
  description: string;
  is_prorated: 0 | 1;
  run_month: string | null;
  status: "active" | "inactive";
  created_by_name: string | null;
  created_at: string;
}

export interface CreateDeductionTypeDto {
  deduction_code: string;
  deduction_name: string;
  description?: string | null;
  is_prorated?: 0 | 1 | boolean;
}

export interface CreateDeductionEntryDto {
  employee_id: string;
  deduction_type_code: string;
  amount: number;
  description: string;
  is_prorated?: boolean;
  run_month?: string | null;
  recurring?: boolean;
}

export interface BulkDeductionRow {
  employee_code: string;
  deduction_type_code: string;
  amount: number;
  description: string;
  run_month?: string | null;
}

export interface BulkDeductionResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

export interface DeductionEntryFilters {
  search?: string;
  branch_id?: string;
  process_id?: string;
  type?: string;
  month?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// ── Deduction Types ───────────────────────────────────────────────────────────

export async function listDeductionTypes(activeOnly = false): Promise<DeductionType[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM payroll_deduction_type
     ${activeOnly ? "WHERE active_status = 1" : ""}
     ORDER BY deduction_name`
  );
  return rows as DeductionType[];
}

export async function createDeductionType(dto: CreateDeductionTypeDto): Promise<DeductionType> {
  if (!dto.deduction_code?.trim() || !dto.deduction_name?.trim()) {
    throw Object.assign(new Error("deduction_code and deduction_name are required"), { statusCode: 400 });
  }
  if (dto.description && String(dto.description).trim().length < 5) {
    throw Object.assign(new Error("description must be at least 5 characters"), { statusCode: 400 });
  }
  const id = randomUUID();
  await db.execute<ResultSetHeader>(
    `INSERT INTO payroll_deduction_type
       (id, deduction_code, deduction_name, description, is_prorated, active_status)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [
      id,
      dto.deduction_code.trim().toUpperCase().replace(/\s+/g, "_"),
      dto.deduction_name.trim(),
      dto.description ?? null,
      dto.is_prorated ? 1 : 0,
    ]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM payroll_deduction_type WHERE id = ? LIMIT 1",
    [id]
  );
  return (rows as DeductionType[])[0];
}

export async function updateDeductionType(
  id: string,
  dto: Partial<CreateDeductionTypeDto>
): Promise<DeductionType> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (dto.deduction_name !== undefined) {
    sets.push("deduction_name = ?");
    params.push(dto.deduction_name.trim());
  }
  if (dto.description !== undefined) {
    if (dto.description && String(dto.description).trim().length < 5) {
      throw Object.assign(new Error("description must be at least 5 characters"), { statusCode: 400 });
    }
    sets.push("description = ?");
    params.push(dto.description ?? null);
  }
  if (dto.is_prorated !== undefined) {
    sets.push("is_prorated = ?");
    params.push(dto.is_prorated ? 1 : 0);
  }

  if (sets.length === 0) {
    throw Object.assign(new Error("No updatable fields provided"), { statusCode: 400 });
  }

  params.push(id);
  await db.execute<ResultSetHeader>(
    `UPDATE payroll_deduction_type SET ${sets.join(", ")} WHERE id = ?`,
    params
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM payroll_deduction_type WHERE id = ? LIMIT 1",
    [id]
  );
  const row = (rows as DeductionType[])[0];
  if (!row) throw Object.assign(new Error("Deduction type not found"), { statusCode: 404 });
  return row;
}

export async function toggleDeductionType(id: string, active: boolean): Promise<DeductionType> {
  // Block deactivation if active entries reference this type
  if (!active) {
    const [entryRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
         FROM employee_deduction_entries ede
         JOIN payroll_deduction_type pdt ON pdt.deduction_code = ede.deduction_type_code
        WHERE pdt.id = ? AND ede.status = 'active'`,
      [id]
    );
    const cnt = Number((entryRows as RowDataPacket[])[0]?.cnt ?? 0);
    if (cnt > 0) {
      throw Object.assign(
        new Error(`Cannot deactivate: ${cnt} active deduction entries reference this type`),
        { statusCode: 400 }
      );
    }
  }

  await db.execute<ResultSetHeader>(
    "UPDATE payroll_deduction_type SET active_status = ? WHERE id = ?",
    [active ? 1 : 0, id]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM payroll_deduction_type WHERE id = ? LIMIT 1",
    [id]
  );
  const row = (rows as DeductionType[])[0];
  if (!row) throw Object.assign(new Error("Deduction type not found"), { statusCode: 404 });
  return row;
}

// ── Deduction Entries ─────────────────────────────────────────────────────────

export async function listDeductionEntries(
  filters: DeductionEntryFilters,
  scopedBranchId?: string | null
): Promise<{ entries: DeductionEntry[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (scopedBranchId) {
    conditions.push("e.branch_id = ?");
    params.push(scopedBranchId);
  }
  if (filters.branch_id) {
    conditions.push("e.branch_id = ?");
    params.push(filters.branch_id);
  }
  if (filters.process_id) {
    conditions.push("e.process_id = ?");
    params.push(filters.process_id);
  }
  if (filters.type) {
    conditions.push("ede.deduction_type_code = ?");
    params.push(filters.type);
  }
  if (filters.month) {
    conditions.push("(ede.run_month = ? OR ede.run_month IS NULL)");
    params.push(filters.month);
  }
  if (filters.status && ["active", "inactive"].includes(filters.status)) {
    conditions.push("ede.status = ?");
    params.push(filters.status);
  }
  if (filters.search?.trim()) {
    conditions.push(
      "(e.employee_code LIKE ? OR CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) LIKE ?)"
    );
    const like = `%${filters.search.trim()}%`;
    params.push(like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM employee_deduction_entries ede
       JOIN employees e ON e.id = ede.employee_id
       JOIN payroll_deduction_type pdt ON pdt.deduction_code = ede.deduction_type_code
       ${where}`,
    params
  );
  const total = Number((countRows as RowDataPacket[])[0]?.total ?? 0);

  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const offset = filters.offset ?? 0;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       ede.id,
       ede.employee_id,
       e.employee_code,
       COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
       bm.branch_name,
       pm.process_name,
       ede.deduction_type_code,
       pdt.deduction_name AS deduction_type_name,
       ede.amount,
       ede.description,
       ede.is_prorated,
       ede.run_month,
       ede.status,
       COALESCE(NULLIF(TRIM(au_emp.full_name),''), CONCAT(au_emp.first_name,' ',COALESCE(au_emp.last_name,''))) AS created_by_name,
       ede.created_at
     FROM employee_deduction_entries ede
     JOIN employees e ON e.id = ede.employee_id
     JOIN payroll_deduction_type pdt ON pdt.deduction_code = ede.deduction_type_code
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     LEFT JOIN employees au_emp ON au_emp.user_id = ede.created_by
     ${where}
     ORDER BY ede.created_at DESC
     ${sqlLimitOffset(limit, offset)}`,
    params
  );

  return { entries: rows as DeductionEntry[], total };
}

export async function createDeductionEntry(
  dto: CreateDeductionEntryDto,
  actorUserId: string
): Promise<DeductionEntry> {
  // Validate employee active
  const [empRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, employee_code FROM employees WHERE id = ? AND active_status = 1 LIMIT 1",
    [dto.employee_id]
  );
  if (!(empRows as RowDataPacket[]).length) {
    throw Object.assign(new Error("Employee not found or not active"), { statusCode: 400 });
  }

  // Validate type active
  const [typeRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, deduction_code FROM payroll_deduction_type WHERE deduction_code = ? AND active_status = 1 LIMIT 1",
    [dto.deduction_type_code]
  );
  if (!(typeRows as RowDataPacket[]).length) {
    throw Object.assign(new Error("Deduction type not found or inactive"), { statusCode: 400 });
  }

  // Validate amount
  if (!dto.amount || Number(dto.amount) <= 0) {
    throw Object.assign(new Error("amount must be greater than 0"), { statusCode: 400 });
  }

  // Validate description
  if (!dto.description || String(dto.description).trim().length < 5) {
    throw Object.assign(
      new Error("description must be at least 5 characters"),
      { statusCode: 400 }
    );
  }

  const id = randomUUID();
  await db.execute<ResultSetHeader>(
    `INSERT INTO employee_deduction_entries
       (id, employee_id, deduction_type_code, amount, description, is_prorated, run_month, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      id,
      dto.employee_id,
      dto.deduction_type_code,
      Number(dto.amount),
      dto.description.trim(),
      dto.is_prorated ? 1 : 0,
      dto.recurring ? null : (dto.run_month ?? null),
      actorUserId,
    ]
  );

  void logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: "deduction_entry_created",
    module_key: "payroll_deductions",
    entity_type: "employee_deduction_entry",
    entity_id: id,
    new_value_json: {
      employee_id: dto.employee_id,
      deduction_type_code: dto.deduction_type_code,
      amount: dto.amount,
      run_month: dto.run_month ?? null,
    } as Record<string, unknown>,
  });

  const { entries } = await listDeductionEntries({ limit: 1, offset: 0 });
  // Fetch the specific newly created entry
  const [newRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       ede.id,
       ede.employee_id,
       e.employee_code,
       COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
       bm.branch_name,
       pm.process_name,
       ede.deduction_type_code,
       pdt.deduction_name AS deduction_type_name,
       ede.amount,
       ede.description,
       ede.is_prorated,
       ede.run_month,
       ede.status,
       NULL AS created_by_name,
       ede.created_at
     FROM employee_deduction_entries ede
     JOIN employees e ON e.id = ede.employee_id
     JOIN payroll_deduction_type pdt ON pdt.deduction_code = ede.deduction_type_code
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     WHERE ede.id = ? LIMIT 1`,
    [id]
  );
  return (newRows as DeductionEntry[])[0];
}

export async function deactivateDeductionEntry(
  id: string,
  reason: string,
  actorUserId: string
): Promise<void> {
  if (!reason || String(reason).trim().length < 5) {
    throw Object.assign(
      new Error("reason must be at least 5 characters"),
      { statusCode: 400 }
    );
  }

  const [existing] = await db.execute<RowDataPacket[]>(
    "SELECT id, status FROM employee_deduction_entries WHERE id = ? LIMIT 1",
    [id]
  );
  if (!(existing as RowDataPacket[]).length) {
    throw Object.assign(new Error("Deduction entry not found"), { statusCode: 404 });
  }

  await db.execute<ResultSetHeader>(
    "UPDATE employee_deduction_entries SET status = 'inactive', deactivate_reason = ? WHERE id = ?",
    [reason.trim(), id]
  );

  void logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: "deduction_entry_deactivated",
    module_key: "payroll_deductions",
    entity_type: "employee_deduction_entry",
    entity_id: id,
    new_value_json: { status: "inactive", reason } as Record<string, unknown>,
  });
}

export async function bulkCreateDeductionEntries(
  rows: BulkDeductionRow[],
  actorUserId: string
): Promise<BulkDeductionResult> {
  if (!rows.length) return { inserted: 0, skipped: 0, errors: [] };
  if (rows.length > 500) {
    throw Object.assign(new Error("Maximum 500 rows per bulk request"), { statusCode: 400 });
  }

  // Load employees by code
  const codes = [...new Set(rows.map((r) => String(r.employee_code ?? "").trim()).filter(Boolean))];
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code FROM employees
      WHERE employee_code IN (${codes.map(() => "?").join(",")})
        AND active_status = 1`,
    codes
  );
  const empMap = new Map<string, string>();
  for (const e of empRows as RowDataPacket[]) empMap.set(String(e.employee_code), String(e.id));

  // Load active deduction types
  const [typeRows] = await db.execute<RowDataPacket[]>(
    "SELECT deduction_code FROM payroll_deduction_type WHERE active_status = 1"
  );
  const activeTypes = new Set((typeRows as RowDataPacket[]).map((t) => String(t.deduction_code)));

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const empId = empMap.get(String(row.employee_code ?? "").trim());
    if (!empId) {
      errors.push(`Row ${i + 1}: employee_code "${row.employee_code}" not found or inactive`);
      skipped++;
      continue;
    }
    if (!activeTypes.has(String(row.deduction_type_code ?? ""))) {
      errors.push(`Row ${i + 1}: deduction_type_code "${row.deduction_type_code}" not found or inactive`);
      skipped++;
      continue;
    }
    if (!row.amount || Number(row.amount) <= 0) {
      errors.push(`Row ${i + 1}: amount must be greater than 0`);
      skipped++;
      continue;
    }
    if (!row.description || String(row.description).trim().length < 5) {
      errors.push(`Row ${i + 1}: description must be at least 5 characters`);
      skipped++;
      continue;
    }

    const id = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO employee_deduction_entries
         (id, employee_id, deduction_type_code, amount, description, is_prorated, run_month, status, created_by)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'active', ?)`,
      [
        id,
        empId,
        String(row.deduction_type_code),
        Number(row.amount),
        String(row.description).trim(),
        row.run_month ?? null,
        actorUserId,
      ]
    );
    inserted++;
  }

  return { inserted, skipped, errors };
}
