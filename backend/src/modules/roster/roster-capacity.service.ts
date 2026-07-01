import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// ========== Types ==========
export interface ProcessWeekOffCapacity {
  id: string;
  process_id: string;
  day_of_week: number; // 0=Sunday, 1=Monday, ... 6=Saturday
  max_weekoff_count: number;
  max_weekoff_percentage: number | null;
  auto_approve_enabled: number;
  auto_approve_threshold: number | null;
  created_at: string;
  updated_at: string;
}

export interface WeekOffAllocation {
  id: string;
  process_id: string;
  day_of_week: number;
  allocation_date: string; // YYYY-MM-DD
  employee_id: string;
  preference_id: string | null;
  allocation_sequence: number; // FCFS sequence
  allocation_status: 'allocated' | 'waitlisted' | 'denied';
  auto_approved: number;
  allocated_at: string;
}

export interface WeekOffNotification {
  id: string;
  employee_id: string;
  preference_id: string;
  notification_type: 'approved' | 'denied' | 'waitlisted' | 'capacity_full';
  message: string;
  roster_date: string | null;
  is_read: number;
  created_at: string;
}

export interface CapacityCheckResult {
  can_allocate: boolean;
  current_count: number;
  max_count: number;
  max_percentage: number | null;
  process_strength: number;
  allocation_sequence: number | null; // Next sequence number if can allocate
  reason?: string;
}

