import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { rosterCapacityService } from './roster-capacity.service.js';

// ========== Types ==========
export interface RosterTemplate {
  id: string;
  template_name: string;
  process_id: string;
  pattern_type: 'fixed' | 'rotation' | 'custom';
  cycle_days: number; // 7 for weekly, 14 for bi-weekly, etc.
  pattern_json: RosterPattern;
  support_ratio_min: number | null;
  support_ratio_max: number | null;
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RosterPattern {
  days: {
    day_number: number; // 1-7 for weekly, 1-14 for bi-weekly
    shift_template_id: string | null;
    is_week_off: boolean;
    is_rotational: boolean;
  }[];
  rotation_groups?: {
    group_name: string;
    employee_ids: string[];
    rotation_sequence: number[];
  }[];
}

export interface WeekOffPreference {
  id: string;
  employee_id: string;
  preferred_day: number; // 0=Sunday, 1=Monday, ... 6=Saturday
  alternate_day: number | null;
  approved: number;
  approved_by: string | null;
  approved_at: string | null;
  submission_order: number | null;
  auto_approved: number;
  created_at: string;
}

export interface RosterAssignmentBatch {
  template_id: string;
  process_id: string;
  start_date: string;
  end_date: string;
  employee_ids: string[];
  apply_preferences: boolean;
}

// ========== Service ==========
class RosterMasterService {
  // ========== Template CRUD ==========
  async createTemplate(data: {
    template_name: string;
    process_id: string;
    pattern_type: 'fixed' | 'rotation' | 'custom';
    cycle_days: number;
    pattern_json: RosterPattern;
    support_ratio_min?: number;
    support_ratio_max?: number;
    created_by: string;
  }): Promise<RosterTemplate> {
    const id = randomUUID();

    await db.execute(
      `INSERT INTO roster_template
       (id, template_name, process_id, pattern_type, cycle_days, pattern_json,
        support_ratio_min, support_ratio_max, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        data.template_name,
        data.process_id,
        data.pattern_type,
        data.cycle_days,
        JSON.stringify(data.pattern_json),
        data.support_ratio_min ?? null,
        data.support_ratio_max ?? null,
        data.created_by,
      ]
    );

    const template = await this.getTemplateById(id);
    if (!template) throw new Error('Template creation failed');
    return template;
  }

  async listTemplates(filters?: { process_id?: string; is_active?: boolean }): Promise<RosterTemplate[]> {
    let sql = 'SELECT * FROM roster_template WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.process_id) {
      sql += ' AND process_id = ?';
      params.push(filters.process_id);
    }

    if (filters?.is_active !== undefined) {
      sql += ' AND is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC';

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return (rows as any[]).map(this.parseTemplate);
  }

  async getTemplateById(id: string): Promise<RosterTemplate | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM roster_template WHERE id = ?',
      [id]
    );

    if (rows.length === 0) return null;
    return this.parseTemplate(rows[0]);
  }

  async updateTemplate(
    id: string,
    data: {
      template_name?: string;
      pattern_json?: RosterPattern;
      support_ratio_min?: number;
      support_ratio_max?: number;
      is_active?: boolean;
    }
  ): Promise<RosterTemplate> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.template_name) {
      updates.push('template_name = ?');
      params.push(data.template_name);
    }

    if (data.pattern_json) {
      updates.push('pattern_json = ?');
      params.push(JSON.stringify(data.pattern_json));
    }

    if (data.support_ratio_min !== undefined) {
      updates.push('support_ratio_min = ?');
      params.push(data.support_ratio_min);
    }

    if (data.support_ratio_max !== undefined) {
      updates.push('support_ratio_max = ?');
      params.push(data.support_ratio_max);
    }

    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(data.is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    params.push(id);

    await db.execute(
      `UPDATE roster_template SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    const template = await this.getTemplateById(id);
    if (!template) throw new Error('Template not found');
    return template;
  }

  async deleteTemplate(id: string): Promise<void> {
    await db.execute('DELETE FROM roster_template WHERE id = ?', [id]);
  }

  // ========== Week-Off Preferences ==========
  async createWeekOffPreference(data: {
    employee_id: string;
    preferred_day: number;
    alternate_day?: number;
  }): Promise<WeekOffPreference> {
    const id = randomUUID();

    await db.execute(
      `INSERT INTO week_off_preference
       (id, employee_id, preferred_day, alternate_day, approved)
       VALUES (?, ?, ?, ?, 0)`,
      [id, data.employee_id, data.preferred_day, data.alternate_day ?? null]
    );

    const pref = await this.getWeekOffPreference(data.employee_id);
    if (!pref) throw new Error('Preference creation failed');
    return pref;
  }

  async getWeekOffPreference(employee_id: string): Promise<WeekOffPreference | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM week_off_preference WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1',
      [employee_id]
    );

