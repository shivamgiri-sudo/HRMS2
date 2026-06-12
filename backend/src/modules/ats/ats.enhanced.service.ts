import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';

// ── Branch Alias Resolution ───────────────────────────────────────────────────
export async function getBranchAliases() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT canonical_key, display_name, alias_text, active_status
     FROM ats_branch_alias_master
     WHERE active_status = 1
     ORDER BY display_name`
  );
  return rows;
}

export async function resolveBranchFromAlias(displayName: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT canonical_key, display_name
     FROM ats_branch_alias_master
     WHERE (display_name = ? OR alias_text = ?) AND active_status = 1
     LIMIT 1`,
    [displayName, displayName]
  );
  return rows[0] ?? null;
}

// ── Recruiter Assignment Logic ────────────────────────────────────────────────
export async function getAvailableRecruiters(branchName: string) {
  // Get recruiters who are:
  // 1. Department = Human Resource
  // 2. Designation = Executive
  // 3. Same branch
  // 4. Present today (from biometric/attendance)

  const today = new Date().toISOString().split('T')[0];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT
       e.id,
       e.employee_code,
       e.first_name,
       e.last_name,
       e.mobile_number,
       e.email,
       e.branch_name,
       d.department_name,
       des.designation_name,
       att.clock_in_time
     FROM employees e
     INNER JOIN department_master d ON e.department_id = d.id
     INNER JOIN designation_master des ON e.designation_id = des.id
     LEFT JOIN wfm_daily_attendance att ON att.employee_id = e.id AND att.record_date = ?
     WHERE d.department_name = 'Human Resource'
       AND des.designation_name = 'Executive'
       AND e.branch_name = ?
       AND att.clock_in_time IS NOT NULL
       AND e.active_status = 1
     ORDER BY e.first_name, e.last_name`,
    [today, branchName]
  );

  return rows;
}

export async function isRecruiterAvailableToday(recruiterId: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM wfm_daily_attendance
     WHERE employee_id = ? AND record_date = ? AND clock_in_time IS NOT NULL
     LIMIT 1`,
    [recruiterId, today]
  );

  return rows.length > 0;
}

