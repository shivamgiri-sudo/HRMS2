import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { UserBusinessScope } from '../../shared/enterpriseScope.js';
import { scopePredicate } from './branch-scope.js';

export const rosterPreferenceService = {
  async submit(
    employeeId: string,
    dto: {
      preferredShiftId?: string;
      preferredWeekOff?: string;
      flexibility: string;
      notes?: string;
      effectiveFrom: string;
    },
  ): Promise<{ id: string }> {
    await db.execute<ResultSetHeader>(
      `INSERT INTO employee_roster_preference
         (employee_id, preferred_shift_id, preferred_week_off, flexibility, notes, effective_from, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
      [
        employeeId,
        dto.preferredShiftId || null,
        dto.preferredWeekOff || null,
        dto.flexibility,
        dto.notes || null,
        dto.effectiveFrom,
        employeeId,
      ],
    );
    const [[row]] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employee_roster_preference WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1",
      [employeeId],
    );
    return { id: row.id };
  },

  async getMyPreferences(employeeId: string): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT erp.*, wst.shift_name
         FROM employee_roster_preference erp
         LEFT JOIN wfm_shift_template wst ON wst.id = erp.preferred_shift_id
        WHERE erp.employee_id = ?
        ORDER BY erp.created_at DESC LIMIT 10`,
      [employeeId],
    );
    return rows;
  },

  async getPending(scope?: UserBusinessScope): Promise<RowDataPacket[]> {
    // Branch scoping (owner ruling 2026-10-01). Unfiltered SQL kept byte-identical for org-wide callers.
    const c = scope ? scopePredicate(scope, { employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", managerEmployeeId: "e.reporting_manager_id" }) : null;
    const scoped = c && c.sql !== "1=1";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT erp.*, e.first_name, e.last_name, e.employee_code, wst.shift_name
         FROM employee_roster_preference erp
         JOIN employees e ON e.id = erp.employee_id
         LEFT JOIN wfm_shift_template wst ON wst.id = erp.preferred_shift_id
        WHERE erp.status = 'pending'${scoped ? ` AND (${c!.sql})` : ""}
        ORDER BY erp.created_at ASC`,
      scoped ? (c!.params as any[]) : []
    );
    return rows;
  },

  async approve(id: string, approvedBy: string): Promise<void> {
    await db.execute(
      "UPDATE employee_roster_preference SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
      [approvedBy, id],
    );
  },

  async reject(id: string, approvedBy: string, reason: string): Promise<void> {
    await db.execute(
      "UPDATE employee_roster_preference SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejection_reason = ? WHERE id = ?",
      [approvedBy, reason, id],
    );
  },

  async getFlexibilityConfig(processId: string): Promise<RowDataPacket | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM shift_flexibility_config WHERE process_id = ? LIMIT 1",
      [processId],
    );
    return rows[0] || null;
  },

  async upsertFlexibilityConfig(
    processId: string,
    data: {
      minFlexibilityPct: number;
      allowsSelfSwap: boolean;
      requiresApproval: boolean;
      configuredBy: string;
    },
  ): Promise<void> {
    await db.execute(
      `INSERT INTO shift_flexibility_config (id, process_id, min_flexibility_pct, allows_self_swap, requires_approval, configured_by)
       VALUES (UUID(), ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         min_flexibility_pct = VALUES(min_flexibility_pct),
         allows_self_swap = VALUES(allows_self_swap),
         requires_approval = VALUES(requires_approval),
         configured_by = VALUES(configured_by),
         updated_at = NOW()`,
      [
        processId,
        data.minFlexibilityPct,
        data.allowsSelfSwap ? 1 : 0,
        data.requiresApproval ? 1 : 0,
        data.configuredBy,
      ],
    );
  },
};
