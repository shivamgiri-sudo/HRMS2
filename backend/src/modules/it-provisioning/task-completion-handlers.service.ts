/**
 * Task Completion Handlers
 *
 * Syncs master data when provisioning tasks are marked complete.
 * Uses EXISTING database tables — no duplicate table creation.
 *
 * Table mapping (verified 2026-07-16):
 *   IT task   → employees.official_email + auth_user + asset_master/asset_assignment
 *   Admin     → employee_biometric_enrollment + employee_documents (id_card)
 *   WFM       → employees.process_id + employee_roster_preference
 *   DPDP      → dpdp_consent_register (not candidate_dpdp_consent)
 */

import { randomUUID } from 'crypto';
import { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { activateIfJoiningDateReached } from '../employees/employee-activation.service.js';

export const OFFICIAL_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(teammas\.in|teammas\.co\.in)$/;

interface TaskRow {
  id: string;
  employee_id: string;
  employee_code: string;
  task_code: string;
  assigned_role: string;
  status: string;
}

async function getTask(taskId: string): Promise<TaskRow> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, employee_code, task_code, assigned_role, status
     FROM it_provisioning_request WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!(rows as any[]).length) {
    throw Object.assign(new Error('Provisioning task not found'), { statusCode: 404 });
  }
  return rows[0] as TaskRow;
}

async function triggerActivationCheck(employeeId: string, actorUserId: string): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const joiningDate = (rows[0] as any)?.date_of_joining;
  if (joiningDate) {
    await activateIfJoiningDateReached(employeeId, joiningDate, actorUserId).catch(err => {
      console.warn('[TaskCompletion] Activation check skipped:', err instanceof Error ? err.message : String(err));
    });
  }
}

// ── IT Email, Domain & Asset ───────────────────────────────────────────────────

export interface ItCompletionInput {
  official_email: string;
  domain_account: string;
  asset_tag?: string;
  asset_type?: string;
  evidence_note?: string;
}