export async function assignRecruiterToCandidate(candidateId: string, preferredRecruiterId: string | null) {
  let assignedRecruiterId = preferredRecruiterId;
  let assignmentReason = 'Candidate selected recruiter';

  if (preferredRecruiterId) {
    const isAvailable = await isRecruiterAvailableToday(preferredRecruiterId);

    if (!isAvailable) {
      // Get candidate's branch
      const [candRows] = await db.execute<RowDataPacket[]>(
        'SELECT applied_for_branch FROM ats_candidate WHERE id = ?',
        [candidateId]
      );

      if (candRows.length === 0) throw new Error('Candidate not found');

      const branchName = candRows[0].applied_for_branch;
      const availableRecruiters = await getAvailableRecruiters(branchName);

      if (availableRecruiters.length > 0) {
        // Fair assignment: lowest active queue count
        const recruiterLoads = await Promise.all(
          availableRecruiters.map(async (rec: any) => {
            const [queueRows] = await db.execute<RowDataPacket[]>(
              `SELECT COUNT(*) as count FROM ats_queue_token
               WHERE recruiter_id = ? AND queue_status IN ('waiting','called','in_interview')`,
              [rec.id]
            );
            return { recruiterId: rec.id, queueCount: queueRows[0].count };
          })
        );

        recruiterLoads.sort((a, b) => a.queueCount - b.queueCount);
        assignedRecruiterId = recruiterLoads[0].recruiterId;
        assignmentReason = 'Preferred recruiter unavailable, reassigned to available recruiter';
      } else {
        assignedRecruiterId = null;
        assignmentReason = 'No recruiter available today';
      }
    }
  } else {
    // No preferred recruiter selected - assign to available recruiter
    const [candRows] = await db.execute<RowDataPacket[]>(
      'SELECT applied_for_branch FROM ats_candidate WHERE id = ?',
      [candidateId]
    );

    if (candRows.length === 0) throw new Error('Candidate not found');

    const branchName = candRows[0].applied_for_branch;
    const availableRecruiters = await getAvailableRecruiters(branchName);

    if (availableRecruiters.length > 0) {
      const recruiterLoads = await Promise.all(
        availableRecruiters.map(async (rec: any) => {
          const [queueRows] = await db.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as count FROM ats_queue_token
             WHERE recruiter_id = ? AND queue_status IN ('waiting','called','in_interview')`,
            [rec.id]
          );
          return { recruiterId: rec.id, queueCount: queueRows[0].count };
        })
      );

      recruiterLoads.sort((a, b) => a.queueCount - b.queueCount);
      assignedRecruiterId = recruiterLoads[0].recruiterId;
      assignmentReason = 'Auto-assigned to available recruiter';
    } else {
      assignedRecruiterId = null;
      assignmentReason = 'No recruiter available today';
    }
  }

  // Update candidate with assigned recruiter
  if (assignedRecruiterId) {
    await db.execute(
      `UPDATE ats_candidate
       SET recruiter_id = ?, recruiter_assigned_id = ?, recruiter_selected = ?
       WHERE id = ?`,
      [assignedRecruiterId, assignedRecruiterId, preferredRecruiterId || assignedRecruiterId, candidateId]
    );

    // Log assignment
    await db.execute(
      `INSERT INTO ats_recruiter_assignment_log
       (id, candidate_id, old_recruiter_id, new_recruiter_id, assignment_reason, assigned_by)
       VALUES (UUID(), ?, NULL, ?, ?, 'SYSTEM')`,
      [candidateId, assignedRecruiterId, assignmentReason]
    );
  }

  return {
    assignedRecruiterId,
    preferredRecruiterId,
    assignmentReason
  };
}

// ── Token Generation ───────────────────────────────────────────────────────────
export async function generateTokenNumber(branchName: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  // Get count of tokens issued today for this branch
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM ats_queue_token
     WHERE branch_name = ? AND DATE(created_at) = ?`,
    [branchName, today]
  );

  const todayCount = rows[0].count + 1;
  const branchPrefix = branchName.substring(0, 3).toUpperCase();
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');

  return `${branchPrefix}-${dateStr}-${String(todayCount).padStart(3, '0')}`;
}

// ── Employee Code Generation ───────────────────────────────────────────────────
export async function generateEmployeeCode(companyPrefix: 'MAS' | 'IDC', isOffrole: boolean): Promise<string> {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Lock row and get next sequence
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT last_sequence_number FROM employee_code_sequence
       WHERE company_prefix = ? FOR UPDATE`,
      [companyPrefix]
    );

    if (rows.length === 0) {
      throw new Error(`Sequence not found for company ${companyPrefix}`);
    }

    const nextSequence = rows[0].last_sequence_number + 1;

    // Update sequence
    await connection.execute(
      `UPDATE employee_code_sequence
       SET last_sequence_number = ?
       WHERE company_prefix = ?`,
      [nextSequence, companyPrefix]
    );

    // Generate employee code
    const employeeCode = isOffrole
      ? `${companyPrefix}${nextSequence}C`
      : `${companyPrefix}${nextSequence}`;

    await connection.commit();

    return employeeCode;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function logEmployeeCodeGeneration(
  employeeCode: string,
  candidateId: string | null,
  employeeId: string | null,
  companyPrefix: string,
  isOffrole: boolean,
  generatedBy: string | null
) {
  await db.execute(
    `INSERT INTO employee_code_generation_log
     (id, employee_code, candidate_id, employee_id, company_prefix, is_offrole, sequence_number, generated_by)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
    [
      employeeCode,
      candidateId,
      employeeId,
      companyPrefix,
      isOffrole ? 1 : 0,
      parseInt(employeeCode.replace(/[^0-9]/g, '')),
      generatedBy
    ]
  );
}
