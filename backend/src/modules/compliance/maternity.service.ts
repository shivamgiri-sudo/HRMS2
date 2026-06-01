// backend/src/modules/compliance/maternity.service.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import {
  computeEntitledWeeks,
  computeLeaveEndDate,
  computeNursingBreakEndDate,
} from './maternity.types.js';
import type {
  MaternityRecord,
  CreateMaternityDTO,
  UpdateMaternityDTO,
} from './maternity.types.js';
import type { MaternityListFilters } from './maternity.validation.js';

const SELECT_BASE = `
  SELECT m.*,
         e.full_name  AS employee_name,
         e.employee_code
    FROM maternity_benefit_record m
    LEFT JOIN employees e ON e.id = m.employee_id
`;

export const maternityService = {
  async list(employeeId: string | undefined, filters: MaternityListFilters): Promise<MaternityRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (employeeId)          { conds.push('m.employee_id = ?');              params.push(employeeId); }
    if (filters.status)      { conds.push('m.status = ?');                   params.push(filters.status); }
    if (filters.record_type) { conds.push('m.record_type = ?');              params.push(filters.record_type); }
    if (filters.year)        { conds.push('YEAR(m.leave_start_date) = ?');   params.push(filters.year); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [rows] = await db.execute<RowDataPacket[]>(
      `${SELECT_BASE} ${where} ORDER BY m.leave_start_date DESC`,
      params
    );
    return rows as MaternityRecord[];
  },

  async getById(id: string): Promise<MaternityRecord | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `${SELECT_BASE} WHERE m.id = ? LIMIT 1`, [id]
    );
    return (rows[0] as MaternityRecord) ?? null;
  },

  async create(dto: CreateMaternityDTO): Promise<MaternityRecord> {
    // Enforce: only one active/approved maternity record per employee at a time
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM maternity_benefit_record
        WHERE employee_id = ? AND status IN ('applied','approved','active') LIMIT 1`,
      [dto.employee_id]
    );
    if ((existing as RowDataPacket[]).length > 0) {
      throw new Error('Employee already has an active or pending maternity record');
    }

    const entitled_weeks = computeEntitledWeeks(
      dto.record_type,
      dto.child_birth_order,
      dto.complications ?? false
    );
    const leave_end_date = computeLeaveEndDate(dto.leave_start_date, entitled_weeks);
    const id = randomUUID();

    await db.execute(
      `INSERT INTO maternity_benefit_record
         (id, employee_id, record_type, child_birth_order, entitled_weeks,
          expected_delivery_date, leave_start_date, leave_end_date,
          paid_weeks, complications, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?)`,
      [
        id,
        dto.employee_id,
        dto.record_type,
        dto.child_birth_order,
        entitled_weeks,
        dto.expected_delivery_date ?? null,
        dto.leave_start_date,
        leave_end_date,
        entitled_weeks, // paid_weeks = entitled_weeks initially
        dto.complications ? 1 : 0,
        dto.notes ?? null,
      ]
    );
    return (await this.getById(id))!;
  },

  async approve(id: string, approverId: string): Promise<MaternityRecord> {
    const record = await this.getById(id);
    if (!record) throw new Error('Maternity record not found');
    if (record.status !== 'applied') throw new Error(`Cannot approve record in status: ${record.status}`);

    // Find ML leave_type_id
    const [ltRows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM leave_type_master WHERE leave_code = 'ML' AND active_status = 1 LIMIT 1"
    );
    if (!(ltRows as RowDataPacket[]).length) throw new Error('ML leave type not found in leave_type_master');
    const leaveTypeId = (ltRows[0] as any).id as string;

    // Auto-create leave_request for the maternity period
    const leaveReqId = randomUUID();
    const totalDays = record.entitled_weeks * 7;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      await conn.execute(
        `INSERT INTO leave_request
           (id, employee_id, leave_type_id, from_date, to_date, total_days, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Maternity leave — auto-created on approval', 'approved')`,
        [
          leaveReqId,
          record.employee_id,
          leaveTypeId,
          record.leave_start_date,
          record.leave_end_date,
          totalDays,
        ]
      );

      // Log the auto-approval in leave_approval_log
      await conn.execute(
        `INSERT INTO leave_approval_log (id, leave_request_id, action, action_by, remarks)
         VALUES (UUID(), ?, 'approved', ?, 'Auto-approved via maternity benefit record')`,
        [leaveReqId, approverId]
      );

      // Update maternity record: status → approved, link leave_request_id
      await conn.execute(
        `UPDATE maternity_benefit_record
            SET status = 'approved', approved_by = ?, leave_request_id = ?
          WHERE id = ?`,
        [approverId, leaveReqId, id]
      );

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    return (await this.getById(id))!;
  },

  async update(id: string, dto: UpdateMaternityDTO): Promise<MaternityRecord> {
    const record = await this.getById(id);
    if (!record) throw new Error('Maternity record not found');

    const sets: string[] = [];
    const params: unknown[] = [];

    if (dto.actual_delivery_date !== undefined) {
      sets.push('actual_delivery_date = ?');
      params.push(dto.actual_delivery_date);
      // Always recompute nursing break end date when a delivery date is provided
      if (dto.actual_delivery_date) {
        sets.push('nursing_break_end_date = ?');
        params.push(computeNursingBreakEndDate(dto.actual_delivery_date));
      }
    }
    if (dto.leave_end_date !== undefined) {
      sets.push('leave_end_date = ?');
      params.push(dto.leave_end_date);
    }
    if (dto.nursing_break_granted !== undefined) {
      sets.push('nursing_break_granted = ?');
      params.push(dto.nursing_break_granted ? 1 : 0);
    }
    if (dto.work_from_home_option !== undefined) {
      sets.push('work_from_home_option = ?');
      params.push(dto.work_from_home_option ? 1 : 0);
    }
    if (dto.notes !== undefined) {
      sets.push('notes = ?');
      params.push(dto.notes);
    }
    if (dto.status !== undefined) {
      sets.push('status = ?');
      params.push(dto.status);
    }

    if (sets.length === 0) return record;
    params.push(id);
    await db.execute(`UPDATE maternity_benefit_record SET ${sets.join(', ')} WHERE id = ?`, params);
    return (await this.getById(id))!;
  },

  /**
   * Returns employee IDs with an active maternity record covering the given month.
   * Used by payroll LWP exclusion.
   * runMonth format: 'YYYY-MM'
   */
  async getActiveEmployeeIdsForMonth(runMonth: string): Promise<Set<string>> {
    const [y, m] = runMonth.split('-').map(Number);
    const monthStart = `${runMonth}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${runMonth}-${String(lastDay).padStart(2, '0')}`;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT employee_id
         FROM maternity_benefit_record
        WHERE status IN ('approved', 'active')
          AND leave_start_date <= ?
          AND (leave_end_date IS NULL OR leave_end_date >= ?)`,
      [monthEnd, monthStart]
    );
    return new Set((rows as RowDataPacket[]).map((r: any) => r.employee_id as string));
  },
};
