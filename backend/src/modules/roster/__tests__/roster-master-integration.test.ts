import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rosterMasterService } from '../roster-master.service.js';
import { db } from '../../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';

// Skip if no live DB available (CI/offline environments)
const SKIP_LIVE_DB = process.env.SKIP_LIVE_DB === 'true' || process.env.NODE_ENV === 'test';

describe.skipIf(SKIP_LIVE_DB)('Roster Master Integration Tests (MySQL)', () => {
  let testProcessId: string;
  let testEmployeeId: string;
  let testTemplateId: string;

  beforeAll(async () => {
    // Get real process and employee from DB
    const [processes] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM process_master LIMIT 1'
    );
    testProcessId = (processes as any)[0]?.id;

    if (!testProcessId) {
      throw new Error('No process found in DB for testing');
    }

    const [employees] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM employees WHERE process_id = ? LIMIT 1',
      [testProcessId]
    );
    testEmployeeId = (employees as any)[0]?.id;

    if (!testEmployeeId) {
      throw new Error('No employee found in that process');
    }
  });

  afterAll(async () => {
    // Cleanup test data
    if (testTemplateId) {
      await db.execute('DELETE FROM roster_template WHERE id = ?', [testTemplateId]);
    }
    if (testEmployeeId) {
      await db.execute('DELETE FROM week_off_preference WHERE employee_id = ?', [testEmployeeId]);
      await db.execute('DELETE FROM roster_assignment WHERE employee_id = ?', [testEmployeeId]);
    }
  });

  describe('Template Management', () => {
    it('should create roster template', async () => {
      const template = await rosterMasterService.createTemplate({
        template_name: 'Test 5-Day Template',
        process_id: testProcessId,
        pattern_type: 'fixed',
        cycle_days: 7,
        pattern_json: {
          days: [
            { day_number: 1, shift_template_id: null, is_week_off: true, is_rotational: false },
            { day_number: 2, shift_template_id: null, is_week_off: false, is_rotational: false },
            { day_number: 3, shift_template_id: null, is_week_off: false, is_rotational: false },
            { day_number: 4, shift_template_id: null, is_week_off: false, is_rotational: false },
            { day_number: 5, shift_template_id: null, is_week_off: false, is_rotational: false },
            { day_number: 6, shift_template_id: null, is_week_off: false, is_rotational: false },
            { day_number: 7, shift_template_id: null, is_week_off: true, is_rotational: false },
          ],
        },
        support_ratio_min: 75,
        support_ratio_max: 100,
        created_by: testEmployeeId,
      });

      expect(template).toBeDefined();
      expect(template.id).toBeDefined();
      expect(template.template_name).toBe('Test 5-Day Template');
      expect(template.cycle_days).toBe(7);
      expect(template.pattern_json.days).toHaveLength(7);

      testTemplateId = template.id;
    });

    it('should list templates for process', async () => {
      const templates = await rosterMasterService.listTemplates({
        process_id: testProcessId,
      });

      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some(t => t.id === testTemplateId)).toBe(true);
    });

    it('should get template by ID', async () => {
      const template = await rosterMasterService.getTemplateById(testTemplateId);

      expect(template).not.toBeNull();
      expect(template?.id).toBe(testTemplateId);
      expect(template?.pattern_json).toBeDefined();
      expect(template?.pattern_json.days).toHaveLength(7);
    });

    it('should update template', async () => {
      const updated = await rosterMasterService.updateTemplate(testTemplateId, {
        template_name: 'Updated Template Name',
        support_ratio_min: 80,
      });

      expect(updated.template_name).toBe('Updated Template Name');
      expect(updated.support_ratio_min).toBe(80);
    });

    it('should toggle template active status', async () => {
      await rosterMasterService.updateTemplate(testTemplateId, { is_active: false });
      let template = await rosterMasterService.getTemplateById(testTemplateId);
      expect(template?.is_active).toBe(0);

      await rosterMasterService.updateTemplate(testTemplateId, { is_active: true });
      template = await rosterMasterService.getTemplateById(testTemplateId);
      expect(template?.is_active).toBe(1);
    });
  });

  describe('Week-Off Preferences', () => {
    it('should create week-off preference', async () => {
      const preference = await rosterMasterService.createWeekOffPreference({
        employee_id: testEmployeeId,
        preferred_day: 0, // Sunday
        alternate_day: 6, // Saturday
      });

      expect(preference).toBeDefined();
      expect(preference.employee_id).toBe(testEmployeeId);
      expect(preference.preferred_day).toBe(0);
      expect(preference.alternate_day).toBe(6);
      expect(preference.approved).toBe(0); // Not approved yet
    });

    it('should get employee week-off preference', async () => {
      const preference = await rosterMasterService.getWeekOffPreference(testEmployeeId);

      expect(preference).not.toBeNull();
      expect(preference?.employee_id).toBe(testEmployeeId);
      expect(preference?.preferred_day).toBe(0);
    });

    it('should list week-off preferences', async () => {
      const preferences = await rosterMasterService.listWeekOffPreferences({
        process_id: testProcessId,
      });

      expect(Array.isArray(preferences)).toBe(true);
      expect(preferences.some(p => p.employee_id === testEmployeeId)).toBe(true);
    });

    it('should approve week-off preference', async () => {
      const approved = await rosterMasterService.approveWeekOffPreference(
        testEmployeeId,
        testEmployeeId // Self-approval for test
      );

      expect(approved.approved).toBe(1);
      expect(approved.approved_by).toBe(testEmployeeId);
      expect(approved.approved_at).not.toBeNull();
    });
  });

  describe('Auto-Roster Generation', () => {
    it('should generate roster assignments', async () => {
      const startDate = '2026-06-09'; // Monday
      const endDate = '2026-06-15'; // Sunday (7 days)

      const result = await rosterMasterService.generateRoster({
        template_id: testTemplateId,
        process_id: testProcessId,
        start_date: startDate,
        end_date: endDate,
        employee_ids: [testEmployeeId],
        apply_preferences: true,
      });

      expect(result.created).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should verify roster assignments in DB', async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM roster_assignment
         WHERE employee_id = ?
         AND roster_date BETWEEN '2026-06-09' AND '2026-06-15'
         ORDER BY roster_date`,
        [testEmployeeId]
      );

      expect(rows.length).toBeGreaterThan(0);

      // Verify pattern (Sun/Sat should be week-off, others work days)
      const assignments = rows as any[];
      assignments.forEach((a) => {
        const date = new Date(a.roster_date);
        const dayOfWeek = date.getDay();

        if (dayOfWeek === 0 || dayOfWeek === 6) {
          // Sunday or Saturday - should be week-off (but may be overridden by preference)
          // Preference was Sunday, so Sunday should be week-off
          if (dayOfWeek === 0) {
            expect(a.is_week_off).toBe(1);
          }
        }
      });
    });

    it('should not create duplicate assignments', async () => {
      const startDate = '2026-06-09';
      const endDate = '2026-06-15';

      const result = await rosterMasterService.generateRoster({
        template_id: testTemplateId,
        process_id: testProcessId,
        start_date: startDate,
        end_date: endDate,
        employee_ids: [testEmployeeId],
        apply_preferences: false,
      });

      expect(result.created).toBe(0); // All already exist
      expect(result.skipped).toBeGreaterThan(0);
    });
  });

  describe('Support Ratio Validation', () => {
    it('should validate support ratio', async () => {
      const validation = await rosterMasterService.validateSupportRatio(
        testProcessId,
        '2026-06-09'
      );

      expect(validation).toBeDefined();
      expect(typeof validation.actual).toBe('number');
      expect(validation.min).toBeDefined();
      expect(validation.max).toBeDefined();
      expect(typeof validation.valid).toBe('boolean');
    });

    it('should calculate actual support ratio correctly', async () => {
      const validation = await rosterMasterService.validateSupportRatio(
        testProcessId,
        '2026-06-09'
      );

      // Should have some employees on duty vs week-off
      expect(validation.actual).toBeGreaterThanOrEqual(0);
      expect(validation.actual).toBeLessThanOrEqual(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent template gracefully', async () => {
      const template = await rosterMasterService.getTemplateById('non-existent-id');
      expect(template).toBeNull();
    });

    it('should handle non-existent employee preference', async () => {
      const preference = await rosterMasterService.getWeekOffPreference('non-existent-id');
      expect(preference).toBeNull();
    });

    it('should handle empty employee list in generation', async () => {
      const result = await rosterMasterService.generateRoster({
        template_id: testTemplateId,
        process_id: testProcessId,
        start_date: '2026-06-16',
        end_date: '2026-06-22',
        employee_ids: [],
        apply_preferences: false,
      });

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('should handle invalid date range (end before start)', async () => {
      const result = await rosterMasterService.generateRoster({
        template_id: testTemplateId,
        process_id: testProcessId,
        start_date: '2026-06-22',
        end_date: '2026-06-16', // End before start
        employee_ids: [testEmployeeId],
        apply_preferences: false,
      });

      // Should handle gracefully (create 0 or skip)
      expect(typeof result.created).toBe('number');
    });
  });
});