export async function completeItProvisioningTask(
  taskId: string,
  input: ItCompletionInput,
  actorUserId: string
): Promise<void> {
  const officialEmail = input.official_email.trim().toLowerCase();
  const domainAccount = input.domain_account.trim();

  if (!officialEmail || !domainAccount) {
    throw Object.assign(
      new Error('official_email and domain_account are required for IT tasks'),
      { statusCode: 400 }
    );
  }
  if (!OFFICIAL_EMAIL_REGEX.test(officialEmail)) {
    throw Object.assign(
      new Error('official_email must end with @teammas.in or @teammas.co.in'),
      { statusCode: 400 }
    );
  }

  const task = await getTask(taskId);
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Update employees.official_email
    await conn.execute(
      `UPDATE employees SET official_email = ?, updated_at = NOW() WHERE id = ?`,
      [officialEmail, task.employee_id]
    );

    // 2. Get employee's current user_id
    const [empRows] = await conn.execute<RowDataPacket[]>(
      `SELECT user_id, first_name, last_name FROM employees WHERE id = ? LIMIT 1`,
      [task.employee_id]
    );
    const emp = empRows[0] as any;
    const existingUserId = emp?.user_id;

    if (existingUserId) {
      // Update existing auth_user email to official email
      await conn.execute(
        `UPDATE auth_user SET email = ?, updated_at = NOW() WHERE id = ?`,
        [officialEmail, existingUserId]
      );
    } else {
      // Create auth_user with official email — this is the employee's first login credential
      const bcrypt = await import('bcryptjs');
      const newAuthUserId = randomUUID();
      // Temp password: Mas@XXXXXX — employee must change on first login
      const tempPassword = `Mas@${Math.floor(100000 + Math.random() * 900000)}`;
      const passwordHash = await bcrypt.default.hash(tempPassword, 12);

      await conn.execute(
        `INSERT INTO auth_user (id, email, password_hash, must_change_password, created_at)
         VALUES (?, ?, ?, 1, NOW())`,
        [newAuthUserId, officialEmail, passwordHash]
      );

      await conn.execute(
        `UPDATE employees SET user_id = ?, updated_at = NOW() WHERE id = ?`,
        [newAuthUserId, task.employee_id]
      );

      // Store credential hint in employee_documents (doc_type = 'it_credentials')
      // This gives IT a record that credentials were issued without storing plaintext
      await conn.execute(
        `INSERT INTO employee_documents
           (id, employee_id, doc_type, doc_category, doc_name, file_url,
            uploaded_by, created_at, verified, verified_by, verification_date)
         VALUES (?, ?, 'it_credentials', 'other', ?, NULL, ?, NOW(), 1, ?, NOW())
         ON DUPLICATE KEY UPDATE uploaded_by = VALUES(uploaded_by), verification_date = NOW()`,
        [
          randomUUID(), task.employee_id,
          `IT credentials issued — official email: ${officialEmail}`,
          actorUserId, actorUserId,
        ]
      ).catch(() => {
        console.warn('[IT] Could not log credentials in employee_documents');
      });
    }

    // 3. Asset allocation using existing asset_master + asset_assignment tables
    if (input.asset_tag) {
      // Find or create asset in asset_master by asset_code (asset_tag)
      const [assetRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM asset_master WHERE asset_code = ? LIMIT 1`,
        [input.asset_tag]
      );
      let assetId: string;

      if ((assetRows as any[]).length > 0) {
        assetId = (assetRows[0] as any).id;
        // Update asset status to assigned
        await conn.execute(
          `UPDATE asset_master SET status = 'assigned', updated_at = NOW() WHERE id = ?`,
          [assetId]
        );
      } else {
        // Create new asset record
        assetId = randomUUID();
        await conn.execute(
          `INSERT INTO asset_master
             (id, asset_code, asset_name, asset_category, asset_type, status, created_at)
           VALUES (?, ?, ?, 'IT Equipment', ?, 'assigned', NOW())`,
          [assetId, input.asset_tag, `${input.asset_type ?? 'Laptop'} - ${input.asset_tag}`, input.asset_type ?? 'Laptop']
        );
      }

      // Create asset_assignment record (existing table)
      await conn.execute(
        `INSERT INTO asset_assignment
           (id, asset_id, employee_id, assigned_date, assigned_by, notes, created_at)
         VALUES (?, ?, ?, CURDATE(), ?, ?, NOW())`,
        [
          randomUUID(), assetId, task.employee_id, actorUserId,
          input.evidence_note ?? `Assigned during IT provisioning task ${taskId}`,
        ]
      );
    }

    // 4. Mark task actioned with structured fields
    await conn.execute(
      `UPDATE it_provisioning_request
       SET status = 'actioned', actioned_by = ?, actioned_at = NOW(),
           official_email = ?, domain_account = ?,
           asset_tag = COALESCE(?, asset_tag),
           updated_at = NOW()
       WHERE id = ?`,
      [actorUserId, officialEmail, domainAccount, input.asset_tag ?? null, taskId]
    );

    await conn.commit();

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: 'it_provisioning_email_set',
      module_key: 'it_provisioning',
      entity_type: 'employee',
      entity_id: task.employee_id,
      employee_id: task.employee_id,
      change_summary: {
        task_id: taskId,
        official_email: officialEmail,
        domain_account: domainAccount,
        auth_user_created: !existingUserId,
        asset_assigned: !!input.asset_tag,
      },
    });

    await triggerActivationCheck(task.employee_id, actorUserId);

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Admin Biometric & ID Card ──────────────────────────────────────────────────

export interface AdminCompletionInput {
  biometric_enrolled: boolean;
  biometric_device_id?: string;    // biometric_device_master.id
  cosec_user_id?: string;          // cosec system user ID
  id_card_printed: boolean;
  id_card_number?: string;
  evidence_note?: string;
}

export async function completeAdminProvisioningTask(
  taskId: string,
  input: AdminCompletionInput,
  actorUserId: string
): Promise<void> {
  const task = await getTask(taskId);
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Biometric enrollment — use existing employee_biometric_enrollment table
    if (input.biometric_enrolled) {
      const cosecUserId = input.cosec_user_id ?? task.employee_code;
      const [existingEnroll] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM employee_biometric_enrollment WHERE employee_id = ? LIMIT 1`,
        [task.employee_id]
      );

      if ((existingEnroll as any[]).length > 0) {
        await conn.execute(
          `UPDATE employee_biometric_enrollment
           SET cosec_user_id = ?, device_id = COALESCE(?, device_id),
               enrolled_by = ?, is_active = 1, last_sync_at = NOW()
           WHERE employee_id = ?`,
          [cosecUserId, input.biometric_device_id ?? null, actorUserId, task.employee_id]
        );
      } else {
        await conn.execute(
          `INSERT INTO employee_biometric_enrollment
             (id, employee_id, cosec_user_id, cosec_user_name, device_id, enrolled_by, enrolled_at, is_active)
           VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`,
          [
            randomUUID(), task.employee_id, cosecUserId,
            task.employee_code,
            input.biometric_device_id ?? null,
            actorUserId,
          ]
        );
      }
    }

    // 2. ID Card — store in employee_documents with doc_type = 'id_card'
    if (input.id_card_printed) {
      const [existingDoc] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM employee_documents WHERE employee_id = ? AND doc_type = 'id_card' LIMIT 1`,
        [task.employee_id]
      );

      if ((existingDoc as any[]).length > 0) {
        await conn.execute(
          `UPDATE employee_documents
           SET doc_name = ?, verified = 1, verified_by = ?,
               verification_date = NOW(), verification_remarks = ?
           WHERE employee_id = ? AND doc_type = 'id_card'`,
          [
            input.id_card_number ? `ID Card No: ${input.id_card_number}` : 'ID Card Issued',
            actorUserId,
            input.evidence_note ?? 'Issued by Admin team',
            task.employee_id,
          ]
        );
      } else {
        await conn.execute(
          `INSERT INTO employee_documents
             (id, employee_id, doc_type, doc_category, doc_name, file_url,
              uploaded_by, created_at, verified, verified_by, verification_date, verification_remarks)
           VALUES (?, ?, 'id_card', 'identity', ?, NULL, ?, NOW(), 1, ?, NOW(), ?)`,
          [
            randomUUID(), task.employee_id,
            input.id_card_number ? `ID Card No: ${input.id_card_number}` : 'Employee ID Card',
            actorUserId, actorUserId,
            input.evidence_note ?? 'Issued by Admin team during joining provisioning',
          ]
        );
      }
    }

    // 3. Mark task actioned
    await conn.execute(
      `UPDATE it_provisioning_request
       SET status = 'actioned', actioned_by = ?, actioned_at = NOW(),
           biometric_enrolled = ?, id_card_printed = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [actorUserId, input.biometric_enrolled ? 1 : 0, input.id_card_printed ? 1 : 0, taskId]
    );

    await conn.commit();

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: 'admin_provisioning_complete',
      module_key: 'it_provisioning',
      entity_type: 'employee',
      entity_id: task.employee_id,
      employee_id: task.employee_id,
      change_summary: {
        task_id: taskId,
        biometric_enrolled: input.biometric_enrolled,
        cosec_user_id: input.cosec_user_id ?? task.employee_code,
        id_card_printed: input.id_card_printed,
        id_card_number: input.id_card_number ?? null,
      },
    });

    await triggerActivationCheck(task.employee_id, actorUserId);

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── WFM Process Alignment ─────────────────────────────────────────────────────

