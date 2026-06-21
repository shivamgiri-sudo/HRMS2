import { db } from '../../db/mysql.js';
import { getLmsConnection } from './lms-external-db.js';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';

interface MappingResult {
  lmsEmployeeId: string;
  hrmsEmployeeId?: string;
  hrmsEmployeeCode?: string;
  mappingSource: 'mobile' | 'personal_email' | 'official_email' | 'employee_code' | 'none';
  confidence: 'high' | 'medium' | 'low';
  success: boolean;
  errorReason?: string;
}

export const lmsEmployeeMapper = {
  /**
   * Map LMS employee to HRMS employee using fallback chain:
   * 1. Mobile number (primary)
   * 2. Personal email (secondary)
   * 3. Official email (tertiary)
   * 4. Employee code (quaternary)
   */
  async mapLmsEmployee(lmsEmployeeId: string): Promise<MappingResult> {
    const auditId = randomUUID();
    const auditLog = {
      lmsEmployeeId,
      triedMobile: null as string | null,
      triedPersonalEmail: null as string | null,
      triedOfficialEmail: null as string | null,
      triedEmployeeCode: null as string | null,
      mobileMatchFound: false,
      emailPersonalMatchFound: false,
      emailOfficialMatchFound: false,
      employeeCodeMatchFound: false,
      finalMatchSource: 'none' as const,
      finalHrmsEmployeeId: null as string | null,
    };

    try {
      // Get LMS employee data (phone, email fields)
      const lms = await getLmsConnection();
      const [lmsRows] = await lms.execute<RowDataPacket[]>(
        `SELECT * FROM admin_user_master WHERE admin_id = ? LIMIT 1`,
        [lmsEmployeeId]
      );
      await lms.end();

      if (!lmsRows.length) {
        return {
          lmsEmployeeId,
          mappingSource: 'none',
          confidence: 'low',
          success: false,
          errorReason: 'LMS employee not found',
        };
      }

      const lmsEmployee = lmsRows[0] as any;

      // Strategy 1: Match by mobile number
      if (lmsEmployee.phone) {
        auditLog.triedMobile = lmsEmployee.phone;
        const [hrmsRows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code, mobile, personal_email, email
           FROM employees
           WHERE mobile = ? AND active_status = 1
           LIMIT 1`,
          [lmsEmployee.phone]
        );

        if (hrmsRows.length > 0) {
          const hrmsEmployee = hrmsRows[0] as any;
          auditLog.mobileMatchFound = true;
          auditLog.finalMatchSource = 'mobile';
          auditLog.finalHrmsEmployeeId = hrmsEmployee.id;

          await this.saveMappingAndAudit(auditId, lmsEmployeeId, hrmsEmployee, 'mobile', 'high', auditLog);
          return {
            lmsEmployeeId,
            hrmsEmployeeId: hrmsEmployee.id,
            hrmsEmployeeCode: hrmsEmployee.employee_code,
            mappingSource: 'mobile',
            confidence: 'high',
            success: true,
          };
        }
      }

      // Strategy 2: Match by personal email
      if (lmsEmployee.personal_email) {
        auditLog.triedPersonalEmail = lmsEmployee.personal_email;
        const [hrmsRows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code, mobile, personal_email, email
           FROM employees
           WHERE personal_email = ? AND active_status = 1
           LIMIT 1`,
          [lmsEmployee.personal_email]
        );

        if (hrmsRows.length > 0) {
          const hrmsEmployee = hrmsRows[0] as any;
          auditLog.emailPersonalMatchFound = true;
          auditLog.finalMatchSource = 'personal_email';
          auditLog.finalHrmsEmployeeId = hrmsEmployee.id;

          await this.saveMappingAndAudit(auditId, lmsEmployeeId, hrmsEmployee, 'personal_email', 'medium', auditLog);
          return {
            lmsEmployeeId,
            hrmsEmployeeId: hrmsEmployee.id,
            hrmsEmployeeCode: hrmsEmployee.employee_code,
            mappingSource: 'personal_email',
            confidence: 'medium',
            success: true,
          };
        }
      }

      // Strategy 3: Match by official email
      if (lmsEmployee.email) {
        auditLog.triedOfficialEmail = lmsEmployee.email;
        const [hrmsRows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code, mobile, personal_email, email
           FROM employees
           WHERE email = ? AND active_status = 1
           LIMIT 1`,
          [lmsEmployee.email]
        );

        if (hrmsRows.length > 0) {
          const hrmsEmployee = hrmsRows[0] as any;
          auditLog.emailOfficialMatchFound = true;
          auditLog.finalMatchSource = 'official_email';
          auditLog.finalHrmsEmployeeId = hrmsEmployee.id;

          await this.saveMappingAndAudit(auditId, lmsEmployeeId, hrmsEmployee, 'email', 'medium', auditLog);
          return {
            lmsEmployeeId,
            hrmsEmployeeId: hrmsEmployee.id,
            hrmsEmployeeCode: hrmsEmployee.employee_code,
            mappingSource: 'official_email',
            confidence: 'medium',
            success: true,
          };
        }
      }

      // Strategy 4: Match by employee code (LMS employee_id = HRMS employee_code)
      auditLog.triedEmployeeCode = lmsEmployeeId;
      const [hrmsRows] = await db.execute<RowDataPacket[]>(
        `SELECT id, employee_code, mobile, personal_email, email
         FROM employees
         WHERE employee_code = ? AND active_status = 1
         LIMIT 1`,
        [lmsEmployeeId]
      );

      if (hrmsRows.length > 0) {
        const hrmsEmployee = hrmsRows[0] as any;
        auditLog.employeeCodeMatchFound = true;
        auditLog.finalMatchSource = 'employee_code';
        auditLog.finalHrmsEmployeeId = hrmsEmployee.id;

        await this.saveMappingAndAudit(auditId, lmsEmployeeId, hrmsEmployee, 'employee_code', 'low', auditLog);
        return {
          lmsEmployeeId,
          hrmsEmployeeId: hrmsEmployee.id,
          hrmsEmployeeCode: hrmsEmployee.employee_code,
          mappingSource: 'employee_code',
          confidence: 'low',
          success: true,
        };
      }

      // No match found on any strategy
      await this.logMappingFailure(auditId, auditLog, 'No matching HRMS employee found');
      return {
        lmsEmployeeId,
        mappingSource: 'none',
        confidence: 'low',
        success: false,
        errorReason: 'No matching HRMS employee found via any mapping strategy',
      };
    } catch (e) {
      await this.logMappingFailure(auditId, auditLog, String(e));
      return {
        lmsEmployeeId,
        mappingSource: 'none',
        confidence: 'low',
        success: false,
        errorReason: `Mapping error: ${String(e).substring(0, 100)}`,
      };
    }
  },

  async saveMappingAndAudit(
    auditId: string,
    lmsEmployeeId: string,
    hrmsEmployee: any,
    source: 'mobile' | 'personal_email' | 'email' | 'employee_code',
    confidence: 'high' | 'medium' | 'low',
    auditLog: any
  ) {
    const mappingId = randomUUID();

    // Normalize source name
    const normalizedSource = source === 'email' ? 'official_email' : source;

    // Save mapping
    await db.execute(
      `INSERT INTO lms_employee_mapping
       (id, lms_employee_id, hrms_employee_id, hrms_employee_code, hrms_mobile, hrms_personal_email, hrms_official_email, mapping_source, mapping_confidence, mapped_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'system')
       ON DUPLICATE KEY UPDATE
       hrms_employee_id = VALUES(hrms_employee_id),
       mapping_source = VALUES(mapping_source),
       mapping_confidence = VALUES(mapping_confidence),
       mapped_at = NOW()`,
      [
        mappingId,
        lmsEmployeeId,
        hrmsEmployee.id,
        hrmsEmployee.employee_code,
        hrmsEmployee.mobile || null,
        hrmsEmployee.personal_email || null,
        hrmsEmployee.email || null,
        normalizedSource,
        confidence,
      ]
    );

    // Save audit
    await db.execute(
      `INSERT INTO lms_mapping_audit
       (id, lms_employee_id, tried_mobile, tried_personal_email, tried_official_email, tried_employee_code,
        mobile_match_found, email_personal_match_found, email_official_match_found, employee_code_match_found,
        final_match_source, final_hrms_employee_id, success)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        auditId,
        lmsEmployeeId,
        auditLog.triedMobile,
        auditLog.triedPersonalEmail,
        auditLog.triedOfficialEmail,
        auditLog.triedEmployeeCode,
        auditLog.mobileMatchFound ? 1 : 0,
        auditLog.emailPersonalMatchFound ? 1 : 0,
        auditLog.emailOfficialMatchFound ? 1 : 0,
        auditLog.employeeCodeMatchFound ? 1 : 0,
        normalizedSource,
        hrmsEmployee.id,
      ]
    );
  },

  async logMappingFailure(auditId: string, auditLog: any, errorReason: string) {
    await db.execute(
      `INSERT INTO lms_mapping_audit
       (id, lms_employee_id, tried_mobile, tried_personal_email, tried_official_email, tried_employee_code,
        mobile_match_found, email_personal_match_found, email_official_match_found, employee_code_match_found,
        final_match_source, success, error_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 0, ?)`,
      [
        auditId,
        auditLog.lmsEmployeeId,
        auditLog.triedMobile,
        auditLog.triedPersonalEmail,
        auditLog.triedOfficialEmail,
        auditLog.triedEmployeeCode,
        auditLog.mobileMatchFound ? 1 : 0,
        auditLog.emailPersonalMatchFound ? 1 : 0,
        auditLog.emailOfficialMatchFound ? 1 : 0,
        auditLog.employeeCodeMatchFound ? 1 : 0,
        errorReason,
      ]
    );
  },

  /**
   * Get existing mapping or create new one
   */
  async getOrMapLmsEmployee(lmsEmployeeId: string): Promise<string | null> {
    // Check if already mapped
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT hrms_employee_id FROM lms_employee_mapping WHERE lms_employee_id = ? LIMIT 1`,
      [lmsEmployeeId]
    );

    if (existing.length > 0) {
      return (existing[0] as any).hrms_employee_id;
    }

    // Create new mapping
    const result = await this.mapLmsEmployee(lmsEmployeeId);
    return result.success ? result.hrmsEmployeeId : null;
  },
};
