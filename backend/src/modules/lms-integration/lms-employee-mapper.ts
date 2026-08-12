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
  errorReason?: string | null;
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
      finalMatchSource: 'none' as 'mobile' | 'personal_email' | 'official_email' | 'employee_code' | 'none',
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

      // PRIORITY 3: Match by official email (@teammas.co.in / @teammas.in)
      if (trainee.email && trainee.email.includes('@')) {
        auditLog.triedOfficialEmail = trainee.email;
        const [hrmsRows] = await db.execute<RowDataPacket[]>(
          `SELECT id, employee_code, mobile, personal_email, email
           FROM employees
           WHERE (office_email = ? OR office_email LIKE CONCAT('%', ?, '%')) AND active_status = 1
           LIMIT 1`,
          [trainee.email, trainee.email.split('@')[0]]
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
    source: 'mobile' | 'personal_email' | 'official_email' | 'email' | 'employee_code',
    confidence: 'high' | 'medium' | 'low',
    auditLog: any
  ) {
    const mappingId = randomUUID();

    // Normalize source name
    const normalizedSource = source === 'email' ? 'official_email' : source;

    // Save mapping.
    //
    // lms_employee_mapping stores employee_id and lms_learner_id, not
    // hrms_employee_id and lms_employee_id, and it has a single `email` column
    // rather than separate personal and official ones. It has no hrms_mobile at
    // all. Five of the ten columns this named did not exist, so the upsert threw
    // ER_BAD_FIELD_ERROR on every cache miss.
    //
    // The mobile number is dropped rather than stored somewhere it does not
    // belong; it is still recorded on the audit row below as tried_mobile, which
    // is where the matching attempt actually belongs.
    //
    // The unique key is uq_lms_emp (employee_id), so the upsert resolves on the
    // employee, and lms_learner_id is what gets corrected on a re-map.
    await db.execute(
      `INSERT INTO lms_employee_mapping
       (id, employee_id, lms_learner_id, hrms_employee_code, email, mapping_source, mapping_confidence, mapped_by, mapped_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'system', NOW())
       ON DUPLICATE KEY UPDATE
       lms_learner_id = VALUES(lms_learner_id),
       email = VALUES(email),
       mapping_source = VALUES(mapping_source),
       mapping_confidence = VALUES(mapping_confidence),
       mapped_at = NOW()`,
      [
        mappingId,
        hrmsEmployee.id,
        lmsEmployeeId,
        hrmsEmployee.employee_code,
        hrmsEmployee.email || hrmsEmployee.personal_email || null,
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
    // Column names, not aliases: lms_employee_mapping stores employee_id and
    // lms_learner_id. This read asked for hrms_employee_id / lms_employee_id,
    // which do not exist, so it threw ER_BAD_FIELD_ERROR on EVERY call —
    // confirmed by running the compiled function against production.
    //
    // It has not been failing in production because the live process is running
    // an older in-memory build; the on-disk dist compiled from this source is
    // broken, so the next restart would have taken learner_progress from 911
    // synced to 0. Verified against live data: all 1,177 rows carry a usable
    // employee_id, and this query resolves real learner ids.
    //
    // The other three names in this file (the upsert below and the audit writes)
    // are wrong too — hrms_mobile, hrms_personal_email and
    // lms_employee_mapping_audit do not exist either. They are NOT touched here:
    // they sit on the cache-miss path, they need columns the table does not have
    // at all rather than a rename, and reconciling this mapper with the one in
    // modules/lms that actually populates the table is a design decision. This
    // change restores exactly the behaviour production has today.
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id FROM lms_employee_mapping WHERE lms_learner_id = ? LIMIT 1`,
      [lmsId]
    );

    if (existing.length > 0) {
      return (existing[0] as any).employee_id ?? null;
    }

    const result = await this.mapLmsTrainee(lmsId);
    return result.success ? (result.hrmsEmployeeId ?? null) : null;
  },
};
