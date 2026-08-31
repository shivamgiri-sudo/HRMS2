import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

function httpError(msg: string, status: number, code: string) {
  const e = new Error(msg) as Error & { status: number; code: string };
  e.status = status; e.code = code; return e;
}

export interface CreateRevisionInput {
  employee_id: string;
  requested_effective_from: string; // YYYY-MM-DD
  reason: string;
  requested_by: string; // auth_user.id (string in this codebase)
}

export async function createRevisionRequest(input: CreateRevisionInput): Promise<{ id: number }> {
  if (!input.reason || input.reason.trim().length < 10) {
    throw httpError("Reason must be at least 10 characters.", 400, "REASON_TOO_SHORT");
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requested_effective_from) || isNaN(Date.parse(input.requested_effective_from))) {
    throw httpError("requested_effective_from must be a valid YYYY-MM-DD date.", 400, "INVALID_DATE");
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1`,
    [input.employee_id]
  );
  if (!empRows.length) throw httpError("Employee not found.", 404, "NOT_FOUND");
  const doj = empRows[0].date_of_joining as string;
  if (new Date(input.requested_effective_from) < new Date(doj)) {
    throw httpError("Requested date cannot be before date of joining.", 400, "INVALID_DATE");
  }

  const [assignRows] = await db.execute<RowDataPacket[]>(
    `SELECT effective_from FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1 ORDER BY effective_from DESC LIMIT 1`,
    [input.employee_id]
  );
  if (!assignRows.length) throw httpError("No active salary assignment found for this employee.", 404, "NO_ASSIGNMENT");
  const currentEffectiveFrom = assignRows[0].effective_from as string;

  const [dupeRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_salary_date_revision_requests WHERE employee_id = ? AND status = 'pending' LIMIT 1`,
    [input.employee_id]
  );
  if (dupeRows.length) throw httpError("A pending revision request already exists for this employee.", 409, "DUPLICATE_REQUEST");

  const [result] = await db.execute(
    `INSERT INTO employee_salary_date_revision_requests
       (employee_id, current_effective_from, requested_effective_from, reason, requested_by)
     VALUES (?, ?, ?, ?, ?)`,
    [input.employee_id, currentEffectiveFrom, input.requested_effective_from, input.reason.trim(), input.requested_by]
  ) as any;

  return { id: (result as any).insertId as number };
}