export interface WfmCompletionInput {
  process_id: string;
  shift_id?: string;
  roster_effective_date: string;
  week_off_day?: string;  // 'Sunday' | 'Monday' etc — matches existing ENUM
  attendance_effective_date: string;
  biometric_mapping_ref?: string;
  evidence_note?: string;
}

export async function completeWfmAlignmentTask(
  taskId: string,
  input: WfmCompletionInput,
  actorUserId: string
): Promise<void> {
  if (!input.process_id) {
    throw Object.assign(new Error('process_id is required for WFM alignment'), { statusCode: 400 });
  }
  if (!input.roster_effective_date || !input.attendance_effective_date) {
    throw Object.assign(
      new Error('roster_effective_date and attendance_effective_date are required'),
      { statusCode: 400 }
    );
  }

  const task = await getTask(taskId);
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Update employee process_id
    await conn.execute(
      `UPDATE employees SET process_id = ?, updated_at = NOW() WHERE id = ?`,
      [input.process_id, task.employee_id]
    );

    // 2. Create/update employee_roster_preference (existing table)
    const [existingPref] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM employee_roster_preference WHERE employee_id = ? LIMIT 1`,
      [task.employee_id]
    );

    if ((existingPref as any[]).length > 0) {
      await conn.execute(
        `UPDATE employee_roster_preference
         SET preferred_shift_id = COALESCE(?, preferred_shift_id),
             preferred_week_off = COALESCE(?, preferred_week_off),
             effective_from = ?,
             status = 'approved',
             approved_by = ?,
             approved_at = NOW(),
             updated_at = NOW()
         WHERE employee_id = ?`,
        [
          input.shift_id ?? null,
          input.week_off_day ?? null,
          input.roster_effective_date,
          actorUserId,
          task.employee_id,
        ]
      );
    } else {
      await conn.execute(
        `INSERT INTO employee_roster_preference
           (id, employee_id, preferred_shift_id, preferred_week_off,
            flexibility, effective_from, status, approved_by, approved_at, created_by, created_at)
         VALUES (?, ?, ?, ?, 'fixed', ?, 'approved', ?, NOW(), ?, NOW())`,
        [
          randomUUID(), task.employee_id,
          input.shift_id ?? null,
          input.week_off_day ?? null,
          input.roster_effective_date,
          actorUserId, actorUserId,
        ]
      );
    }

    // 3. If biometric_mapping_ref provided, update cosec mapping
    if (input.biometric_mapping_ref) {
      await conn.execute(
        `UPDATE employee_biometric_enrollment
         SET cosec_user_id = ?, last_sync_at = NOW()
         WHERE employee_id = ?`,
        [input.biometric_mapping_ref, task.employee_id]
      ).catch(() => {
        // Non-blocking if no enrollment record yet
      });
    }

    // 4. Mark task actioned
    await conn.execute(
      `UPDATE it_provisioning_request
       SET status = 'actioned', actioned_by = ?, actioned_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [actorUserId, taskId]
    );

    await conn.commit();

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: 'wfm_alignment_complete',
      module_key: 'it_provisioning',
      entity_type: 'employee',
      entity_id: task.employee_id,
      employee_id: task.employee_id,
      change_summary: {
        task_id: taskId,
        process_id: input.process_id,
        shift_id: input.shift_id ?? null,
        roster_effective_date: input.roster_effective_date,
        attendance_effective_date: input.attendance_effective_date,
      },
    });

    await triggerActivationCheck(task.employee_id, actorUserId);

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Dispatcher: routes to correct handler by task_code ────────────────────────

