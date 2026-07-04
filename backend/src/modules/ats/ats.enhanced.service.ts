import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';

type RecruiterRow = RowDataPacket & {
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  mobile: string | null;
  email: string | null;
  branch_name: string;
  id?: string;
};
type RosterRow = RowDataPacket & { id: string; employee_id: string };
type QueueCountRow = RowDataPacket & { count: number | string | null };
type RecruiterNameRow = RowDataPacket & { full_name: string | null };

// ── Branch Alias Resolution ───────────────────────────────────────────────────
export async function getBranchAliases() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT canonical_key,
            MAX(display_name) AS display_name,
            MIN(alias_text) AS alias_text,
            MAX(active_status) AS active_status
     FROM ats_branch_alias_master
     WHERE active_status = 1
     GROUP BY canonical_key
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

// ── Recruiter Roster Upsert ────────────────────────────────────────────────────
// Ensures an HR/Executive employee exists in ats_recruiter_roster (the FK target)
// and returns their roster id. Uses INSERT … ON DUPLICATE KEY UPDATE so it's
// idempotent — safe to call on every walk-in registration.
export async function ensureRecruiterInRoster(
  employee: { id: string; first_name: string; last_name: string; mobile: string | null; email: string | null; branch_name: string }
): Promise<string> {
  const fullName = `${employee.first_name} ${employee.last_name ?? ''}`.trim();

  // Check if already in roster (keyed by employee_id)
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM ats_recruiter_roster WHERE employee_id = ? LIMIT 1`,
    [employee.id]
  );
  if ((existing as RowDataPacket[]).length > 0) {
    return (existing as RowDataPacket[])[0].id as string;
  }

  // Insert new roster entry
  const rosterId = randomUUID();
  await db.execute(
    `INSERT INTO ats_recruiter_roster
       (id, name, email, mobile, branch, employee_id, active_status, active_flag,
        available_today, daily_capacity, assigned_today)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'Y', 'Y', 999, 0)`,
    [rosterId, fullName, employee.email ?? null, employee.mobile ?? null, employee.branch_name, employee.id]
  );
  return rosterId;
}

// ── Recruiter Assignment Logic ────────────────────────────────────────────────
export async function getAvailableRecruiters(branchName: string) {
  const today = new Date().toISOString().split('T')[0];

  // Fetch HR/Executive employees at this branch (department = Human Resource, designation = Executive)
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT
       e.id AS employee_id,
       e.employee_code,
       e.first_name,
       e.last_name,
       e.mobile,
       e.email,
       b.branch_name,
       d.dept_name AS department_name,
       des.designation_name,
       att.clock_in_time,
       CASE
         WHEN att.clock_in_time IS NOT NULL
           OR att.attendance_status IN ('present', 'half_day')
         THEN 1 ELSE 0
       END AS present_today
     FROM employees e
     INNER JOIN department_master d ON e.department_id = d.id
     INNER JOIN designation_master des ON e.designation_id = des.id
     INNER JOIN branch_master b ON b.id = e.branch_id
     LEFT JOIN attendance_daily_record att ON att.employee_id = e.id AND att.record_date = ?
     WHERE (LOWER(d.dept_name) LIKE '%human resource%' OR LOWER(d.dept_name) LIKE '%admin/hr%')
       AND (
         LOWER(des.designation_name) LIKE '%executive%'
         OR LOWER(des.designation_name) LIKE '%recruiter%'
         OR LOWER(des.designation_name) LIKE '%hr manager%'
       )
       AND (b.branch_name = ? OR b.branch_code = ?)
       AND e.active_status = 1
     ORDER BY present_today DESC, e.first_name, e.last_name`,
    [today, branchName, branchName]
  );

  // Ensure every employee has a valid ats_recruiter_roster row (FK target for recruiter_id)
  // and return the roster id as `id` so callers can write it directly into ats_candidate.recruiter_id
  const result: RecruiterRow[] = [];
  for (const row of rows as RecruiterRow[]) {
    const rosterId = await ensureRecruiterInRoster({
      id: row.employee_id,
      first_name: row.first_name,
      last_name: row.last_name,
      mobile: row.mobile,
      email: row.email,
      branch_name: row.branch_name,
    });
    result.push({ ...row, id: rosterId });
  }
  return result;
}

export async function isRecruiterAvailableToday(recruiterId: string): Promise<boolean> {
  // recruiterId can be a roster UUID or an employee UUID — resolve to employee_id first
  const [rosterRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM ats_recruiter_roster WHERE id = ? AND active_status = 1 LIMIT 1`,
    [recruiterId]
  );
  const employeeId = (rosterRows as RosterRow[]).length > 0
    ? (rosterRows as RosterRow[])[0].employee_id
    : recruiterId;

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1`,
    [employeeId]
  );

  return empRows.length > 0;
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
          availableRecruiters.map(async (rec: RecruiterRow) => {
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
        availableRecruiters.map(async (rec: RecruiterRow) => {
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
    // assignedRecruiterId is an ats_recruiter_roster.id — resolve the employee name via the roster
    const [recNameRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(r.name, CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS full_name
       FROM ats_recruiter_roster r
       LEFT JOIN employees e ON e.id = r.employee_id
       WHERE r.id = ? LIMIT 1`,
      [assignedRecruiterId]
    );
    const resolvedName = (recNameRows as RecruiterNameRow[])[0]?.full_name?.trim() ?? null;

    await db.execute(
      `UPDATE ats_candidate
       SET recruiter_id = ?,
           recruiter_assigned_id = ?,
           assigned_recruiter_id = ?,
           recruiter_assigned_name = ?,
           recruiter_selected = ?,
           preferred_recruiter_id = ?,
           assignment_reason = ?
       WHERE id = ?`,
      [
        assignedRecruiterId,
        assignedRecruiterId,
        assignedRecruiterId,
        resolvedName,
        preferredRecruiterId || assignedRecruiterId,
        preferredRecruiterId,
        assignmentReason,
        candidateId,
      ]
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