export async function listRevisionRequests(filters: { status?: string; employee_id?: string }) {
  const status = filters.status || "pending";
  const conds = ["r.status = ?"];
  const params: unknown[] = [status];
  if (filters.employee_id) { conds.push("r.employee_id = ?"); params.push(filters.employee_id); }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.employee_id, r.current_effective_from, r.requested_effective_from,
            r.reason, r.status, r.review_remarks, r.created_at, r.reviewed_at,
            e.full_name, e.employee_code,
            b.branch_name,
            COALESCE(au.email, '') AS requested_by_email
       FROM employee_salary_date_revision_requests r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN auth_user au ON au.id = r.requested_by
      WHERE ${conds.join(" AND ")}
      ORDER BY r.created_at DESC`,
    params
  );
  return rows as RowDataPacket[];
}

export async function reviewRevisionRequest(
  id: number,
  action: "approve" | "reject",
  reviewedBy: string,
  remarks?: string
): Promise<void> {
  if (action === "reject" && (!remarks || remarks.trim().length === 0)) {
    throw httpError("Remarks are required when rejecting.", 400, "REMARKS_REQUIRED");
  }

  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM employee_salary_date_revision_requests WHERE id = ? LIMIT 1`,
    [id]
  );
  const req = reqRows[0];
  if (!req) throw httpError("Revision request not found.", 404, "NOT_FOUND");
  if (req.status !== "pending") throw httpError("Request is no longer pending.", 409, "NOT_PENDING");

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    if (action === "approve") {
      await connection.execute(
        `UPDATE employee_salary_assignment
            SET active_status = 0,
                effective_to = DATE_SUB(?, INTERVAL 1 DAY)
          WHERE employee_id = ? AND active_status = 1`,
        [req.requested_effective_from, req.employee_id]
      );

      const [assignRows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM employee_salary_assignment WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1`,
        [req.employee_id]
      );
      if (!assignRows.length) {
        await connection.rollback();
        throw httpError("No salary assignment found to revise.", 404, "NO_ASSIGNMENT");
      }
      const old = assignRows[0];

      // Insert a new active assignment with the revised effective_from date.
      // Columns: id (auto-UUID), employee_id, structure_id, ctc_annual,
      //          effective_from, active_status, assigned_by.
      // basic_salary / gross_salary / created_by do NOT exist on this table.
      await connection.execute(
        `INSERT INTO employee_salary_assignment
           (employee_id, structure_id, ctc_annual, effective_from, active_status, assigned_by)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [
          req.employee_id,
          old.structure_id,
          old.ctc_annual,
          req.requested_effective_from,
          reviewedBy,
        ]
      );

      // Audit — non-fatal if no review row exists for this employee
      await connection.execute(
        `INSERT INTO employee_payroll_head_review_history
           (id, employee_id, review_id, action, actor_user_id, rejection_remarks, notified_employee)
         SELECT UUID(), ?, r.id, 'salary_date_revision_approved', ?, ?, 0
           FROM employee_payroll_head_review r WHERE r.employee_id = ? LIMIT 1`,
        [
          req.employee_id,
          reviewedBy,
          JSON.stringify({ old_date: req.current_effective_from, new_date: req.requested_effective_from, request_id: id }),
          req.employee_id,
        ]
      ).catch(() => {});
    } else {
      await connection.execute(
        `INSERT INTO employee_payroll_head_review_history
           (id, employee_id, review_id, action, actor_user_id, rejection_remarks, notified_employee)
         SELECT UUID(), ?, r.id, 'salary_date_revision_rejected', ?, ?, 0
           FROM employee_payroll_head_review r WHERE r.employee_id = ? LIMIT 1`,
        [
          req.employee_id,
          reviewedBy,
          JSON.stringify({ requested_date: req.requested_effective_from, remarks }),
          req.employee_id,
        ]
      ).catch(() => {});
    }

    const [updateResult] = await connection.execute(
      `UPDATE employee_salary_date_revision_requests
          SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_remarks = ?
        WHERE id = ? AND status = 'pending'`,
      [action === "approve" ? "approved" : "rejected", reviewedBy, remarks ?? null, id]
    ) as any;

    if ((updateResult as any).affectedRows === 0) {
      await connection.rollback();
      throw httpError("Request was already processed by another reviewer.", 409, "ALREADY_PROCESSED");
    }

    await connection.commit();
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}

export interface BulkValidateInput {
  employee_codes: string[];          // raw codes from textarea, may have whitespace
  requested_effective_from: string;  // YYYY-MM-DD
}

export interface BulkValidateRow {
  code: string;
  status: 'ok' | 'error';
  employee_id?: string;
  name?: string;
  reason?: string;
}

export async function bulkValidate(input: BulkValidateInput): Promise<BulkValidateRow[]> {
  // Validate date format (same pattern as createRevisionRequest)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.requested_effective_from) ||
    isNaN(Date.parse(input.requested_effective_from))
  ) {
    throw httpError("requested_effective_from must be a valid YYYY-MM-DD date.", 400, "INVALID_DATE");
  }

  // Deduplicate and trim input codes
  const codes = Array.from(
    new Set(input.employee_codes.map((c) => c.trim()).filter((c) => c.length > 0))
  );

  const results: BulkValidateRow[] = [];

  for (const code of codes) {
    // Check 1: employee lookup
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, TRIM(COALESCE(full_name, CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')))) AS name, date_of_joining
         FROM employees WHERE employee_code = ? LIMIT 1`,
      [code]
    );

    if (!empRows.length) {
      results.push({ code, status: 'error', reason: 'Employee not found' });
      continue;
    }

    const emp = empRows[0];
    const employee_id = String(emp.id);
    const name = emp.name as string;
    const doj = emp.date_of_joining as string;

    // Check 2: date before date of joining
    if (new Date(input.requested_effective_from) < new Date(doj)) {
      results.push({ code, status: 'error', employee_id, name, reason: 'Date is before date of joining' });
      continue;
    }

    // Check 3: active salary assignment
    const [assignRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1 LIMIT 1`,
      [employee_id]
    );

    if (!assignRows.length) {
      results.push({ code, status: 'error', employee_id, name, reason: 'No active salary assignment' });
      continue;
    }

    // Check 4: no existing pending revision
    const [pendingRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employee_salary_date_revision_requests WHERE employee_id = ? AND status = 'pending' LIMIT 1`,
      [employee_id]
    );

    if (pendingRows.length) {
      results.push({ code, status: 'error', employee_id, name, reason: 'Pending request already exists' });
      continue;
    }

    results.push({ code, status: 'ok', employee_id, name });
  }

  return results;
}
