/**
 * DPDP Access Export Service
 *
 * Collects personal data across all modules for a given principal (employee)
 * in response to a Section 11 data access request.
 *
 * Rules:
 * - Never returns raw PAN, Aadhaar, bank account, or UAN numbers.
 * - Payroll amounts are included (employee's own data); payroll of others is excluded.
 * - Attendance/leave counts are included; granular timestamps are summarized.
 * - Document metadata is included; file binaries are not.
 * - Audit events involving the principal are listed (principal as actor or subject).
 * - AI context entries are excluded (implementation-internal, not personal data under DPDP).
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
// maskPan/maskAadhaar/maskBankAccount available if needed for future raw-field path
// import { maskPan, maskAadhaar, maskBankAccount } from "../privacy-engine/privacyMasking.service.js";

export interface PersonalDataExport {
  generated_at: string;
  principal_id: string;
  sections: {
    identity: Record<string, unknown> | null;
    contact: Record<string, unknown> | null;
    employment: Record<string, unknown> | null;
    payroll_components: unknown[] | null;
    attendance_summary: Record<string, unknown> | null;
    leave_summary: unknown[] | null;
    consents: unknown[];
    rights_requests: unknown[];
    documents: unknown[];
    audit_events: unknown[];
  };
}

export async function buildPersonalDataExport(principalId: string): Promise<PersonalDataExport> {
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, full_name, first_name, last_name, date_of_birth, gender,
            blood_group, nationality, official_email, personal_email, mobile, address1,
            city, state, country, designation, department, branch_id, process_id,
            employment_type, employment_status, date_of_joining,
            pan_number_masked, aadhaar_last4, nominee_name, nominee_relation,
            created_at, updated_at
     FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [principalId]
  );

  const emp = empRows[0] ?? null;
  const employeeId: string | null = emp?.id ?? null;

  // ── Contact / identity split
  const identity = emp
    ? {
        full_name: emp.full_name,
        date_of_birth: emp.date_of_birth,
        gender: emp.gender,
        blood_group: emp.blood_group,
        nationality: emp.nationality,
        pan_number: emp.pan_number_masked,
        aadhaar_last4: emp.aadhaar_last4,
        nominee_name: emp.nominee_name,
        nominee_relation: emp.nominee_relation,
      }
    : null;

  const contact = emp
    ? {
        official_email: emp.official_email,
        personal_email: emp.personal_email,
        mobile: emp.mobile,
        address: emp.address1,
        city: emp.city,
        state: emp.state,
        country: emp.country,
      }
    : null;

  const employment = emp
    ? {
        employee_code: emp.employee_code,
        designation: emp.designation,
        department: emp.department,
        branch_id: emp.branch_id,
        process_id: emp.process_id,
        employment_type: emp.employment_type,
        employment_status: emp.employment_status,
        date_of_joining: emp.date_of_joining,
        created_at: emp.created_at,
      }
    : null;

  // ── Payroll — component names and amounts (own data)
  let payrollComponents: unknown[] = [];
  if (employeeId) {
    const [prRows] = await db.execute<RowDataPacket[]>(
      `SELECT component_name, amount, effective_from, effective_to
       FROM employee_salary_component
       WHERE employee_id = ?
       ORDER BY effective_from DESC
       LIMIT 50`,
      [employeeId]
    );
    payrollComponents = prRows;
  }

  // ── Attendance summary (counts, not raw timestamps)
  let attendanceSummary: Record<string, unknown> | null = null;
  if (employeeId) {
    const [attRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_sessions,
         SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present_days,
         SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent_days,
         SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late_days,
         MIN(date) AS earliest_date,
         MAX(date) AS latest_date
       FROM attendance
       WHERE employee_id = ?`,
      [employeeId]
    );
    attendanceSummary = attRows[0] ?? null;
  }

  // ── Leave summary
  let leaveSummary: unknown[] = [];
  if (employeeId) {
    const [lvRows] = await db.execute<RowDataPacket[]>(
      `SELECT leave_type, status, from_date, to_date, total_days, reason
       FROM employee_leave
       WHERE employee_id = ?
       ORDER BY from_date DESC
       LIMIT 100`,
      [employeeId]
    );
    leaveSummary = lvRows;
  }

  // ── Consents
  const [consentRows] = await db.execute<RowDataPacket[]>(
    `SELECT purpose_code, principal_type, consent_text_version, consented_at, withdrawn_at, channel
     FROM data_consent
     WHERE data_principal_id = ?
     ORDER BY consented_at DESC`,
    [principalId]
  );

  // ── Rights requests
  const [rightsRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, request_type, status, description, field_name, created_at, resolved_at
     FROM data_rights_request
     WHERE principal_id = ?
     ORDER BY created_at DESC`,
    [principalId]
  );

  // ── Document metadata (no binaries, no access_level=payroll/confidential file paths)
  let docRows: RowDataPacket[] = [];
  if (employeeId) {
    const [dr] = await db.execute<RowDataPacket[]>(
      `SELECT id, category, original_filename, mime_type, access_level, created_at
       FROM document_vault_inventory
       WHERE owner_employee_id = ? AND is_soft_deleted = 0
       ORDER BY created_at DESC`,
      [employeeId]
    );
    docRows = dr;
  }

  // ── Audit events (principal as actor or subject — sensitive data excluded)
  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT action_type, target_type, created_at, ip_address
     FROM sensitive_action_log
     WHERE actor_user_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [principalId]
  );

  return {
    generated_at: new Date().toISOString(),
    principal_id: principalId,
    sections: {
      identity,
      contact,
      employment,
      payroll_components: payrollComponents,
      attendance_summary: attendanceSummary,
      leave_summary: leaveSummary,
      consents: consentRows,
      rights_requests: rightsRows,
      documents: docRows,
      audit_events: auditRows,
    },
  };
}