// ========== Service ==========
class RosterCapacityService {
  // ========== Capacity Config CRUD ==========
  async getCapacityConfig(processId: string, dayOfWeek: number): Promise<ProcessWeekOffCapacity | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM process_weekoff_capacity WHERE process_id = ? AND day_of_week = ?',
      [processId, dayOfWeek]
    );

    return rows.length > 0 ? (rows[0] as ProcessWeekOffCapacity) : null;
  }

  async updateCapacityConfig(
    processId: string,
    dayOfWeek: number,
    updates: {
      max_weekoff_count?: number;
      max_weekoff_percentage?: number | null;
      auto_approve_enabled?: boolean;
      auto_approve_threshold?: number | null;
    }
  ): Promise<ProcessWeekOffCapacity> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.max_weekoff_count !== undefined) {
      sets.push('max_weekoff_count = ?');
      params.push(updates.max_weekoff_count);
    }
    if (updates.max_weekoff_percentage !== undefined) {
      sets.push('max_weekoff_percentage = ?');
      params.push(updates.max_weekoff_percentage);
    }
    if (updates.auto_approve_enabled !== undefined) {
      sets.push('auto_approve_enabled = ?');
      params.push(updates.auto_approve_enabled ? 1 : 0);
    }
    if (updates.auto_approve_threshold !== undefined) {
      sets.push('auto_approve_threshold = ?');
      params.push(updates.auto_approve_threshold);
    }

    if (sets.length === 0) {
      throw new Error('No updates provided');
    }

    params.push(processId, dayOfWeek);

    await db.execute(
      `UPDATE process_weekoff_capacity SET ${sets.join(', ')}, updated_at = NOW()
       WHERE process_id = ? AND day_of_week = ?`,
      params
    );

    const config = await this.getCapacityConfig(processId, dayOfWeek);
    if (!config) throw new Error('Capacity config not found after update');
    return config;
  }

  // ========== Capacity Checking ==========
  async checkCapacity(
    processId: string,
    allocationDate: string,
    dayOfWeek: number
  ): Promise<CapacityCheckResult> {
    // Get capacity config
    const config = await this.getCapacityConfig(processId, dayOfWeek);
    if (!config) {
      return {
        can_allocate: false,
        current_count: 0,
        max_count: 0,
        max_percentage: null,
        process_strength: 0,
        allocation_sequence: null,
        reason: 'No capacity config found for this process and day',
      };
    }

    // Get current allocations for this date
    const [allocations] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM weekoff_allocation_log
       WHERE process_id = ? AND allocation_date = ? AND allocation_status = 'allocated'`,
      [processId, allocationDate]
    );
    const currentCount = (allocations[0] as any).count;

    // Get process strength (total active employees in process)
    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM employees WHERE process_id = ? AND active_status = 1`,
      [processId]
    );
    const processStrength = (employees[0] as any).count;

    // Check count limit
    if (currentCount >= config.max_weekoff_count) {
      return {
        can_allocate: false,
        current_count: currentCount,
        max_count: config.max_weekoff_count,
        max_percentage: config.max_weekoff_percentage,
        process_strength: processStrength,
        allocation_sequence: null,
        reason: `Max capacity reached (${currentCount}/${config.max_weekoff_count})`,
      };
    }

    // Check percentage limit if configured
    if (config.max_weekoff_percentage !== null && processStrength > 0) {
      const currentPercentage = (currentCount / processStrength) * 100;
      if (currentPercentage >= config.max_weekoff_percentage) {
        return {
          can_allocate: false,
          current_count: currentCount,
          max_count: config.max_weekoff_count,
          max_percentage: config.max_weekoff_percentage,
          process_strength: processStrength,
          allocation_sequence: null,
          reason: `Max percentage reached (${currentPercentage.toFixed(1)}%/${config.max_weekoff_percentage}%)`,
        };
      }
    }

    // Get next sequence number (FCFS)
    const [maxSeq] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(allocation_sequence), 0) as max_seq FROM weekoff_allocation_log
       WHERE process_id = ? AND day_of_week = ?`,
      [processId, dayOfWeek]
    );
    const nextSequence = ((maxSeq[0] as any).max_seq || 0) + 1;

    return {
      can_allocate: true,
      current_count: currentCount,
      max_count: config.max_weekoff_count,
      max_percentage: config.max_weekoff_percentage,
      process_strength: processStrength,
      allocation_sequence: nextSequence,
    };
  }

  // ========== Auto-Approval Logic ==========
  async shouldAutoApprove(processId: string, dayOfWeek: number, currentAllocations: number): Promise<boolean> {
    const config = await this.getCapacityConfig(processId, dayOfWeek);
    if (!config || !config.auto_approve_enabled) {
      return false;
    }

    // Auto-approve if threshold not set (approve all within capacity)
    if (config.auto_approve_threshold === null) {
      return true;
    }

    // Auto-approve if under threshold
    return currentAllocations < config.auto_approve_threshold;
  }

  // ========== Allocation Management ==========
  async allocateWeekOff(data: {
    process_id: string;
    day_of_week: number;
    allocation_date: string;
    employee_id: string;
    preference_id: string | null;
    auto_approved?: boolean;
  }): Promise<WeekOffAllocation> {
    // Check capacity
    const capacityCheck = await this.checkCapacity(
      data.process_id,
      data.allocation_date,
      data.day_of_week
    );

    if (!capacityCheck.can_allocate) {
      throw new Error(capacityCheck.reason || 'Capacity limit reached');
    }

    const id = randomUUID();
    const allocationStatus = 'allocated';

    await db.execute(
      `INSERT INTO weekoff_allocation_log
       (id, process_id, day_of_week, allocation_date, employee_id, preference_id,
        allocation_sequence, allocation_status, auto_approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.process_id,
        data.day_of_week,
        data.allocation_date,
        data.employee_id,
        data.preference_id,
        capacityCheck.allocation_sequence,
        allocationStatus,
        data.auto_approved ? 1 : 0,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM weekoff_allocation_log WHERE id = ?',
      [id]
    );

    return rows[0] as WeekOffAllocation;
  }

  async getAllocations(filters: {
    process_id?: string;
    allocation_date?: string;
    employee_id?: string;
    day_of_week?: number;
  }): Promise<WeekOffAllocation[]> {
    let sql = 'SELECT * FROM weekoff_allocation_log WHERE 1=1';
    const params: unknown[] = [];

    if (filters.process_id) {
      sql += ' AND process_id = ?';
      params.push(filters.process_id);
    }
    if (filters.allocation_date) {
      sql += ' AND allocation_date = ?';
      params.push(filters.allocation_date);
    }
    if (filters.employee_id) {
      sql += ' AND employee_id = ?';
      params.push(filters.employee_id);
    }
    if (filters.day_of_week !== undefined) {
      sql += ' AND day_of_week = ?';
      params.push(filters.day_of_week);
    }

    sql += ' ORDER BY allocation_sequence ASC';

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows as WeekOffAllocation[];
  }

  // ========== Notification Management ==========
  async createNotification(data: {
    employee_id: string;
    preference_id: string;
    notification_type: 'approved' | 'denied' | 'waitlisted' | 'capacity_full';
    message: string;
    roster_date?: string;
  }): Promise<WeekOffNotification> {
    const id = randomUUID();

    await db.execute(
      `INSERT INTO weekoff_preference_notification
       (id, employee_id, preference_id, notification_type, message, roster_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.employee_id,
        data.preference_id,
        data.notification_type,
        data.message,
        data.roster_date || null,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM weekoff_preference_notification WHERE id = ?',
      [id]
    );

    return rows[0] as WeekOffNotification;
  }

  async getNotifications(employeeId: string, unreadOnly = false): Promise<WeekOffNotification[]> {
    let sql = 'SELECT * FROM weekoff_preference_notification WHERE employee_id = ?';
    const params: unknown[] = [employeeId];

    if (unreadOnly) {
      sql += ' AND is_read = 0';
    }

    sql += ' ORDER BY created_at DESC';

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows as WeekOffNotification[];
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await db.execute(
      'UPDATE weekoff_preference_notification SET is_read = 1 WHERE id = ?',
      [notificationId]
    );
  }

  // ========== Week-Off Preference Enhancement (FCFS) ==========
  async submitWeekOffPreference(data: {
    employee_id: string;
    process_id: string;
    preferred_day: number;
    alternate_day: number | null;
  }): Promise<{ preference_id: string; auto_approved: boolean; notification: string }> {
    const preferenceId = randomUUID();

    // Get current submission count for FCFS ordering
    const [submissionCount] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM week_off_preference
       WHERE employee_id IN (SELECT id FROM employees WHERE process_id = ?)`,
      [data.process_id]
    );
    const submissionOrder = ((submissionCount[0] as any).count || 0) + 1;

    // Check capacity and auto-approval
    const dayOfWeek = data.preferred_day;
    const [currentAllocs] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM weekoff_allocation_log
       WHERE process_id = ? AND day_of_week = ? AND allocation_status = 'allocated'`,
      [data.process_id, dayOfWeek]
    );
    const currentCount = (currentAllocs[0] as any).count;

    const shouldAutoApprove = await this.shouldAutoApprove(data.process_id, dayOfWeek, currentCount);

    // Insert preference
    await db.execute(
      `INSERT INTO week_off_preference
       (id, employee_id, preferred_day, alternate_day, approved, auto_approved, submission_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        preferenceId,
        data.employee_id,
        data.preferred_day,
        data.alternate_day,
        shouldAutoApprove ? 1 : 0,
        shouldAutoApprove ? 1 : 0,
        submissionOrder,
      ]
    );

    // Create notification
    const notificationMessage = shouldAutoApprove
      ? `Your week-off preference for ${this.getDayName(data.preferred_day)} has been auto-approved.`
      : `Your week-off preference for ${this.getDayName(data.preferred_day)} is pending manager approval (FCFS order: #${submissionOrder}).`;

    await this.createNotification({
      employee_id: data.employee_id,
      preference_id: preferenceId,
      notification_type: shouldAutoApprove ? 'approved' : 'waitlisted',
      message: notificationMessage,
    });

    return {
      preference_id: preferenceId,
      auto_approved: shouldAutoApprove,
      notification: notificationMessage,
    };
  }

  private getDayName(day: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day] || 'Unknown';
  }
}

export const rosterCapacityService = new RosterCapacityService();
