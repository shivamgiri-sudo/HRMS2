import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Skip if no live DB — honour explicit SKIP_LIVE_DB=false override
const SKIP_LIVE_DB = process.env.SKIP_LIVE_DB === 'false'
  ? false
  : process.env.NODE_ENV === 'test';

import { db } from '../../../db/mysql.js';
import { templateService } from '../template.service.js';
import { dispatchService } from '../dispatch.service.js';
import { notificationPreferencesService } from '../notification-preferences.service.js';
import type { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';

describe.skipIf(SKIP_LIVE_DB)('Communication Module Integration Tests', () => {
  let testTemplateId: string;
  let testEmployeeId: string;

  beforeAll(async () => {
    // Create test employee for dispatch tests
    testEmployeeId = randomUUID();
    await db.execute(
      `INSERT INTO employees (id, first_name, last_name, email, mobile, employee_code, date_of_joining, branch_id, process_id, designation_id, department_id)
       VALUES (?, 'Test', 'Employee', 'test@example.com', '+919876543210', 'TEST001', '2024-01-01',
               (SELECT id FROM branch_master LIMIT 1),
               (SELECT id FROM process_master LIMIT 1),
               (SELECT id FROM designation_master LIMIT 1),
               (SELECT id FROM department_master LIMIT 1))`,
      [testEmployeeId]
    );
  });

  afterAll(async () => {
    // Cleanup
    if (testTemplateId) {
      await db.execute('DELETE FROM communication_template WHERE id = ?', [testTemplateId]);
    }
    if (testEmployeeId) {
      await db.execute('DELETE FROM dispatch_log WHERE recipient_employee_id = ?', [testEmployeeId]);
      await db.execute('DELETE FROM notification_preferences WHERE employee_id = ?', [testEmployeeId]);
      await db.execute('DELETE FROM employees WHERE id = ?', [testEmployeeId]);
    }
  });

  describe('Template Service', () => {
    it('should create template', async () => {
      const template = await templateService.createTemplate({
        name: 'Test Welcome Template',
        subject: 'Welcome {{employee.name}}!',
        body_html: '<p>Hello {{employee.name}}, welcome to MAS HRMS!</p>',
        body_text: 'Hello {{employee.name}}, welcome to MAS HRMS!',
        category: 'onboarding',
        channel: 'email',
        is_critical: false,
        created_by: testEmployeeId,
      });

      expect(template).toBeDefined();
      expect(template.id).toBeDefined();
      expect(template.name).toBe('Test Welcome Template');
      expect(template.category).toBe('onboarding');

      testTemplateId = template.id;
    });

    it('should list templates', async () => {
      const templates = await templateService.getTemplates({ category: 'onboarding' });

      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some(t => t.id === testTemplateId)).toBe(true);
    });

    it('should get template by ID', async () => {
      const template = await templateService.getTemplateById(testTemplateId);

      expect(template).toBeDefined();
      expect(template?.id).toBe(testTemplateId);
      expect(template?.name).toBe('Test Welcome Template');
    });

    it('should render template with variables', async () => {
      const rendered = await templateService.renderTemplate({
        template_id: testTemplateId,
        data: {
          employee: { name: 'John Doe', id: testEmployeeId },
        },
      });

      expect(rendered.html).toContain('John Doe');
      expect(rendered.html).toContain('welcome to MAS HRMS');
      expect(rendered.text).toContain('John Doe');
    });

    it('should update template', async () => {
      const updated = await templateService.updateTemplate(testTemplateId, {
        subject: 'Welcome Aboard {{employee.name}}!',
      });

      expect(updated.subject).toBe('Welcome Aboard {{employee.name}}!');
    });

    it('should toggle template active status', async () => {
      await templateService.updateTemplate(testTemplateId, { is_active: false });
      let template = await templateService.getTemplateById(testTemplateId);
      expect(template?.is_active).toBe(0);

      await templateService.updateTemplate(testTemplateId, { is_active: true });
      template = await templateService.getTemplateById(testTemplateId);
      expect(template?.is_active).toBe(1);
    });
  });

  describe('Notification Preferences', () => {
    it('should get default preference (email)', async () => {
      const channel = await notificationPreferencesService.getPreferredChannel(
        testEmployeeId,
        'onboarding'
      );

      expect(channel).toBe('email'); // Default
    });

    it('should update preference', async () => {
      await notificationPreferencesService.updatePreference(testEmployeeId, {
        category: 'onboarding',
        preferred_channel: 'sms',
        enabled: true,
      });

      const channel = await notificationPreferencesService.getPreferredChannel(
        testEmployeeId,
        'onboarding'
      );

      expect(channel).toBe('sms');
    });

    it('should get all preferences for employee', async () => {
      const prefs = await notificationPreferencesService.getPreferences(testEmployeeId);

      expect(Array.isArray(prefs)).toBe(true);
      expect(prefs.some(p => p.category === 'onboarding' && p.preferred_channel === 'sms')).toBe(true);
    });
  });

  describe('Dispatch Service', () => {
    it('should queue message for dispatch', async () => {
      const result = await dispatchService.send({
        template_id: testTemplateId,
        recipient_employee_ids: [testEmployeeId],
        data: {
          employee: { name: 'Test Employee', id: testEmployeeId },
        },
        channel: 'email',
        is_critical: false,
      });

      expect(result.queued).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.dispatch_ids.length).toBe(1);
    });

    it('should log dispatch in dispatch_log table', async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        'SELECT * FROM dispatch_log WHERE recipient_employee_id = ? ORDER BY created_at DESC LIMIT 1',
        [testEmployeeId]
      );

      expect(rows.length).toBeGreaterThan(0);
      const log = rows[0] as any;
      expect(log.template_id).toBe(testTemplateId);
      expect(log.recipient_employee_id).toBe(testEmployeeId);
      expect(log.channel).toBe('email');
      expect(log.status).toBeDefined(); // queued or sent
    });

    it('should get dispatch logs', async () => {
      const result = await dispatchService.getLogs({
        employee_id: testEmployeeId,
        page: 1,
        limit: 10,
      });

      expect(result.logs).toBeDefined();
      expect(Array.isArray(result.logs)).toBe(true);
      expect(result.logs.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
    });

    it('should get dispatch stats', async () => {
      const stats = await dispatchService.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.total_sent_today).toBe('number');
      expect(typeof stats.delivery_rate).toBe('number');
      expect(stats.by_channel).toBeDefined();
      expect(typeof stats.by_channel.email).toBe('number');
    });
  });

  describe('End-to-End Flow', () => {
    it('should complete full workflow: create template → set preference → send message → verify log', async () => {
      // 1. Create template
      const template = await templateService.createTemplate({
        name: 'E2E Test Template',
        subject: 'Test {{type}}',
        body_html: '<p>E2E test for {{employee.name}}</p>',
        category: 'alerts',
        channel: 'multi',
        created_by: testEmployeeId,
      });

      // 2. Set preference to WhatsApp
      await notificationPreferencesService.updatePreference(testEmployeeId, {
        category: 'alerts',
        preferred_channel: 'whatsapp',
        enabled: true,
      });

      // 3. Send message
      const result = await dispatchService.send({
        template_id: template.id,
        recipient_employee_ids: [testEmployeeId],
        data: {
          type: 'Alert',
          employee: { name: 'Test User', id: testEmployeeId },
        },
      });

      expect(result.queued).toBe(1);

      // 4. Verify log
      const logs = await dispatchService.getLogs({
        employee_id: testEmployeeId,
        page: 1,
        limit: 5,
      });

      const latestLog = logs.logs.find(l => l.template_id === template.id);
      expect(latestLog).toBeDefined();
      expect(latestLog?.channel).toBe('whatsapp'); // Should use preference
      expect(latestLog?.template_name).toBe('E2E Test Template');

      // Cleanup
      await db.execute('DELETE FROM communication_template WHERE id = ?', [template.id]);
    });
  });
});
