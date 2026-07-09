import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';

interface CreateChecklistsResult {
  created: number;
  skipped: number;
  templateId: string;
}

interface EmployeeRow extends RowDataPacket {
  id: string;
  employee_code: string;
}

interface TemplateRow extends RowDataPacket {
  id: string;
}

interface SystemUserRow extends RowDataPacket {
  id: string;
}

/**
 * Create placeholder joining document checklists for all active employees
 * who have 0 checklist items. This marks them as "legacy employee" with
 * documents already verified offline, so the stat card doesn't show "pending documents".
 */
export async function createLegacyJoiningChecklists(): Promise<CreateChecklistsResult> {
  const result: CreateChecklistsResult = {
    created: 0,
    skipped: 0,
    templateId: '',
  };

  // Get or create "Legacy Employee" template
  const [existingTemplates] = await db.execute<TemplateRow[]>(
    'SELECT id FROM employee_joining_document_template WHERE template_name = ? LIMIT 1',
    ['Legacy Employee']
  );

  let templateId: string;
  if (existingTemplates.length > 0) {
    templateId = existingTemplates[0].id;
  } else {
    templateId = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO employee_joining_document_template
       (id, template_name, description, active_status, created_at, updated_at)
       VALUES (?, ?, ?, 1, NOW(), NOW())`,
      [
        templateId,
        'Legacy Employee',
        'Pre-HRMS employee — documents verified offline before system migration'
      ]
    );
  }

  result.templateId = templateId;

  // Get system user ID for verified_by field
  const [systemUsers] = await db.execute<SystemUserRow[]>(
    `SELECT au.id FROM auth_user au
     WHERE au.email = 'system@teammas.in' OR au.email LIKE '%system%'
     LIMIT 1`
  );
  const systemUserId = systemUsers[0]?.id ?? randomUUID(); // Fallback to random UUID if no system user

  // Find all active employees with 0 checklist items
  const [employees] = await db.execute<EmployeeRow[]>(
    `SELECT e.id, e.employee_code
     FROM employees e
     WHERE e.active_status = 1
       AND NOT EXISTS (
         SELECT 1 FROM employee_joining_document_checklist jc
         WHERE jc.employee_id = e.id
       )
     ORDER BY e.employee_code`
  );

  // Create one checklist item per employee
  for (const employee of employees) {
    try {
      const checklistId = randomUUID();
      await db.execute<ResultSetHeader>(
        `INSERT INTO employee_joining_document_checklist
         (id, employee_id, template_id, document_name, status,
          verification_type, is_required, verified_by, verified_at, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
        [
          checklistId,
          employee.id,
          templateId,
          'Legacy Employee Record',
          'verified',
          'manual',
          0, // not required
          systemUserId,
          'Pre-HRMS employee — documents verified offline before system migration'
        ]
      );
      result.created++;
    } catch (err: any) {
      console.error(`[createLegacyJoiningChecklists] Failed for ${employee.employee_code}:`, err.message);
      result.skipped++;
    }
  }

  return result;
}