    if (rows.length === 0) return null;
    return rows[0] as WeekOffPreference;
  }

  async listWeekOffPreferences(filters?: {
    approved?: boolean;
    process_id?: string;
  }): Promise<WeekOffPreference[]> {
    let sql = 'SELECT wp.* FROM week_off_preference wp';
    const params: unknown[] = [];

    if (filters?.process_id) {
      sql += ' JOIN employees e ON wp.employee_id = e.id WHERE e.process_id = ?';
      params.push(filters.process_id);
    } else {
      sql += ' WHERE 1=1';
    }

    if (filters?.approved !== undefined) {
      sql += ' AND wp.approved = ?';
      params.push(filters.approved ? 1 : 0);
    }

    sql += ' ORDER BY wp.created_at DESC';

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows as WeekOffPreference[];
  }

  async approveWeekOffPreference(
    employee_id: string,
    approved_by: string
  ): Promise<WeekOffPreference> {
    await db.execute(
      `UPDATE week_off_preference
       SET approved = 1, approved_by = ?, approved_at = NOW()
       WHERE employee_id = ?`,
      [approved_by, employee_id]
    );

    const pref = await this.getWeekOffPreference(employee_id);
    if (!pref) throw new Error('Preference not found');
    return pref;
  }

  // ========== Auto-Roster Generation ==========
  async generateRoster(batch: RosterAssignmentBatch): Promise<{
    created: number;
    skipped: number;
    errors: string[];
  }> {
    const template = await this.getTemplateById(batch.template_id);
    if (!template) throw new Error('Template not found');

    const start = new Date(batch.start_date);
    const end = new Date(batch.end_date);
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Get week-off preferences if requested
    const preferences = batch.apply_preferences
      ? await this.listWeekOffPreferences({ process_id: batch.process_id })
      : [];

    const prefMap = new Map<string, WeekOffPreference>();
    preferences.forEach((p) => prefMap.set(p.employee_id, p));

    for (const employee_id of batch.employee_ids) {
      try {
        const preference = prefMap.get(employee_id);

        for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
          const currentDate = new Date(start);
          currentDate.setDate(start.getDate() + dayOffset);

          const dateStr = currentDate.toISOString().slice(0, 10);
          const dayOfWeek = currentDate.getDay(); // 0=Sunday, 6=Saturday
          const cycleDay = (dayOffset % template.cycle_days) + 1;

          const patternDay = template.pattern_json.days.find((d) => d.day_number === cycleDay);
          if (!patternDay) continue;

          let is_week_off = patternDay.is_week_off;
          let shift_template_id = patternDay.shift_template_id;

          // Apply preference if exists and approved
          if (preference?.approved && preference.preferred_day === dayOfWeek) {
            is_week_off = true;
            shift_template_id = null;
          }

          // Check capacity if trying to assign week-off
          if (is_week_off) {
            const capacityCheck = await rosterCapacityService.checkCapacity(
              batch.process_id,
              dateStr,
              dayOfWeek
            );

            if (!capacityCheck.can_allocate) {
              // Capacity full - try alternate day if preference exists
              if (preference?.alternate_day !== null && preference?.alternate_day !== undefined) {
                const alternateDayOfWeek = preference.alternate_day;
                if (alternateDayOfWeek === dayOfWeek) {
                  // Alternate same as preferred, assign work day
                  is_week_off = false;
                  shift_template_id = patternDay.shift_template_id;

                  // Notify employee preference not fulfilled
                  await rosterCapacityService.createNotification({
                    employee_id,
                    preference_id: preference.id,
                    notification_type: 'capacity_full',
                    message: `Week-off preference for ${dateStr} could not be fulfilled due to capacity limits. Assigned work day instead.`,
                    roster_date: dateStr,
                  });
                }
                // Else check alternate day capacity in future enhancement
              } else {
                // No alternate, assign work day
                is_week_off = false;
                shift_template_id = patternDay.shift_template_id;

                // Notify if preference was requested
                if (preference?.approved) {
                  await rosterCapacityService.createNotification({
                    employee_id,
                    preference_id: preference.id,
                    notification_type: 'capacity_full',
                    message: `Week-off preference for ${dateStr} could not be fulfilled due to capacity limits.`,
                    roster_date: dateStr,
                  });
                }
              }
            } else if (preference?.approved) {
              // Capacity available, allocate in capacity log
              await rosterCapacityService.allocateWeekOff({
                process_id: batch.process_id,
                day_of_week: dayOfWeek,
                allocation_date: dateStr,
                employee_id,
                preference_id: preference.id,
                auto_approved: preference.auto_approved === 1,
              });
            }
          }

          // Check if assignment already exists
          const [existing] = await db.execute<RowDataPacket[]>(
            `SELECT id FROM roster_assignment
             WHERE employee_id = ? AND roster_date = ?`,
            [employee_id, dateStr]
          );

          if (existing.length > 0) {
            skipped++;
            continue;
          }

          // Create assignment
          const assignmentId = randomUUID();
          await db.execute(
            `INSERT INTO roster_assignment
             (id, employee_id, roster_date, shift_template_id, is_week_off,
              acknowledgement_status, created_at)
             VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
            [assignmentId, employee_id, dateStr, shift_template_id, is_week_off ? 1 : 0]
          );

          created++;
        }
      } catch (error: any) {
        errors.push(`Employee ${employee_id}: ${error.message}`);
      }
    }

    return { created, skipped, errors };
  }

  // ========== Validation ==========
  async validateSupportRatio(
    process_id: string,
    date: string
  ): Promise<{ actual: number; min: number | null; max: number | null; valid: boolean }> {
    // Get active template for process
    const [templates] = await db.execute<RowDataPacket[]>(
      'SELECT support_ratio_min, support_ratio_max FROM roster_template WHERE process_id = ? AND is_active = 1 LIMIT 1',
      [process_id]
    );

    if (templates.length === 0) {
      return { actual: 0, min: null, max: null, valid: true };
    }

    const template = templates[0] as any;

    // Count employees on duty vs week-off
    const [counts] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN is_week_off = 0 THEN 1 ELSE 0 END) AS on_duty,
         SUM(CASE WHEN is_week_off = 1 THEN 1 ELSE 0 END) AS week_off
       FROM roster_assignment ra
       JOIN employees e ON ra.employee_id = e.id
       WHERE e.process_id = ? AND ra.roster_date = ?`,
      [process_id, date]
    );

    const row = (counts as any)[0];
    const onDuty = Number(row?.on_duty ?? 0);
    const weekOff = Number(row?.week_off ?? 0);
    const total = onDuty + weekOff;

    const actual = total > 0 ? (onDuty / total) * 100 : 0;

    const min = template.support_ratio_min;
    const max = template.support_ratio_max;

    let valid = true;
    if (min !== null && actual < min) valid = false;
    if (max !== null && actual > max) valid = false;

    return { actual, min, max, valid };
  }

  // ========== Helpers ==========
  private parseTemplate(row: any): RosterTemplate {
    return {
      ...row,
      pattern_json: typeof row.pattern_json === 'string'
        ? JSON.parse(row.pattern_json)
        : row.pattern_json,
    };
  }
}

export const rosterMasterService = new RosterMasterService();
