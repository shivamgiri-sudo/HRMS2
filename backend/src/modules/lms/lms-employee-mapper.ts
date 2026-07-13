import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { lmsQuery } from "./lms.service.js";

export type MappingSource = "mobile" | "personal_email" | "official_email" | "employee_code" | "manual";
export type MappingConfidence = "high" | "medium" | "low";

export interface MappingResult {
  lmsEmployeeId: string;
  hrmsEmployeeId?: string;
  hrmsEmployeeCode?: string;
  mappingSource: MappingSource | "none";
  confidence: MappingConfidence;
  success: boolean;
  errorReason?: string | null;
}

export const lmsEmployeeMapper = {
  async mapLmsTrainee(lmsId: string): Promise<MappingResult> {
    const auditId = randomUUID();
    const log = {
      lmsEmployeeId: lmsId,
      triedMobile: null as string | null,
      triedPersonalEmail: null as string | null,
      triedOfficialEmail: null as string | null,
      triedEmployeeCode: null as string | null,
      mobileMatchFound: false,
      emailPersonalMatchFound: false,
      emailOfficialMatchFound: false,
      employeeCodeMatchFound: false,
    };

    try {
      const [traineeRows] = await lmsQuery<RowDataPacket[]>(
        `SELECT employee_id, permanent_emp_id, trainee_name, email, mobile
           FROM trainee_master WHERE employee_id = ? OR permanent_emp_id = ? OR lms_id = ? LIMIT 1`,
        [lmsId, lmsId, lmsId]
      );
      if (!traineeRows?.length) {
        await this._logFailure(auditId, log, "LMS trainee not found");
        return { lmsEmployeeId: lmsId, mappingSource: "none", confidence: "low", success: false, errorReason: "LMS trainee not found" };
      }
      const t = traineeRows[0] as any;

      const save = async (emp: any, source: MappingSource, confidence: MappingConfidence): Promise<MappingResult> => {
        await db.execute(
          `INSERT INTO lms_employee_mapping
             (id, employee_id, lms_learner_id, email, mapping_source, mapping_confidence, hrms_employee_code, mapped_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'system')
           ON DUPLICATE KEY UPDATE
             lms_learner_id = VALUES(lms_learner_id),
             mapping_source = VALUES(mapping_source),
             mapping_confidence = VALUES(mapping_confidence),
             hrms_employee_code = VALUES(hrms_employee_code)`,
          [randomUUID(), emp.id, lmsId, t.email || emp.email || null, source, confidence, emp.employee_code]
        );
        await db.execute(
          `INSERT INTO lms_mapping_audit
             (id, lms_employee_id, tried_mobile, tried_personal_email, tried_official_email, tried_employee_code,
              mobile_match_found, email_personal_match_found, email_official_match_found, employee_code_match_found,
              final_match_source, final_hrms_employee_id, success)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [auditId, lmsId, log.triedMobile, log.triedPersonalEmail, log.triedOfficialEmail, log.triedEmployeeCode,
           log.mobileMatchFound ? 1 : 0, log.emailPersonalMatchFound ? 1 : 0,
           log.emailOfficialMatchFound ? 1 : 0, log.employeeCodeMatchFound ? 1 : 0,
           source, emp.id]
        );
        return { lmsEmployeeId: lmsId, hrmsEmployeeId: emp.id, hrmsEmployeeCode: emp.employee_code, mappingSource: source, confidence, success: true };
      };

      // Priority 1: mobile
      if (t.mobile?.trim()) {
        log.triedMobile = t.mobile;
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code FROM employees WHERE (mobile = ? OR alternate_mobile = ?) AND active_status = 1 LIMIT 1`,
          [t.mobile, t.mobile]
        );
        if (rows.length) { log.mobileMatchFound = true; return save(rows[0] as any, "mobile", "high"); }
      }

      // Priority 2: personal email
      if (t.email?.trim()) {
        log.triedPersonalEmail = t.email;
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code FROM employees WHERE (personal_email = ? OR email = ?) AND active_status = 1 LIMIT 1`,
          [t.email, t.email]
        );
        if (rows.length) { log.emailPersonalMatchFound = true; return save(rows[0] as any, "personal_email", "medium"); }
      }

      // Priority 3: official email prefix
      if (t.email?.includes("@")) {
        log.triedOfficialEmail = t.email;
        const prefix = t.email.split("@")[0];
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code FROM employees WHERE office_email = ? AND active_status = 1 LIMIT 1`,
          [t.email]
        );
        if (rows.length) { log.emailOfficialMatchFound = true; return save(rows[0] as any, "official_email", "medium"); }
        const [rows2] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code FROM employees WHERE office_email LIKE ? AND active_status = 1 LIMIT 1`,
          [`${prefix}@%`]
        );
        if (rows2.length) { log.emailOfficialMatchFound = true; return save(rows2[0] as any, "official_email", "medium"); }
      }

      // Priority 4: employee code
      const empCode = String(t.permanent_emp_id || t.employee_id || "").trim();
      if (empCode) {
        log.triedEmployeeCode = empCode;
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code FROM employees WHERE UPPER(employee_code) = UPPER(?) AND active_status = 1 LIMIT 1`,
          [empCode]
        );
        if (rows.length) { log.employeeCodeMatchFound = true; return save(rows[0] as any, "employee_code", "low"); }
      }

      await this._logFailure(auditId, log, "No matching HRMS employee found");
      return { lmsEmployeeId: lmsId, mappingSource: "none", confidence: "low", success: false, errorReason: "No match found" };
    } catch (e: any) {
      await this._logFailure(auditId, log, String(e));
      return { lmsEmployeeId: lmsId, mappingSource: "none", confidence: "low", success: false, errorReason: String(e).slice(0, 200) };
    }
  },

  async getOrMapLmsTrainee(lmsId: string): Promise<string | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM lms_employee_mapping WHERE lms_learner_id = ? AND is_active = 1 LIMIT 1`,
      [lmsId]
    );
    if (rows.length) return (rows[0] as any).employee_id ?? null;
    const result = await this.mapLmsTrainee(lmsId);
    return result.success ? (result.hrmsEmployeeId ?? null) : null;
  },

  async _logFailure(auditId: string, log: any, reason: string) {
    try {
      await db.execute(
        `INSERT INTO lms_mapping_audit
           (id, lms_employee_id, tried_mobile, tried_personal_email, tried_official_email, tried_employee_code,
            mobile_match_found, email_personal_match_found, email_official_match_found, employee_code_match_found,
            final_match_source, success, error_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 0, ?)`,
        [auditId, log.lmsEmployeeId, log.triedMobile, log.triedPersonalEmail, log.triedOfficialEmail, log.triedEmployeeCode,
         log.mobileMatchFound ? 1 : 0, log.emailPersonalMatchFound ? 1 : 0,
         log.emailOfficialMatchFound ? 1 : 0, log.employeeCodeMatchFound ? 1 : 0, reason]
      );
    } catch {}
  },
};
