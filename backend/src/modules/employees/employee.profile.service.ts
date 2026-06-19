import { randomUUID } from "crypto";
import type { Request } from "express";
import type { RowDataPacket } from "mysql2";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type {
  BankDetailsInput,
  EmergencyContactInput,
  NomineeInput,
  SelfProfileUpdateInput,
  StatutoryDetailsInput,
} from "./employee.profile.validation.js";
import { isOfficialEmail } from "../../shared/officialEmail.js";

function notFound(message = "No employee record for this user"): Error {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function maskLastFour(last4: string | null | undefined, groups = 2): string | null {
  if (!last4) return null;
  return `${"•••• ".repeat(groups)}${last4.slice(-4)}`.trim();
}

async function employeeIdForUser(userId: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId],
  );
  const employeeId = String(rows[0]?.id ?? "");
  if (!employeeId) throw notFound();
  return employeeId;
}

async function auditProfileChange(
  userId: string,
  employeeId: string,
  action: string,
  fields: string[],
  req?: Request,
): Promise<void> {
  await logSensitiveAction({
    actor_user_id: userId,
    action_type: action,
    module_key: "EMPLOYEE_PROFILE",
    entity_type: "employee",
    entity_id: employeeId,
    change_summary: { fields },
    req,
  });
}

export const employeeProfileService = {
  async getMyProfile(userId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id, e.employee_code, e.user_id,
         COALESCE(NULLIF(e.first_name, ''), NULLIF(e.full_name, ''), '') AS first_name,
         COALESCE(e.last_name, '') AS last_name,
         e.full_name,
         COALESCE(NULLIF(TRIM(e.official_email), ''), e.email) AS email,
         e.personal_email, e.personal_phone,
         e.mobile, e.alternate_mobile, e.avatar_url, e.gender,
         DATE_FORMAT(e.date_of_birth, '%Y-%m-%d') AS date_of_birth,
         DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS date_of_joining,
         e.employment_status, e.employment_type,
         e.branch_id, e.department_id, e.process_id, e.designation_id,
         e.reporting_manager_id, e.address1, e.address2, e.city, e.state,
         e.country, e.pincode, e.marital_status, e.blood_group,
         e.working_hours_start, e.working_hours_end, e.working_days,
         e.pan_verified_on, e.aadhaar_last4, e.aadhaar_verified_on,
         RIGHT(e.pan_number, 4) AS pan_last4,
         RIGHT(COALESCE(eu.member_id, e.epf_number), 4) AS pf_last4,
         RIGHT(COALESCE(eu.uan, e.uan_number), 4) AS uan_last4,
         eu.verification_status AS statutory_verification_status,
         COALESCE(NULLIF(m.full_name, ''), CONCAT(m.first_name, ' ', COALESCE(m.last_name, '')), '') AS reporting_manager_name,
         dept.dept_name AS department_name,
         desig.designation_name AS designation,
         br.branch_name,
         proc.process_name,
         ec.name AS emergency_name,
         ec.relationship AS emergency_relationship,
         ec.mobile AS emergency_mobile,
         ec.address AS emergency_address,
         nom.nominee_name,
         nom.relationship AS nominee_relationship,
         nom.date_of_birth AS nominee_date_of_birth,
         nom.mobile AS nominee_mobile,
         nom.address AS nominee_address,
         COALESCE(ebd.bank_name, e.bank_name) AS bank_name,
         COALESCE(ebd.account_holder_name, e.account_holder_name) AS account_holder_name,
         COALESCE(ebd.bank_branch, e.bank_branch) AS bank_branch,
         COALESCE(ebd.ifsc_code, e.ifsc_code) AS ifsc_code,
         ebd.account_type,
         ebd.verified AS bank_verified,
         COALESCE(
           RIGHT(CAST(AES_DECRYPT(ebd.account_number, ?) AS CHAR), 4),
           RIGHT(CAST(ebd.account_number AS CHAR), 4),
           RIGHT(e.bank_account_number, 4)
         ) AS bank_last4
       FROM employees e
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN designation_master desig ON desig.id = e.designation_id
       LEFT JOIN branch_master br ON br.id = e.branch_id
       LEFT JOIN process_master proc ON proc.id = e.process_id
       LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
       LEFT JOIN employee_emergency_contact ec
         ON ec.employee_id = e.id AND ec.contact_seq = 1
       LEFT JOIN employee_nominee nom
         ON nom.id = (
           SELECT n2.id FROM employee_nominee n2
           WHERE n2.employee_id = e.id
           ORDER BY n2.created_at ASC LIMIT 1
         )
       LEFT JOIN employee_bank_detail ebd
         ON ebd.employee_id = e.id AND ebd.is_primary = 1 AND ebd.active_status = 1
       WHERE e.user_id = ? AND e.active_status = 1
       LIMIT 1`,
      [env.PAYROLL_BANK_KEY, userId],
    );

    const row = rows[0] as Record<string, any> | undefined;
    if (!row) throw notFound();

    let workingDays: number[] | null = null;
    if (row.working_days) {
      try {
        workingDays = typeof row.working_days === "string"
          ? JSON.parse(row.working_days)
          : row.working_days;
      } catch {
        workingDays = null;
      }
    }

    const bankProvided = Boolean(row.bank_last4 || row.bank_name || row.ifsc_code);
    const statutoryProvided = Boolean(
      row.pan_last4 || row.aadhaar_last4 || row.pf_last4 || row.uan_last4,
    );

    return {
      id: row.id,
      employee_code: row.employee_code,
      user_id: row.user_id,
      first_name: row.first_name,
      last_name: row.last_name,
      full_name: row.full_name || `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
      email: row.email,
      official_email_compliant: isOfficialEmail(row.email),
      phone: row.mobile,
      personal_email: row.personal_email ?? null,
      personal_phone: row.personal_phone ?? null,
      alternate_mobile: row.alternate_mobile,
      avatar_url: row.avatar_url,
      gender: row.gender ? String(row.gender).toLowerCase() : null,
      date_of_birth: row.date_of_birth,
      hire_date: row.date_of_joining,
      status: row.employment_status?.toLowerCase() ?? null,
      employment_type: row.employment_type,
      branch_id: row.branch_id,
      department_id: row.department_id,
      process_id: row.process_id,
      designation_id: row.designation_id,
      designation: row.designation,
      department_name: row.department_name,
      department: row.department_name ? { name: row.department_name } : null,
      branch_name: row.branch_name,
      process_name: row.process_name,
      reporting_manager_id: row.reporting_manager_id,
      reporting_manager_name: row.reporting_manager_name,
      reporting_manager: row.reporting_manager_name,
      address: row.address1,
      address2: row.address2,
      city: row.city,
      state: row.state,
      country: row.country,
      pincode: row.pincode,
      marital_status: row.marital_status,
      blood_group: row.blood_group,
      working_hours_start: row.working_hours_start,
      working_hours_end: row.working_hours_end,
      working_days: workingDays,
      emergency_contact: row.emergency_name ? {
        name: row.emergency_name,
        relationship: row.emergency_relationship,
        mobile: row.emergency_mobile,
        address: row.emergency_address,
      } : null,
      nominee: row.nominee_name ? {
        nominee_name: row.nominee_name,
        relationship: row.nominee_relationship,
        date_of_birth: row.nominee_date_of_birth,
        mobile: row.nominee_mobile,
        address: row.nominee_address,
      } : null,
      bank_details: bankProvided ? {
        bank_name: row.bank_name,
        account_holder_name: row.account_holder_name,
        bank_branch: row.bank_branch,
        ifsc_code: row.ifsc_code,
        account_type: row.account_type,
        masked_account_number: maskLastFour(row.bank_last4),
        verification_status: row.bank_verified ? "verified" : "pending",
      } : null,
      statutory_details: statutoryProvided ? {
        masked_pan_number: maskLastFour(row.pan_last4, 1),
        masked_aadhaar_number: row.aadhaar_last4
          ? `•••• •••• ${row.aadhaar_last4}`
          : null,
        masked_pf_number: maskLastFour(row.pf_last4),
        masked_uan: maskLastFour(row.uan_last4),
        pan_verification_status: row.pan_last4
          ? (row.pan_verified_on ? "verified" : "pending")
          : "not_provided",
        aadhaar_verification_status: row.aadhaar_last4
          ? (row.aadhaar_verified_on ? "verified" : "pending")
          : "not_provided",
        pf_uan_verification_status: row.statutory_verification_status
          ?? "pending",
      } : null,
    };
  },

  async updateMyProfile(
    userId: string,
    input: SelfProfileUpdateInput,
    req?: Request,
  ) {
    const employeeId = await employeeIdForUser(userId);
    const mapping: Record<keyof SelfProfileUpdateInput, string> = {
      email: "email",
      phone: "mobile",
      personal_email: "personal_email",
      personal_phone: "personal_phone",
      alternate_mobile: "alternate_mobile",
      address: "address1",
      address2: "address2",
      city: "city",
      state: "state",
      country: "country",
      pincode: "pincode",
      date_of_birth: "date_of_birth",
      gender: "gender",
      marital_status: "marital_status",
      blood_group: "blood_group",
      working_hours_start: "working_hours_start",
      working_hours_end: "working_hours_end",
      working_days: "working_days",
    };

    const entries = Object.entries(input) as Array<
      [keyof SelfProfileUpdateInput, SelfProfileUpdateInput[keyof SelfProfileUpdateInput]]
    >;
    if (!entries.length) throw badRequest("No editable fields provided");

    const values = entries.map(([key, value]) => {
      if (key === "working_days") return JSON.stringify(value);
      if (key === "gender" && typeof value === "string") {
        return value.charAt(0).toUpperCase() + value.slice(1);
      }
      return value;
    });
    const sets = entries.map(([key]) => `${mapping[key]} = ?`).join(", ");
    const officialEmailSet = input.email !== undefined ? ", official_email = ?" : "";
    const officialEmailValues = input.email !== undefined ? [input.email] : [];

    await db.execute(
      `UPDATE employees SET ${sets}${officialEmailSet}, updated_at = NOW() WHERE id = ?`,
      [...values, ...officialEmailValues, employeeId],
    );
    await auditProfileChange(
      userId,
      employeeId,
      "SELF_PROFILE_UPDATED",
      entries.map(([key]) => String(key)),
      req,
    );
    return this.getMyProfile(userId);
  },

  async saveEmergencyContact(
    userId: string,
    input: EmergencyContactInput,
    req?: Request,
  ) {
    const employeeId = await employeeIdForUser(userId);
    await db.execute(
      `INSERT INTO employee_emergency_contact
         (id, employee_id, contact_seq, is_primary, name, relationship, mobile, address)
       VALUES (UUID(), ?, 1, 1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         relationship = VALUES(relationship),
         mobile = VALUES(mobile),
         address = VALUES(address)`,
      [employeeId, input.name, input.relationship, input.mobile, input.address ?? null],
    );
    await auditProfileChange(userId, employeeId, "EMERGENCY_CONTACT_UPDATED", ["name", "relationship", "mobile", "address"], req);
    return this.getMyProfile(userId);
  },

  async saveNominee(
    userId: string,
    input: NomineeInput,
    req?: Request,
  ) {
    const employeeId = await employeeIdForUser(userId);
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employee_nominee WHERE employee_id = ? ORDER BY created_at ASC LIMIT 1`,
      [employeeId],
    );
    const existingId = (existing[0] as any)?.id as string | undefined;
    if (existingId) {
      await db.execute(
        `UPDATE employee_nominee
         SET nominee_name = ?, relationship = ?, date_of_birth = ?, mobile = ?, address = ?, updated_at = NOW()
         WHERE id = ?`,
        [input.nominee_name, input.relationship, input.date_of_birth ?? null, input.mobile ?? null, input.address ?? null, existingId],
      );
    } else {
      await db.execute(
        `INSERT INTO employee_nominee
           (id, employee_id, nominee_name, relationship, date_of_birth, mobile, address)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
        [employeeId, input.nominee_name, input.relationship, input.date_of_birth ?? null, input.mobile ?? null, input.address ?? null],
      );
    }
    await auditProfileChange(userId, employeeId, "NOMINEE_UPDATED", ["nominee_name", "relationship", "date_of_birth", "mobile", "address"], req);
    return this.getMyProfile(userId);
  },

  async saveBankDetails(
    userId: string,
    input: BankDetailsInput,
    req?: Request,
  ) {
    const employeeId = await employeeIdForUser(userId);
    const encryptedAccount = input.account_number
      ? db.execute(`SELECT AES_ENCRYPT(?, ?) AS enc`, [input.account_number, env.PAYROLL_BANK_KEY]).then(([r]: any) => (r[0] as any).enc)
      : Promise.resolve(null);
    const encAcc = await encryptedAccount;

    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employee_bank_detail WHERE employee_id = ? AND is_primary = 1 AND active_status = 1 LIMIT 1`,
      [employeeId],
    );
    const existingId = (existing[0] as any)?.id as string | undefined;

    if (existingId) {
      const sets = [
        "bank_name = ?",
        "account_holder_name = ?",
        "bank_branch = ?",
        "ifsc_code = ?",
        "account_type = ?",
        "verified = 0",
        "updated_at = NOW()",
      ];
      const vals: unknown[] = [
        input.bank_name, input.account_holder_name, input.bank_branch ?? null,
        input.ifsc_code, input.account_type,
      ];
      if (encAcc !== null) {
        sets.splice(5, 0, "account_number = ?");
        vals.splice(5, 0, encAcc);
      }
      await db.execute(
        `UPDATE employee_bank_detail SET ${sets.join(", ")} WHERE id = ?`,
        [...vals, existingId],
      );
    } else {
      await db.execute(
        `INSERT INTO employee_bank_detail
           (id, employee_id, is_primary, account_seq, bank_name, account_holder_name,
            bank_branch, account_number, ifsc_code, account_type, verified, active_status)
         VALUES (UUID(), ?, 1, 1, ?, ?, ?, ?, ?, ?, 0, 1)`,
        [
          employeeId, input.bank_name, input.account_holder_name,
          input.bank_branch ?? null, encAcc,
          input.ifsc_code, input.account_type,
        ],
      );
    }
    await auditProfileChange(userId, employeeId, "BANK_DETAILS_UPDATED", ["bank_name", "account_holder_name", "ifsc_code", "account_type"], req);
    return this.getMyProfile(userId);
  },

  async saveStatutoryDetails(
    userId: string,
    input: StatutoryDetailsInput,
    req?: Request,
  ) {
    const employeeId = await employeeIdForUser(userId);
    const empUpdates: string[] = [];
    const empVals: unknown[] = [];

    if (input.pan_number) {
      empUpdates.push("pan_number = ?");
      empVals.push(input.pan_number);
    }
    if (input.aadhaar_last4) {
      empUpdates.push("aadhaar_last4 = ?");
      empVals.push(input.aadhaar_last4);
    }
    if (empUpdates.length) {
      empVals.push(employeeId);
      await db.execute(
        `UPDATE employees SET ${empUpdates.join(", ")}, updated_at = NOW() WHERE id = ?`,
        empVals,
      );
    }

    if (input.uan || input.pf_number) {
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employee_uan WHERE employee_id = ? AND is_active = 1 LIMIT 1`,
        [employeeId],
      );
      const existingUanId = (existing[0] as any)?.id as string | undefined;
      if (existingUanId) {
        const uanSets: string[] = ["updated_at = NOW()"];
        const uanVals: unknown[] = [];
        if (input.uan) { uanSets.unshift("uan = ?"); uanVals.push(input.uan); }
        if (input.pf_number) { uanSets.unshift("member_id = ?"); uanVals.push(input.pf_number); }
        uanVals.push(existingUanId);
        await db.execute(`UPDATE employee_uan SET ${uanSets.join(", ")} WHERE id = ?`, uanVals);
      } else {
        await db.execute(
          `INSERT INTO employee_uan (id, employee_id, uan, member_id, is_active, verification_status)
           VALUES (UUID(), ?, ?, ?, 1, 'pending')`,
          [employeeId, input.uan ?? null, input.pf_number ?? null],
        );
      }
    }

    await auditProfileChange(
      userId, employeeId, "STATUTORY_DETAILS_UPDATED",
      Object.keys(input).filter((k) => (input as any)[k] !== undefined),
      req,
    );
    return this.getMyProfile(userId);
  },
};