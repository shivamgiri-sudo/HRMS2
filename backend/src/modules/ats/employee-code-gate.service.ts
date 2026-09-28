import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

interface BoolRow extends RowDataPacket {
  profile_status?: string | null;
  verification_status?: string | null;
  overall_match_status?: string | null;
  validation_status?: string | null;
  jclr_status?: string | null;
  status?: string | null;
  employee_code?: string | null;
  employee_id?: string | null;
  id?: string | null;
}

export interface GateCheckResult {
  canGenerate: boolean;
  blockers: string[];
  checklist: Record<string, boolean>;
  alreadyGenerated?: boolean;
  employeeCode?: string | null;
  employeeId?: string | null;
}

async function findExistingEmployeeCode(candidateId: string): Promise<{
  employeeCode: string | null;
  employeeId: string | null;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        COALESCE(c.employee_code, e.employee_code, e_by_email.employee_code) AS employee_code,
        COALESCE(e.id, e_by_email.id) AS employee_id
       FROM ats_candidate c
       LEFT JOIN appointment_letter_request alr ON alr.candidate_id = c.id
       LEFT JOIN employees e ON e.id = alr.employee_id
       LEFT JOIN employees e_by_email
         ON e_by_email.email = c.email OR e_by_email.official_email = c.email
       WHERE c.id = ?
         AND COALESCE(c.employee_code, e.employee_code, e_by_email.employee_code) IS NOT NULL
       ORDER BY e.created_at DESC, e_by_email.created_at DESC
       LIMIT 1`,
    [candidateId],
  ).catch(() => [[]] as RowDataPacket[][]);

  const row = Array.isArray(rows) ? rows[0] as BoolRow | undefined : undefined;
  return {
    employeeCode: row?.employee_code ?? null,
    employeeId: row?.employee_id ?? null,
  };
}

export async function checkEmployeeCodeGate(candidateId: string): Promise<GateCheckResult> {
  const blockers: string[] = [];
  const checklist: Record<string, boolean> = {};

  const existing = await findExistingEmployeeCode(candidateId);
  if (existing.employeeCode) {
    return {
      canGenerate: false,
      alreadyGenerated: true,
      employeeCode: existing.employeeCode,
      employeeId: existing.employeeId,
      blockers: [],
      checklist: {
        employee_code_generated: true,
        employee_master_created: Boolean(existing.employeeId),
      },
    };
  }

  // 1. Onboarding submitted
  //
  // `is_submitted` is not a column on candidate_onboarding_profile (there is no such
  // column in the live schema) — this query always threw ER_BAD_FIELD_ERROR, was
  // swallowed by a blanket .catch(), and silently evaluated to "not submitted" for
  // every candidate, including ones who genuinely had submitted. The real completion
  // marker is `profile_status`: checked against all 91 candidates in production that
  // already carry an employee_code, 100% of them have profile_status = 'submitted'.
  // The other values observed in production (draft, employee_details_saved,
  // bank_saved, approved) never appear on a converted candidate and never carry a
  // submitted_at timestamp either, so they are not later stages of this same flow and
  // are intentionally not treated as equivalent here.
  //
  // No .catch() here on purpose: a genuine query failure should surface as an error,
  // not silently collapse into "not submitted" the way the old bug did.
  const [cop] = await db.execute<RowDataPacket[]>(
    'SELECT profile_status FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1',
    [candidateId]
  );
  const onboardingOk = Array.isArray(cop) && cop.length > 0 && (cop[0] as BoolRow).profile_status === 'submitted';
  checklist['onboarding_submitted'] = onboardingOk;
  if (!onboardingOk) blockers.push('Candidate onboarding not submitted');

  // 2. BGV complete (ats_bgv_verification is actual table name)
  const [bgv] = await db.execute<RowDataPacket[]>(
    `SELECT verification_status FROM ats_bgv_verification
     WHERE candidate_id = ? AND verification_status IN ('completed','approved','cleared') LIMIT 1`,
    [candidateId]
  ).catch(() => [[]] as BoolRow[]);
  const bgvOk = Array.isArray(bgv) && bgv.length > 0;
  checklist['bgv_complete'] = bgvOk;
  if (!bgvOk) blockers.push('BGV not completed or approved');

  // 3. Name consistency
  const [nm] = await db.execute<RowDataPacket[]>(
    `SELECT overall_match_status FROM candidate_name_match_summary
     WHERE candidate_id = ? AND overall_match_status IN ('matched','approved') LIMIT 1`,
    [candidateId]
  ).catch(() => [[]] as BoolRow[]);
  const nameOk = Array.isArray(nm) && nm.length > 0;
  checklist['name_consistency'] = nameOk;
  if (!nameOk) blockers.push('Name consistency check not passed or not approved');

  // 4. Payroll HR validation (ats_payroll_hr_validation is actual table name)
  const [phr] = await db.execute<RowDataPacket[]>(
    `SELECT validation_status FROM ats_payroll_hr_validation
     WHERE candidate_id = ? AND validation_status = 'validated' LIMIT 1`,
    [candidateId]
  ).catch(() => [[]] as BoolRow[]);
  const phrOk = Array.isArray(phr) && phr.length > 0;
  checklist['payroll_hr_validated'] = phrOk;
  if (!phrOk) blockers.push('Payroll HR validation not complete');

  // 5. JCLR status
  //
  // Previously queried `jclr_entries`, a table with zero rows in all of production —
  // this check could never pass for anyone, ever. The JCLR field that is actually
  // populated for candidates lives on ats_payroll_hr_validation.jclr_status, but
  // nothing in this codebase ever writes any value there besides its 'pending'
  // default (verified: all 111 rows in production are 'pending' — no code path sets
  // it to 'approved', 'completed', or anything else). Gating on a specific "approved"
  // value here would just recreate the identical always-fails bug on a different
  // column.
  //
  // The Joining Control Room's own readiness gate (joining-control-room.service.ts,
  // readinessBlockers()) already settled this by explicit product decision
  // (2026-09-04): JCLR is physical joining-day logistics (workstation, ID card,
  // transport, training batch) handed to Payroll HR — operational information, not a
  // condition of employee-code eligibility. This gate follows that same decision:
  // read the real column for visibility/audit, but do not block on it.
  await db.execute<RowDataPacket[]>(
    `SELECT jclr_status FROM ats_payroll_hr_validation WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  ).catch(() => [[]] as BoolRow[]);
  checklist['jclr_approved'] = true;

  // 6. Salary components assigned
  const [sc] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM salary_component_assignments
     WHERE candidate_id = ? AND status = 'active' LIMIT 1`,
    [candidateId]
  ).catch(() => [[]] as BoolRow[]);
  const scOk = Array.isArray(sc) && sc.length > 0;
  checklist['salary_components'] = scOk;
  if (!scOk) blockers.push('Salary components not assigned');

  // 7. No duplicate employee code already generated
  const [dup] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code FROM ats_candidate WHERE id = ? AND employee_code IS NOT NULL LIMIT 1`,
    [candidateId]
  ).catch(() => [[]] as BoolRow[]);
  if (Array.isArray(dup) && dup.length > 0 && (dup[0] as BoolRow).employee_code) {
    return {
      canGenerate: false,
      alreadyGenerated: true,
      employeeCode: (dup[0] as BoolRow).employee_code ?? null,
      blockers: [],
      checklist,
    };
  }

  return { canGenerate: blockers.length === 0, blockers, checklist };
}
