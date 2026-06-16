import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export const lmsService = {
  async getProgress(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id,
              employee_id,
              lms_learner_id,
              course_id,
              course_name,
              course_name AS content_title,
              'course' AS content_type,
              NULL AS content_url,
              completion_pct,
              score,
              status,
              last_accessed,
              synced_at
         FROM lms_learning_progress_snapshot
        WHERE employee_id = ?
        ORDER BY synced_at DESC`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async getCertifications(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_certification_snapshot WHERE employee_id = ? ORDER BY issued_date DESC",
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async listMappings() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.*, e.full_name, e.employee_code
       FROM lms_employee_mapping m
       LEFT JOIN employees e ON e.id = m.employee_id
       WHERE m.is_active = 1
       ORDER BY e.full_name`
    );
    return rows as RowDataPacket[];
  },

  async upsertMapping(employeeId: string, lmsLearnerId: string, email?: string) {
    await db.execute(
      `INSERT INTO lms_employee_mapping (id, employee_id, lms_learner_id, email)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE lms_learner_id = VALUES(lms_learner_id), email = VALUES(email)`,
      [randomUUID(), employeeId, lmsLearnerId, email ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_employee_mapping WHERE employee_id = ? LIMIT 1", [employeeId]
    );
    return (rows as RowDataPacket[])[0];
  },

  async getSyncLog() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_sync_audit_log ORDER BY created_at DESC LIMIT 100"
    );
    return rows as RowDataPacket[];
  },
};
