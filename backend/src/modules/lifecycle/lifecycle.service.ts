import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

export const lifecycleService = {
  // ── Probation / Confirmation ──────────────────────────────────────────────

  async getProbationDue(days: number) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.date_of_joining,
              e.employment_status, e.branch_id, b.branch_name,
              DATEDIFF(NOW(), e.date_of_joining) AS days_on_probation
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       WHERE e.employment_status = 'Probation'
         AND DATEDIFF(NOW(), e.date_of_joining) >= ?
         AND e.active_status = 1
       ORDER BY e.date_of_joining`,
      [days]
    );
    return rows as RowDataPacket[];
  },

  async confirmEmployee(
    employeeId: string,
    confirmedBy: string,
    remarks: string | undefined,
    req?: Request
  ) {
    await db.execute(
      `UPDATE employees SET employment_status = 'Confirmed', updated_at = NOW() WHERE id = ?`,
      [employeeId]
    );

    await db.execute(
      `INSERT INTO employee_journey_log
         (id, employee_id, event_type, event_date, description, module, triggered_by, metadata)
       VALUES (?, ?, 'confirmation', CURDATE(), ?, 'LIFECYCLE', ?, ?)`,
      [
        randomUUID(),
        employeeId,
        remarks ?? "Employment confirmed",
        confirmedBy,
        JSON.stringify({ confirmed_by: confirmedBy }),
      ]
    );

    await logSensitiveAction({
      actor_user_id: confirmedBy,
      action_type: "EMPLOYEE_CONFIRMED",
      module_key: "LIFECYCLE",
      entity_type: "employee",
      entity_id: employeeId,
      change_summary: { employment_status: "Confirmed", remarks },
      req,
    });
  },

  // ── Lifecycle events ─────────────────────────────────────────────────────

  async listEvents(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM employee_lifecycle_event WHERE employee_id = ? ORDER BY effective_date DESC, created_at DESC`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async createEvent(data: {
    employee_id: string;
    event_type: string;
    effective_date: string;
    old_value_json?: Record<string, unknown>;
    new_value_json?: Record<string, unknown>;
    remarks?: string;
    approval_request_id?: string;
    initiated_by: string;
    approved_by?: string;
  }, req?: Request) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO employee_lifecycle_event
         (id, employee_id, event_type, effective_date, old_value_json, new_value_json,
          remarks, approval_request_id, initiated_by, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.employee_id, data.event_type, data.effective_date,
        data.old_value_json ? JSON.stringify(data.old_value_json) : null,
        data.new_value_json ? JSON.stringify(data.new_value_json) : null,
        data.remarks ?? null, data.approval_request_id ?? null,
        data.initiated_by, data.approved_by ?? null,
      ]
    );

    // Also append to journey_log for unified timeline
    await db.execute(
      `INSERT INTO employee_journey_log (id, employee_id, event_type, event_date, description, module, triggered_by, metadata)
       VALUES (?, ?, ?, ?, ?, 'LIFECYCLE', ?, ?)`,
      [
        randomUUID(), data.employee_id, data.event_type, data.effective_date,
        data.remarks ?? data.event_type,
        data.initiated_by,
        JSON.stringify({ lifecycle_event_id: id, new_value: data.new_value_json }),
      ]
    );

    await logSensitiveAction({
      actor_user_id: data.initiated_by,
      action_type: `LIFECYCLE_${data.event_type.toUpperCase()}`,
      module_key: "LIFECYCLE",
      entity_type: "employee",
      entity_id: data.employee_id,
      change_summary: { event_type: data.event_type, effective_date: data.effective_date },
      req,
    });

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_lifecycle_event WHERE id = ? LIMIT 1", [id]
    );
    return (rows as RowDataPacket[])[0];
  },

  // ── Document verification ─────────────────────────────────────────────────

  async verifyDocument(documentId: string, verifiedBy: string, remarks?: string, req?: Request) {
    await db.execute(
      `UPDATE employee_documents SET verified = 1, verified_by = ?, verification_date = NOW(),
       verification_remarks = ? WHERE id = ?`,
      [verifiedBy, remarks ?? null, documentId]
    );
    await logSensitiveAction({
      actor_user_id: verifiedBy, action_type: "DOCUMENT_VERIFIED", module_key: "LIFECYCLE",
      entity_type: "employee_document", entity_id: documentId,
      change_summary: { verified: true, remarks },
      req,
    });
  },

  async logDocumentAccess(documentId: string, accessedBy: string, accessType: string, ipAddress?: string) {
    try {
      await db.execute(
        "INSERT INTO employee_document_access_log (id, document_id, accessed_by, access_type, ip_address) VALUES (?, ?, ?, ?, ?)",
        [randomUUID(), documentId, accessedBy, accessType, ipAddress ?? null]
      );
    } catch { /* non-fatal */ }
  },

  async listDocuments(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC",
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async getExpiredOrExpiringDocuments(daysAhead = 30) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT d.*, e.employee_code, e.full_name
       FROM employee_documents d
       JOIN employees e ON e.id = d.employee_id
       WHERE d.expiry_date IS NOT NULL AND d.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ORDER BY d.expiry_date ASC`,
      [daysAhead]
    );
    return rows as RowDataPacket[];
  },
};
