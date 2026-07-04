import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

interface BoolRow extends RowDataPacket {
  is_submitted?: number | string | null;
  verification_status?: string | null;
  overall_match_status?: string | null;
  validation_status?: string | null;
  status?: string | null;
  employee_code?: string | null;
  id?: string | null;
}

export interface GateCheckResult {
  canGenerate: boolean;
  blockers: string[];
  checklist: Record<string, boolean>;
}

export async function checkEmployeeCodeGate(candidateId: string): Promise<GateCheckResult> {
  const blockers: string[] = [];
  const checklist: Record<string, boolean> = {};

  // 1. Onboarding submitted
  const [cop] = await db.execute<RowDataPacket[]>(
    'SELECT is_submitted FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1',
    [candidateId]
  ).catch(() => [[]] as BoolRow[]);
  const onboardingOk = Array.isArray(cop) && cop.length > 0 && Number((cop[0] as BoolRow).is_submitted ?? 0) === 1;
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

  // 5. JCLR BM approved
  const [jclr] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM jclr_entries WHERE candidate_id = ? AND status = 'approved' LIMIT 1`,
    [candidateId]
  ).catch(() => [[]] as BoolRow[]);
  const jclrOk = Array.isArray(jclr) && jclr.length > 0;
  checklist['jclr_approved'] = jclrOk;
  if (!jclrOk) blockers.push('JCLR not approved by BM/Branch Head');

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
      blockers: ['Employee code already generated: ' + (dup[0] as BoolRow).employee_code],
      checklist,
    };
  }

  return { canGenerate: blockers.length === 0, blockers, checklist };
}
