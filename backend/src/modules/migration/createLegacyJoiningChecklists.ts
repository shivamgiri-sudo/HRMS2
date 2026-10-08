import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';
import { recalculateDocumentProgress } from '../employees/employeeJoiningDocuments.service.js';

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
  // template_name is not a column either, so this lookup threw before the insert
  // below was ever reached. document_code is the stable key and is what the
  // insert now supplies.
  const [existingTemplates] = await db.execute<TemplateRow[]>(
    'SELECT id FROM employee_joining_document_template WHERE document_code = ? LIMIT 1',
    ['LEGACY_EMPLOYEE']
  );

  let templateId: string;
  if (existingTemplates.length > 0) {
    templateId = existingTemplates[0].id;
  } else {
    templateId = randomUUID();
    await db.execute<ResultSetHeader>(
      // The columns are document_name and document_code, not template_name, and
      // there is no description column. document_code and document_category are
      // both NOT NULL with no default and were never supplied, so this INSERT
      // could not have succeeded even with the right names.
      `INSERT INTO employee_joining_document_template
       (id, document_code, document_name, document_category, active_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NOW(), NOW())`,
      [
        templateId,
        'LEGACY_EMPLOYEE',
        'Legacy Employee',
        'legacy'
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
        // verification_type, is_required and notes do not exist here. The real
        // columns are verification_status, mandatory and hr_remarks. document_code,
        // owner_type and action_type are NOT NULL with no default and were all
        // missing, so this INSERT failed on both counts - which the per-employee
        // catch below recorded only as a skip.
        `INSERT INTO employee_joining_document_checklist
         (id, employee_id, template_id, document_code, document_name, status,
          owner_type, action_type, mandatory, verified_by, verified_at,
          verification_status, hr_remarks, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'system', 'verify', ?, ?, NOW(), ?, ?, NOW(), NOW())`,
        [
          checklistId,
          employee.id,
          templateId,
          'LEGACY_EMPLOYEE',
          'Legacy Employee Record',
          'verified',
          0, // mandatory: a legacy record is not a live requirement
          systemUserId,
          'verified',
          'Pre-HRMS employee — documents verified offline before system migration'
        ]
      );
      result.created++;
      // The insert above never updated employees.joining_document_status /
      // joining_document_completion_pct, so it stayed NULL for every legacy
      // employee forever — recalculateDocumentProgress is the established
      // single writer for those columns (employeeJoiningDocuments.service.ts).
      // Keeps the underlying data internally consistent even though the
      // joining-documents tracker now excludes legacy_emp_id IS NOT NULL rows
      // outright rather than trying to display this as a status.
      await recalculateDocumentProgress(employee.id);
    } catch (err: any) {
      console.error(`[createLegacyJoiningChecklists] Failed for ${employee.employee_code}:`, err.message);
      result.skipped++;
    }
  }

  return result;
}
