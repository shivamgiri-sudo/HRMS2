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
   * Map LMS trainee to HRMS employee using priority order:
   * 1. Mobile number (primary, from trainee_master.mobile)
   * 2. Personal email (secondary, from trainee_master.email)
   * 3. Official email (tertiary)
   * 4. Employee code (quaternary, trainee_master.employee_id)
   */
  async mapLmsTrainee(lmsId: string): Promise<MappingResult> {
    const auditId = randomUUID();
    const auditLog = {
      lmsEmployeeId: lmsId,
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
      // Get trainee data from LMS
      const lms = await getLmsConnection();
      const [traineeRows] = await lms.execute<RowDataPacket[]>(
        `SELECT employee_id, lms_id, trainee_name, email, mobile FROM trainee_master WHERE lms_id = ? LIMIT 1`,
        [lmsId]
      );
      await lms.end();

      if (!traineeRows.length) {
        return {
          lmsEmployeeId: lmsId,
          mappingSource: 'none',
          confidence: 'low',
          success: false,
          errorReason: 'LMS trainee not found',
        };
      }

      const trainee = traineeRows[0] as any;

      // PRIORITY 1: Match by mobile number
      if (trainee.mobile && trainee.mobile.trim()) {
        auditLog.triedMobile = trainee.mobile;
        const [hrmsRows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code, mobile, personal_email, email
           FROM employees
           WHERE (mobile = ? OR alternate_mobile = ?) AND active_status = 1
           LIMIT 1`,
          [trainee.mobile, trainee.mobile]
        );

        if (hrmsRows.length > 0) {
          const hrmsEmployee = hrmsRows[0] as any;
          auditLog.mobileMatchFound = true;
          auditLog.finalMatchSource = 'mobile';
          auditLog.finalHrmsEmployeeId = hrmsEmployee.id;

          await this.saveMappingAndAudit(auditId, lmsId, hrmsEmployee, 'mobile', 'high', auditLog);
          return {
            lmsEmployeeId: lmsId,
            hrmsEmployeeId: hrmsEmployee.id,
            hrmsEmployeeCode: hrmsEmployee.employee_code,
            mappingSource: 'mobile',
            confidence: 'high',
            success: true,
          };
        }
      }

      // PRIORITY 2: Match by personal email
      if (trainee.email && trainee.email.trim()) {
        auditLog.triedPersonalEmail = trainee.email;
        const [hrmsRows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code, mobile, personal_email, email
           FROM employees
           WHERE (personal_email = ? OR email = ?) AND active_status = 1
           LIMIT 1`,
          [trainee.email, trainee.email]
        );

        if (hrmsRows.length > 0) {
          const hrmsEmployee = hrmsRows[0] as any;
          auditLog.emailPersonalMatchFound = true;
          auditLog.finalMatchSource = 'personal_email';
          auditLog.finalHrmsEmployeeId = hrmsEmployee.id;

          await this.saveMappingAndAudit(auditId, lmsId, hrmsEmployee, 'personal_email', 'medium', auditLog);
          return {
            lmsEmployeeId: lmsId,
            hrmsEmployeeId: hrmsEmployee.id,
            hrmsEmployeeCode: hrmsEmployee.employee_code,
            mappingSource: 'personal_email',
            confidence: 'medium',
            success: true,
          };
        }
      }

      // PRIORITY 3: Match by official email (try domain extraction if personal_email failed)
      if (trainee.email && trainee.email.includes('@')) {
        auditLog.triedOfficialEmail = trainee.email;
        const [hrmsRows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code, mobile, personal_email, email
           FROM employees
           WHERE office_email = ? AND active_status = 1
           LIMIT 1`,
          [trainee.email]
        );

        if (hrmsRows.length > 0) {
          const hrmsEmployee = hrmsRows[0] as any;
          auditLog.emailOfficialMatchFound = true;
          auditLog.finalMatchSource = 'official_email';
          auditLog.finalHrmsEmployeeId = hrmsEmployee.id;

          await this.saveMappingAndAudit(auditId, lmsId, hrmsEmployee, 'official_email', 'medium', auditLog);
          return {
            lmsEmployeeId: lmsId,
            hrmsEmployeeId: hrmsEmployee.id,
            hrmsEmployeeCode: hrmsEmployee.employee_code,
            mappingSource: 'official_email',
            confidence: 'medium',
            success: true,
          };
        }
      }

      // PRIORITY 4: Match by employee code from trainee_master (case-insensitive)
      if (trainee.employee_id) {
        auditLog.triedEmployeeCode = trainee.employee_id;
        const [hrmsRows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code, mobile, personal_email, email
           FROM employees
           WHERE UPPER(employee_code) = UPPER(?) AND active_status = 1
           LIMIT 1`,
          [trainee.employee_id]
        );

        if (hrmsRows.length > 0) {
          const hrmsEmployee = hrmsRows[0] as any;
          auditLog.employeeCodeMatchFound = true;
          auditLog.finalMatchSource = 'employee_code';
          auditLog.finalHrmsEmployeeId = hrmsEmployee.id;

          await this.saveMappingAndAudit(auditId, lmsId, hrmsEmployee, 'employee_code', 'low', auditLog);
          return {
            lmsEmployeeId: lmsId,
            hrmsEmployeeId: hrmsEmployee.id,
            hrmsEmployeeCode: hrmsEmployee.employee_code,
            mappingSource: 'employee_code',
            confidence: 'low',
            success: true,
          };
        }
      }

      // No match found on any priority
      await this.logMappingFailure(auditId, auditLog, 'No matching HRMS employee found');
      return {
        lmsEmployeeId: lmsId,
        mappingSource: 'none',
        confidence: 'low',
        success: false,
        errorReason: 'No matching HRMS employee found via any priority',
      };
    } catch (e) {
      await this.logMappingFailure(auditId, auditLog, String(e));
      return {
        lmsEmployeeId: lmsId,
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
  async getOrMapLmsTrainee(lmsId: string): Promise<string | null> {
    // Check if already mapped
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT hrms_employee_id FROM lms_employee_mapping WHERE lms_employee_id = ? LIMIT 1`,
      [lmsId]
    );

    if (existing.length > 0) {
      return (existing[0] as any).hrms_employee_id;
    }

    // Create new mapping using priority chain
    const result = await this.mapLmsTrainee(lmsId);
    return result.success ? result.hrmsEmployeeId : null;
  },
};