export async function dispatchTaskCompletion(
  taskId: string,
  body: Record<string, unknown>,
  actorUserId: string
): Promise<void> {
  const task = await getTask(taskId);

  switch (task.task_code) {
    case 'IT_EMAIL_DOMAIN_ASSET':
      await completeItProvisioningTask(taskId, {
        official_email: String(body.official_email ?? ''),
        domain_account: String(body.domain_account ?? ''),
        asset_tag: body.asset_tag ? String(body.asset_tag) : undefined,
        asset_type: body.asset_type ? String(body.asset_type) : undefined,
        evidence_note: body.evidence_note ? String(body.evidence_note) : undefined,
      }, actorUserId);
      break;

    case 'ADMIN_BIOMETRIC_ID_CARD':
      await completeAdminProvisioningTask(taskId, {
        biometric_enrolled: Boolean(body.biometric_enrolled),
        biometric_device_id: body.biometric_device_id ? String(body.biometric_device_id) : undefined,
        cosec_user_id: body.cosec_user_id ? String(body.cosec_user_id) : undefined,
        id_card_printed: Boolean(body.id_card_printed),
        id_card_number: body.id_card_number ? String(body.id_card_number) : undefined,
        evidence_note: body.evidence_note ? String(body.evidence_note) : undefined,
      }, actorUserId);
      break;

    case 'WFM_PROCESS_ALIGNMENT':
      await completeWfmAlignmentTask(taskId, {
        process_id: String(body.process_id ?? ''),
        shift_id: body.shift_id ? String(body.shift_id) : undefined,
        roster_effective_date: String(body.roster_effective_date ?? ''),
        week_off_day: body.week_off_day ? String(body.week_off_day) : undefined,
        attendance_effective_date: String(body.attendance_effective_date ?? ''),
        biometric_mapping_ref: body.biometric_mapping_ref ? String(body.biometric_mapping_ref) : undefined,
        evidence_note: body.evidence_note ? String(body.evidence_note) : undefined,
      }, actorUserId);
      break;

    default:
      // APPOINTMENT_LETTER_ESIGN and any other task codes
      // Handled by existing actionProvisioningRequest — just mark actioned
      break;
  }
}
